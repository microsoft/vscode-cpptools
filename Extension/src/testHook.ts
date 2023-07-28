/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { ok } from 'assert';
import * as vscode from 'vscode';
import { CppToolsTestHook, IntelliSenseStatus, Status } from 'vscode-cpptools/out/testApi';

export class TestHook implements CppToolsTestHook {
    private disposed = false;
    private intelliSenseStatusChangedEvent: vscode.EventEmitter<IntelliSenseStatus> = new vscode.EventEmitter<IntelliSenseStatus>();
    private statusChangedEvent: vscode.EventEmitter<Status> = new vscode.EventEmitter<Status>();

    // The StatusChanged event is deprecated in CppToolsTestHook API.
    public get StatusChanged(): vscode.Event<Status> {
        ok(!this.disposed, "TestHook is disposed.");
        return this.statusChangedEvent.event;
    }

    public get IntelliSenseStatusChanged(): vscode.Event<IntelliSenseStatus> {
        ok(!this.disposed, "TestHook is disposed.");
        return this.intelliSenseStatusChangedEvent.event;
    }

    public get valid(): boolean {
        return !this.disposed && !!this.intelliSenseStatusChangedEvent && !!this.statusChangedEvent;
    }

    public updateStatus(status: IntelliSenseStatus): void {
        ok(!this.disposed, "TestHook is disposed.");
        this.intelliSenseStatusChangedEvent.fire(status);
        this.statusChangedEvent.fire(status.status);
    }

    public dispose(): void {
        ok(!this.disposed, "TestHook is disposed.");
        this.disposed = true;
        this.intelliSenseStatusChangedEvent.dispose();
        this.statusChangedEvent.dispose();
    }
}

let testHook: TestHook;

export function getTestHook(): TestHook {
    if (!testHook || !testHook.valid) {
        testHook = new TestHook();
    }
    return testHook;
}
