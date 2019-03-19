/*--------------------------------------------------------------------------------------------- 
 *  Copyright (c) Microsoft Corporation. All rights reserved. 
 *  Licensed under the MIT License. See License.txt in the project root for license information. 
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as assert from 'assert';
import { getLanguageConfigFromPatterns } from '../../../src/LanguageServer/languageConfig';
import * as util from '../../../src/common';
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import * as config from '../../../src/LanguageServer/configurations';
import { CppSettings } from '../../../src/LanguageServer/settings';
import { getActiveClient } from '../../../src/LanguageServer/extension';

suite("multiline comment setting tests", function(): void {
    suiteSetup(async function(): Promise<void> { 
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

/******************************************************************************/

function cppPropertiesPath(): string {
    return vscode.workspace.workspaceFolders[0].uri.fsPath + "/.vscode/c_cpp_properties.json";
}

async function changeCppProperties(cppProperties: config.ConfigurationJson, disposables: vscode.Disposable[]): Promise<void> {
    let promise: Promise<void> = new Promise<void>((resolve, reject) => {
        disposables.push(getActiveClient().ActiveConfigChanged(name => {
            if (name === cppProperties.configurations[0].name) {
                resolve();
            }
        }));

        // Can't trust the file watcher, so we need to allocate additional time for the backup watcher to fire.
        setTimeout(() => { reject(new Error("timeout")); }, 4000);
    });
    await util.writeFileText(cppPropertiesPath(), JSON.stringify(cppProperties));
    let contents: string = await util.readFileText(cppPropertiesPath());
    console.log("    wrote c_cpp_properties.json: " + contents);
    return promise;
}

/******************************************************************************/

suite("extensibility tests v2", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let lastResult: api.SourceFileConfigurationItem[];
    let defaultConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}", "/v2/folder" ],
        defines: [ "${workspaceFolder}" ],
        intelliSenseMode: "msvc-x64",
        standard: "c++17"
    };
    let lastBrowseResult: api.WorkspaceBrowseConfiguration;
    let defaultBrowseConfig: api.WorkspaceBrowseConfiguration = {
        browsePath: [ "/v2/folder" ],
        compilerPath: "",
        standard: "c++14",
        windowsSdkVersion: "8.1"
    };

    // Has to be 'any' instead of api.CustomConfigurationProvider because of missing interface members.
    let provider: api.CustomConfigurationProvider = {
        name: "cpptoolsTest-v2",
        extensionId: "ms-vscode.cpptools-test2",
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
        canProvideBrowseConfiguration(): Thenable<boolean> {
            return Promise.resolve(true);
        },
        provideBrowseConfiguration(): Thenable<api.WorkspaceBrowseConfiguration> {
            lastBrowseResult = defaultBrowseConfig;
            return Promise.resolve(defaultBrowseConfig);
        },
        dispose(): void {
            console.log("    disposed");
        }
    };
    let disposables: vscode.Disposable[] = [];

    suiteSetup(async function(): Promise<void> {
        cpptools = await apit.getCppToolsTestApi(api.Version.v2);
        cpptools.registerCustomConfigurationProvider(provider);
        cpptools.notifyReady(provider);
        disposables.push(cpptools);

        await changeCppProperties({
                configurations: [ {name: "test2", configurationProvider: provider.extensionId} ],
                version: 4
            },
            disposables);
    });

    suiteTeardown(function(): void {
        disposables.forEach(d => d.dispose());
    });

    test("Check provider", async () => {
        // Open a c++ file to start the language server.
        let path: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/main2.cpp";
        let uri: vscode.Uri = vscode.Uri.file(path);

        let testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        let testResult: any = new Promise<void>((resolve, reject) => {
            disposables.push(testHook.StatusChanged(status => {
                if (status === apit.Status.IntelliSenseReady) {
                    let expected: api.SourceFileConfigurationItem[] = [ {uri: uri.toString(), configuration: defaultConfig} ];
                    assert.deepEqual(lastResult, expected);
                    assert.deepEqual(lastBrowseResult, defaultBrowseConfig);
                    resolve();
                }
            }));
            setTimeout(() => { reject(new Error("timeout")); }, 2500);
        });
        disposables.push(testHook);

        await vscode.workspace.openTextDocument(path);
        await testResult;
    });
});

