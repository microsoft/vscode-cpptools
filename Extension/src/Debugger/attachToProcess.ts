/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { CppSettings } from '../LanguageServer/settings';
import { AttachItem, showQuickPick } from './attachQuickPick';
import { PsProcessParser } from './nativeAttach';

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as util from '../common';
import * as debugUtils from './utils';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface AttachItemsProvider {
    getAttachItems(token?: vscode.CancellationToken): Promise<AttachItem[]>;
}

export class AttachPicker {
    constructor(private attachItemsProvider: AttachItemsProvider) { }

    // We should not await on this function.
    public async ShowAttachEntries(token?: vscode.CancellationToken): Promise<string | undefined> {
        return showQuickPick(() => this.attachItemsProvider.getAttachItems(token));
    }
}

export class RemoteAttachPicker {
    constructor() {
        this._channel = vscode.window.createOutputChannel('remote-attach');
    }

    private _channel: vscode.OutputChannel;

    public async ShowAttachEntries(config: any): Promise<string | undefined> {
        this._channel.clear();
        let processes: AttachItem[];

        const pipeTransport: any = config ? config.pipeTransport : undefined;
        const useExtendedRemote: any = config ? config.useExtendedRemote : undefined;
        const miDebuggerPath: any = config ? config.miDebuggerPath : undefined;
        const miDebuggerServerAddress: any = config ? config.miDebuggerServerAddress : undefined;

        if (pipeTransport) {
            let pipeProgram: string | undefined;

            if (os.platform() === 'win32' &&
                pipeTransport.pipeProgram &&
                !await util.checkFileExists(pipeTransport.pipeProgram)) {
                const pipeProgramStr: string = pipeTransport.pipeProgram.toLowerCase().trim();
                const expectedArch: debugUtils.ArchType = debugUtils.ArchType[process.arch as keyof typeof debugUtils.ArchType];

                // Check for pipeProgram
                if (!await util.checkFileExists(config.pipeTransport.pipeProgram)) {
                    pipeProgram = debugUtils.ArchitectureReplacer.checkAndReplaceWSLPipeProgram(pipeProgramStr, expectedArch);
                }

                // If pipeProgram does not get replaced and there is a pipeCwd, concatenate with pipeProgramStr and attempt to replace.
                if (!pipeProgram && config.pipeTransport.pipeCwd) {
                    const pipeCwdStr: string = config.pipeTransport.pipeCwd.toLowerCase().trim();
                    const newPipeProgramStr: string = path.join(pipeCwdStr, pipeProgramStr);

                    if (!await util.checkFileExists(newPipeProgramStr)) {
                        pipeProgram = debugUtils.ArchitectureReplacer.checkAndReplaceWSLPipeProgram(newPipeProgramStr, expectedArch);
                    }
                }
            }

            if (!pipeProgram) {
                pipeProgram = pipeTransport.pipeProgram;
            }

            const pipeArgs: string[] = pipeTransport.pipeArgs;

            const argList: string = RemoteAttachPicker.createArgumentList(pipeArgs);

            const pipeCmd: string = `"${pipeProgram}" ${argList}`;

            processes = await this.getRemoteOSAndProcesses(pipeCmd);
        } else if (!pipeTransport && useExtendedRemote) {
            if (!miDebuggerPath || !miDebuggerServerAddress) {
                throw new Error(localize("debugger.path.and.server.address.required", "{0} in debug configuration requires {1} and {2}", "useExtendedRemote", "miDebuggerPath", "miDebuggerServerAddress"));
            }
            processes = await this.getRemoteProcessesExtendedRemote(miDebuggerPath, miDebuggerServerAddress);
        } else {
            throw new Error(localize("no.pipetransport.useextendedremote", "Chosen debug configuration does not contain {0} or {1}", "pipeTransport", "useExtendedRemote"));
        }

        const attachPickOptions: vscode.QuickPickOptions = {
            matchOnDetail: true,
            matchOnDescription: true,
            placeHolder: localize("select.process.attach", "Select the process to attach to")
        };

        const item: AttachItem | undefined = await vscode.window.showQuickPick(processes, attachPickOptions);
        if (item) {
            return item.id;
        } else {
            throw new Error(localize("process.not.selected", "Process not selected."));
        }
    }

