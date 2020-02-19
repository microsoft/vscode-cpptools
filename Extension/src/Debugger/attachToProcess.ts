/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { PsProcessParser } from './nativeAttach';
import { AttachItem, showQuickPick } from './attachQuickPick';

import * as debugUtils from './utils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as util from '../common';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface AttachItemsProvider {
    getAttachItems(): Promise<AttachItem[]>;
}

export class AttachPicker {
    constructor(private attachItemsProvider: AttachItemsProvider) { }

    public ShowAttachEntries(): Promise<string> {
        return util.isExtensionReady().then(ready => {
            if (!ready) {
                util.displayExtensionNotReadyPrompt();
            } else {
                return showQuickPick(() => this.attachItemsProvider.getAttachItems());
            }
        });
    }
}

export class RemoteAttachPicker {
    constructor() {
        this._channel = vscode.window.createOutputChannel('remote-attach');
    }

    private _channel: vscode.OutputChannel = null;

    public ShowAttachEntries(config: any): Promise<string> {
        return util.isExtensionReady().then(ready => {
            if (!ready) {
                util.displayExtensionNotReadyPrompt();
            } else {
                this._channel.clear();

                let pipeTransport: any = config ? config.pipeTransport : null;

                if (pipeTransport === null) {
                    return Promise.reject<string>(new Error(localize("no.pipetransport", "Chosen debug configuration does not contain {0}", "pipeTransport")));
                }

                let pipeProgram: string = null;

                if (os.platform() === 'win32' &&
                    pipeTransport.pipeProgram &&
                    !fs.existsSync(pipeTransport.pipeProgram)) {
                    const pipeProgramStr: string = pipeTransport.pipeProgram.toLowerCase().trim();
                    const expectedArch: debugUtils.ArchType = debugUtils.ArchType[process.arch];

                    // Check for pipeProgram
                    if (!fs.existsSync(config.pipeTransport.pipeProgram)) {
                        pipeProgram = debugUtils.ArchitectureReplacer.checkAndReplaceWSLPipeProgram(pipeProgramStr, expectedArch);
                    }

                    // If pipeProgram does not get replaced and there is a pipeCwd, concatenate with pipeProgramStr and attempt to replace.
                    if (!pipeProgram && config.pipeTransport.pipeCwd) {
                        const pipeCwdStr: string = config.pipeTransport.pipeCwd.toLowerCase().trim();
                        const newPipeProgramStr: string = path.join(pipeCwdStr, pipeProgramStr);

                        if (!fs.existsSync(newPipeProgramStr)) {
                            pipeProgram = debugUtils.ArchitectureReplacer.checkAndReplaceWSLPipeProgram(newPipeProgramStr, expectedArch);
                        }
                    }
                }

                if (!pipeProgram) {
                    pipeProgram = pipeTransport.pipeProgram;
                }

                let pipeArgs: string[] = pipeTransport.pipeArgs;

                let argList: string = RemoteAttachPicker.createArgumentList(pipeArgs);

                let pipeCmd: string = `"${pipeProgram}" ${argList}`;

                return this.getRemoteOSAndProcesses(pipeCmd)
                    .then(processes => {
                        let attachPickOptions: vscode.QuickPickOptions = {
                            matchOnDetail: true,
                            matchOnDescription: true,
                            placeHolder: localize("select.process.attach", "Select the process to attach to")
                        };

                        return vscode.window.showQuickPick(processes, attachPickOptions)
                            .then(item => item ? item.id : Promise.reject<string>(new Error(localize("process.not.selected", "Process not selected."))));
                    });
            }
        });
    }

    // Creates a string to run on the host machine which will execute a shell script on the remote machine to retrieve OS and processes
    private getRemoteProcessCommand(): string {
        let innerQuote: string = `'`;
        let outerQuote: string = `"`;

        // Must use single quotes around the whole command and double quotes for the argument to `sh -c` because Linux evaluates $() inside of double quotes.
        // Having double quotes for the outerQuote will have $(uname) replaced before it is sent to the remote machine.
        if (os.platform() !== "win32") {
            innerQuote = `"`;
            outerQuote = `'`;
        }

        return `${outerQuote}sh -c ${innerQuote}uname && if [ $(uname) = \\\"Linux\\\" ] ; then ${PsProcessParser.psLinuxCommand} ; elif [ $(uname) = \\\"Darwin\\\" ] ; ` +
        `then ${PsProcessParser.psDarwinCommand}; fi${innerQuote}${outerQuote}`;
    }

    private getRemoteOSAndProcesses(pipeCmd: string): Promise<AttachItem[]> {
        // Do not add any quoting in execCommand.
        const execCommand: string = `${pipeCmd} ${this.getRemoteProcessCommand()}`;

        return util.execChildProcess(execCommand, null, this._channel).then(output => {
            // OS will be on first line
            // Processes will follow if listed
            let lines: string[] = output.split(/\r?\n/);

            if (lines.length === 0) {
                return Promise.reject<AttachItem[]>(new Error(localize("pipe.failed", "Pipe transport failed to get OS and processes.")));
            } else {
                let remoteOS: string = lines[0].replace(/[\r\n]+/g, '');

                if (remoteOS !== "Linux" && remoteOS !== "Darwin") {
                    return Promise.reject<AttachItem[]>(new Error(`Operating system "${remoteOS}" not supported.`));
                }

                // Only got OS from uname
                if (lines.length === 1) {
                    return Promise.reject<AttachItem[]>(new Error(localize("no.process.list", "Transport attach could not obtain processes list.")));
                } else {
                    let processes: string[] = lines.slice(1);
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
                            let aLower: string = a.name.toLowerCase();
                            let bLower: string = b.name.toLowerCase();
                            if (aLower === bLower) {
                                return 0;
                            }
                            return aLower < bLower ? -1 : 1;
                        })
                        .map(p => p.toAttachItem());
                }
            }
        });
    }

    private static createArgumentList(args: string[]): string {
        let argsString: string = "";

        for (let arg of args) {
            if (argsString) {
                argsString += " ";
            }
            argsString += `"${arg}"`;
        }

        return argsString;
    }
}