/******************************************************************************/

suite("extensibility tests v1", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let lastResult: api.SourceFileConfigurationItem[];
    let defaultConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}" ],
        defines: [ "${workspaceFolder}" ],
        intelliSenseMode: "msvc-x64",
        standard: "c++17"
    };

    // Has to be 'any' instead of api.CustomConfigurationProvider because of missing interface members.
    let provider: any = {
        name: "cpptoolsTest-v1",
        extensionId: "ms-vscode.cpptools-test",
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
            console.log("    disposed");
        }
    };
    let disposables: vscode.Disposable[] = [];

    suiteSetup(async function(): Promise<void> {
        cpptools = await apit.getCppToolsTestApi(api.Version.v1);
        cpptools.registerCustomConfigurationProvider(provider);
        disposables.push(cpptools);

        await changeCppProperties({
                configurations: [ {name: "test1", configurationProvider: provider.extensionId} ],
                version: 4
            },
            disposables);
    });

    suiteTeardown(function(): void {
        disposables.forEach(d => d.dispose());
    });

    test("Check provider", async () => {
        // Open a c++ file to start the language server.
        let path: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/main1.cpp";
        let uri: vscode.Uri = vscode.Uri.file(path);

        let testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        let testResult: any = new Promise<void>((resolve, reject) => {
            disposables.push(testHook.StatusChanged(status => {
                if (status === apit.Status.IntelliSenseReady) {
                    let expected: api.SourceFileConfigurationItem[] = [ {uri: uri.toString(), configuration: defaultConfig} ];
                    assert.deepEqual(lastResult, expected);
                    resolve();
                }
            }));
            setTimeout(() => { reject(new Error("timeout")); }, 2500);
        });
        disposables.push(testHook);

        await vscode.workspace.openTextDocument(path);
        await testResult;
    });
});

/******************************************************************************/

suite("extensibility tests v0", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let lastResult: api.SourceFileConfigurationItem[];
    let defaultConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}" ],
        defines: [ "${workspaceFolder}" ],
        intelliSenseMode: "msvc-x64",
        standard: "c++17"
    };

    // Has to be 'any' instead of api.CustomConfigurationProvider because of missing interface members.
    let provider: any = {
        name: "cpptoolsTest-v0",
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
        }
    };
    let disposables: vscode.Disposable[] = [];

    suiteSetup(async function(): Promise<void> {
        cpptools = await apit.getCppToolsTestApi(api.Version.v0);
        cpptools.registerCustomConfigurationProvider(provider);
        disposables.push(cpptools); // This is a no-op for v0, but do it anyway to make sure nothing breaks.

        await changeCppProperties({
            configurations: [ { name: "test0", configurationProvider: provider.name } ],
            version: 4
        },
        disposables);
    });

    suiteTeardown(async function(): Promise<void> {
        disposables.forEach(d => d.dispose());
        await util.deleteFile(cppPropertiesPath());
    });

    test("Check provider", async () => {
        // Open a C++ file to start the language server.
        let path: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/main.cpp";
        let uri: vscode.Uri = vscode.Uri.file(path);

        let testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        let testResult: any = new Promise<void>((resolve, reject) => {
            disposables.push(testHook.StatusChanged(status => {
                if (status === apit.Status.IntelliSenseReady) {
                    let expected: api.SourceFileConfigurationItem[] = [ {uri: uri.toString(), configuration: defaultConfig} ];
                    assert.deepEqual(lastResult, expected);
                    resolve();
                }
            }));
            setTimeout(() => { reject(new Error("timeout")); }, 2500);
        });
        disposables.push(testHook);

        await vscode.workspace.openTextDocument(path);
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