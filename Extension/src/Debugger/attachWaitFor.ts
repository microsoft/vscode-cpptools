
import * as os from 'os';
import * as vscode from 'vscode';
import { localize } from 'vscode-nls';
import * as util from '../common';
import { sleep } from '../Utility/Async/sleep';
import { CimAttachItemsProvider, PsAttachItemsProvider, WmicAttachItemsProvider } from './nativeAttach';

export interface WaitForProcessProvider {
    poll(program: string, timeout: number, interval: number, token?: vscode.CancellationToken): Promise<string | undefined>
}

export class PollProcessProviderFactory {
    static Get(): WaitForProcessProvider {
        if (os.platform() === 'win32') {
            const pwsh: string | undefined = util.findPowerShell();
            let itemsProvider = pwsh ? new CimAttachItemsProvider(pwsh) : new WmicAttachItemsProvider();
            return new PollWindowsProvider(itemsProvider);
        } else {
            // Linux and MacOS
            return new PollProcProvider(new PsAttachItemsProvider());
        }
    }
}

export class PollProcProvider implements WaitForProcessProvider {

    constructor(itemsProvider: PsAttachItemsProvider) {
        this.itemsProvider = itemsProvider;
    }

    private itemsProvider: PsAttachItemsProvider;

    async poll(program: string, timeout: number, interval: number, token?: vscode.CancellationToken): Promise<string | undefined> {
        return new Promise<string | undefined>(async (resolve, reject) => {
            const startTime = Date.now();  // Get the current time in milliseconds
            let process: string | undefined;
            while (true) {
                let elapsedTime = Date.now() - startTime;
                if (elapsedTime >= timeout) {
                    reject(new Error(localize("waitfor.timeout", "Timeout reached. No process matched the pattern.")));
                }

                if (token?.isCancellationRequested) {
                    reject(new Error(localize("waitfor.cancelled", "Operation cancelled.")));
                }

                let procs = await this.itemsProvider.getAttachItems(token)
                for (const proc of procs) {
                    if (proc.detail?.includes(program)) {
                        process = proc.id
                        break
                    }
                }

                if (process) {
                    await util.execChildProcess(`kill -STOP ${process}`, undefined, undefined);
                    break
                }

                sleep(interval)
            }

            resolve(process)
        })
    }
}

export class PollWindowsProvider implements WaitForProcessProvider {
    constructor(itemsProvider: CimAttachItemsProvider | WmicAttachItemsProvider) {
        this.itemsProvider = itemsProvider;
    }

    private itemsProvider: CimAttachItemsProvider | WmicAttachItemsProvider;

    public async poll(program: string, timeout: number, interval: number, token?: vscode.CancellationToken): Promise<string | undefined> {
        return new Promise<string | undefined>(async (resolve, reject) => {
            const startTime = Date.now();  // Get the current time in milliseconds
            let process: string | undefined;
            while (true) {
                const elapsedTime = Date.now() - startTime;
                if (elapsedTime >= timeout) {
                    reject(new Error(localize("waitfor.timeout", "Timeout reached. No process matched the pattern.")));
                }

                // Check for cancellation
                if (token?.isCancellationRequested) {
                    reject(new Error(localize("waitfor.cancelled", "Operation cancelled.")));
                }

                let procs = await this.itemsProvider.getAttachItems(token)
                for (const proc of procs) {
                    if (proc.detail?.includes(program)) {
                        process = proc.id
                        break
                    }
                }

                if (process) {
                    // Use pssupend to send SIGSTOP analogous in Windows
                    await util.execChildProcess(`pssuspend.exe /accepteula -nobanner ${process}`, undefined, undefined)
                    break
                }

                sleep(interval)
            }
            resolve(process)
        })
    }
}


export class AttachWaitFor {
    constructor(poller: WaitForProcessProvider) {
        //this._channel = vscode.window.createOutputChannel('waitfor-attach');
        this.poller = poller;

    }

    // Defaults: ms
    private timeout: number = 10000;
    private interval: number = 150;
    private poller: WaitForProcessProvider;

    public async WaitForProcess(program: string, timeout: number, interval: number, token?: vscode.CancellationToken): Promise<string | undefined> {
        if (timeout) {
            this.timeout = timeout;
        }
        if (interval) {
            this.interval = interval;
        }
        return await this.poller.poll(program, this.timeout, this.interval, token);
    }
}
