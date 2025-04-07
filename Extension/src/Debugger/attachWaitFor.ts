
import * as vscode from 'vscode';
import * as util from '../common';
import { sleep } from '../Utility/Async/sleep';
import { PsProcessParser } from './nativeAttach';

export class AttachWaitFor {

    constructor() {
        this._channel = vscode.window.createOutputChannel('waitfor-attach');
        this.timeout = 30000
    }

    private _channel: vscode.OutputChannel;
    private timeout: number;

    public async WaitForProcess(program: string, timeout: number): Promise<string | undefined> {
        if (timeout) {
            this.timeout = timeout
        }

        return await this.poll(program)
    }

    //Naive poll mechanism, parses /proc for a while till a match is found
    private async poll(program: string): Promise<string | undefined> {
        this._channel.clear()
        const startTime = Date.now();  // Get the current time in milliseconds
        let seen = new Set<string>();
        let process: string | undefined;
        while (true) {
            const elapsedTime = Date.now() - startTime;

            if (elapsedTime >= this.timeout) {
                console.log('Timeout reached. No process matched pattern.');
                return undefined
            }

            const output: string = await util.execChildProcess(PsProcessParser.psLinuxCommand, undefined, this._channel)
            const lines: string[] = output.split(/\r?\n/);
            const processes: string[] = lines.slice(1);
            const processAttach = PsProcessParser.ParseProcessFromPsArray(processes)
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
            processAttach.forEach(p => {
                if (!process && p.detail!.includes(program)) {
                    console.log("Found program waiting for with pid %s - info %s", p.id!, p.detail!)
                    process = p.id!

                    // Send sigstop by default?
                    util.execChildProcess(`kill -STOP ${process}`, undefined, this._channel)
                    return
                }

                if (seen.has(p.id!) == false && p.label != "ps" && !p.detail!.includes("ps")) {
                    seen.add(p.id!)
                }
            })

            if (process) {
                return process
            }

            sleep(200)
        }
    }

}
