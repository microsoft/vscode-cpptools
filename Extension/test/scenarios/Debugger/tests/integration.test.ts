/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../../../vscode.d.ts" />
import * as assert from 'assert';
import { suite } from 'mocha';
import * as vscode from 'vscode';

suite(`Debug Integration Test: `, function(): void {

    suiteSetup(async function(): Promise<void> {
        const extension: vscode.Extension<any> = vscode.extensions.getExtension("ms-vscode.cpptools") || assert.fail("Extension not found");
        if (!extension.isActive) {
            await extension.activate();
        }
    });

    test("Starting (gdb) Launch from the workspace root should create an Active Debug Session", async () => {
        // If it is failing on startDebugging. Investigate the SimpleCppProject's tasks.json or launch.json.
        await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], "(gdb) Launch");

        const debugSessionTerminated: Promise<void> = new Promise(resolve => {
            vscode.debug.onDidTerminateDebugSession((e) => resolve());
        });

        try {
            assert.equal(vscode.debug.activeDebugSession?.type, "cppdbg");
        } catch (e) {
            assert.fail("Debugger failed to launch. Did the extension activate correctly?");
        }

        await debugSessionTerminated;
    });
});
