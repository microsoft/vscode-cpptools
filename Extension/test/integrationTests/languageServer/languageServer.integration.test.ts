/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import * as assert from 'assert';
import { getLanguageConfigFromPatterns } from '../../../src/LanguageServer/languageConfig';
import * as util from '../../../src/common';
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import * as config from '../../../src/LanguageServer/configurations';
import * as testHelpers from '../testHelpers';

suite("multiline comment setting tests", function(): void {
    suiteSetup(async function(): Promise<void> {
        await testHelpers.activateCppExtension();
    });

    const defaultMLRules: vscode.OnEnterRule[] = [
        {   // e.g. /** | */
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            afterText: /^\s*\*\/$/,
            action: { indentAction: vscode.IndentAction.IndentOutdent, appendText: ' * ' }
        },
        {   // e.g. /** ...|
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            action: { indentAction: vscode.IndentAction.None, appendText: ' * ' }
        },
        {   // e.g.  * ...|
            beforeText: /^(\t|[ ])*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
            previousLineText: /(?=^(\s*(\/\*\*|\*)).*)(?=(?!(\s*\*\/)))/,
            action: { indentAction: vscode.IndentAction.None, appendText: '* ' }
        },
        {   // e.g.  */|
            beforeText: /^(\t|[ ])*\*\/\s*$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 1 }
        },
        {   // e.g.  *-----*/|
            beforeText: /^(\t|[ ])*\*[^/]*\*\/\s*$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 1 }
        }
    ];
    const defaultSLRules: vscode.OnEnterRule[] = [
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
        const rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('c', [ "/**" ]).onEnterRules;
        assert.deepStrictEqual(rules, defaultMLRules);
    });

    test("Check for removal of single line comment continuations for C", () => {
        const rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('c', [ "/**", "///" ]).onEnterRules;
        assert.deepStrictEqual(rules, defaultMLRules);
    });

    test("Check the default OnEnterRules for C++", () => {
        const rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('cpp', [ "/**" ]).onEnterRules;
        assert.deepStrictEqual(rules, defaultMLRules);
    });

    test("Make sure duplicate rules are removed", () => {
        const rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('cpp', [ "/**", { begin: "/**", continue: " * " }, "/**" ]).onEnterRules;
        assert.deepStrictEqual(rules, defaultMLRules);
    });

    test("Check single line rules for C++", () => {
        const rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('cpp', [ "///" ]).onEnterRules;
        assert.deepStrictEqual(rules, defaultSLRules);
    });

});

/* **************************************************************************** */

function cppPropertiesPath(): string {
    return vscode.workspace.workspaceFolders[0].uri.fsPath + "/.vscode/c_cpp_properties.json";
}

async function changeCppProperties(cppProperties: config.ConfigurationJson, disposables: vscode.Disposable[]): Promise<void> {
    await util.writeFileText(cppPropertiesPath(), JSON.stringify(cppProperties));
    const contents: string = await util.readFileText(cppPropertiesPath());
    console.log("    wrote c_cpp_properties.json: " + contents);

    // Sleep for 4000ms for file watcher
    return new Promise(r => setTimeout(r, 4000));
}

/* **************************************************************************** */

