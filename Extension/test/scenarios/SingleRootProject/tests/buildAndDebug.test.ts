/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import * as fs from 'fs';
import { suite, test } from 'mocha';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { updateBuildAndDebugSessionState } from '../../../../src/Debugger/extension';
import { SessionState } from '../../../../src/sessionState';
import * as testHelpers from '../../../common/testHelpers';

async function assertSessionState(isSourceFile: boolean, isFolderOpen: boolean): Promise<void> {
    const timeout: number = Date.now() + 1000;
    while (Date.now() < timeout &&
        (SessionState.buildAndDebugIsSourceFile.get() !== isSourceFile ||
            SessionState.buildAndDebugIsFolderOpen.get() !== isFolderOpen)) {
        await testHelpers.delay(10);
    }
    assert.strictEqual(SessionState.buildAndDebugIsSourceFile.get(), isSourceFile);
    assert.strictEqual(SessionState.buildAndDebugIsFolderOpen.get(), isFolderOpen);
}

suite("BuildAndDebug SessionState Tests", () => {
    test("updateBuildAndDebugSessionState sets false when editor is undefined", () => {
        updateBuildAndDebugSessionState(undefined);
        assert.strictEqual(SessionState.buildAndDebugIsSourceFile.get(), false);
        assert.strictEqual(SessionState.buildAndDebugIsFolderOpen.get(), true);
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
        assert.strictEqual(SessionState.buildAndDebugIsFolderOpen.get(), true);
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

    test("updateBuildAndDebugSessionState tracks an external C/C++ source file", () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0] ?? assert.fail("No workspace folder available");
        const mockEditor: any = {
            document: {
                uri: vscode.Uri.joinPath(workspaceFolder.uri, "..", "external.cpp"),
                languageId: "cpp"
            }
        };
        updateBuildAndDebugSessionState(mockEditor);
        assert.strictEqual(SessionState.buildAndDebugIsSourceFile.get(), true);
        assert.strictEqual(SessionState.buildAndDebugIsFolderOpen.get(), false);
    });

    test("active document language changes update session state", async () => {
        const temporaryDirectory: string = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cpptools-build-and-debug-"));
        const sourceUri: vscode.Uri = vscode.Uri.file(path.join(temporaryDirectory, "external.cpp"));
        await fs.promises.writeFile(sourceUri.fsPath, "int main() { return 0; }\n");

        try {
            let document: vscode.TextDocument = await vscode.workspace.openTextDocument(sourceUri);
            await vscode.window.showTextDocument(document);
            await assertSessionState(true, false);

            document = await vscode.languages.setTextDocumentLanguage(document, "plaintext");
            await assertSessionState(false, true);

            await vscode.languages.setTextDocumentLanguage(document, "cpp");
            await assertSessionState(true, false);
        } finally {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
        }
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
        assert.strictEqual(SessionState.buildAndDebugIsFolderOpen.get(), true);
    });
});
