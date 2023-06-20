/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as os from 'os';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { CppSourceStr } from './LanguageServer/extension';
import { getLocalizedString, LocalizeStringParams } from './LanguageServer/localization';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// This is used for testing purposes
let Subscriber: (message: string) => void;
export function subscribeToAllLoggers(subscriber: (message: string) => void): void {
    Subscriber = subscriber;
}

export class Logger {
    private writer: (message: string) => void;

    constructor(writer: (message: string) => void) {
        this.writer = writer;
    }

    public append(message: string): void {
        this.writer(message);
        if (Subscriber) {
            Subscriber(message);
        }
    }

    public appendLine(message: string): void {
        this.writer(message + os.EOL);
        if (Subscriber) {
            Subscriber(message + os.EOL);
        }
    }

    // We should not await on this function.
    public showInformationMessage(message: string, items?: string[]): Thenable<string | undefined> {
        this.appendLine(message);

        if (!items) {
            return vscode.window.showInformationMessage(message);
        }
        return vscode.window.showInformationMessage(message, ...items);
    }

    // We should not await on this function.
    public showWarningMessage(message: string, items?: string[]): Thenable<string | undefined> {
        this.appendLine(message);

        if (!items) {
            return vscode.window.showWarningMessage(message);
        }
        return vscode.window.showWarningMessage(message, ...items);
    }

    // We should not await on this function.
    public showErrorMessage(message: string, items?: string[]): Thenable<string | undefined> {
        this.appendLine(message);

        if (!items) {
            return vscode.window.showErrorMessage(message);
        }
        return vscode.window.showErrorMessage(message, ...items);
    }
}

export let outputChannel: vscode.OutputChannel | undefined;
export let diagnosticsChannel: vscode.OutputChannel | undefined;
export let debugChannel: vscode.OutputChannel | undefined;
export let warningChannel: vscode.OutputChannel | undefined;
export let sshChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel(CppSourceStr);
        // Do not use CppSettings to avoid circular require()
        const settings: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", null);
        const loggingLevel: string | undefined = settings.get<string>("loggingLevel");
        if (!!loggingLevel && loggingLevel !== "None" && loggingLevel !== "Error") {
            outputChannel.appendLine(`loggingLevel: ${loggingLevel}`);
        }
    }
    return outputChannel;
}

export function getDiagnosticsChannel(): vscode.OutputChannel {
    if (!diagnosticsChannel) {
        diagnosticsChannel = vscode.window.createOutputChannel(localize("c.cpp.diagnostics", "C/C++ Diagnostics"));
    }
    return diagnosticsChannel;
}

export function getSshChannel(): vscode.OutputChannel {
    if (!sshChannel) {
        sshChannel = vscode.window.createOutputChannel(localize("c.cpp.ssh.channel", "{0}: SSH", "Cpptools"));
    }
    return sshChannel;
}

export function showOutputChannel(): void {
    getOutputChannel().show();
}

let outputChannelLogger: Logger | undefined;

export function getOutputChannelLogger(): Logger {
    if (!outputChannelLogger) {
        outputChannelLogger = new Logger(message => getOutputChannel().append(message));
    }
    return outputChannelLogger;
}

export function log(output: string): void {
    if (!outputChannel) {
        outputChannel = getOutputChannel();
    }
    outputChannel.appendLine(`${output}`);
}

export interface DebugProtocolParams {
    jsonrpc: string;
    method: string;
    params?: any;
}

export function logDebugProtocol(output: DebugProtocolParams): void {
    if (!debugChannel) {
        debugChannel = vscode.window.createOutputChannel(`${localize("c.cpp.debug.protocol", "C/C++ Debug Protocol")}`);
    }
    debugChannel.appendLine("");
    debugChannel.appendLine("************************************************************************************************************************");
    debugChannel.append(`${output}`);
}

export interface ShowWarningParams {
    localizeStringParams: LocalizeStringParams;
}

export function showWarning(params: ShowWarningParams): void {
    const message: string = getLocalizedString(params.localizeStringParams);
    let showChannel: boolean = false;
    if (!warningChannel) {
        warningChannel = vscode.window.createOutputChannel(`${localize("c.cpp.warnings", "C/C++ Configuration Warnings")}`);
        showChannel = true;
    }
    // Append before showing the channel, to avoid a delay.
    warningChannel.appendLine(`[${new Date().toLocaleString()}] ${message}`);
    if (showChannel) {
        warningChannel.show(true);
    }
}

export function logLocalized(params: LocalizeStringParams): void {
    const output: string = getLocalizedString(params);
    log(output);
}

export function disposeOutputChannels(): void {
    if (outputChannel) {
        outputChannel.dispose();
    }
    if (diagnosticsChannel) {
        diagnosticsChannel.dispose();
    }
    if (debugChannel) {
        debugChannel.dispose();
    }
    if (warningChannel) {
        warningChannel.dispose();
    }
}
