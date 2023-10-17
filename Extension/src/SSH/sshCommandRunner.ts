/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { CppSettings } from '../LanguageServer/settings';
import { ManualPromise } from '../Utility/Async/manualPromise';
import { ISshHostInfo, ProcessReturnType, splitLines, stripEscapeSequences } from '../common';
import { isWindows } from '../constants';
import { getSshChannel } from '../logger';
import {
    ConnectionFailureInteractor, ContinueOnInteractor, DifferingHostKeyInteractor,
    DuoTwoFacInteractor,
    FingerprintInteractor, IInteraction, IInteractor, ISystemInteractor, MitmInteractor,
    PassphraseInteractor,
    PasswordInteractor,
    TwoFacInteractor,
    autoFilledPasswordForUsers
} from './commandInteractors';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class CanceledError extends Error {
    constructor() {
        super(localize('ssh.canceled', 'SSH command canceled'));
    }
}

export interface ICommandResult {
    stdout: string;
    stderr: string;
}

export function showPassphraseInputBox(
    keyName?: string,
    prompt?: string,
    cancelToken?: vscode.CancellationToken
): Promise<string | undefined> {
    const keyStr: string = keyName ? `"${keyName}"` : '';
    const msg: string = localize('ssh.passphrase.input.box', 'Enter passphrase for ssh key {0}', keyStr);
    return showInputBox(msg, prompt, cancelToken);
}

export function showPasswordInputBox(
    user: string | undefined,
    prompt?: string,
    cancelToken?: vscode.CancellationToken
): Promise<string | undefined> {
    const msg: string = user ? localize('ssh.enter.password.for.user', 'Enter password for user "{0}"', user) : localize('ssh.message.enter.password', 'Enter password');
    return showInputBox(msg, prompt, cancelToken);
}

export function showVerificationCodeInputBox(
    msg: string,
    cancelToken?: vscode.CancellationToken
): Promise<string | undefined> {
    return showInputBox(msg, undefined, cancelToken);
}

export async function showInputBox(
    msg: string,
    prompt?: string,
    cancelToken?: vscode.CancellationToken
): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const quickPick: vscode.InputBox = vscode.window.createInputBox();
        quickPick.title = msg;
        quickPick.prompt = prompt;
        quickPick.password = true;
        quickPick.ignoreFocusOut = true;

        let isAccepted: boolean = false;

        quickPick.onDidAccept(() => {
            isAccepted = true;
            const passphrase: string = quickPick.value;
            quickPick.dispose();
            resolve(passphrase);
        });

        quickPick.onDidHide(() => {
            if (!isAccepted) {
                resolve(undefined);
            }
        });

        quickPick.show();

        if (cancelToken) {
            cancelToken.onCancellationRequested(() => {
                reject(new CanceledError());
                quickPick.dispose();
            });
        }
    });
}

class ConfirmationItem implements vscode.QuickPickItem, vscode.MessageItem {
    title: string;
    isCloseAffordance: boolean = true;
    constructor(public label: string, public value: string) {
        this.title = label;
    }
}

const continueConfirmationPlaceholder: string = localize('ssh.continue.confirmation.placeholder', 'Are you sure you want to continue?');

export async function showHostKeyConfirmation(
    host: string,
    fingerprint: string,
    cancelToken?: vscode.CancellationToken
): Promise<string | undefined> {
    return showConfirmationPicker(
        localize('ssh.host.key.confirmation.title', '"{0}" has fingerprint "{1}".', host, fingerprint),
        continueConfirmationPlaceholder,
        cancelToken
    );
}

export async function showDifferingHostConfirmation(
    message: string,
    cancelToken?: vscode.CancellationToken
): Promise<string | undefined> {
    return showConfirmationPicker(message, continueConfirmationPlaceholder, cancelToken);
}