suite("extensibility tests v3", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let lastResult: api.SourceFileConfigurationItem[];
    const defaultConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}", "/v3/folder" ],
        defines: [ "${workspaceFolder}" ],
        intelliSenseMode: "msvc-x64",
        standard: "c++17"
    };
    let lastBrowseResult: api.WorkspaceBrowseConfiguration;
    const defaultBrowseConfig: api.WorkspaceBrowseConfiguration = {
        browsePath: [ "/v3/folder" ],
        compilerPath: "",
        standard: "c++14",
        windowsSdkVersion: "8.1"
    };
    const defaultFolderBrowseConfig: api.WorkspaceBrowseConfiguration = {
        browsePath: [ "/v3/folder-1" ],
        compilerPath: "",
        standard: "c++14",
        windowsSdkVersion: "8.1"
    };

    const provider: api.CustomConfigurationProvider = {
        name: "cpptoolsTest-v3",
        extensionId: "ms-vscode.cpptools-test3",
        canProvideConfiguration(document: vscode.Uri): Thenable<boolean> {
            return Promise.resolve(true);
        },
        provideConfigurations(uris: vscode.Uri[]): Thenable<api.SourceFileConfigurationItem[]> {
            const result: api.SourceFileConfigurationItem[] = [];
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
        canProvideBrowseConfigurationsPerFolder(): Thenable<boolean> {
            return Promise.resolve(true);
        },
        provideFolderBrowseConfiguration(uri: vscode.Uri): Thenable<api.WorkspaceBrowseConfiguration> {
            lastBrowseResult = defaultFolderBrowseConfig;
            return Promise.resolve(defaultFolderBrowseConfig);
        },
        dispose(): void {
            console.log("    disposed");
        }
    };
    const disposables: vscode.Disposable[] = [];

    suiteSetup(async function(): Promise<void> {
        cpptools = await apit.getCppToolsTestApi(api.Version.v3);
        cpptools.registerCustomConfigurationProvider(provider);
        cpptools.notifyReady(provider);
        disposables.push(cpptools);

        await changeCppProperties({
            configurations: [ {name: "test3", configurationProvider: provider.extensionId} ],
            version: 4
        },
        disposables);
    });

    suiteTeardown(function(): void {
        disposables.forEach(d => d.dispose());
    });

    test("Check provider - main3.cpp", async () => {
        // Open a c++ file to start the language server.
        const path: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/main3.cpp";
        const uri: vscode.Uri = vscode.Uri.file(path);

        const testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        const testResult: any = new Promise<void>((resolve, reject) => {
            disposables.push(testHook.IntelliSenseStatusChanged(result => {
                result = result as apit.IntelliSenseStatus;
                if (result.filename === "main3.cpp" && result.status === apit.Status.IntelliSenseReady) {
                    const expected: api.SourceFileConfigurationItem[] = [ {uri: uri.toString(), configuration: defaultConfig} ];
                    assert.deepEqual(lastResult, expected);
                    assert.deepEqual(lastBrowseResult, defaultFolderBrowseConfig);
                    resolve();
                }
            }));
            setTimeout(() => { reject(new Error("timeout")); }, testHelpers.defaultTimeout);
        });
        disposables.push(testHook);

        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(path);
        await vscode.window.showTextDocument(document);
        await testResult;
    });
});

/* **************************************************************************** */

suite("extensibility tests v2", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let lastResult: api.SourceFileConfigurationItem[];
    const defaultConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}", "/v2/folder" ],
        defines: [ "${workspaceFolder}" ],
        intelliSenseMode: "msvc-x64",
        standard: "c++17"
    };
    let lastBrowseResult: api.WorkspaceBrowseConfiguration;
    const defaultBrowseConfig: api.WorkspaceBrowseConfiguration = {
        browsePath: [ "/v2/folder" ],
        compilerPath: "",
        standard: "c++14",
        windowsSdkVersion: "8.1"
    };

    // Has to be 'any' instead of api.CustomConfigurationProvider because of missing interface members.
    const provider: any = {
        name: "cpptoolsTest-v2",
        extensionId: "ms-vscode.cpptools-test2",
        canProvideConfiguration(document: vscode.Uri): Thenable<boolean> {
            return Promise.resolve(true);
        },
        provideConfigurations(uris: vscode.Uri[]): Thenable<api.SourceFileConfigurationItem[]> {
            const result: api.SourceFileConfigurationItem[] = [];
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
    const disposables: vscode.Disposable[] = [];

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

    test("Check provider - main2.cpp", async () => {
        // Open a c++ file to start the language server.
        const path: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/main2.cpp";
        const uri: vscode.Uri = vscode.Uri.file(path);

        const testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        const testResult: any = new Promise<void>((resolve, reject) => {
            disposables.push(testHook.IntelliSenseStatusChanged(result => {
                result = result as apit.IntelliSenseStatus;
                if (result.filename === "main2.cpp" && result.status === apit.Status.IntelliSenseReady) {

                    const expected: api.SourceFileConfigurationItem[] = [ {uri: uri.toString(), configuration: defaultConfig} ];
                    assert.deepEqual(lastResult, expected);
                    assert.deepEqual(lastBrowseResult, defaultBrowseConfig);
                    resolve();
                }
            }));
            setTimeout(() => { reject(new Error("timeout")); }, testHelpers.defaultTimeout);
        });
        disposables.push(testHook);

        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(path);
        await vscode.window.showTextDocument(document);
        await testResult;
    });
});

