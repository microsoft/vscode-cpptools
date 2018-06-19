/*--------------------------------------------------------------------------------------------- 
 *  Copyright (c) Microsoft Corporation. All rights reserved. 
 *  Licensed under the MIT License. See License.txt in the project root for license information. 
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as assert from 'assert';
import { getLanguageConfigFromPatterns } from '../../src/LanguageServer/languageConfig';
import * as api from '../../src/api';
import * as apit from '../../src/testApi';
import * as config from '../../src/LanguageServer/configurations';
import { CppSettings } from '../../src/LanguageServer/settings';

suite("multiline comment setting tests", function() {
    suiteSetup(async function() { 
        let extension: vscode.Extension<any> = vscode.extensions.getExtension("ms-vscode.cpptools"); 
        if (!extension.isActive) { 
            await extension.activate(); 
        }
    });

    let defaultRules: vscode.OnEnterRule[] = [
        {
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            afterText: /^\s*\*\/$/,
            action: { indentAction: vscode.IndentAction.IndentOutdent, appendText: ' * ' }
        },
        {
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            action: { indentAction: vscode.IndentAction.None, appendText: ' * ' }
        },
        {
            beforeText: /^\s*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
            action: { indentAction: vscode.IndentAction.None, appendText: '* ' }
        },
        {
            beforeText: /^\s*\*\/\s*$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 1 }
        },
        {
            beforeText: /^\s*\*[^/]*\*\/\s*$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 1 }
        }
    ];
    let defaultSLRules: vscode.OnEnterRule[] = [
        {
            beforeText: /^\s*\/\/\/.+$/,
            action: { indentAction: vscode.IndentAction.None, appendText: '///' }
        },
        {
            beforeText: /^\s*\/\/\/$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 0 }
        }
    ];

    test("Check the default OnEnterRules for C", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('c', [ "/**" ]).onEnterRules;
        assert.deepEqual(rules, defaultRules);
    });

    test("Check for removal of single line comment continuations for C", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('c', [ "/**", "///" ]).onEnterRules;
        assert.deepEqual(rules, defaultRules);
    });

    test("Check the default OnEnterRules for C++", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('cpp', [ "/**" ]).onEnterRules;
        assert.deepEqual(rules, defaultRules);
    });

    test("Make sure duplicate rules are removed", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('cpp', [ "/**", { begin: "/**", continue: " * " }, "/**" ]).onEnterRules;
        assert.deepEqual(rules, defaultRules);
    });

    test("Check single line rules for C++", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('cpp', [ "///" ]).onEnterRules;
        assert.deepEqual(rules, defaultSLRules);
    });

});

suite("extensibility tests", function() {
    let cpptools: apit.CppToolsTestApi;
    let lastResult: api.SourceFileConfigurationItem[];
    let defaultConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}" ],
        defines: [ "${workspaceFolder}" ],
        intelliSenseMode: "msvc-x64",
        standard: "c++17"
    };
    let provider: api.CustomConfigurationProvider = {
        name: "Test Provider",
        extensionId: "ms-vscode.cpptools",
        canProvideConfiguration(document: vscode.Uri): Thenable<boolean> {
            return Promise.resolve(true);
        },
        provideConfigurations(uris: vscode.Uri[]): Thenable<api.SourceFileConfigurationItem[]> {
            let result: api.SourceFileConfigurationItem[] = [];
            uris.forEach(uri => {
                result.push({
                    uri: uri.toString(),
                    configuration: defaultConfig
                });
            });
            lastResult = result;
            return Promise.resolve(result);
        },
        dispose(): void {
            console.log("disposed");
        }
    };

    suiteSetup(async function(): Promise<void> {
        let extension: vscode.Extension<apit.CppToolsTestApi> = vscode.extensions.getExtension("ms-vscode.cpptools");
        if (!extension.isActive) { 
            await extension.activate().then(cpptoolsApi => cpptools = cpptoolsApi);
        } else {
            cpptools = extension.exports;
        }
        cpptools.registerCustomConfigurationProvider(provider);
    });

    suiteTeardown(function(): void {
        if (cpptools) {
            cpptools.dispose();
        }
    });

    test("Check provider", async () => {
        // Open a c++ file to start the language server.
        console.log("check provider test");
        let testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        let testResult: any = new Promise<void>((resolve, reject) => {
            testHook.StatusChanged(status => {
                console.log("Status change: " + status.toString());
                if (status === apit.Status.IntelliSenseReady) {
                    let expected: api.SourceFileConfigurationItem[] = [ {uri: uri.toString(), configuration: defaultConfig} ];
                    assert.deepEqual(lastResult, expected);
                    resolve();
                }
            });
            setTimeout(() => { reject("timeout"); }, 5000);
        });
        let path: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/main.cpp";
        let uri: vscode.Uri = vscode.Uri.file(path);
        let document: vscode.TextDocument = await vscode.workspace.openTextDocument(path);
        await testResult;
    });
});

/*
suite("configuration tests", function() {
    suiteSetup(async function() { 
        let extension: vscode.Extension<any> = vscode.extensions.getExtension("ms-vscode.cpptools"); 
        if (!extension.isActive) { 
            await extension.activate(); 
        }
        // Open a c++ file to start the language server.
        await vscode.workspace.openTextDocument({ language: "cpp", content: "int main() { return 0; }"});
    });

    suiteTeardown(async function() {
        // Delete c_cpp_properties.json
    });

    

    test("Check default configuration", () => {
        let rootUri: vscode.Uri;
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            rootUri = vscode.workspace.workspaceFolders[0].uri;
        }
        assert.notEqual(rootUri, undefined, "Root Uri is not defined");
        if (rootUri) {
            let cppProperties: config.CppProperties = new config.CppProperties(rootUri);
            let configurations: config.Configuration[] = cppProperties.Configurations;
            let defaultConfig: config.Configuration = config.getDefaultConfig();
            assert.deepEqual(configurations[0], defaultConfig);
            console.log(JSON.stringify(configurations, null, 2));

            // Need to set the CompilerDefaults before the CppProperties can be successfully modified.
            cppProperties.CompilerDefaults = {
                compilerPath: "/path/to/compiler",
                cStandard: "c99",
                cppStandard: "c++14",
                frameworks: ["/path/to/framework"],
                includes: ["/path/to/includes"]
            };

            configurations[0].cppStandard = "${default}";

            let s: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp.default", rootUri);
            let d: any = s.inspect("cppStandard");
            s.update("cppStandard", "c++11", vscode.ConfigurationTarget.WorkspaceFolder);
            d = s.inspect("cppStandard");

            cppProperties.onDidChangeSettings();
        }
    });
});
*/