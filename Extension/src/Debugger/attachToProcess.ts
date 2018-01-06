/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import { execChildProcess } from '../common';
import { PsProcessParser } from './nativeAttach';
import * as util from '../common';

export interface AttachItem extends vscode.QuickPickItem {
    id: string;
}

export interface AttachItemsProvider {
    getAttachItems(): Promise<AttachItem[]>;
}

export class AttachPicker {
    constructor(private attachItemsProvider: AttachItemsProvider) { }

    public ShowAttachEntries(): Promise<string> {
        if (util.getShowReloadPrompt()) {
            util.showReloadOrWaitPrompt();
        } else {
            return this.attachItemsProvider.getAttachItems()
                .then(processEntries => {
                    let attachPickOptions: vscode.QuickPickOptions = {
                        matchOnDescription: true,
                        matchOnDetail: true,
                        placeHolder: "Select the process to attach to"
                    };

                    return vscode.window.showQuickPick(processEntries, attachPickOptions)
                        .then(chosenProcess => {
                            return chosenProcess ? chosenProcess.id : Promise.reject<string>(new Error("Process not selected."));
                        });
                });
        }
    }
}

export class RemoteAttachPicker {
    constructor() {
        this._channel = vscode.window.createOutputChannel('remote-attach');
    }

    private _channel: vscode.OutputChannel = null;

    public ShowAttachEntries(args: any): Promise<string> {
        if (util.getShowReloadPrompt()) {
            util.showReloadOrWaitPrompt();
        } else {
            this._channel.clear();

            let pipeTransport: any = args ? args.pipeTransport : null;

            if (pipeTransport === null) {
                return Promise.reject<string>(new Error("Chosen debug configuration does not contain pipeTransport"));
            }

            let pipeProgram: string = pipeTransport.pipeProgram;
            let pipeArgs: string[] = pipeTransport.pipeArgs;

            let argList: string = RemoteAttachPicker.createArgumentList(pipeArgs);

            let pipeCmd: string = `"${pipeProgram}" ${argList}`;

            return this.getRemoteOSAndProcesses(pipeCmd)
                .then(processes => {
                    let attachPickOptions: vscode.QuickPickOptions = {
                        matchOnDetail: true,
                        matchOnDescription: true,
                        placeHolder: "Select the process to attach to"
                    };

                    return vscode.window.showQuickPick(processes, attachPickOptions)
                        .then(item => {
                            return item ? item.id : Promise.reject<string>(new Error("Process not selected."));
                        });
                });
        }
    }

    private getRemoteOSAndProcesses(pipeCmd: string): Promise<AttachItem[]> {
        // Commands to get OS and processes
        const command: string = `bash -c 'uname && if [ $(uname) == "Linux" ] ; then ${PsProcessParser.psLinuxCommand} ; elif [ $(uname) == "Darwin" ] ; ` +
            `then ${PsProcessParser.psDarwinCommand}; fi'`;

        return execChildProcess(`${pipeCmd} "${command}"`, null, this._channel).then(output => {
            // OS will be on first line
            // Processess will follow if listed
            let lines: string[] = output.split(/\r?\n/);

            if (lines.length == 0) {
                return Promise.reject<AttachItem[]>(new Error("Pipe transport failed to get OS and processes."));
            } else {
                let remoteOS: string = lines[0].replace(/[\r\n]+/g, '');

                if (remoteOS != "Linux" && remoteOS != "Darwin") {
                    return Promise.reject<AttachItem[]>(new Error(`Operating system "${remoteOS}" not supported.`));
                }

                // Only got OS from uname
                if (lines.length == 1) {
                    return Promise.reject<AttachItem[]>(new Error("Transport attach could not obtain processes list."));
                } else {
                    let processes: string[] = lines.slice(1);
                    return PsProcessParser.ParseProcessFromPsArray(processes)
                        .sort((a, b) => {
                            if (a.name == undefined) {
                                if (b.name == undefined) {
                                    return 0;
                                }
                                return 1;
                            }
                            if (b.name == undefined) {
                                return -1;
                            }
                            let aLower: string = a.name.toLowerCase();
                            let bLower: string = b.name.toLowerCase();
                            if (aLower == bLower) {
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
