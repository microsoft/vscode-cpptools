/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as assert from 'assert';
import { suite } from 'mocha';
import * as vscode from 'vscode';
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import { timeout } from '../../../../src/Utility/Async/timeout';
import * as testHelpers from '../../../common/testHelpers';

suite(`[Reference test]`, function(): void {
    let cpptools: apit.CppToolsTestApi;
    const disposables: vscode.Disposable[] = [];
    const wf = vscode.workspace.workspaceFolders?.[1] ?? assert.fail("Could not get workspace folder");
    const path: string = wf.uri.fsPath + "/references.cpp";
    const fileUri: vscode.Uri = vscode.Uri.file(path);
    let testHook: apit.CppToolsTestHook;
    let document: vscode.TextDocument;

    suiteSetup(async function(): Promise<void> {
        await testHelpers.activateCppExtension();

        cpptools = await apit.getCppToolsTestApi(api.Version.latest) ?? assert.fail('Could not get CppToolsTestApi');
        testHook = cpptools.getTestHook();
        disposables.push(testHook);

        const getIntelliSenseStatus = new Promise<void>((resolve) => {
            disposables.push(testHook.IntelliSenseStatusChanged(result => {
                result = result as apit.IntelliSenseStatus;
                if (result.filename === "references.cpp" && result.status === apit.Status.IntelliSenseReady) {
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
        document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);
        await timeout(20000, getIntelliSenseStatus);
    });

    test("[Find confirmed references of a symbol]", async () => {
        // Get reference of function declaration "int func1()"
        const declarationResult: vscode.Location[] = <vscode.Location[]>(await vscode.commands.executeCommand("vscode.executeReferenceProvider", fileUri, new vscode.Position(17, 7)));
        const functionCallResult: vscode.Location[] = <vscode.Location[]>(await vscode.commands.executeCommand("vscode.executeReferenceProvider", fileUri, new vscode.Position(24, 21)));

        const expectedText: string = "func1";
        assertTextInLocation(document, expectedText, declarationResult);
        assertTextInLocation(document, expectedText, functionCallResult);
        assert.deepEqual(declarationResult, functionCallResult);
    });

    test("[Find references of local param]", async () => {
        // Get reference of local param: var1 in "int func1(float var1)"
        const result: vscode.Location[] = <vscode.Location[]>(await vscode.commands.executeCommand("vscode.executeReferenceProvider", fileUri, new vscode.Position(21, 18)));

        const expectedText: string = "var1";
        assertTextInLocation(document, expectedText, result);
        assert.equal(result.length, 2);
    });

    // TODO: Investigate why doing an edit affects execution of find all references on test pipeline.
    // test("[Add new call to a function and find reference]", async () => {
    //     // Get reference of "int func1()"declaration
    //     let beforeEditResult: vscode.Location[] = <vscode.Location[]>(await vscode.commands.executeCommand("vscode.executeReferenceProvider", fileUri, new vscode.Position(17, 7)));
    //     let expectedText: string = "func1";
    //     assert.equal(beforeEditResult.length, 3);
    //     assertTextInLocation(document, expectedText, beforeEditResult);

    //     // Add another reference to "func1()"
    //     let workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
    //     workspaceEdit.insert(fileUri, new vscode.Position(34, 5), "int y = func1();");
    //     await vscode.workspace.applyEdit(workspaceEdit);
    //     await getIntelliSenseStatus;

    //     let afterEditResult: vscode.Location[] = <vscode.Location[]>(await vscode.commands.executeCommand("vscode.executeReferenceProvider", fileUri, new vscode.Position(17, 7)));
    //     assert.equal(afterEditResult.length, 4);

    //     assertTextInLocation(document, expectedText, afterEditResult);
    // });
});

function assertTextInLocation(document: vscode.TextDocument, expectedText: string, Locations: vscode.Location[], displayLog: boolean = false): void {
    if (displayLog) {
        console.log("expected reference text: " + expectedText);
    }
    Locations.forEach(location => {
        const actualtext: string = document.getText(location.range);
        if (displayLog) {
            console.log("actual reference text: " + actualtext);
        }
        assert.equal(expectedText, actualtext);
    });
}
