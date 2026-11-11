/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { suite } from 'mocha';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { EditorConfigWatcher } from '../../../../src/LanguageServer/editorConfig';
import * as extension from '../../../../src/LanguageServer/extension';
import { createProtocolFilter } from '../../../../src/LanguageServer/protocolFilter';
import * as testHelpers from '../../../common/testHelpers';

suite("EditorConfig in a multi-root workspace", () => {
    let firstFolder: vscode.WorkspaceFolder;
    let secondFolder: vscode.WorkspaceFolder;
    const directories: string[] = [];
    const documents: vscode.TextDocument[] = [];

    suiteSetup(async () => {
        await testHelpers.activateCppExtension();
        firstFolder = vscode.workspace.workspaceFolders?.[0] ?? assert.fail("First workspace folder is unavailable");
        secondFolder = vscode.workspace.workspaceFolders?.[1] ?? assert.fail("Second workspace folder is unavailable");
    });

    teardown(async () => {
        await closeDocuments();
        await extension.clients.getDefaultClient().onDidChangeVisibleTextEditors([]);
        for (const directory of directories.splice(0)) {
            await rm(directory, { recursive: true, force: true });
        }
    });

    async function closeDocuments(): Promise<void> {
        for (const document of documents.splice(0)) {
            if (!document.isClosed) {
                await vscode.window.showTextDocument(document, { preview: false });
                await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
            }
        }
    }

    async function createDocument(folder: vscode.WorkspaceFolder, endOfLine?: 'crlf'): Promise<vscode.TextDocument> {
        const directory = await mkdtemp(path.join(folder.uri.fsPath, 'editorconfig-review-'));
        directories.push(directory);
        await writeFile(path.join(directory, '.editorconfig'),
            'root = true\n[*.cpp]\nindent_style = tab\nindent_size = 3\n' +
            (endOfLine ? `end_of_line = ${endOfLine}\n` : ''));
        const source = path.join(directory, 'sample.cpp');
        await writeFile(source, 'int value;\n');
        const document = await vscode.workspace.openTextDocument(source);
        documents.push(document);
        return document;
    }

    test("uses the active document's formatting mode even when called on another client", async () => {
        const firstConfiguration = vscode.workspace.getConfiguration("C_Cpp", firstFolder.uri);
        const secondConfiguration = vscode.workspace.getConfiguration("C_Cpp", secondFolder.uri);
        const firstOriginal = firstConfiguration.inspect<string>("formatting")?.workspaceFolderValue;
        const secondOriginal = secondConfiguration.inspect<string>("formatting")?.workspaceFolderValue;
        const settingsFiles = [firstFolder, secondFolder].map(folder => path.join(folder.uri.fsPath, '.vscode/settings.json'));
        const settingsContents = await Promise.all(settingsFiles.map(async file => {
            try {
                return await readFile(file);
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                    return undefined;
                }
                throw error;
            }
        }));
        try {
            await firstConfiguration.update("formatting", "clangFormat", vscode.ConfigurationTarget.WorkspaceFolder);
            await secondConfiguration.update("formatting", "vcFormat", vscode.ConfigurationTarget.WorkspaceFolder);
            const firstDocument = await createDocument(firstFolder, 'crlf');
            const secondDocument = await createDocument(secondFolder);
            const firstOwner = extension.clients.getClientFor(firstDocument.uri);
            const secondOwner = extension.clients.getClientFor(secondDocument.uri);
            assert.notStrictEqual(firstOwner, secondOwner);
            const editor = await vscode.window.showTextDocument(firstDocument, { preview: false });
            editor.options = { insertSpaces: true, tabSize: 4, indentSize: 4 };
            secondOwner.updateActiveDocumentTextOptions();
            assert.strictEqual(editor.options.insertSpaces, true);
            assert.strictEqual(editor.options.tabSize, 4);
            assert.strictEqual(firstDocument.eol, vscode.EndOfLine.LF);

            const secondEditor = await vscode.window.showTextDocument(secondDocument, { preview: false });
            secondEditor.options = { insertSpaces: true, tabSize: 4, indentSize: 4 };
            firstOwner.updateActiveDocumentTextOptions();
            assert.strictEqual(secondEditor.options.insertSpaces, false);
            assert.strictEqual(secondEditor.options.tabSize, 3);
        } finally {
            await closeDocuments();
            await firstConfiguration.update("formatting", firstOriginal, vscode.ConfigurationTarget.WorkspaceFolder);
            await secondConfiguration.update("formatting", secondOriginal, vscode.ConfigurationTarget.WorkspaceFolder);
            for (let index = 0; index < settingsFiles.length; ++index) {
                const content = settingsContents[index];
                if (content === undefined) {
                    await rm(settingsFiles[index], { force: true });
                } else {
                    await writeFile(settingsFiles[index], content);
                }
            }
        }
    });

    test("uses one watcher owner for secondary didOpen and later visibility changes", async () => {
        await extension.clients.getDefaultClient().onDidChangeVisibleTextEditors([]);
        const document = await createDocument(secondFolder);
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const owner = extension.clients.getClientFor(document.uri);
        const defaultClient = extension.clients.getDefaultClient();
        assert.notStrictEqual(owner, defaultClient);
        await defaultClient.onDidChangeVisibleTextEditors([]);
        const sandbox = sinon.createSandbox();
        const updates = sandbox.spy(EditorConfigWatcher.prototype, "update");
        const creations = sandbox.spy(vscode.workspace, "createFileSystemWatcher");
        const trackedDocument = owner.TrackedDocuments.get(document.uri.toString());
        try {
            sandbox.stub(owner, "takeOwnership");
            owner.TrackedDocuments.delete(document.uri.toString());
            const filter = createProtocolFilter();
            assert.ok(filter.didOpen);
            await filter.didOpen(document, async () => { });
            await defaultClient.onDidChangeVisibleTextEditors([editor]);
            assert.ok(updates.called);
            assert.strictEqual(new Set(updates.thisValues).size, 1);
            const disposals = creations.getCalls()
                .filter(call => call.args[0] instanceof vscode.RelativePattern && call.args[0].pattern === '.editorconfig')
                .map(call => sandbox.spy(call.returnValue, "dispose"));
            assert.ok(disposals.length > 0);
            await defaultClient.onDidChangeVisibleTextEditors([]);
            for (const disposal of disposals) {
                sinon.assert.calledOnce(disposal);
            }
        } finally {
            if (trackedDocument) {
                owner.TrackedDocuments.set(document.uri.toString(), trackedDocument);
            }
            sandbox.restore();
        }
    });
});