async function showConfirmationPicker(
    title: string,
    placeholder: string,
    cancelToken?: vscode.CancellationToken
): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const quickPick: vscode.QuickPick<ConfirmationItem> = vscode.window.createQuickPick<ConfirmationItem>();
        quickPick.canSelectMany = false;
        quickPick.items = [new ConfirmationItem(localize('continue', 'Continue'), 'yes'), new ConfirmationItem(localize('cancel', 'Cancel'), 'no')];
        quickPick.title = title;
        quickPick.placeholder = placeholder;

        let isAccepted: boolean = false;

        quickPick.onDidAccept(async () => {
            isAccepted = true;
            const value: string = quickPick.selectedItems[0].value;
            quickPick.dispose();
            resolve(value);
        });

        quickPick.onDidHide(() => {
            if (!isAccepted) {
                resolve(undefined);
            }
        });

        quickPick.show();

        if (cancelToken) {
            cancelToken.onCancellationRequested(() => {
                quickPick.hide();
                reject(new CanceledError());
            });
        }
    });
}

export interface ITerminalCommandWithLoginArgs {
    systemInteractor: ISystemInteractor;
    command: string;
    nickname: string;
    marker?: string;
    usedInteractors?: Set<string>;
    interactor?: IInteractor;
    cwd?: string;
    token?: vscode.CancellationToken;
    continueOn?: string;

    revealTerminal?: vscode.Event<void>;
}

export async function runSshTerminalCommandWithLogin(
    host: ISshHostInfo,
    terminalArgs: ITerminalCommandWithLoginArgs,
    showLoginTerminal = false
): Promise<ProcessReturnType> {
    const interactors: IInteractor[] = [];

    if (terminalArgs.interactor) {
        interactors.push(terminalArgs.interactor);
    }

    if (!showLoginTerminal) {
        autoFilledPasswordForUsers.clear();
        interactors.push(
            new MitmInteractor(),
            new FingerprintInteractor(host.hostName, showHostKeyConfirmation),
            new PassphraseInteractor(showPassphraseInputBox),
            new DifferingHostKeyInteractor(showDifferingHostConfirmation),
            new PasswordInteractor(host, showPasswordInputBox),
            new TwoFacInteractor(showVerificationCodeInputBox),
            new DuoTwoFacInteractor(showVerificationCodeInputBox),
            new ConnectionFailureInteractor(host.hostName)
        );
    }

    if (terminalArgs.continueOn) {
        interactors.push(new ContinueOnInteractor(terminalArgs.continueOn));
    }

    // This terminal is always local
    const result: ProcessReturnType = await runInteractiveSshTerminalCommand({
        systemInteractor: terminalArgs.systemInteractor,
        command: terminalArgs.command,
        interactors,
        usedInteractors: terminalArgs.usedInteractors,
        nickname: terminalArgs.nickname,
        token: terminalArgs.token,
        marker: terminalArgs.marker,
        revealTerminal: terminalArgs.revealTerminal,
        showLoginTerminal,
        cwd: terminalArgs.cwd ? vscode.Uri.file(terminalArgs.cwd) : undefined
    });

    return result;
}

export interface ITerminalCommandArgs {
    systemInteractor: ISystemInteractor;
    command: string;
    interactors?: IInteractor[];
    nickname: string;
    usedInteractors?: Set<string>;
    sendText?: string;
    cwd?: vscode.Uri;
    terminalIsWindows?: boolean;
    token?: vscode.CancellationToken;
    marker?: string;
    revealTerminal?: vscode.Event<void>;
    showLoginTerminal?: boolean; // If true, respect the showLoginTerminal setting
}

export function getPauseLogMarker(uuid: string): string {
    return `${uuid}: pauseLog`;
}

export function getResumeLogMarker(uuid: string): string {
    return `${uuid}: resumeLog`;
}

