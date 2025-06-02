/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as child_process from 'child_process';
import * as os from 'os';
import { normalize } from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { findPowerShell } from '../common';
import { isMacOS } from '../constants';
import { AttachItem } from './attachQuickPick';
import { AttachItemsProvider } from './attachToProcess';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class Process implements AttachItem {
    get label() {
        return this.name;
    }

    get description() {
        // If the fullPath is known and different than the process name, put that in the description after the pid
        // to let the user can find the actual process they are looking for.
        return this.fullPath && this.fullPath !== this.name ? `${this.pid} [${this.fullPath}]` : this.pid;
    }

    get detail() {
        return this.commandLine;
    }

    get id() {
        return this.pid;
    }

    constructor(public name: string, public pid?: string, public commandLine?: string, public fullPath?: string) {
        if (this.fullPath) {
            // If we have a full path, clean it up.
            if (this.fullPath?.startsWith('"') && this.fullPath.endsWith('"')) {
                this.fullPath = this.fullPath.slice(1, -1);
            }
            this.fullPath = normalize(this.fullPath);
        }
    }
}

export class NativeAttachItemsProviderFactory {
    static Get(): AttachItemsProvider {
        if (os.platform() === 'win32') {
            const pwsh: string | undefined = findPowerShell();
            return pwsh ? new CimAttachItemsProvider(pwsh) : new WmicAttachItemsProvider();
        } else {
            return new PsAttachItemsProvider();
        }
    }
}

abstract class NativeAttachItemsProvider implements AttachItemsProvider {
    protected abstract getInternalProcessEntries(token?: vscode.CancellationToken): Promise<Process[]>;

    async getAttachItems(token?: vscode.CancellationToken): Promise<AttachItem[]> {
        const processEntries: Process[] = await this.getInternalProcessEntries(token);
        // localeCompare is significantly slower than < and > (2000 ms vs 80 ms for 10,000 elements)
        // We can change to localeCompare if this becomes an issue
        processEntries.sort((a, b) => {
            if (a.name === undefined) {
                if (b.name === undefined) {
                    return 0;
                }
                return 1;
            }
            if (b.name === undefined) {
                return -1;
            }
            const aLower: string = a.name.toLowerCase();
            const bLower: string = b.name.toLowerCase();
            if (aLower === bLower) {
                return 0;
            }
            return aLower < bLower ? -1 : 1;
        });
        return processEntries;
    }
}

export class PsAttachItemsProvider extends NativeAttachItemsProvider {
    // Perf numbers:
    // OS X 10.10
    // | # of processes | Time (ms) |
    // |----------------+-----------|
    // |            272 |        52 |
    // |            296 |        49 |
    // |            384 |        53 |
    // |            784 |       116 |
    //
    // Ubuntu 16.04
    // | # of processes | Time (ms) |
    // |----------------+-----------|
    // |            232 |        26 |
    // |            336 |        34 |
    // |            736 |        62 |
    // |           1039 |       115 |
    // |           1239 |       182 |

    // ps outputs as a table. With the option "ww", ps will use as much width as necessary.
    // However, that only applies to the right-most column. Here we use a hack of setting
    // the column header to 50 a's so that the second column will have at least that many
    // characters. 50 was chosen because that's the maximum length of a "label" in the
    // QuickPick UI in VSCode.

    protected async getInternalProcessEntries(token?: vscode.CancellationToken): Promise<Process[]> {
        switch (os.platform()) {
            case 'darwin':
                return PsProcessParser.ParseProcessFromPs(await spawnChildProcess(PsProcessParser.psDarwinCommand, token));
            case 'linux':
                return PsProcessParser.ParseProcessFromPs(await spawnChildProcess(PsProcessParser.psLinuxCommand, token));
            default:
                throw new Error(localize("os.not.supported", 'Operating system "{0}" not supported.', os.platform()));
        }
    }
}

export class PsProcessParser {
    // Use a large fixed width - the default on macOS is quite small.
    static fixedWidth = ''.padEnd(512, 'a');

    // Note that comm on Linux systems is truncated to 16 characters:
    // https://bugzilla.redhat.com/show_bug.cgi?id=429565
    public static get psLinuxCommand(): string { return `ps axww -o pid=,exe=${this.fixedWidth},args=${this.fixedWidth}`; }
    public static get psDarwinCommand(): string { return `ps axww -o pid=,comm=${this.fixedWidth},args=${this.fixedWidth}`; }
    public static get psToyboxCommand(): string { return `ps -A -o pid=,comm=${this.fixedWidth},args=${this.fixedWidth}`; }

    // Only public for tests.
    public static ParseProcessFromPs(processes: string): Process[] {
        const lines: string[] = processes.split(os.EOL);
        return PsProcessParser.ParseProcessFromPsArray(lines);
    }

