/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CppToolsTestHook, Status, IntelliSenseStatus } from 'vscode-cpptools/out/testApi';
import * as vscode from 'vscode';

export class TestHook implements CppToolsTestHook {
    private intelliSenseStatusChangedEvent: vscode.EventEmitter<IntelliSenseStatus> = new vscode.EventEmitter<IntelliSenseStatus>();
    private statusChangedEvent: vscode.EventEmitter<Status> = new vscode.EventEmitter<Status>();

    // The StatusChanged event is deprecated in CppToolsTestHook API.
    public get StatusChanged(): vscode.Event<Status> {
        return this.statusChangedEvent.event;
    }

    public get IntelliSenseStatusChanged(): vscode.Event<IntelliSenseStatus> {
        return this.intelliSenseStatusChangedEvent.event;
    }

    public get valid(): boolean {
        return !!this.intelliSenseStatusChangedEvent && !!this.statusChangedEvent;
    }

    public updateStatus(status: IntelliSenseStatus): void {
        this.intelliSenseStatusChangedEvent.fire(status);
        this.statusChangedEvent.fire(status.status);
    }

    public dispose(): void {
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