export function runInteractiveSshTerminalCommand(args: ITerminalCommandArgs): Promise<ProcessReturnType> {
    const disposables: vscode.Disposable[] = [];
    const { systemInteractor, command, interactors, nickname, token } = args;
    let logIsPaused: boolean = false;
    const loggingLevel: string | undefined = new CppSettings().loggingLevel;
    const result = new ManualPromise<ProcessReturnType>();

    let stdout: string = '';
    let windowListener: vscode.Disposable | undefined;
    let terminalListener: vscode.Disposable | undefined;
    let terminal: vscode.Terminal | undefined;
    let tokenListener: vscode.Disposable;
    let continueWithoutExiting: boolean = false;

    const clean = () => {
        if (terminalListener) {
            terminalListener.dispose();
            terminalListener = undefined;
        }

        if (terminal) {
            terminal.dispose();
            terminal = undefined;
        }

        if (windowListener) {
            windowListener.dispose();
            windowListener = undefined;
        }

        if (tokenListener) {
            tokenListener.dispose();
        }

        disposables.forEach(disposable => disposable.dispose());
    };

    const done = (cancel: boolean = false, noClean: boolean = false, exitCode?: number) => {
        if (!noClean) {
            clean();
        }
        getSshChannel().appendLine(cancel ? localize('ssh.terminal.command.canceled', '"{0}" terminal command canceled.', nickname) : localize('ssh.terminal.command.done', '"{0}" terminal command done.', nickname));

        if (cancel) {
            if (continueWithoutExiting) {
                const warningMessage: string = localize('ssh.continuing.command.canceled', 'Task \'{0}\' is canceled, but the underlying command may not be terminated. Please check manually.', command);
                getSshChannel().appendLine(warningMessage);
                void vscode.window.showWarningMessage(warningMessage);
            }
            return result.reject(new CanceledError());
        }

        // When using showLoginTerminal, stdout include the passphrase prompt, etc. Try to get just the command output on the last line.
        const actualOutput: string | undefined = cancel ? '' : lastNonemptyLine(stdout);
        result.resolve({ succeeded: !exitCode, exitCode, output: actualOutput || '' });
    };

    const failed = (error?: any) => {
        clean();
        const errorMessage: string = localize('ssh.process.failed', '"{0}" process failed: {1}', nickname, error);
        getSshChannel().appendLine(errorMessage);
        void vscode.window.showErrorMessage(errorMessage);
        result.reject(error);
    };

    const handleOutputLogging = (data: string): void => {
        let nextPauseState: boolean | undefined;
        if (args.marker) {
            const pauseMarker: string = getPauseLogMarker(args.marker);
            const pauseIdx: number = data.lastIndexOf(pauseMarker);
            if (pauseIdx >= 0) {
                data = data.substring(0, pauseIdx + pauseMarker.length);
                nextPauseState = true;
            }

            const resumeIdx: number = data.lastIndexOf(getResumeLogMarker(args.marker));
            if (resumeIdx >= 0) {
                data = data.substring(resumeIdx);
                nextPauseState = false;
            }
        }

        // Log the chunk of data that includes the pause/resume markers,
        // so unpause first and pause after logging
        if (!logIsPaused) {
            logReceivedData(data, nickname);
        }

        if (typeof nextPauseState === 'boolean') {
            logIsPaused = nextPauseState;
        }
    };

    const handleTerminalOutput = async (dataWrite: vscode.TerminalDataWriteEvent): Promise<void> => {
        if (loggingLevel !== 'None') {
            handleOutputLogging(dataWrite.data);
        }

        if (continueWithoutExiting) {
            // Skip the interactors after we have continued since I haven't see a use case for now.
            return;
        }

        stdout += dataWrite.data;

        if (interactors) {
            for (const interactor of interactors) {
                try {
                    const interaction: IInteraction = await interactor.onData(stdout);

                    if (interaction.postAction === 'consume') {
                        if (args.usedInteractors) {
                            args.usedInteractors.add(interactor.id);
                        }

                        stdout = '';
                    }

                    if (interaction.canceled) {
                        if (args.usedInteractors) {
                            args.usedInteractors.add(interactor.id);
                        }

                        done(true);
                        return;
                    }

                    if (interaction.continue) {
                        if (args.usedInteractors) {
                            args.usedInteractors.add(interactor.id);
                        }
                        continueWithoutExiting = true;
                        done(false, true);
                        return;
                    }

                    if (typeof interaction.response === 'string') {
                        if (args.usedInteractors) {
                            args.usedInteractors.add(interactor.id);
                        }

                        if (terminal) {
                            terminal.sendText(`${interaction.response}\n`);
                            const logOutput: string = interaction.isPassword
                                ? interaction.response.replace(/./g, '*')
                                : interaction.response;
                            if (loggingLevel === 'Debug' || loggingLevel === 'Information') {
                                getSshChannel().appendLine(localize('ssh.wrote.data.to.terminal', '"{0}" wrote data to terminal: "{1}".', nickname, logOutput));
                            }
                        }
                    }
                } catch (e) {
                    failed(e);
                }
            }
        }
    };

    if (token) {
        tokenListener = token.onCancellationRequested(() => {
            done(true);
        });
    }

    const terminalIsWindows: boolean = typeof args.terminalIsWindows === 'boolean' ? args.terminalIsWindows : isWindows;
    try {
        // the terminal process should not fail, but exit cleanly
        let shellArgs: string | string[];
        if (args.sendText) {
            shellArgs = '';
        } else {
            shellArgs = terminalIsWindows ? `/c (${command})\nexit /b %ErrorLevel%` : ['-c', `${command}\nexit $?`];
        }

        const options: vscode.TerminalOptions = {
            cwd:
                args.cwd ||
                (terminalIsWindows
                    ? vscode.Uri.file(os.homedir() || 'c:\\')
                    : vscode.Uri.file(os.homedir() || '/')),
            name: nickname,
            shellPath: getShellPath(terminalIsWindows),
            shellArgs,
            hideFromUser: true
        };

        let terminalDataHandlingQueue: Promise<void> = Promise.resolve();
        terminalListener = systemInteractor.onDidWriteTerminalData(async e => {
            if (e.terminal !== terminal) {
                return;
            }

            terminalDataHandlingQueue = terminalDataHandlingQueue.finally(() => void handleTerminalOutput(e));
        });
        terminal = systemInteractor.createTerminal(options);

        if (args.revealTerminal) {
            disposables.push(
                args.revealTerminal(() => {
                    if (terminal) {
                        terminal.show();
                    }
                })
            );
        }

        if (args.sendText) {
            const sendText: string = terminalIsWindows ? `(${args.sendText})\nexit /b %ErrorLevel%` : `${args.sendText}\nexit $?`;

            terminal.sendText(sendText);
            if (loggingLevel === 'Debug' || loggingLevel === 'Information') {
                getSshChannel().appendLine(localize('ssh.wrote.data.to.terminal', '"{0}" wrote data to terminal: "{1}".', nickname, args.sendText));
            }
        }

        if (args.showLoginTerminal) {
            terminal.show();
        }

        windowListener = systemInteractor.onDidCloseTerminal(t => {
            if (t === terminal) {
                terminal = undefined; // Is already disposed
                done(false, false, t.exitStatus?.code);
            }
        });
    } catch (error) {
        failed(error);
    }

    return result;
}