    public static ParseProcessFromPsArray(processArray: string[]): Process[] {
        const processEntries: Process[] = [];

        // lines[0] is the header of the table
        for (let i: number = 1; i < processArray.length; i++) {
            const line: string = processArray[i];
            if (!line) {
                continue;
            }

            const processEntry: Process | undefined = PsProcessParser.parseLineFromPs(line);
            if (processEntry) {
                processEntries.push(processEntry);
            }
        }

        return processEntries;
    }

    private static parseLineFromPs(line: string): Process | undefined {
        const psEntry = isMacOS ?
            // On macOS, we're using fixed-width columns, so we have to use a fixed-width regex.
            // <start>whitespace(NUMBERS)whitespace(FIXED-WIDTH)whitespace(EVERYTHING-ELSE)<end>
            new RegExp(`^\\s*([0-9]+)\\s+(.{${PsProcessParser.fixedWidth.length - 1}})\\s+(.*)$`) :

            // On Linux, column widths cannot be guaranteed - but we do get escaped spaces in the command line.
            // <start>whitespace(NUMBERS)whitespace(NOTWHITESPACE)whitespace(EVERYTHING-ELSE)<end>
            /^\s*(\d+)\s+((?:\\\s|\S)+)\s+([\s\S]*)$/;

        const matches: RegExpExecArray | null = psEntry.exec(line);
        if (matches && matches.length === 4) {
            const pid: string = matches[1].trim();
            let fullPath: string = matches[2].trim();
            const rawCommandLine = matches[3].trim();

            // Trim the full path off the command line so that we optimize for seeing '<cmd> <args>'.
            const cmdline: string = rawCommandLine.replace(/^\s*[\/\\]*(?:(?:[^\\\/\s]|\\.)+[\/\\])*([^\\\/\s]+)(?=\s|$)/, "$1");

            // If the fullPath == '-', let's grab the arg0 from the raw command line.
            if (fullPath === '-') {
                const args = /^((?:\\\s|\S)+)\s*([\s\S]*)$/.exec(rawCommandLine);
                if (args) {
                    fullPath = args[1];
                }
            }

            const executable: string = fullPath.replace(/^.*\//, '');

            // Skip processes that are '<defunct>'.
            if (executable === '<defunct>' || cmdline.includes('<defunct>')) {
                return undefined;
            }

            return new Process(executable, pid, cmdline, fullPath);
        }
    }
}

function spawnChildProcess(command: string, token?: vscode.CancellationToken): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const process: child_process.ChildProcess = child_process.spawn(command, { shell: true });
        let stdout: string = "";
        let stderr: string = "";

        if (process) {
            let cancellationTokenListener: vscode.Disposable | undefined; // eslint-disable-line prefer-const
            // Handle timeout
            const seconds: number = 30;
            const processTimeout: NodeJS.Timeout = setTimeout(() => {
                process.removeAllListeners();
                if (cancellationTokenListener) {
                    cancellationTokenListener.dispose();
                }

                try {
                    process.kill();
                } catch (e) {
                    // Failed to kill process.
                }
                reject(new Error(localize("timeout.processList.spawn", '"{0}" timed out after {1} seconds.', command, seconds)));
                return;
            }, seconds * 1000);

            // Handle cancellation
            cancellationTokenListener = token?.onCancellationRequested(() => {
                clearTimeout(processTimeout);
                process.removeAllListeners();

                try {
                    process.kill();
                } catch (e) {
                    // Failed to kill process.
                }
                reject(new Error(localize("cancel.processList.spawn", '"{0}" canceled.', command)));
                return;
            });

            const cleanUpCallbacks = () => {
                clearTimeout(processTimeout);
                process.removeAllListeners();
                if (cancellationTokenListener) {
                    cancellationTokenListener.dispose();
                }
            };

            // Handle data streams
            if (process.stdout) {
                process.stdout.on('data', (data: string) => {
                    stdout += data.toString();
                });
            }

            if (process.stderr) {
                process.stderr.on('data', (data: string) => {
                    stderr += data.toString();
                });
            }

            // Handle process exit
            process.on('close', (code: number) => {
                cleanUpCallbacks();
                if (code !== 0) {
                    let errorMessage: string = localize("error.processList.spawn", '"{0}" exited with code: "{1}".', command, code);
                    if (stderr && stderr.length > 0) {
                        errorMessage += os.EOL;
                        errorMessage += stderr;
                    }
                    reject(new Error(errorMessage));
                    return;
                }

                if (stderr && stderr.length > 0) {
                    if (stderr.indexOf('screen size is bogus') >= 0) {
                        // ignore this error silently; see https://github.com/microsoft/vscode/issues/75932
                        // see similar fix for the Node - Debug (Legacy) Extension at https://github.com/microsoft/vscode-node-debug/commit/5298920
                    } else {
                        reject(new Error(stderr));
                        return;
                    }
                }

                resolve(stdout);
            });

            // Handle process error
            process.on('error', error => {
                cleanUpCallbacks();
                reject(error);
            });
        } else {
            reject(new Error(localize("failed.processList.spawn", 'Failed to spawn "{0}".', command)));
        }
    });
}

