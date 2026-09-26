/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../../../vscode.d.ts" />

import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import * as extension from '../../../../src/LanguageServer/extension';
import * as testHelpers from '../../../common/testHelpers';

suite("Inactive region folding", function (): void {
    let testHook: apit.CppToolsTestHook;
    let workspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(async function (): Promise<void> {
        await testHelpers.activateCppExtension();
        const cpptools: apit.CppToolsTestApi = await apit.getCppToolsTestApi(api.Version.latest)
            ?? assert.fail("Could not get CppToolsTestApi");
        testHook = cpptools.getTestHook();
        workspaceFolder = vscode.workspace.workspaceFolders?.[0]
            ?? assert.fail("No workspace folder available");
    });

    suiteTeardown(function (): void {
        testHook.dispose();
    });

    test("folds an inactive preprocessor branch instead of its nested function", async () => {
        const configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", workspaceFolder.uri);
        const previousValue: boolean | undefined = configuration.inspect<boolean>("dimInactiveRegions")?.globalValue;
        await configuration.update("dimInactiveRegions", false, vscode.ConfigurationTarget.Global);
        try {
            const editor: vscode.TextEditor = await openFileAndWaitForIntelliSense();
            await vscode.commands.executeCommand("editor.unfoldAll");
            await vscode.commands.executeCommand("C_Cpp.FoldAllInactiveRegions");

            await assertInactiveBranchIsFolded(editor);
        } finally {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await configuration.update("dimInactiveRegions", previousValue, vscode.ConfigurationTarget.Global);
        }
    });

    test("automatically folds inactive regions when enabled", async () => {
        const configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", workspaceFolder.uri);
        const previousValue: boolean | undefined = configuration.inspect<boolean>("autoFoldInactiveRegions")?.globalValue;
        await configuration.update("autoFoldInactiveRegions", true, vscode.ConfigurationTarget.Global);
        try {
            const editor: vscode.TextEditor = await openFileAndWaitForIntelliSense();
            await testHelpers.delay(100);

            await assertInactiveBranchIsFolded(editor);
        } finally {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await configuration.update("autoFoldInactiveRegions", previousValue, vscode.ConfigurationTarget.Global);
        }
    });

    test("manual folding does not suppress later automatic folding", async () => {
        const configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", workspaceFolder.uri);
        const previousAutoFoldValue: boolean | undefined = configuration.inspect<boolean>("autoFoldInactiveRegions")?.globalValue;
        const previousCodeFoldingValue: string | undefined = configuration.inspect<string>("codeFolding")?.globalValue;
        await configuration.update("autoFoldInactiveRegions", false, vscode.ConfigurationTarget.Global);
        await configuration.update("codeFolding", "enabled", vscode.ConfigurationTarget.Global);
        try {
            const editor: vscode.TextEditor = await openFileAndWaitForIntelliSense();
            await vscode.commands.executeCommand("editor.unfoldAll");
            await vscode.commands.executeCommand("C_Cpp.FoldAllInactiveRegions");
            await assertInactiveBranchIsFolded(editor);

            await vscode.commands.executeCommand("editor.unfoldAll");
            await assertInactiveBranchIsUnfolded(editor);
            await configuration.update("autoFoldInactiveRegions", true, vscode.ConfigurationTarget.Global);

            await assertInactiveBranchIsFolded(editor);
        } finally {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await configuration.update("autoFoldInactiveRegions", previousAutoFoldValue, vscode.ConfigurationTarget.Global);
            await configuration.update("codeFolding", previousCodeFoldingValue, vscode.ConfigurationTarget.Global);
        }
    });

    test("unfolds all inactive regions", async () => {
        const editor: vscode.TextEditor = await openFileAndWaitForIntelliSense();
        try {
            await vscode.commands.executeCommand("C_Cpp.FoldAllInactiveRegions");
            await assertInactiveBranchIsFolded(editor);

            await vscode.commands.executeCommand("C_Cpp.UnfoldAllInactiveRegions");
            await assertInactiveBranchIsUnfolded(editor);
        } finally {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        }
    });

    test("applies a fold command queued before IntelliSense is ready", async () => {
        const configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp");
        const previousUpdateDelay: number | undefined = configuration.inspect<number>("intelliSenseUpdateDelay")?.globalValue;
        await configuration.update("intelliSenseUpdateDelay", 3000, vscode.ConfigurationTarget.Global);
        const editor: vscode.TextEditor = await openFileAndWaitForIntelliSense();
        try {
            await vscode.commands.executeCommand("editor.unfoldAll");
            let intelliSenseReady: boolean = false;
            const ready: Promise<void> = waitForIntelliSenseReady(path.basename(editor.document.fileName))
                .then(() => {
                    intelliSenseReady = true;
                });
            const editApplied: boolean = await editor.edit(editBuilder =>
                editBuilder.insert(new vscode.Position(0, 0), " "));
            assert.strictEqual(editApplied, true);
            assert.strictEqual(intelliSenseReady, false);

            await vscode.commands.executeCommand("C_Cpp.FoldAllInactiveRegions");
            await ready;
            await assertInactiveBranchIsFolded(editor);
        } finally {
            if (editor.document.isDirty) {
                await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
                await vscode.commands.executeCommand("undo");
            }
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await configuration.update("intelliSenseUpdateDelay", previousUpdateDelay, vscode.ConfigurationTarget.Global);
        }
    });

    test("does not automatically refold an editor after client recovery", async () => {
        const configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", workspaceFolder.uri);
        const previousAutoFoldValue: boolean | undefined = configuration.inspect<boolean>("autoFoldInactiveRegions")?.globalValue;
        const previousCodeFoldingValue: string | undefined = configuration.inspect<string>("codeFolding")?.globalValue;
        await configuration.update("autoFoldInactiveRegions", true, vscode.ConfigurationTarget.Global);
        await configuration.update("codeFolding", "enabled", vscode.ConfigurationTarget.Global);
        const editor: vscode.TextEditor = await openFileAndWaitForIntelliSense();
        try {
            await assertInactiveBranchIsFolded(editor);
            await vscode.commands.executeCommand("editor.unfoldAll");
            await assertInactiveBranchIsUnfolded(editor);

            const ready: Promise<void> = waitForIntelliSenseReady(path.basename(editor.document.fileName));
            await extension.clients.recreateClients();
            await ready;

            await assertInactiveBranchIsUnfolded(editor);
        } finally {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await configuration.update("autoFoldInactiveRegions", previousAutoFoldValue, vscode.ConfigurationTarget.Global);
            await configuration.update("codeFolding", previousCodeFoldingValue, vscode.ConfigurationTarget.Global);
        }
    });

    test("does not automatically fold regions introduced after an empty initial result", async () => {
        const configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", workspaceFolder.uri);
        const previousAutoFoldValue: boolean | undefined = configuration.inspect<boolean>("autoFoldInactiveRegions")?.globalValue;
        const previousCodeFoldingValue: string | undefined = configuration.inspect<string>("codeFolding")?.globalValue;
        await configuration.update("autoFoldInactiveRegions", true, vscode.ConfigurationTarget.Global);
        await configuration.update("codeFolding", "enabled", vscode.ConfigurationTarget.Global);
        const editor: vscode.TextEditor = await openFileAndWaitForIntelliSense("main.cpp");
        try {
            const ready: Promise<void> = waitForIntelliSenseReady(path.basename(editor.document.fileName));
            const editApplied: boolean = await editor.edit(editBuilder => editBuilder.insert(
                new vscode.Position(0, 0),
                "#if 0\nint inactive()\n{\n    return 0;\n}\n#endif\n\n"));
            assert.strictEqual(editApplied, true);
            await ready;
            await testHelpers.delay(100);

            const activeEditor: vscode.TextEditor = await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
            activeEditor.selection = new vscode.Selection(0, 0, 0, 0);
            await vscode.commands.executeCommand("cursorMove", { to: "down", by: "wrappedLine", value: 1 });
            assert.strictEqual(activeEditor.selection.active.line, 1);
        } finally {
            if (editor.document.isDirty) {
                await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
                await vscode.commands.executeCommand("undo");
            }
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await configuration.update("autoFoldInactiveRegions", previousAutoFoldValue, vscode.ConfigurationTarget.Global);
            await configuration.update("codeFolding", previousCodeFoldingValue, vscode.ConfigurationTarget.Global);
        }
    });

    test("does not automatically fold inactive regions when code folding is disabled", async () => {
        const configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", workspaceFolder.uri);
        const previousAutoFoldValue: boolean | undefined = configuration.inspect<boolean>("autoFoldInactiveRegions")?.globalValue;
        const previousCodeFoldingValue: string | undefined = configuration.inspect<string>("codeFolding")?.globalValue;
        await configuration.update("autoFoldInactiveRegions", false, vscode.ConfigurationTarget.Global);
        await configuration.update("codeFolding", "disabled", vscode.ConfigurationTarget.Global);
        try {
            const editor: vscode.TextEditor = await openFileAndWaitForIntelliSense();
            await vscode.commands.executeCommand("editor.unfoldAll");
            await configuration.update("autoFoldInactiveRegions", true, vscode.ConfigurationTarget.Global);
            await testHelpers.delay(100);

            await assertInactiveBranchIsUnfolded(editor);
        } finally {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            await testHelpers.delay(150);
            await configuration.update("autoFoldInactiveRegions", previousAutoFoldValue, vscode.ConfigurationTarget.Global);
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

    async function assertInactiveBranchIsUnfolded(editor: vscode.TextEditor): Promise<void> {
        const activeEditor: vscode.TextEditor = await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
        activeEditor.selection = new vscode.Selection(24, 0, 24, 0);
        await vscode.commands.executeCommand("cursorMove", { to: "down", by: "wrappedLine", value: 1 });
        assert.strictEqual(activeEditor.selection.active.line, 25);
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

    async function openFileAndWaitForIntelliSense(fileName: string = "code_folding.cpp"): Promise<vscode.TextEditor> {
        const filePath: string = path.join(workspaceFolder.uri.fsPath, fileName);
        const ready: Promise<void> = waitForIntelliSenseReady(fileName);
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(filePath);
        const editor: vscode.TextEditor = await vscode.window.showTextDocument(document);
        await ready;
        return editor;
    }
});