function getShellPath(_isWindows: boolean): string {
    if (_isWindows) {
        // Some users don't have cmd.exe on the path...
        if (process.env.SystemRoot) {
            // This var should always exist but be paranoid
            const cmdPath: string = path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
            return cmdPath;
        } else {
            return 'cmd.exe';
        }
    } else {
        // Note - can't rely on having sh in path (#590), and can't check the disk (bc remote terminals)
        return '/bin/sh';
    }
}

function logReceivedData(data: string, nickname: string): void {
    const logData: string = data.replace(/\r?\n$/, ''); // Trim single trailing newline for nicer log
    if (logData === ' ') {
        // From the sleep command that must periodically echo ' '
        return;
    }
    const markedLines: string = logData
        .split(/\n/)
        .map(line => `${nickname}> ${line}`)
        .join('\n');

    getSshChannel().appendLine(markedLines);
}

function lastNonemptyLine(str: string): string | undefined {
    const lines: string[] = splitLines(str);

    if (isWindows) {
        let outputContainingPipeError: string = '';
        for (let i: number = lines.length - 1; i >= 0; i--) {
            const strippedLine: string = stripEscapeSequences(lines[i]);
            if (strippedLine.match(/The process tried to write to a nonexistent pipe/)) {
                outputContainingPipeError = strippedLine;
                continue;
            }
            if (strippedLine) {
                return strippedLine;
            }
        }

        if (outputContainingPipeError) {
            return outputContainingPipeError;
        }
    }

    const nonEmptyLines: string[] = lines.filter(l => !!l);
    return nonEmptyLines[nonEmptyLines.length - 1];
}
