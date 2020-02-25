/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as util from '../common';
import * as vscode from 'vscode';

class PersistentStateBase<T> {
    private key: string;
    private defaultvalue: T;
    private state: vscode.Memento;
    private curvalue: T;

    constructor(key: string, defaultValue: T, state: vscode.Memento) {
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
}

// Abstraction for global state that persists across activations but is not present in a settings file
export class PersistentState<T> extends PersistentStateBase<T> {
    constructor(key: string, defaultValue: T) {
        super(key, defaultValue, util.extensionContext ? util.extensionContext.globalState : null);
    }
}

export class PersistentWorkspaceState<T> extends PersistentStateBase<T> {
    constructor(key: string, defaultValue: T) {
        super(key, defaultValue, util.extensionContext ? util.extensionContext.workspaceState : null);
    }
}

export class PersistentFolderState<T> extends PersistentWorkspaceState<T> {
    constructor(key: string, defaultValue: T, folder: vscode.WorkspaceFolder) {
        let newKey: string = key + (folder ? `-${util.getUniqueWorkspaceName(folder)}` : "-untitled");
        super(newKey, defaultValue);
    }
}
