/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { sessionIsWsl } from '../common';

/**
 * A minimal inline Debug Adapter that runs the target program directly without a debug adapter
 * when the user invokes "Run Without Debugging".
 */
export class RunWithoutDebuggingAdapter implements vscode.DebugAdapter {
    private readonly sendMessageEmitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    public readonly onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.sendMessageEmitter.event;

    private seq: number = 1;
    private childProcess?: cp.ChildProcess;
    private terminal?: vscode.Terminal;

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

        if (consoleMode === 'integratedTerminal') {
            this.launchIntegratedTerminal(program, args, cwd, env);
        } else if (consoleMode === 'externalTerminal') {
            this.launchExternalTerminal(program, args, cwd, env);
        } else {
            this.launchInternalConsole(program, args, cwd, env);
        }
    }

    /**
     * Launch the program in a VS Code integrated terminal.
     * The terminal will remain open after the program exits and be reused for the next session, if applicable.
     */
    private launchIntegratedTerminal(program: string, args: string[], cwd: string | undefined, env: NodeJS.ProcessEnv) {
        const shellArgs: string[] = [program, ...args].map(a => this.quoteArg(a));
        const terminalName = path.normalize(program);
        const existingTerminal = vscode.window.terminals.find(t => t.name === terminalName);
        this.terminal = existingTerminal ?? vscode.window.createTerminal({
            name: terminalName,
            cwd,
            env: env as Record<string, string>
        });
        this.terminal.show(true);
        this.terminal.sendText(shellArgs.join(' '));

        // The terminal manages its own lifecycle; notify VS Code the "debug" session is done.
        this.sendEvent('terminated');
    }

    /**
     * Launch the program in an external terminal. We do not keep track of this terminal or the spawned process.
     */
    private launchExternalTerminal(program: string, args: string[], cwd: string | undefined, env: NodeJS.ProcessEnv): void {
        const quotedArgs: string[] = [program, ...args].map(a => this.quoteArg(a));
        const cmdLine: string = quotedArgs.join(' ');
        const platform: string = os.platform();
        if (platform === 'win32') {
            cp.spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/K', cmdLine], { cwd, env, detached: true, stdio: 'ignore' }).unref();
        } else if (platform === 'darwin') {
            cp.spawn('osascript', ['-e', `tell application "Terminal" to do script "${cmdLine.replace(/"/g, '\\"')}"`], { cwd, env, detached: true, stdio: 'ignore' }).unref();
        } else if (platform === 'linux' && sessionIsWsl()) {
            cp.spawn('/mnt/c/Windows/System32/cmd.exe', ['/c', 'start', 'bash', '-c', `${cmdLine};read -p 'Press enter to continue...'`], { env, detached: true, stdio: 'ignore' }).unref();
        } else { // platform === 'linux'
            cp.spawn('bash', ['-c', `${cmdLine};read -p 'Press enter to continue...'`], { cwd, env, detached: true, stdio: 'ignore' }).unref();
        }
        this.sendEvent('terminated');
    }

    /**
     * Spawn the process and forward stdout/stderr as DAP output events.
     */
    private launchInternalConsole(program: string, args: string[], cwd: string | undefined, env: NodeJS.ProcessEnv) {
        this.childProcess = cp.spawn(program, args, { cwd, env });

        this.childProcess.stdout?.on('data', (data: Buffer) => {
            this.sendEvent('output', { category: 'stdout', output: data.toString() });
        });
        this.childProcess.stderr?.on('data', (data: Buffer) => {
            this.sendEvent('output', { category: 'stderr', output: data.toString() });
        });
        this.childProcess.on('error', (err: Error) => {
            this.sendEvent('output', { category: 'stderr', output: `${err.message}\n` });
            this.sendEvent('exited', { exitCode: 1 });
            this.sendEvent('terminated');
        });
        this.childProcess.on('exit', (code: number | null) => {
            this.sendEvent('exited', { exitCode: code ?? 0 });
            this.sendEvent('terminated');
        });
    }

    private quoteArg(arg: string): string {
        return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
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
        this.sendMessageEmitter.fire({
            type: 'event',
            seq: this.seq++,
            event,
            body
        } as vscode.DebugProtocolMessage);
    }

    public dispose(): void {
        this.terminateProcess();
        this.sendMessageEmitter.dispose();
    }

    private terminateProcess(): void {
        this.childProcess?.kill();
        this.childProcess = undefined;
    }
}
