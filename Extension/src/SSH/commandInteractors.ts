/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { escapeStringForRegex, extensionContext, getFullHostAddress, ISshHostInfo, stripEscapeSequences } from '../common';
import { isWindows } from '../constants';
import { getOutputChannelLogger } from '../logger';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

/**
 * The users that we autofilled their passwords.
 * If a user's password is already used and yet we still get the same prompt, we probably got a wrong password.
 * Needs to be reset for each command.
 */
export const autoFilledPasswordForUsers: Set<string> = new Set<string>();

export type IDifferingHostConfirmationProvider =
    (message: string, cancelToken?: vscode.CancellationToken) => Promise<string | undefined>;

export type IFingerprintConfirmationProvider =
    (host: string, fingerprint: string, cancelToken?: vscode.CancellationToken) => Promise<string | undefined>;

export interface IInteraction {
    canceled?: boolean;
    postAction?: 'consume' | 'keep';
    response?: string;
    isPassword?: boolean;
    continue?: boolean; // Continue without waiting for the program to finish or pause
}

export interface IInteractorDataDetails {
    detectedServerKey?: string;
    detail?: string;
}

export interface IInteractor {
    id: string;
    onData(data: string, cancelToken?: vscode.CancellationToken, extraDetails?: IInteractorDataDetails): Promise<IInteraction>;
}

export class MitmInteractor implements IInteractor {
    static ID = 'mitm';

    get id(): string {
        return MitmInteractor.ID;
    }

    async onData(data: string): Promise<IInteraction> {
        if (data.match('Port forwarding is disabled to avoid man-in-the-middle attacks.')) {
            throw Error('Port forwarding is disabled to avoid man-in-the-middle attacks.');
        }

        return {};
    }
}

export class FingerprintInteractor implements IInteractor {
    static ID = 'fingerprint';

    constructor(private readonly hostName: string, private readonly confirmationProvider: IFingerprintConfirmationProvider) { }

    get id(): string {
        return FingerprintInteractor.ID;
    }

    async onData(data: string, cancelToken?: vscode.CancellationToken, extraDetails?: IInteractorDataDetails): Promise<IInteraction> {
        const fingerprintMatcher: RegExp = /fingerprint\sis\s(.+)\./;

        const result: IInteraction = { postAction: 'keep' };
        data = data.trim();

        let fingerprintMatch: RegExpMatchArray | null;
        if (
            data.includes('Are you sure you want to continue connecting') &&
            (fingerprintMatch = data.match(fingerprintMatcher))
        ) {
            result.postAction = 'consume';
            const confirmation: string | undefined = await this.confirmationProvider(
                this.hostName,
                fingerprintMatch[1],
                cancelToken
            );
            if (confirmation) {
                result.response = confirmation;
            } else {
                result.canceled = true;
            }
        } else if (
            isWindows &&
            (data.includes('The authenticity of host ') || (data === '' && extraDetails?.detectedServerKey))
        ) {
            // hack for #1195
            // First line local server case (git ssh only gives the first line over ssh_askpass)
            const key: string = extraDetails?.detectedServerKey || '(unknown)';

            result.postAction = 'consume';
            const confirmation: string | undefined = await this.confirmationProvider(this.hostName, key, cancelToken);
            if (confirmation) {
                result.response = confirmation;
            } else {
                result.canceled = true;
            }
        }

        return result;
    }
}

export class DifferingHostKeyInteractor implements IInteractor {
    static ID = 'differing host key';

    constructor(private readonly confirmationProvider: IDifferingHostConfirmationProvider) { }

    get id(): string {
        return DifferingHostKeyInteractor.ID;
    }

    async onData(data: string, cancelToken?: vscode.CancellationToken, _extraDetails?: IInteractorDataDetails): Promise<IInteraction> {
        const result: IInteraction = { postAction: 'keep' };
        data = data.trim();

        if (
            data.includes('Are you sure you want to continue connecting') &&
            data.includes('Offending key for IP in') &&
            data.includes('Matching host key in')
        ) {
            result.postAction = 'consume';
            const message: string = data.substring(data.indexOf('Warning'), data.indexOf('Are')).trim();
            const confirmation: string | undefined = await this.confirmationProvider(message, cancelToken);
            if (confirmation) {
                result.response = confirmation;
            } else {
                result.canceled = true;
            }
        }

        return result;
    }
}

