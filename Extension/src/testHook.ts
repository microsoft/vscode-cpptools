/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CppToolsTestHook, Status } from 'vscode-cpptools/out/testApi';
import * as vscode from 'vscode';

export class TestHook implements CppToolsTestHook {
    private statusChangedEvent: vscode.EventEmitter<Status> = new vscode.EventEmitter<Status>();

    public get StatusChanged(): vscode.Event<Status> {
        return this.statusChangedEvent.event;
    }

    public get valid(): boolean {
        return !!this.statusChangedEvent;
    }

    public updateStatus(status: Status): void {
        this.statusChangedEvent.fire(status);
    }

    public dispose(): void {
        this.statusChangedEvent.dispose();
        this.statusChangedEvent = null;
    }
}

let testHook: TestHook;

export function getTestHook(): TestHook {
    if (!testHook || !testHook.valid) {
        testHook = new TestHook();
    }
    return testHook;
}