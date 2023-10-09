/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../../../vscode.d.ts" />

import * as assert from 'assert';
import { suite } from 'mocha';
import * as vscode from 'vscode';
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import { timeout } from '../../../../src/Utility/Async/timeout';
import * as testHelpers from '../../../common/testHelpers';

suite("[Inlay hints test]", function(): void {
    // Settings
    const inlayHintSettings: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('C_Cpp.inlayHints');
    const autoDeclarationTypesEnabled: string = "autoDeclarationTypes.enabled";
    const autoDeclarationTypesShowOnLeft: string = "autoDeclarationTypes.showOnLeft";
    const parameterNamesEnabled: string = "parameterNames.enabled";
    const parameterNamesSuppress: string = "parameterNames.suppressWhenArgumentContainsName";
    const parameterNamesHideUnderScore: string = "parameterNames.hideLeadingUnderscores";
    const referenceOperatorEnabled: string = "referenceOperator.enabled";
    const referenceOperatorShowSpace: string = "referenceOperator.showSpace";
    const enabled: boolean = true;
    const disabled: boolean = false;
    let autoDeclarationTypesEnabledValue: any;
    let autoDeclarationTypesShowOnLeftValue: any;
    let parameterNamesEnabledValue: any;
    let parameterNamesSuppressValue: any;
    let parameterNamesHideUnderScoreValue: any;
    let referenceOperatorEnabledValue: any;
    let referenceOperatorShowSpaceValue: any;
    // Test setup
    const wf = vscode.workspace.workspaceFolders?.[1] ?? assert.fail("Test failed because workspace folder is undefined.");
    const rootUri: vscode.Uri = wf.uri;
    const filePath: string | undefined = rootUri.fsPath + "/inlay_hints.cpp";
    const fileUri: vscode.Uri = vscode.Uri.file(filePath);
    const disposables: vscode.Disposable[] = [];

    suiteSetup(async function(): Promise<void> {
        await testHelpers.activateCppExtension();

        const cpptools = await apit.getCppToolsTestApi(api.Version.latest) ?? assert.fail("Could not get cpptools test api");

        const testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        disposables.push(testHook);

        const getIntelliSenseStatus = new Promise<void>((resolve) => {
            disposables.push(testHook.IntelliSenseStatusChanged(result => {
                result = result as apit.IntelliSenseStatus;
                if (result.filename === "inlay_hints.cpp" && result.status === apit.Status.IntelliSenseReady) {
                    console.log(`IntelliSense for '${result.filename}' is ready`);
                    resolve();
                } else if (result.status === apit.Status.TagParsingBegun) {
                    console.log(`IntelliSense status is TagParsingBegun`);
                } else if (result.status === apit.Status.TagParsingDone) {
                    console.log(`IntelliSense status is TagParsingDone`);
                } else if (result.status === apit.Status.IntelliSenseCompiling) {
                    console.log(`IntelliSense status is IntelliSenseCompiling`);
                }
            }));
        });

        // Start language server
        console.log("Open file: " + fileUri.toString());
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);
        await timeout(30000, getIntelliSenseStatus);
        saveOriginalSettings();
        await useDefaultSettings();
    });

    suiteTeardown(async function(): Promise<void> {
        await restoreOriginalSettings();
        disposables.forEach(d => d.dispose());
    });

    function saveOriginalSettings(): void {
        autoDeclarationTypesEnabledValue = inlayHintSettings.inspect(autoDeclarationTypesEnabled)!.globalValue;
        autoDeclarationTypesShowOnLeftValue = inlayHintSettings.inspect(autoDeclarationTypesShowOnLeft)!.globalValue;
        parameterNamesEnabledValue = inlayHintSettings.inspect(parameterNamesEnabled)!.globalValue;
        parameterNamesSuppressValue = inlayHintSettings.inspect(parameterNamesSuppress)!.globalValue;
        parameterNamesHideUnderScoreValue = inlayHintSettings.inspect(parameterNamesHideUnderScore)!.globalValue;
        referenceOperatorEnabledValue = inlayHintSettings.inspect(referenceOperatorEnabled)!.globalValue;
        referenceOperatorShowSpaceValue = inlayHintSettings.inspect(referenceOperatorShowSpace)!.globalValue;
    }

    async function restoreOriginalSettings(): Promise<void> {
        await changeInlayHintSetting(autoDeclarationTypesEnabled, autoDeclarationTypesEnabledValue);
        await changeInlayHintSetting(autoDeclarationTypesShowOnLeft, autoDeclarationTypesShowOnLeftValue);
        await changeInlayHintSetting(parameterNamesEnabled, parameterNamesEnabledValue);
        await changeInlayHintSetting(parameterNamesSuppress, parameterNamesSuppressValue);
        await changeInlayHintSetting(parameterNamesHideUnderScore, parameterNamesHideUnderScoreValue);
        await changeInlayHintSetting(referenceOperatorEnabled, referenceOperatorEnabledValue);
        await changeInlayHintSetting(referenceOperatorShowSpace, referenceOperatorShowSpaceValue);
    }

    async function useDefaultSettings(): Promise<void> {
        await changeInlayHintSetting(autoDeclarationTypesEnabled, undefined);
        await changeInlayHintSetting(autoDeclarationTypesShowOnLeft, undefined);
        await changeInlayHintSetting(parameterNamesEnabled, undefined);
        await changeInlayHintSetting(parameterNamesSuppress, undefined);
        await changeInlayHintSetting(parameterNamesHideUnderScore, undefined);
        await changeInlayHintSetting(referenceOperatorEnabled, undefined);
        await changeInlayHintSetting(referenceOperatorShowSpace, undefined);
    }

    test("[Inlay Hints - auto type]", async () => {

        const range: vscode.Range = new vscode.Range(new vscode.Position(15, 0), new vscode.Position(31, 0));

        await changeInlayHintSetting(autoDeclarationTypesEnabled, disabled);
        await changeInlayHintSetting(autoDeclarationTypesShowOnLeft, disabled);

        // WARNING: debugging this test will block on this call: (and others like it.)
        const result1 = await timeout(1000, vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range) as Promise<any>);
        assert.strictEqual(result1.length, 0, "Incorrect number of results.");

        await changeInlayHintSetting(autoDeclarationTypesEnabled, enabled);

        const result2 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result2.length, 12, "Incorrect number of results.");
        const expectedKind = vscode.InlayHintKind.Type;
        assertHintValues(result2, 0, 16, 16, ": int *const", expectedKind);
        assertHintValues(result2, 1, 17, 17, ": const int *const", expectedKind);
        assertHintValues(result2, 2, 18, 18, ": const int *const &", expectedKind);
        assertHintValues(result2, 3, 19, 19, ": const int *const", expectedKind);
        assertHintValues(result2, 4, 20, 17, ": const int", expectedKind);
        assertHintValues(result2, 5, 21, 12, ": const int &", expectedKind);
        assertHintValues(result2, 6, 22, 21, ": const int &", expectedKind);
        assertHintValues(result2, 7, 23, 21, ": const int *", expectedKind);
        assertHintValues(result2, 8, 24, 21, ": int *", expectedKind);
        assertHintValues(result2, 9, 25, 21, ": const int *", expectedKind);
        assertHintValues(result2, 10, 28, 14, ": int", expectedKind);
        assertHintValues(result2, 11, 29, 15, ": int", expectedKind);
    });

    test("[Inlay Hints - auto type, show on left]", async () => {
        const range: vscode.Range = new vscode.Range(new vscode.Position(15, 0), new vscode.Position(31, 0));

        await changeInlayHintSetting(autoDeclarationTypesEnabled, disabled);
        await changeInlayHintSetting(autoDeclarationTypesShowOnLeft, disabled);
        const result1 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result1.length, 0, "Incorrect number of results.");

        await changeInlayHintSetting(autoDeclarationTypesEnabled, enabled);
        await changeInlayHintSetting(autoDeclarationTypesShowOnLeft, enabled);
        const result2 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result2.length, 12, "Incorrect number of results.");
        const expectedKind = vscode.InlayHintKind.Type;
        assertHintValues(result2, 0, 16, 15, "int *const", expectedKind);
        assertHintValues(result2, 1, 17, 15, "const int *const", expectedKind);
        assertHintValues(result2, 2, 18, 16, "const int *const &", expectedKind);
        assertHintValues(result2, 3, 19, 17, "const int *const", expectedKind);
        assertHintValues(result2, 4, 20, 15, "const int", expectedKind);
        assertHintValues(result2, 5, 21, 10, "const int &", expectedKind);
        assertHintValues(result2, 6, 22, 19, "const int &", expectedKind);
        assertHintValues(result2, 7, 23, 19, "const int *", expectedKind);
        assertHintValues(result2, 8, 24, 19, "int *", expectedKind);
        assertHintValues(result2, 9, 25, 19, "const int *", expectedKind);
        assertHintValues(result2, 10, 28, 9, "int", expectedKind);
        assertHintValues(result2, 11, 29, 14, "int", expectedKind);
    });

    test("[Inlay Hints - parameter names]", async () => {
        const range: vscode.Range = new vscode.Range(new vscode.Position(39, 0), new vscode.Position(78, 0));

        await changeInlayHintSetting(parameterNamesEnabled, disabled);
        await changeInlayHintSetting(referenceOperatorEnabled, disabled);
        const result1 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result1.length, 0, "Incorrect number of results.");

        await changeInlayHintSetting(parameterNamesEnabled, enabled);
        await changeInlayHintSetting(parameterNamesSuppress, enabled);
        const result2 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result2.length, 16, "Incorrect number of results.");
        const expectedKind = vscode.InlayHintKind.Parameter;
        assertHintValues(result2, 0, 41, 17, "width:", expectedKind);
        assertHintValues(result2, 1, 41, 20, "height:", expectedKind);
        assertHintValues(result2, 2, 42, 17, "width:", expectedKind);
        assertHintValues(result2, 3, 43, 17, "height:", expectedKind);
        assertHintValues(result2, 4, 45, 17, "width:", expectedKind);
        assertHintValues(result2, 5, 46, 17, "height:", expectedKind);
        assertHintValues(result2, 6, 50, 20, "height:", expectedKind);
        assertHintValues(result2, 7, 51, 26, "height:", expectedKind);
        assertHintValues(result2, 8, 52, 29, "height:", expectedKind);
        assertHintValues(result2, 9, 54, 13, "height:", expectedKind);
        assertHintValues(result2, 10, 57, 13, "height:", expectedKind);
        assertHintValues(result2, 11, 61, 13, "width:", expectedKind);
        assertHintValues(result2, 12, 62, 13, "width:", expectedKind);
        assertHintValues(result2, 13, 63, 16, "width:", expectedKind);
        assertHintValues(result2, 14, 64, 13, "width:", expectedKind);
        assertHintValues(result2, 15, 67, 13, "width:", expectedKind);
    });

    test("[Inlay Hints - parameter hideLeadingUnderscores]", async () => {
        const range: vscode.Range = new vscode.Range(new vscode.Position(34, 0), new vscode.Position(36, 0));

        await changeInlayHintSetting(parameterNamesEnabled, enabled);
        await changeInlayHintSetting(parameterNamesHideUnderScore, disabled);
        const result1 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result1.length, 4, "Incorrect number of results.");
        const expectedKind = vscode.InlayHintKind.Parameter;
        assertHintValues(result1, 0, 35, 16, "___x:", expectedKind);
        assertHintValues(result1, 1, 35, 19, "__y:", expectedKind);
        assertHintValues(result1, 2, 35, 22, "_z:", expectedKind);
        assertHintValues(result1, 3, 35, 25, "a:", expectedKind);

        await changeInlayHintSetting(parameterNamesHideUnderScore, enabled);
        const result2 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result2.length, 4, "Incorrect number of results.");
        assertHintValues(result2, 0, 35, 16, "x:", expectedKind);
        assertHintValues(result2, 1, 35, 19, "y:", expectedKind);
        assertHintValues(result2, 2, 35, 22, "z:", expectedKind);
        assertHintValues(result2, 3, 35, 25, "a:", expectedKind);
    });

    test("[Inlay Hints - reference operator]", async () => {
        const range: vscode.Range = new vscode.Range(new vscode.Position(81, 0), new vscode.Position(106, 0));

        await changeInlayHintSetting(parameterNamesEnabled, disabled);
        await changeInlayHintSetting(referenceOperatorEnabled, disabled);
        await changeInlayHintSetting(referenceOperatorShowSpace, disabled);
        const result1 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result1.length, 0, "Incorrect number of results.");

        await changeInlayHintSetting(referenceOperatorEnabled, enabled);
        const result2 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result2.length, 16, "Incorrect number of results.");
        const expectedKind = vscode.InlayHintKind.Parameter;
        const refOp: string = "&:";
        assertHintValues(result2, 0, 87, 9, refOp, expectedKind);
        assertHintValues(result2, 1, 87, 12, refOp, expectedKind);
        assertHintValues(result2, 2, 88, 9, refOp, expectedKind);
        assertHintValues(result2, 3, 88, 22, refOp, expectedKind);
        assertHintValues(result2, 4, 89, 9, refOp, expectedKind);
        assertHintValues(result2, 5, 90, 9, refOp, expectedKind);
        assertHintValues(result2, 6, 93, 9, refOp, expectedKind);
        assertHintValues(result2, 7, 94, 9, refOp, expectedKind);
        assertHintValues(result2, 8, 97, 9, refOp, expectedKind);
        assertHintValues(result2, 9, 97, 12, refOp, expectedKind);
        assertHintValues(result2, 10, 98, 9, refOp, expectedKind);
        assertHintValues(result2, 11, 98, 12, refOp, expectedKind);
        assertHintValues(result2, 12, 99, 9, refOp, expectedKind);
        assertHintValues(result2, 13, 100, 9, refOp, expectedKind);
        assertHintValues(result2, 14, 103, 9, refOp, expectedKind);
        assertHintValues(result2, 15, 104, 9, refOp, expectedKind);
    });

    test("[Inlay Hints - reference operator and param name, show space]", async () => {
        const range: vscode.Range = new vscode.Range(new vscode.Position(87, 0), new vscode.Position(96, 0));

        await changeInlayHintSetting(parameterNamesEnabled, enabled);
        await changeInlayHintSetting(parameterNamesHideUnderScore, enabled);
        await changeInlayHintSetting(parameterNamesSuppress, disabled);
        await changeInlayHintSetting(referenceOperatorEnabled, enabled);
        await changeInlayHintSetting(referenceOperatorShowSpace, disabled);
        const result1 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result1.length, 12, "Incorrect number of results.");
        const expectedKind = vscode.InlayHintKind.Parameter;
        assertHintValues(result1, 0, 87, 9, "&first:", expectedKind);
        assertHintValues(result1, 1, 87, 12, "&last:", expectedKind);
        assertHintValues(result1, 2, 87, 15, "flag:", expectedKind);
        assertHintValues(result1, 3, 88, 9, "&first:", expectedKind);
        assertHintValues(result1, 4, 88, 22, "&last:", expectedKind);
        assertHintValues(result1, 5, 88, 25, "flag:", expectedKind);
        assertHintValues(result1, 6, 89, 9, "&first:", expectedKind);
        assertHintValues(result1, 7, 90, 9, "&last:", expectedKind);
        assertHintValues(result1, 8, 91, 9, "flag:", expectedKind);
        assertHintValues(result1, 9, 93, 9, "&first:", expectedKind);
        assertHintValues(result1, 10, 94, 9, "&last:", expectedKind);
        assertHintValues(result1, 11, 95, 9, "flag:", expectedKind);

        await changeInlayHintSetting(referenceOperatorShowSpace, enabled);
        const result2 = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', fileUri, range);
        assert.strictEqual(result2.length, 12, "Incorrect number of results.");
        assertHintValues(result2, 0, 87, 9, "& first:", expectedKind);
        assertHintValues(result2, 1, 87, 12, "& last:", expectedKind);
        assertHintValues(result2, 2, 87, 15, "flag:", expectedKind);
        assertHintValues(result2, 3, 88, 9, "& first:", expectedKind);
        assertHintValues(result2, 4, 88, 22, "& last:", expectedKind);
        assertHintValues(result2, 5, 88, 25, "flag:", expectedKind);
        assertHintValues(result2, 6, 89, 9, "& first:", expectedKind);
        assertHintValues(result2, 7, 90, 9, "& last:", expectedKind);
        assertHintValues(result2, 8, 91, 9, "flag:", expectedKind);
        assertHintValues(result2, 9, 93, 9, "& first:", expectedKind);
        assertHintValues(result2, 10, 94, 9, "& last:", expectedKind);
        assertHintValues(result2, 11, 95, 9, "flag:", expectedKind);
    });

    async function changeInlayHintSetting(inlayHintSetting: string, valueNew: any): Promise<void> {
        const valueBeforeChange: any = inlayHintSettings.inspect(inlayHintSetting)!.globalValue;
        if (valueBeforeChange !== valueNew) {
            await inlayHintSettings.update(inlayHintSetting, valueNew, vscode.ConfigurationTarget.Global);
            const valueAfterChange: any = inlayHintSettings.inspect(inlayHintSetting)!.globalValue;
            assert.strictEqual(valueAfterChange, valueNew, `Unable to change setting: ${inlayHintSetting}`);
        }
    }

    function assertHintValues(
        actualHintResults: any,
        resultNumber: number,
        expectedLine: number,
        expectedCharacter: number,
        expectedLabel: string,
        expectedKind: any): void {
        assert.strictEqual(actualHintResults[resultNumber].position.line, expectedLine, `Incorrect line for result ${resultNumber}.`);
        assert.strictEqual(actualHintResults[resultNumber].position.character, expectedCharacter, `Incorrect character for result ${resultNumber}.`);
        assert.strictEqual(actualHintResults[resultNumber].label, expectedLabel, `Incorrect label for result ${resultNumber}.`);
        assert.strictEqual(actualHintResults[resultNumber].kind, expectedKind, `Incorrect kind for result ${resultNumber}.`);
    }
});