export type IStringProvider =
    (key?: string, detail?: string, cancelToken?: vscode.CancellationToken) => Promise<string | undefined>;

export class PassphraseInteractor implements IInteractor {
    static ID = 'passphrase';

    constructor(private readonly passphraseProvider: IStringProvider) { }

    get id(): string {
        return PassphraseInteractor.ID;
    }

    async onData(data: string, cancelToken?: vscode.CancellationToken): Promise<IInteraction> {
        const result: IInteraction = { postAction: 'keep' };
        const lines: string[] = data.trim().split('\n');
        if (lines.some(l => l.indexOf('Enter passphrase for') >= 0)) {
            result.postAction = 'consume';
            const passphrase: string | undefined = await this.passphraseProvider(undefined, undefined, cancelToken); // TODO keep track of the key name
            if (typeof passphrase === 'string') {
                result.response = passphrase;
                result.isPassword = true;
            } else {
                result.canceled = true;
            }
        } else if (lines.some(l => l.indexOf('Identity added:') >= 0)) {
            result.postAction = 'consume';
        }

        return result;
    }
}

export function getExitCode(output: string, marker: string): number | undefined {
    const regex: RegExp = new RegExp(`${marker}##([0-9]*)##`);
    const match: RegExpExecArray | null = regex.exec(output);
    if (match) {
        try {
            const num: number = parseInt(match[1]);
            return Number.isNaN(num) ? undefined : num;
        } catch (err) {
            return undefined;
        }
    }

    return 0;
}

/**
 * Matches SSH password prompt of format:
 * 's password:
 * or
 * Password:
 * not
 * 's old password:
 * 's new password:
 */
