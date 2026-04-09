/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { buildShellCommandLine, sessionIsWsl } from '../common';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize = nls.loadMessageBundle();

/**
 * A minimal inline Debug Adapter that runs the target program directly without a debug adapter
 * when the user invokes "Run Without Debugging".
 */
export class RunWithoutDebuggingAdapter implements vscode.DebugAdapter {
    private readonly sendMessageEmitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    public readonly onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.sendMessageEmitter.event;
    private readonly terminalListeners: vscode.Disposable[] = [];

    private seq: number = 1;
    private childProcess?: cp.ChildProcess;
    private terminal?: vscode.Terminal;
    private terminalExecution?: vscode.TerminalShellExecution;
    private hasTerminated: boolean = false;

    public handleMessage(message: vscode.DebugProtocolMessage): void {
        const msg = message as { type: string; command: string; seq: number; arguments?: any; };
        if (msg.type === 'request') {
            void this.handleRequest(msg);
        }
    }

    private async handleRequest(request: { command: string; seq: number; arguments?: any; }): Promise<void> {
        switch (request.command) {
            case 'initialize':
                this.sendResponse(request, {});
                this.sendEvent('initialized');
                break;
            case 'launch':
                await this.launch(request);
                break;
            case 'configurationDone':
                this.sendResponse(request, {});
                break;
            case 'disconnect':
            case 'terminate':
                this.sendResponse(request, {});
                break;
            default:
                this.sendResponse(request, {});
                break;
        }
    }

    private async launch(request: { command: string; seq: number; arguments?: any; }): Promise<void> {
        const config = request.arguments as {
            program?: string;
            args?: string[];
            cwd?: string;
            environment?: { name: string; value: string; }[];
            console?: string;
            externalConsole?: boolean;
        };

        const program: string = config.program ?? '';
        const args: string[] = config.args ?? [];
        const cwd: string | undefined = config.cwd;
        const environment: { name: string; value: string; }[] = config.environment ?? [];
        const consoleMode: string = config.console ?? (config.externalConsole ? 'externalTerminal' : 'integratedTerminal');

        // Merge the launch config's environment variables on top of the inherited process environment.
        const env: NodeJS.ProcessEnv = { ...process.env };
        for (const e of environment) {
            env[e.name] = e.value;
        }

        this.sendResponse(request, {});

        if (consoleMode === 'integratedTerminal' || consoleMode === 'internalConsole') {
            await this.launchIntegratedTerminal(program, args, cwd, env);
        } else if (consoleMode === 'externalTerminal') {
            this.launchExternalTerminal(program, args, cwd, env);
        }
    }

    /**
     * Launch the program in a VS Code integrated terminal.
     * The terminal will remain open after the program exits and be reused for the next session, if applicable.
     */
    private async launchIntegratedTerminal(program: string, args: string[], cwd: string | undefined, env: NodeJS.ProcessEnv): Promise<void> {
        const terminalName = path.normalize(program);
        const existingTerminal = vscode.window.terminals.find(t => t.name === terminalName);
        this.terminal = existingTerminal ?? vscode.window.createTerminal({
            name: terminalName,
            cwd,
            env: env as Record<string, string>
        });
        this.terminal.show(true);

        const shellIntegration: vscode.TerminalShellIntegration | undefined =
            this.terminal.shellIntegration ?? await this.waitForShellIntegration(this.terminal, 3000);

        // Not all terminals support shell integration. If it's not available, we'll just send the command as text though we won't be able to monitor its execution.
        if (shellIntegration) {
            this.monitorIntegratedTerminal(this.terminal);
            if (program.includes(' ')) {
                // VS Code does not automatically quote the program path if it has spaces.
                program = `"${program}"`;
            }
            this.terminalExecution = shellIntegration.executeCommand(program, args);
        } else {
            const cmdLine: string = buildShellCommandLine('', program, args);
            this.terminal.sendText(cmdLine);

            // The terminal manages its own lifecycle; notify VS Code the "debug" session is done.
            this.sendEvent('terminated');
        }
    }

    /**
     * Launch the program in an external terminal. We do not keep track of this terminal or the spawned process.
     */
    private launchExternalTerminal(program: string, args: string[], cwd: string | undefined, env: NodeJS.ProcessEnv): void {
        const cmdLine: string = buildShellCommandLine('', program, args);
        const platform: string = os.platform();
        if (platform === 'win32') {
            cp.spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/K', cmdLine], { cwd, env, detached: true, stdio: 'ignore' }).unref();
        } else if (platform === 'darwin') {
            cp.spawn('osascript', ['-e', `tell application "Terminal" to do script "${this.escapeQuotes(cmdLine)}"`], { cwd, env, detached: true, stdio: 'ignore' }).unref();
        } else if (platform === 'linux' && sessionIsWsl()) {
            cp.spawn('/mnt/c/Windows/System32/cmd.exe', ['/c', 'start', 'bash', '-c', `${cmdLine};read -p 'Press enter to continue...'`], { env, detached: true, stdio: 'ignore' }).unref();
        } else { // platform === 'linux'
            this.launchLinuxExternalTerminal(cmdLine, cwd, env);
        }
        this.sendEvent('terminated');
    }