    // Creates a string to run on the host machine which will execute a shell script on the remote machine to retrieve OS and processes
    private getRemoteProcessCommand(): string {
        let innerQuote: string = `'`;
        let outerQuote: string = `"`;
        let parameterBegin: string = `$(`;
        let parameterEnd: string = `)`;
        let escapedQuote: string = `\\\"`;
        let shPrefix: string = ``;

        const settings: CppSettings = new CppSettings();
        if (settings.useBacktickCommandSubstitution) {
            parameterBegin = `\``;
            parameterEnd = `\``;
            escapedQuote = `\"`;
        }

        // Must use single quotes around the whole command and double quotes for the argument to `sh -c` because Linux evaluates $() inside of double quotes.
        // Having double quotes for the outerQuote will have $(uname) replaced before it is sent to the remote machine.
        if (os.platform() !== "win32") {
            innerQuote = `"`;
            outerQuote = `'`;
        }
        // Also use a full path on Linux, so that we can use transports that need a full path such as 'machinectl' to connect to nspawn containers.
        if (os.platform() === "linux") {
            shPrefix = `/bin/`;
        }

        return `${outerQuote}${shPrefix}sh -c ${innerQuote}uname && if [ ${parameterBegin}uname -o${parameterEnd} = ${escapedQuote}Toybox${escapedQuote} ] ; ` +
            `then ${PsProcessParser.psToyboxCommand} ; elif [ ${parameterBegin}uname${parameterEnd} = ${escapedQuote}Linux${escapedQuote} ] ; ` +
            `then ${PsProcessParser.psLinuxCommand} ; elif [ ${parameterBegin}uname${parameterEnd} = ${escapedQuote}Darwin${escapedQuote} ] ; ` +
            `then ${PsProcessParser.psDarwinCommand}; fi${innerQuote}${outerQuote}`;
    }

    private async getRemoteOSAndProcesses(pipeCmd: string): Promise<AttachItem[]> {
        // Do not add any quoting in execCommand.
        const execCommand: string = `${pipeCmd} ${this.getRemoteProcessCommand()}`;

        const output: string = await util.execChildProcess(execCommand, undefined, this._channel);
        // OS will be on first line
        // Processes will follow if listed
        const lines: string[] = output.split(/\r?\n/);
        if (lines.length === 0) {
            throw new Error(localize("pipe.failed", "Pipe transport failed to get OS and processes."));
        } else {
            const remoteOS: string = lines[0].replace(/[\r\n]+/g, '');

            if (remoteOS !== "Linux" && remoteOS !== "Darwin") {
                throw new Error(`Operating system "${remoteOS}" not supported.`);
            }

            // Only got OS from uname
            if (lines.length === 1) {
                throw new Error(localize("no.process.list", "Transport attach could not obtain processes list."));
            } else {
                const processes: string[] = lines.slice(1);
                return PsProcessParser.ParseProcessFromPsArray(processes)
                    .sort((a, b) => {
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
                    })
                    .map(p => p.toAttachItem());
            }
        }
    }

    private async getRemoteProcessesExtendedRemote(miDebuggerPath: string, miDebuggerServerAddress: string): Promise<AttachItem[]> {
        const args: string[] = [`-ex "target extended-remote ${miDebuggerServerAddress}"`, '-ex "info os processes"', '-batch'];
        let processListOutput: util.ProcessReturnType = await util.spawnChildProcess(miDebuggerPath, args);
        // The device may not be responsive for a while during the restart after image deploy. Retry 5 times.
        for (let i: number = 0; i < 5 && !processListOutput.succeeded; i++) {
            processListOutput = await util.spawnChildProcess(miDebuggerPath, args);
        }

        if (!processListOutput.succeeded) {
            throw new Error(localize('failed.to.make.gdb.connection', 'Failed to make GDB connection: "{0}".', processListOutput.output));
        }
        const processes: AttachItem[] = this.parseProcessesFromInfoOsProcesses(processListOutput.output);
        if (!processes || processes.length === 0) {
            throw new Error(localize('failed.to.parse.processes', 'Failed to parse processes: "{0}".', processListOutput.output));
        }
        return processes;
    }

    /**
    Format:
    pid      usr      command     cores
    1        ?
    2        ?
    3                 /usr/bin/sample 0,2
    4        root     /usr/bin/gdbserver --multi :6000 0

    Returns an AttachItem array, each item contains a label of "<user   >command", and a pid.
    Unfortunately because the format of each line is not fixed, and everything except pid is optional, it's hard
    to get a better label.
    */
    private parseProcessesFromInfoOsProcesses(processList: string): AttachItem[] {
        const lines: string[] = processList?.split('\n');
        if (!lines?.length) {
            return [];
        }

        const processes: AttachItem[] = [];
        for (const line of lines) {
            const trimmedLine: string = line.trim();
            if (!trimmedLine.endsWith('?')) {
                const matches: RegExpMatchArray | null = trimmedLine.match(/^(\d+)\s+(.+?)\s+(?:\d+,)*\d+$/);
                if (matches?.length === 3) {
                    const id: string = matches[1];
                    const userCommand: string = matches[2];
                    processes.push({ label: userCommand, id, description: id });
                }
            }
        }

        return processes;
    }

    private static createArgumentList(args: string[]): string {
        let argsString: string = "";

        for (const arg of args) {
            if (argsString) {
                argsString += " ";
            }
            argsString += `"${arg}"`;
        }

        return argsString;
    }
}
