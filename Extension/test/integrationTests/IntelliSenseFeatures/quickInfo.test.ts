/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as os from 'os';
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import * as testHelpers from '../testHelpers';

suite("[Quick info test]", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let disposables: vscode.Disposable[] = [];
    let filePath: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/quickInfo.cpp";
    let fileUri: vscode.Uri = vscode.Uri.file(filePath);
    let platform: string = "";

    suiteSetup(async function(): Promise<void> {
        await testHelpers.activateCppExtension();

        cpptools = await apit.getCppToolsTestApi(api.Version.latest);
        platform = os.platform();
        let testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        disposables.push(testHook);

        let getIntelliSenseStatus: any = new Promise<void>((resolve, reject) => {
            disposables.push(testHook.IntelliSenseStatusChanged(result => {
                result = result as apit.IntelliSenseStatus;
                if (result.filename === "quickInfo.cpp" && result.status === apit.Status.IntelliSenseReady) {
                    resolve();
                }
            }));
            setTimeout(() => { reject(new Error("Timeout: IntelliSenseStatusChanged event")); }, testHelpers.defaultTimeout);
        });

        // Start language server
        console.log("Open file: " + fileUri.toString());
        await vscode.commands.executeCommand("vscode.open", fileUri);
        await getIntelliSenseStatus;
    });

    suiteTeardown(function(): void {
        disposables.forEach(d => d.dispose());
    });

    test("[Hover over function call]", async () => {
        let result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(12, 12)));
        let expected1: string = "";
        switch (platform) {
            case "win32":
                expected1 = `\`\`\`cpp\nvoid myfunction(int var1, std::string var2, std::string var3)\n\`\`\``;
                break;
            case "linux":
                expected1 = `\`\`\`cpp\nvoid myfunction(int var1, std::__cxx11::string var2, std::__cxx11::string var3)\n\`\`\``;
                break;
            case "darwin":
                expected1 = `\`\`\`cpp\nvoid myfunction(int var1, std::__1::string var2, std::__1::string var3)\n\`\`\``;
                break;
        }
        let actual1: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        assert.equal(actual1, expected1);
        let expected2: string = `comment for myfunction`;
        let actual2: string = (<vscode.MarkdownString>result[0].contents[1]).value;
        assert.equal(actual2, expected2);
    });

    test("[Hover over function param string variable]", async () => {
        let result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(12, 30)));
        let expected: string = "";
        switch (platform) {
            case "win32":
                expected = `\`\`\`cpp\nstd::string stringVar\n\`\`\``;
                break;
            case "linux":
                expected = `\`\`\`cpp\nstd::__cxx11::string stringVar\n\`\`\``;
                break;
            case "darwin":
                expected = `\`\`\`cpp\nstd::__1::string stringVar\n\`\`\``;
                break;
        }
        let actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        assert.equal(actual, expected);
    });

    test("[Hover over function param string literal]", async () => {
        let result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(12, 44)));
        let expected: string = "";
        switch (platform) {
            case "win32":
                expected = `\`\`\`cpp\nstd::string::basic_string(const char *_Ptr)\n\`\`\`\n\n+17 overloads\n`;
                break;
            case "linux":
                expected = `\`\`\`cpp\nstd::__cxx11::string::basic_string(const char *__s, const std::allocator<...> &__a = std::allocator<...>())\n\`\`\`\n\n+16 overloads\n`;
                break;
            case "darwin":
                expected = `\`\`\`cpp\nstd::__1::string::basic_string<std::nullptr_t>(const char *__s)\n\`\`\`\n\n+21 overloads\n`;
                break;
        }
        let actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        assert.equal(actual, expected);
    });

    test("[Hover over function param with squiggles]", async () => {
        let result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(13, 18)));
        let expected: string = `\`\`\`cpp\nint intVar\n\`\`\``;
        let actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        assert.equal(actual, expected);
    });
});
