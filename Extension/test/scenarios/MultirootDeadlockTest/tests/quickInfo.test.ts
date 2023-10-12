/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as assert from 'assert';
import * as os from 'os';
import * as vscode from 'vscode';
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import { timeout } from '../../../../src/Utility/Async/timeout';
import * as testHelpers from '../../../common/testHelpers';

suite("[Quick info test]", function(): void {
    let cpptools: apit.CppToolsTestApi;
    const disposables: vscode.Disposable[] = [];
    const filePath: string = `${vscode.workspace.workspaceFolders?.[1]?.uri.fsPath}/quickInfo.cpp`;
    const fileUri: vscode.Uri = vscode.Uri.file(filePath);
    let platform: string = "";

    suiteSetup(async function(): Promise<void> {
        await testHelpers.activateCppExtension();

        cpptools = await apit.getCppToolsTestApi(api.Version.latest) ?? assert.fail('Could not get CppToolsTestApi');
        platform = os.platform();
        const testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        disposables.push(testHook);

        /*
        PROBLEM: waiting for the intellisense ready for the file changes the output of the Doxygen comment test

        it changes from <T> to <int> and the test fails
        */
        const getIntelliSenseStatus = new Promise<void>((resolve) => {
            disposables.push(testHook.IntelliSenseStatusChanged(result => {
                result = result as apit.IntelliSenseStatus;
                if (result.filename === "quickInfo.cpp" && result.status === apit.Status.IntelliSenseReady) {
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
        await vscode.commands.executeCommand("vscode.open", fileUri);
        await timeout(20000, getIntelliSenseStatus);

    });

    suiteTeardown(function(): void {
        disposables.forEach(d => d.dispose());
    });

    test("[Hover over function call - normal comment]", async () => {
        const result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(35, 23)));
        const expected_full_comment: string = `\`\`\`cpp\nbool isEven(int value)\n\`\`\`  \nVerifies if input is even number or not`;
        const expectedMap: Map<string, string> = new Map<string, string>();
        expectedMap.set("win32", expected_full_comment);
        expectedMap.set("linux", expected_full_comment);
        expectedMap.set("darwin", expected_full_comment);

        const actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        const expected: string = expectedMap.get(platform) ?? assert.fail("Platform not found");
        assert.strictEqual(actual, expected);
    });

    /** TODO: Investigate why this changes from <T> to int inconsistently */
    test.skip("[Hover over function call - Doxygen comment]", async () => {
        const result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(36, 9)));

        const expected_full_comment: string = `\`\`\`cpp\nT testDoxygen<T>(T base, T height)\n\`\`\`  \nCalculates area of rectangle  \n  \n**Template Parameters:**  \n\`T\` – is template param  \n  \n**Parameters:**  \n\`base\` – is horizontal length  \n\`height\` – is vertical length  \n  \n**Returns:**  \nArea of rectangle  \n  \n**Exceptions:**  \nThis is an exception comment`;
        const expectedMap: Map<string, string> = new Map<string, string>();
        expectedMap.set("win32", `\`\`\`cpp\nT testDoxygen<T>(T base, T height)\n\`\`\``); // Running test locally returns full comment, but running test on Azure pipeline does not.
        expectedMap.set("linux", expected_full_comment);
        expectedMap.set("darwin", expected_full_comment);

        const actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        const expected: string = expectedMap.get(platform) ?? assert.fail("Platform not found");
        assert.ok(actual === expected_full_comment || actual === expected, `Should match the comment string\n\nACTUAL:===========\n${actual}\n===========\nexpected:===========\n${expected_full_comment}\n===========`);
    });

    test("[Hover over function param string variable]", async () => {
        const result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(33, 30)));

        const expectedMap: Map<string, string> = new Map<string, string>();
        expectedMap.set("win32", `\`\`\`cpp\nstd::string stringVar\n\`\`\``);
        expectedMap.set("linux", `\`\`\`cpp\nstd::string stringVar\n\`\`\``);
        expectedMap.set("darwin", `\`\`\`cpp\nstd::__1::string stringVar\n\`\`\``);

        const expected: string = expectedMap.get(platform) ?? assert.fail("Platform not found");
        const actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        assert.strictEqual(actual, expected);
    });

    test("[Hover over function param int]", async () => {
        const result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(33, 18)));
        const expected: string = `\`\`\`cpp\nint intVar\n\`\`\``;
        const actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        assert.strictEqual(actual, expected);
    });
});
