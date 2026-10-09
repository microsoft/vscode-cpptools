/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../../../vscode.d.ts" />

import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as extension from '../../../../src/LanguageServer/extension';
import * as testHelpers from '../../../common/testHelpers';

suite("Inactive region folding in a multi-root workspace", function (): void {
    let firstWorkspaceFolder: vscode.WorkspaceFolder;
    let workspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(async function (): Promise<void> {
        await testHelpers.activateCppExtension();
        firstWorkspaceFolder = vscode.workspace.workspaceFolders?.[0]
            ?? assert.fail("First workspace folder is unavailable");
        workspaceFolder = vscode.workspace.workspaceFolders?.[1]
            ?? assert.fail("Second workspace folder is unavailable");
    });

    test("routes manual folding operations by URI during a workspace client switch", async () => {
        const sandbox: sinon.SinonSandbox = sinon.createSandbox();
        let releaseEditorChange: (() => void) | undefined;
        let editorChangePromise: Promise<void> | undefined;
        let editor: vscode.TextEditor | undefined;
        let firstEditor: vscode.TextEditor | undefined;
        try {
            const firstDocument: vscode.TextDocument = await vscode.workspace.openTextDocument(
                path.join(firstWorkspaceFolder.uri.fsPath, "test.cpp"));
            firstEditor = await vscode.window.showTextDocument(firstDocument);
            await extension.clients.didChangeActiveEditor(firstEditor);
            const firstClient = extension.clients.ActiveClient;
            const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
                path.join(workspaceFolder.uri.fsPath, "code_folding.cpp"));
            const owner = extension.clients.getClientFor(document.uri);
            assert.notStrictEqual(firstClient, owner);

            const ownerFoldStub: sinon.SinonStub = sandbox.stub(owner, "foldAllInactiveRegions").resolves();
            const ownerUnfoldStub: sinon.SinonStub = sandbox.stub(owner, "unfoldAllInactiveRegions").resolves();
            const firstFoldStub: sinon.SinonStub = sandbox.stub(firstClient, "foldAllInactiveRegions").resolves();
            const firstUnfoldStub: sinon.SinonStub = sandbox.stub(firstClient, "unfoldAllInactiveRegions").resolves();

            const pendingEditorChange: Promise<void> = new Promise(resolve => releaseEditorChange = resolve);
            // Hold the client switch open; only command dispatch is under test.
            sandbox.stub(owner, "didChangeActiveEditor").returns(pendingEditorChange);
            editor = await vscode.window.showTextDocument(document);
            editorChangePromise = extension.clients.didChangeActiveEditor(editor);
            assert.strictEqual(extension.clients.ActiveClient, firstClient);

            await vscode.commands.executeCommand("C_Cpp.FoldAllInactiveRegions");
            sinon.assert.calledOnce(ownerFoldStub);
            sinon.assert.notCalled(firstFoldStub);
            assert.strictEqual(extension.clients.ActiveClient, firstClient);

            await vscode.commands.executeCommand("C_Cpp.UnfoldAllInactiveRegions");
            sinon.assert.calledOnce(ownerUnfoldStub);
            sinon.assert.notCalled(firstUnfoldStub);
            assert.strictEqual(extension.clients.ActiveClient, firstClient);
        } finally {
            releaseEditorChange?.();
            await editorChangePromise;
            sandbox.restore();
            if (editor) {
                await closeEditor(editor);
            }
            if (firstEditor) {
                await closeEditor(firstEditor);
            }
        }
    });

    async function closeEditor(editor: vscode.TextEditor): Promise<void> {
        await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
});
