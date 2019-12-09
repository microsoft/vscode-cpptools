/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import { activateCppExtension } from '../testHelpers';

const defaultTimeout: number = 60000;

suite("[Quick info test]", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let disposables: vscode.Disposable[] = [];
    let filePath: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/quickInfo.cpp";
    let fileUri: vscode.Uri = vscode.Uri.file(filePath);

    suiteSetup(async function(): Promise<void> {
        await activateCppExtension();

        // TODO: create common function to start language server that accepts source file as input
        cpptools = await apit.getCppToolsTestApi(api.Version.latest);

        let testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        let testResult: any = new Promise<void>((resolve, reject) => {
            disposables.push(testHook.StatusChanged(status => {
                if (status === apit.Status.IntelliSenseReady) {
                    resolve();
                }
            }));
            setTimeout(() => { reject(new Error("timeout")); }, defaultTimeout);
        });
        disposables.push(testHook);

        // Start language server
        await vscode.commands.executeCommand("vscode.open", fileUri);
        await testResult;
    });

    suiteTeardown(function(): void {
        disposables.forEach(d => d.dispose());
    });

    test("Hover over function call", async () => {
        let result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(12, 12)));
        let expected1: string =
        `\`\`\`cpp
void myfunction(int var1, std::string var2, std::string var3)
\`\`\``;
        let actual1: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        assert.equal(actual1, expected1);
        let expected2: string = `comment for myfunction`;
        let actual2: string = (<vscode.MarkdownString>result[0].contents[1]).value;
        assert.equal(actual2, expected2);
    });

    test("Hover over function param string variable", async () => {
        let result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(12, 30)));
        let expected: string =
        `\`\`\`cpp
std::string stringVar
\`\`\``;
        let actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;

        assert.equal(actual, expected);
    });

    test("Hover over function param string literal", async () => {
        let result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(12, 44)));
        let expected: string =
        `\`\`\`cpp
std::string::basic_string(const char *_Ptr)
\`\`\`

+17 overloads
`;
        let actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        assert.equal(actual, expected);
    });

    test("Hover over function param with squiggles", async () => {
        let result: vscode.Hover[] = <vscode.Hover[]>(await vscode.commands.executeCommand('vscode.executeHoverProvider', fileUri, new vscode.Position(13, 18)));
        let expected: string = `\`\`\`cpp\nint intVar\n\`\`\``;
        let actual: string = (<vscode.MarkdownString>result[0].contents[0]).value;
        assert.equal(actual, expected);
    });
});
