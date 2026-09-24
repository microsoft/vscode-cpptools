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
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import * as extension from '../../../../src/LanguageServer/extension';
import * as testHelpers from '../../../common/testHelpers';

suite("Inactive region folding in a multi-root workspace", function (): void {
    let testHook: apit.CppToolsTestHook;
    let firstWorkspaceFolder: vscode.WorkspaceFolder;
    let workspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(async function (): Promise<void> {
        await testHelpers.activateCppExtension();
        const cpptools: apit.CppToolsTestApi = await apit.getCppToolsTestApi(api.Version.latest)
            ?? assert.fail("Could not get CppToolsTestApi");
        testHook = cpptools.getTestHook();
        firstWorkspaceFolder = vscode.workspace.workspaceFolders?.[0]
            ?? assert.fail("First workspace folder is unavailable");
        workspaceFolder = vscode.workspace.workspaceFolders?.[1]
            ?? assert.fail("Second workspace folder is unavailable");
    });

    suiteTeardown(function (): void {
        testHook.dispose();
    });

    test("routes manual folding by URI during a workspace client switch", async () => {
        const configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", workspaceFolder.uri);
        const previousCodeFoldingValue: string | undefined = configuration.inspect<string>("codeFolding")?.globalValue;
        await configuration.update("codeFolding", "enabled", vscode.ConfigurationTarget.Global);
        let releaseEditorChange: (() => void) | undefined;
        let editorChangeStub: sinon.SinonStub | undefined;
        let editorChangePromise: Promise<void> | undefined;
        try {
            const editor: vscode.TextEditor = await openFileAndWaitForIntelliSense();
            await vscode.commands.executeCommand("editor.unfoldAll");

            const firstDocument: vscode.TextDocument = await vscode.workspace.openTextDocument(
                path.join(firstWorkspaceFolder.uri.fsPath, "test.cpp"));
            const firstEditor: vscode.TextEditor = await vscode.window.showTextDocument(firstDocument);
            await extension.clients.didChangeActiveEditor(firstEditor);
            const firstClient = extension.clients.ActiveClient;
            const owner = extension.clients.getClientFor(editor.document.uri);
            assert.notStrictEqual(firstClient, owner);

            const pendingEditorChange: Promise<void> = new Promise(resolve => releaseEditorChange = resolve);
            editorChangeStub = sinon.stub(owner, "didChangeActiveEditor").returns(pendingEditorChange);
            const activeEditor: vscode.TextEditor = await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
            editorChangePromise = extension.clients.didChangeActiveEditor(activeEditor);
            assert.strictEqual(extension.clients.ActiveClient, firstClient);

            await vscode.commands.executeCommand("C_Cpp.FoldInactiveRegions");

            await assertInactiveBranchIsFolded(editor);
        } finally {
            releaseEditorChange?.();
            await editorChangePromise;
            editorChangeStub?.restore();
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await configuration.update("codeFolding", previousCodeFoldingValue, vscode.ConfigurationTarget.Global);
        }
    });

    async function assertInactiveBranchIsFolded(editor: vscode.TextEditor): Promise<void> {
        let line: number = 24;
        for (let i: number = 0; i < 20; ++i) {
            const activeEditor: vscode.TextEditor = await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
            activeEditor.selection = new vscode.Selection(24, 0, 24, 0);
            await vscode.commands.executeCommand("cursorMove", { to: "down", by: "wrappedLine", value: 1 });
            line = activeEditor.selection.active.line;
            if (line === 28) {
                return;
            }
            await testHelpers.delay(50);
        }

        assert.strictEqual(line, 28);
    }

    function waitForIntelliSenseReady(fileName: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timeout: NodeJS.Timeout = setTimeout(() => {
                listener.dispose();
                reject(new Error(`Timed out waiting for IntelliSense for ${fileName}`));
            }, testHelpers.defaultTimeout);
            const listener: vscode.Disposable = testHook.IntelliSenseStatusChanged(result => {
                if (result.filename === fileName && result.status === apit.Status.IntelliSenseReady) {
                    clearTimeout(timeout);
                    listener.dispose();
                    resolve();
                }
            });
        });
    }

    async function openFileAndWaitForIntelliSense(): Promise<vscode.TextEditor> {
        const fileName: string = "code_folding.cpp";
        const filePath: string = path.join(workspaceFolder.uri.fsPath, fileName);
        const ready: Promise<void> = waitForIntelliSenseReady(fileName);
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(filePath);
        const editor: vscode.TextEditor = await vscode.window.showTextDocument(document);
        await ready;
        return editor;
    }
});