/* **************************************************************************** */

suite("extensibility tests v1", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let lastResult: api.SourceFileConfigurationItem[];
    const defaultConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}" ],
        defines: [ "${workspaceFolder}" ],
        intelliSenseMode: "msvc-x64",
        standard: "c++17"
    };

    // Has to be 'any' instead of api.CustomConfigurationProvider because of missing interface members.
    const provider: any = {
        name: "cpptoolsTest-v1",
        extensionId: "ms-vscode.cpptools-test",
        canProvideConfiguration(document: vscode.Uri): Thenable<boolean> {
            return Promise.resolve(true);
        },
        provideConfigurations(uris: vscode.Uri[]): Thenable<api.SourceFileConfigurationItem[]> {
            const result: api.SourceFileConfigurationItem[] = [];
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
    const disposables: vscode.Disposable[] = [];

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

    test("Check provider - main1.cpp", async () => {
        // Open a c++ file to start the language server.
        const path: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/main1.cpp";
        const uri: vscode.Uri = vscode.Uri.file(path);

        const testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        const testResult: any = new Promise<void>((resolve, reject) => {
            disposables.push(testHook.IntelliSenseStatusChanged(result => {
                result = result as apit.IntelliSenseStatus;
                if (result.filename === "main1.cpp" && result.status === apit.Status.IntelliSenseReady) {
                    const expected: api.SourceFileConfigurationItem[] = [ {uri: uri.toString(), configuration: defaultConfig} ];
                    assert.deepEqual(lastResult, expected);
                    resolve();
                }
            }));
            setTimeout(() => { reject(new Error("timeout")); }, testHelpers.defaultTimeout);
        });
        disposables.push(testHook);

        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(path);
        await vscode.window.showTextDocument(document);
        await testResult;
    });
});

/* **************************************************************************** */

suite("extensibility tests v0", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let lastResult: api.SourceFileConfigurationItem[];
    const defaultConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}" ],
        defines: [ "${workspaceFolder}" ],
        intelliSenseMode: "msvc-x64",
        standard: "c++17"
    };

    // Has to be 'any' instead of api.CustomConfigurationProvider because of missing interface members.
    const provider: any = {
        name: "cpptoolsTest-v0",
        canProvideConfiguration(document: vscode.Uri): Thenable<boolean> {
            return Promise.resolve(true);
        },
        provideConfigurations(uris: vscode.Uri[]): Thenable<api.SourceFileConfigurationItem[]> {
            const result: api.SourceFileConfigurationItem[] = [];
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
    const disposables: vscode.Disposable[] = [];

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

    test("Check provider - main.cpp", async () => {
        // Open a C++ file to start the language server.
        const path: string = vscode.workspace.workspaceFolders[0].uri.fsPath + "/main.cpp";
        const uri: vscode.Uri = vscode.Uri.file(path);

        const testHook: apit.CppToolsTestHook = cpptools.getTestHook();
        const testResult: any = new Promise<void>((resolve, reject) => {
            disposables.push(testHook.IntelliSenseStatusChanged(result => {
                result = result as apit.IntelliSenseStatus;
                if (result.filename === "main.cpp" && result.status === apit.Status.IntelliSenseReady) {
                    const expected: api.SourceFileConfigurationItem[] = [ {uri: uri.toString(), configuration: defaultConfig} ];
                    assert.deepEqual(lastResult, expected);
                    resolve();
                }
            }));
            setTimeout(() => { reject(new Error("timeout")); }, testHelpers.defaultTimeout);
        });
        disposables.push(testHook);

        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(path);
        await vscode.window.showTextDocument(document);
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
        await vscode.window.showTextDocument(document);
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
