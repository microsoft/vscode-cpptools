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
    private state: vscode.Memento;

    constructor(key: string, defaultValue: T, state: vscode.Memento) {
        this.key = key;
        this.defaultvalue = defaultValue;
        this.state = state;
    }

    public get Value(): T {
        return this.state.get<T>(this.key, this.defaultvalue);
    }

    public set Value(newValue: T) {
        this.state.update(this.key, newValue);
    }

    public get DefaultValue(): T {
        return this.defaultvalue;
    }
}

// Abstraction for global state that persists across activations but is not present in a settings file
export class PersistentState<T> extends PersistentStateBase<T> {
    constructor(key: string, defaultValue: T) {
        super(key, defaultValue, util.extensionContext.globalState);
    }
}

export class PersistentWorkspaceState<T> extends PersistentStateBase<T> {
    constructor(key: string, defaultValue: T) {
        super(key, defaultValue, util.extensionContext.workspaceState);
    }
}

export class PersistentFolderState<T> extends PersistentWorkspaceState<T> {
    constructor(key: string, defaultValue: T, folder: string) {
        let newKey: string = key + (folder ? `-${path.basename(folder)}` : "-untitled");
        super(newKey, defaultValue);
    }
}
