/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';
import { updateBuildAndDebugSessionState } from '../../../../src/Debugger/extension';
import { SessionState } from '../../../../src/sessionState';

suite("BuildAndDebug SessionState Tests", () => {
    test("updateBuildAndDebugSessionState sets false when editor is undefined", () => {
        updateBuildAndDebugSessionState(undefined);
        assert.strictEqual(SessionState.buildAndDebugIsSourceFile.get(), false);
        assert.strictEqual(SessionState.buildAndDebugIsFolderOpen.get(), false);
    });

    test("updateBuildAndDebugSessionState sets false for non-C/C++ editor", () => {
        const mockEditor: any = {
            document: {
                uri: vscode.Uri.file("test.txt"),
                languageId: "plaintext"
            }
        };
        updateBuildAndDebugSessionState(mockEditor);
        assert.strictEqual(SessionState.buildAndDebugIsSourceFile.get(), false);
        assert.strictEqual(SessionState.buildAndDebugIsFolderOpen.get(), false);
    });

    test("updateBuildAndDebugSessionState sets true for C/C++ source file", () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0] ?? assert.fail("No workspace folder available");
        const mockEditor: any = {
            document: {
                uri: vscode.Uri.joinPath(workspaceFolder.uri, "main.cpp"),
                languageId: "cpp"
            }
        };
        updateBuildAndDebugSessionState(mockEditor);
        assert.strictEqual(SessionState.buildAndDebugIsSourceFile.get(), true);
        assert.strictEqual(SessionState.buildAndDebugIsFolderOpen.get(), true);
    });

    test("updateBuildAndDebugSessionState sets false for C/C++ header file", () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0] ?? assert.fail("No workspace folder available");
        const mockEditor: any = {
            document: {
                uri: vscode.Uri.joinPath(workspaceFolder.uri, "header.h"),
                languageId: "cpp"
            }
        };
        updateBuildAndDebugSessionState(mockEditor);
        assert.strictEqual(SessionState.buildAndDebugIsSourceFile.get(), false);
        assert.strictEqual(SessionState.buildAndDebugIsFolderOpen.get(), false);
    });
});
