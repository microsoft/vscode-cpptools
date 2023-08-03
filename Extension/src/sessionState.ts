/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';

/**
 * Stores a session variable and updates the vscode context.
 */
class SessionStateVariable<T> {
    constructor(private key: string, private value: T) {
        void this.setContext();
    }

    public get(): T {
        return this.value;
    }

    public async set(value: T): Promise<void> {
        this.value = value;
        return this.setContext();
    }

    private async setContext(): Promise<void> {
        await vscode.commands.executeCommand('setContext', this.key, this.value);
    }
}

// Used by the walkthrough to determine which markdown page to load. Any change to this type requires an update to the walkthrough.
export type SupportedWindowsVersions = '10' | '11' | '';

export abstract class SessionState {
    public static trustedCompilerFound = new SessionStateVariable<boolean>('cpptools.trustedCompilerFound', false);
    public static scanForCompilersDone = new SessionStateVariable<boolean>('cpptools.scanForCompilersDone', false);
    public static scanForCompilersEmpty = new SessionStateVariable<boolean>('cpptools.scanForCompilersEmpty', false);
    public static buildAndDebugIsFolderOpen = new SessionStateVariable<boolean>('cpptools.buildAndDebug.isFolderOpen', false);
    public static buildAndDebugIsSourceFile = new SessionStateVariable<boolean>('cpptools.buildAndDebug.isSourceFile', false);
    public static windowsVersion = new SessionStateVariable<SupportedWindowsVersions>('cpptools.windowsVersion', '');
}
