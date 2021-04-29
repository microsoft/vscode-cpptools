/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as os from 'os';

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

    // This function is not intended to have a top-level await.
    public showInformationMessage(message: string, items?: string[]): Thenable<string | undefined> {
        this.appendLine(message);

        if (!items) {
            return vscode.window.showInformationMessage(message);
        }
        return vscode.window.showInformationMessage(message, ...items);
    }

    // This function is not intended to have a top-level await.
    public showWarningMessage(message: string, items?: string[]): Thenable<string | undefined> {
        this.appendLine(message);

        if (!items) {
            return vscode.window.showWarningMessage(message);
        }
        return vscode.window.showWarningMessage(message, ...items);
    }

    // This function is not intended to have a top-level await.
    public showErrorMessage(message: string, items?: string[]): Thenable<string | undefined> {
        this.appendLine(message);

        if (!items) {
            return vscode.window.showErrorMessage(message);
        }
        return vscode.window.showErrorMessage(message, ...items);
    }
}

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("C/C++");
    }
    return outputChannel;
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
