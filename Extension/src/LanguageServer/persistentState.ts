/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as util from '../common';
import * as vscode from 'vscode';
import * as path from 'path';

class PersistentStateBase<T> {
    private key: string;
    private defaultvalue: T;
    private state?: vscode.Memento;
    private curvalue: T;

    constructor(key: string, defaultValue: T, state?: vscode.Memento) {
        this.key = key;
        this.defaultvalue = defaultValue;
        this.state = state;
        this.curvalue = defaultValue;
    }

    public get Value(): T {
        return this.state ? this.state.get<T>(this.key, this.defaultvalue) : this.curvalue;
    }

    public set Value(newValue: T) {
        if (this.state) {
            this.state.update(this.key, newValue);
        }
        this.curvalue = newValue;
    }

    public get DefaultValue(): T {
        return this.defaultvalue;
    }

    public setDefault(): void {
        if (this.state) {
            this.state.update(this.key, this.defaultvalue);
        }
        this.curvalue = this.defaultvalue;
    }

}

// Abstraction for global state that persists across activations but is not present in a settings file
export class PersistentState<T> extends PersistentStateBase<T> {
    constructor(key: string, defaultValue: T) {
        super(key, defaultValue, util.extensionContext ? util.extensionContext.globalState : undefined);
    }
}

export class PersistentWorkspaceState<T> extends PersistentStateBase<T> {
    constructor(key: string, defaultValue: T) {
        super(key, defaultValue, util.extensionContext ? util.extensionContext.workspaceState : undefined);
    }
}

export class PersistentFolderState<T> extends PersistentWorkspaceState<T> {
    constructor(key: string, defaultValue: T, folder: vscode.WorkspaceFolder) {
        // Check for the old key. If found, remove it and update the new key with the old value.
        const old_key: string = key + (folder ? `-${path.basename(folder.uri.fsPath)}` : "-untitled");
        let old_val: T | undefined;
        if (util.extensionContext) {
            old_val = util.extensionContext.workspaceState.get(old_key);
            if (old_val !== undefined) {
                util.extensionContext.workspaceState.update(old_key, undefined);
            }
        }
        const newKey: string = key + (folder ? `-${folder.uri.fsPath}` : "-untitled");
        super(newKey, defaultValue);
        if (old_val !== undefined) {
            this.Value = old_val;
        }
    }
}
