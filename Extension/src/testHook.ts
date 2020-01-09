/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CppToolsTestHook, IntelliSenseStatus } from 'vscode-cpptools/out/testApi';
import * as vscode from 'vscode';

export class TestHook implements CppToolsTestHook {
    private statusChangedEvent: vscode.EventEmitter<IntelliSenseStatus> = new vscode.EventEmitter<IntelliSenseStatus>();

    public get StatusChanged(): vscode.Event<IntelliSenseStatus> {
        return this.statusChangedEvent.event;
    }

    public get valid(): boolean {
        return !!this.statusChangedEvent;
    }

    public updateStatus(status: IntelliSenseStatus): void {
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