function getPasswordPrompt(data: string, details?: IInteractorDataDetails): { user?: string; message?: string } | undefined {
    if (data.includes('Password:')) {
        // Password prompt for unspecified user
        return { user: '' };
    }

    // Got \r\r\n as a line ending here
    const match: RegExpMatchArray | null = stripEscapeSequences(data).match(/([a-zA-Z0-9\-_@\.]*)'s password:/);
    if (match) {
        return {
            user: match[1],
            message: details ? details.detail : undefined
        };
    }

    return undefined;
}

export class PasswordInteractor implements IInteractor {
    static ID = 'password';

    constructor(private readonly host: ISshHostInfo, private readonly passwordProvider: IStringProvider) { }

    get id(): string {
        return PasswordInteractor.ID;
    }

    async onData(data: string, cancelToken?: vscode.CancellationToken, extraDetails?: IInteractorDataDetails): Promise<IInteraction> {
        const result: IInteraction = { postAction: 'keep' };
        const pwPrompt: { user?: string; message?: string } | undefined = getPasswordPrompt(data, extraDetails);
        if (pwPrompt && typeof pwPrompt.user === 'string') {
            result.postAction = 'consume';
            const actualUser: string = pwPrompt.user === '' ? getFullHostAddress(this.host) : pwPrompt.user;
            const passwordCacheKey: string = `SSH:${actualUser}`;
            const cachedPassword: string | undefined = await extensionContext?.secrets?.get(passwordCacheKey);
            if (cachedPassword !== undefined && !autoFilledPasswordForUsers.has(actualUser)) {
                autoFilledPasswordForUsers.add(actualUser);
                result.response = cachedPassword;
                result.isPassword = true;
            } else {
                const password: string | undefined = await this.passwordProvider(pwPrompt.user, pwPrompt.message, cancelToken);
                if (typeof password === 'string') {
                    await extensionContext?.secrets?.store(passwordCacheKey, password);
                    autoFilledPasswordForUsers.add(actualUser);
                    result.response = password;
                    result.isPassword = true;
                } else {
                    result.canceled = true;
                }
            }
        }

        return result;
    }
}

export type IVerificationCodeProvider =
    (msg: string, cancelToken?: vscode.CancellationToken) => Promise<string | undefined>;

export class TwoFacInteractor implements IInteractor {
    static ID = '2fa';

    constructor(private readonly verificationCodeProvider: IVerificationCodeProvider) { }

    get id(): string {
        return TwoFacInteractor.ID;
    }

    async onData(data: string, cancelToken?: vscode.CancellationToken): Promise<IInteraction> {
        const result: IInteraction = { postAction: 'keep' };
        if (data.includes('Verification code:')) {
            result.postAction = 'consume';
            const verificationCode: string | undefined = await this.verificationCodeProvider('Enter verification code', cancelToken);
            if (typeof verificationCode === 'string') {
                result.response = verificationCode;
                result.isPassword = true;
            } else {
                result.canceled = true;
            }
        }

        return result;
    }
}

// https://github.com/microsoft/vscode-remote-release/issues/2170
export class DuoTwoFacInteractor implements IInteractor {
    static ID = 'duo-2fa';

    constructor(private readonly verificationCodeProvider: IVerificationCodeProvider) { }

    get id(): string {
        return DuoTwoFacInteractor.ID;
    }

    async onData(data: string, cancelToken?: vscode.CancellationToken): Promise<IInteraction> {
        const result: IInteraction = { postAction: 'keep' };
        if (data.includes('Passcode:')) {
            result.postAction = 'consume';
            const verificationCode: string | undefined = await this.verificationCodeProvider('Enter passcode', cancelToken);
            if (typeof verificationCode === 'string') {
                result.response = verificationCode;
                result.isPassword = true;
            } else {
                result.canceled = true;
            }
        }

        return result;
    }
}

export class ContinueOnInteractor implements IInteractor {
    static ID = 'continueOn';

    constructor(private readonly continueOn: string) { }

    get id(): string {
        return ContinueOnInteractor.ID;
    }

    async onData(data: string, _cancelToken?: vscode.CancellationToken): Promise<IInteraction> {
        const result: IInteraction = { postAction: 'keep' };
        const pattern: string = escapeStringForRegex(this.continueOn);
        const re: RegExp = new RegExp(pattern, 'g');
        if (data.match(re)) {
            result.continue = true;
        }
        return result;
    }
}

export class ConnectionFailureInteractor implements IInteractor {
    static ID = 'connectionFailure';

    constructor(private readonly hostName: string) { }

    get id(): string {
        return ConnectionFailureInteractor.ID;
    }

    async onData(data: string): Promise<IInteraction> {
        const result: IInteraction = { postAction: 'keep' };
        if (data.includes('Connection refused') || data.includes('Could not resolve hostname')) {
            result.postAction = 'consume';
            void getOutputChannelLogger().showErrorMessage(localize('failed.to.connect', 'Failed to connect to {0}', this.hostName));
        }
        return result;
    }
}

export class ComposedInteractor implements IInteractor {
    constructor(private readonly interactors: IInteractor[]) { }

    get id(): string {
        return 'composed';
    }

    async onData(data: string): Promise<IInteraction> {
        for (const interactor of this.interactors) {
            const result: IInteraction = await interactor.onData(data);
            if (result.postAction === 'consume') {
                return result;
            }
        }

        return { postAction: 'keep' };
    }
}

export interface ISystemInteractor {
    createTerminal(options: vscode.TerminalOptions): vscode.Terminal;
    onDidCloseTerminal: typeof vscode.window.onDidCloseTerminal;
    onDidWriteTerminalData: typeof vscode.window.onDidWriteTerminalData;
}

export const defaultSystemInteractor: ISystemInteractor = {
    createTerminal: vscode.window.createTerminal,
    onDidCloseTerminal: vscode.window.onDidCloseTerminal,
    onDidWriteTerminalData: vscode.window.onDidWriteTerminalData
};