export class WmicAttachItemsProvider extends NativeAttachItemsProvider {
    // Perf numbers on Win10:
    // | # of processes | Time (ms) |
    // |----------------+-----------|
    // |            309 |       413 |
    // |            407 |       463 |
    // |            887 |       746 |
    // |           1308 |      1132 |

    protected async getInternalProcessEntries(token?: vscode.CancellationToken): Promise<Process[]> {
        const wmicCommand: string = 'wmic process get Name,ProcessId,CommandLine /FORMAT:list';
        const processes: string = await spawnChildProcess(wmicCommand, token);
        return WmicProcessParser.ParseProcessFromWmic(processes);
    }
}

export class WmicProcessParser {
    private static get wmicNameTitle(): string { return 'Name'; }
    private static get wmicCommandLineTitle(): string { return 'CommandLine'; }
    private static get wmicPidTitle(): string { return 'ProcessId'; }

    // Only public for tests.
    public static ParseProcessFromWmic(processes: string): Process[] {
        const lines: string[] = processes.split(os.EOL);
        let currentProcess: Process = new Process("current process", undefined, undefined);
        const processEntries: Process[] = [];

        for (let i: number = 0; i < lines.length; i++) {
            const line: string = lines[i];
            if (!line) {
                continue;
            }

            WmicProcessParser.parseLineFromWmic(line, currentProcess);

            // Each entry of processes has ProcessId as the last line
            if (line.lastIndexOf(WmicProcessParser.wmicPidTitle, 0) === 0) {
                processEntries.push(currentProcess);
                currentProcess = new Process("current process", undefined, undefined);
            }
        }

        return processEntries;
    }

    private static parseLineFromWmic(line: string, process: Process): void {
        const splitter: number = line.indexOf('=');
        if (splitter >= 0) {
            const key: string = line.slice(0, line.indexOf('=')).trim();
            let value: string = line.slice(line.indexOf('=') + 1).trim();
            if (key === WmicProcessParser.wmicNameTitle) {
                process.name = value;
            } else if (key === WmicProcessParser.wmicPidTitle) {
                process.pid = value;
            } else if (key === WmicProcessParser.wmicCommandLineTitle) {
                const extendedLengthPath: string = '\\??\\';
                if (value.lastIndexOf(extendedLengthPath, 0) === 0) {
                    value = value.slice(extendedLengthPath.length);
                }

                process.commandLine = value;
            }
        }
    }
}

export class CimAttachItemsProvider extends NativeAttachItemsProvider {
    constructor(private pwsh: string) { super(); }

    // Perf numbers on Win10:
    // TODO

    protected async getInternalProcessEntries(token?: vscode.CancellationToken): Promise<Process[]> {
        const pwshCommand: string = `${this.pwsh} -NoProfile -Command`;
        const cimCommand: string = 'Get-CimInstance Win32_Process | Select-Object Name,ProcessId,CommandLine,Path | ConvertTo-JSON -Compress';
        const processes: string = await spawnChildProcess(`${pwshCommand} "${cimCommand}"`, token);
        return CimProcessParser.ParseProcessFromCim(processes);
    }
}

type CimProcessInfo = {
    Name: string;
    ProcessId: number;
    CommandLine: string | null;
    Path: string | null;
};

export class CimProcessParser {
    private static get extendedLengthPathPrefix(): string { return '\\\\?\\'; }
    private static get ntObjectManagerPathPrefix(): string { return '\\??\\'; }

    // Only public for tests.
    public static ParseProcessFromCim(processes: string): Process[] {
        const processInfos: CimProcessInfo[] = JSON.parse(processes);
        return processInfos.map(info => {
            let cmdline: string | undefined = info.CommandLine || undefined;
            if (cmdline?.startsWith(this.extendedLengthPathPrefix)) {
                cmdline = cmdline.slice(this.extendedLengthPathPrefix.length);
            }
            if (cmdline?.startsWith(this.ntObjectManagerPathPrefix)) {
                cmdline = cmdline.slice(this.ntObjectManagerPathPrefix.length);
            }
            return new Process(info.Name, `${info.ProcessId}`, cmdline, info.Path || undefined);
        });
    }
}