    /**
     * On Linux, find and launch an available terminal emulator to run the command.
     */
    private launchLinuxExternalTerminal(cmdLine: string, cwd: string | undefined, env: NodeJS.ProcessEnv): void {
        const bashCmd = `${cmdLine}; echo; read -p 'Press enter to continue...'`;
        const bashArgs = ['bash', '-c', bashCmd];

        // Terminal emulators in order of preference, with the correct flag style for each.
        const candidates: { cmd: string; buildArgs(): string[] }[] = [
            { cmd: 'x-terminal-emulator', buildArgs: () => ['-e', ...bashArgs] },
            { cmd: 'gnome-terminal', buildArgs: () => ['-e', ...bashArgs] },
            { cmd: 'konsole', buildArgs: () => ['-e', ...bashArgs] },
            { cmd: 'xterm', buildArgs: () => ['-e', ...bashArgs] }
        ];

        // Honor the $TERMINAL environment variable if set.
        const terminalEnv = process.env['TERMINAL'];
        if (terminalEnv) {
            candidates.unshift({ cmd: terminalEnv, buildArgs: () => ['-e', ...bashArgs] });
        }

        for (const candidate of candidates) {
            try {
                const result = cp.spawnSync('which', [candidate.cmd], { stdio: 'pipe' });
                if (result.status === 0) {
                    cp.spawn(candidate.cmd, candidate.buildArgs(), { cwd, env, detached: true, stdio: 'ignore' }).unref();
                    return;
                }
            } catch {
                continue;
            }
        }

        const message = localize('no.terminal.emulator', 'No terminal emulator found. Please set the $TERMINAL environment variable to your terminal emulator of choice, or install one of the following: x-terminal-emulator, gnome-terminal, konsole, xterm.');
        vscode.window.showErrorMessage(message);
    }

    private escapeQuotes(arg: string): string {
        return arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    private waitForShellIntegration(terminal: vscode.Terminal, timeoutMs: number): Promise<vscode.TerminalShellIntegration | undefined> {
        return new Promise(resolve => {
            let resolved: boolean = false;
            const done = (shellIntegration: vscode.TerminalShellIntegration | undefined): void => {
                if (resolved) {
                    return;
                }

                resolved = true;
                clearTimeout(timeout);
                shellIntegrationChanged.dispose();
                terminalClosed.dispose();
                resolve(shellIntegration);
            };

            const timeout = setTimeout(() => done(undefined), timeoutMs);
            const shellIntegrationChanged = vscode.window.onDidChangeTerminalShellIntegration(event => {
                if (event.terminal === terminal) {
                    done(event.shellIntegration);
                }
            });
            const terminalClosed = vscode.window.onDidCloseTerminal(closedTerminal => {
                if (closedTerminal === terminal) {
                    done(undefined);
                }
            });
        });
    }

    private monitorIntegratedTerminal(terminal: vscode.Terminal): void {
        this.disposeTerminalListeners();
        this.terminalListeners.push(
            vscode.window.onDidEndTerminalShellExecution(event => {
                if (event.terminal !== terminal || event.execution !== this.terminalExecution || this.hasTerminated) {
                    return;
                }

                if (event.exitCode !== undefined) {
                    this.sendEvent('exited', { exitCode: event.exitCode });
                }

                this.sendEvent('terminated');
            }),
            vscode.window.onDidCloseTerminal(closedTerminal => {
                if (closedTerminal !== terminal || this.hasTerminated) {
                    return;
                }

                this.sendEvent('terminated');
            })
        );
    }

    private disposeTerminalListeners(): void {
        while (this.terminalListeners.length > 0) {
            this.terminalListeners.pop()?.dispose();
        }
    }

    private sendResponse(request: { command: string; seq: number; }, body: object): void {
        this.sendMessageEmitter.fire({
            type: 'response',
            seq: this.seq++,
            request_seq: request.seq,
            success: true,
            command: request.command,
            body
        } as vscode.DebugProtocolMessage);
    }

    private sendEvent(event: string, body?: object): void {
        if (event === 'terminated') {
            if (this.hasTerminated) {
                return;
            }

            this.hasTerminated = true;
            this.disposeTerminalListeners();
        }

        this.sendMessageEmitter.fire({
            type: 'event',
            seq: this.seq++,
            event,
            body
        } as vscode.DebugProtocolMessage);
    }

    public dispose(): void {
        this.terminateProcess();
        this.disposeTerminalListeners();
        this.sendMessageEmitter.dispose();
    }

    private terminateProcess(): void {
        this.childProcess?.kill();
        this.childProcess = undefined;
    }
}
