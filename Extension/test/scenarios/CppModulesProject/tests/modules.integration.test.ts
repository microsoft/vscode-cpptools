/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../../../vscode.d.ts" />

// Groundwork for IntelliSense support of C++20 modules importing
// (https://github.com/microsoft/vscode-cpptools/issues/6302).
//
// These tests cover the extension-side behavior that module based projects
// rely on today:
//  * module interface files (.cppm/.ixx) are recognized as C++ sources,
//  * a compile_commands.json that contains GCC module related flags does not
//    prevent the language server from providing IntelliSense for the project,
//    and its entries are actually applied to the translation units (verified
//    through a sentinel define and a hover assertion, not just readiness),
//  * module related compiler arguments (both GCC and MSVC spellings) are
//    accepted and delivered through the custom configuration provider path,
//    verified the same way.
//
// No statement is made about the semantic understanding of module imports by
// the language server itself: that support is still in development and is
// tracked by the issue referenced above. When it ships, these tests are the
// place to add end-to-end module IntelliSense assertions.

import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import * as api from 'vscode-cpptools';
import * as apit from 'vscode-cpptools/out/testApi';
import * as config from '../../../../src/LanguageServer/configurations';
import * as util from '../../../../src/common';
import * as testHelpers from '../../../common/testHelpers';

/* **************************************************************************** */

function workspacePath(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'workspace folder should be set.');

    return folder.uri.fsPath;
}

function toPosixPath(path: string): string {
    return path.replace(/\\/g, '/');
}

// The (empty) fake gcc binaries are checked in with the scenario assets,
// following the SimpleCppProject pattern, so that the language server does not
// probe a real compiler and the tests stay deterministic across machines.
function fakeGccPath(): string {
    return toPosixPath(`${workspacePath()}/bin/${process.platform === 'win32' ? 'gcc.exe' : 'gcc'}`);
}

// The directories of these files are created on demand by util.writeFileText,
// but only when the path uses native separators, hence path.join here. The
// contents written to the JSON files use posix paths (see toPosixPath).
function compileCommandsPath(): string {
    return path.join(workspacePath(), 'build', 'compile_commands.json');
}

function cppPropertiesPath(): string {
    return path.join(workspacePath(), '.vscode', 'c_cpp_properties.json');
}

async function changeCppProperties(cppProperties: config.ConfigurationJson, _disposables: vscode.Disposable[]): Promise<void> {
    await util.writeFileText(cppPropertiesPath(), JSON.stringify(cppProperties));
    const contents: string = await util.readFileText(cppPropertiesPath());
    console.log("    wrote c_cpp_properties.json: " + contents);

    // Sleep for 4000ms for file watcher
    return new Promise(r => setTimeout(r, 4000));
}

async function openAndAwaitIntelliSenseReady(cpptools: apit.CppToolsTestApi, disposables: vscode.Disposable[], filename: string): Promise<vscode.TextDocument> {
    const filePath: string = workspacePath() + "/" + filename;

    const testHook: apit.CppToolsTestHook = cpptools.getTestHook();
    const testResult: Promise<void> = new Promise<void>((resolve, reject) => {
        disposables.push(testHook.IntelliSenseStatusChanged(result => {
            result = result as apit.IntelliSenseStatus;
            if (result.filename === filename && result.status === apit.Status.IntelliSenseReady) {
                resolve();
            }
        }));
        setTimeout(() => { reject(new Error(`timeout waiting for IntelliSenseReady: ${filename}`)); }, testHelpers.defaultTimeout);
    });

    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await testResult;
    return document;
}

// Verifies, through IntelliSense, that a sentinel define reached the language
// server for the given document: hovering over a use of a symbol that is only
// declared under "#ifdef <sentinel>" resolves if and only if the define was
// applied to the translation unit. This observes the *effect* of the delivered
// configuration instead of merely re-checking what a provider returned.
async function assertSentinelDefineApplied(document: vscode.TextDocument, useStatement: string, symbol: string): Promise<void> {
    const text: string = document.getText();
    const useIndex: number = text.indexOf(useStatement);
    assert.ok(useIndex >= 0, `use statement not found in document: ${useStatement}`);
    const symbolOffsetInUse: number = useStatement.indexOf(symbol);
    assert.ok(symbolOffsetInUse >= 0, `symbol not found in use statement: ${symbol}`);

    // +1 to hover from inside the token.
    const position: vscode.Position = document.positionAt(useIndex + symbolOffsetInUse + 1);

    // The hover can lag slightly behind IntelliSenseReady; retry for a while.
    const deadline: number = Date.now() + testHelpers.defaultTimeout;
    while (Date.now() < deadline) {
        const hovers: vscode.Hover[] = <vscode.Hover[]> await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, position);
        if (hovers.length > 0) {
            return;
        }
        await testHelpers.delay(500);
    }
    assert.fail(`hover did not resolve '${symbol}' -- the sentinel define was not applied to ${document.uri.fsPath}`);
}

/* **************************************************************************** */

interface CompileCommandEntry {
    directory: string;
    arguments: string[];
    file: string;
}

// GCC spellings of the C++20 module related compiler flags, as emitted by
// CMake's C++ module support for GCC targets.
function gccModuleArgs(cmiDir: string): string[] {
    return [
        "-std=c++20",
        "-fmodules-ts",
        `-fprebuilt-module-path=${cmiDir}`,
        `-fmodule-file=math=${cmiDir}/math.gcm`
    ];
}

function compileCommandEntry(file: string, extraArgs: string[] = []): CompileCommandEntry {
    const root: string = toPosixPath(workspacePath());
    const objectFile: string = `${root}/build/${file.replace(/\.[^.]+$/, "")}.o`;
    return {
        directory: root,
        arguments: [fakeGccPath(), ...gccModuleArgs(`${root}/build/cmi`), ...extraArgs, "-c", "-o", objectFile, file],
        file: file
    };
}

async function writeCompileCommands(entries: CompileCommandEntry[]): Promise<void> {
    await util.writeFileText(compileCommandsPath(), JSON.stringify(entries, null, 2));
    console.log("    wrote build/compile_commands.json for: " + entries.map(entry => entry.file).join(", "));
}

/* **************************************************************************** */

// MSVC spellings of the C++20 module related compiler arguments, as used by
// the (currently MSVC-only) modules IntelliSense workaround.
function msvcModuleArgs(): string[] {
    const ifcDir: string = `${toPosixPath(workspacePath())}/build/ifc`;
    return [
        "/ifcSearchDir",
        ifcDir,
        "/reference",
        `math=${ifcDir}/math.ifc`,
        "/headerUnit",
        `std=${ifcDir}/std.ifc`,
        "/stdIfcDir",
        ifcDir
    ];
}

/* **************************************************************************** */

suite("C++20 modules file type tests", function(): void {
    suiteSetup(async function(): Promise<void> {
        await testHelpers.activateCppExtension();
    });

    test("Module interface files are opened as C++ (.cppm)", async () => {
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(workspacePath() + "/math.cppm");
        await vscode.window.showTextDocument(document);
        assert.strictEqual(document.languageId, 'cpp');
    });

    test("Module interface files are opened as C++ (.ixx)", async () => {
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(workspacePath() + "/math.ixx");
        await vscode.window.showTextDocument(document);
        assert.strictEqual(document.languageId, 'cpp');
    });
});

/* **************************************************************************** */

suite("compile_commands.json with GCC C++20 module flags", function(): void {
    let cpptools: apit.CppToolsTestApi;
    const disposables: vscode.Disposable[] = [];

    suiteSetup(async function(): Promise<void> {
        cpptools = await apit.getCppToolsTestApi(api.Version.v2) ?? assert.fail('Could not get CppToolsTestApi');
        disposables.push(cpptools);

        await writeCompileCommands([
            // The sentinel define carried by main.cpp's entry lets the test
            // verify through IntelliSense (hover) that the database entry was
            // applied, rather than IntelliSense falling back to a default
            // configuration.
            compileCommandEntry("main.cpp", ["-DCPPMODULES_COMPILE_COMMANDS_SENTINEL=1"]),
            compileCommandEntry("math.cppm"),
            compileCommandEntry("math.ixx")
        ]);

        await changeCppProperties({
            configurations: [
                {
                    name: "GCC C++20 modules",
                    compileCommands: [compileCommandsPath()],
                    intelliSenseMode: "gcc-x64",
                    cppStandard: "c++20"
                }
            ],
            version: 4
        },
        disposables);
    });

    suiteTeardown(function(): void {
        disposables.forEach(d => d.dispose());
    });

    test("IntelliSense is provided for the module importer (main.cpp)", async () => {
        const document: vscode.TextDocument = await openAndAwaitIntelliSenseReady(cpptools, disposables, "main.cpp");

        // Verify that the compile_commands.json entry for this file -- the one
        // carrying the module related flags -- was actually applied to the
        // translation unit (and not a fallback configuration).
        await assertSentinelDefineApplied(document, "return compile_database_sentinel_value;", "compile_database_sentinel_value");
    });
});

/* **************************************************************************** */

suite("custom configuration provider with module compiler args", function(): void {
    let cpptools: apit.CppToolsTestApi;
    let lastResult: api.SourceFileConfigurationItem[];
    let configurationProvidedBeforeCanProvide: boolean = false;
    const supportedUris: Set<string> = new Set();
    const disposables: vscode.Disposable[] = [];

    // gcc-style module args for main2.cpp, MSVC-style module args for main3.cpp.
    // Each config also carries a sentinel define -- through the provider API's
    // `defines` channel, which is the documented way to deliver defines -- so
    // the tests can verify through IntelliSense (hover) that the configuration
    // was actually delivered and applied for the translation unit, not merely
    // returned by the provider. The module flags stay in `compilerArgs`.
    const gccModuleConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}" ],
        defines: [ "PROVIDER_GCC_SENTINEL=1" ],
        intelliSenseMode: "gcc-x64",
        standard: "c++20",
        compilerArgs: gccModuleArgs(`${toPosixPath(workspacePath())}/build/cmi`)
    };
    const msvcModuleConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}" ],
        defines: [ "PROVIDER_MSVC_SENTINEL=1" ],
        intelliSenseMode: "msvc-x64",
        standard: "c++20",
        compilerArgs: msvcModuleArgs()
    };

    const provider: api.CustomConfigurationProvider = {
        name: "cpptoolsTest-modules",
        extensionId: "ms-vscode.cpptools-test-modules",
        canProvideConfiguration(document: vscode.Uri): Thenable<boolean> {
            supportedUris.add(document.toString());
            return Promise.resolve(true);
        },
        provideConfigurations(uris: vscode.Uri[]): Thenable<api.SourceFileConfigurationItem[]> {
            const result: api.SourceFileConfigurationItem[] = [];
            uris.forEach(uri => {
                const uriString: string = uri.toString();
                if (!supportedUris.has(uriString)) {
                    configurationProvidedBeforeCanProvide = true;
                }
                const configuration: api.SourceFileConfiguration = uri.path.endsWith("main3.cpp") ? msvcModuleConfig : gccModuleConfig;
                result.push({
                    uri: uriString,
                    configuration: configuration
                });
            });
            lastResult = result;
            return Promise.resolve(result);
        },
        dispose(): void {
            console.log("    disposed");
        },
        canProvideBrowseConfiguration(): Thenable<boolean> {
            return Promise.resolve(false);
        },
        provideBrowseConfiguration(): Thenable<api.WorkspaceBrowseConfiguration> {
            return Promise.resolve({ browsePath: [] });
        },
        canProvideBrowseConfigurationsPerFolder(): Thenable<boolean> {
            return Promise.resolve(false);
        },
        provideFolderBrowseConfiguration(_uri: vscode.Uri): Thenable<api.WorkspaceBrowseConfiguration> {
            return Promise.resolve({ browsePath: [] });
        }
    };

    suiteSetup(async function(): Promise<void> {
        cpptools = await apit.getCppToolsTestApi(api.Version.v6) ?? assert.fail('Could not get CppToolsTestApi');
        cpptools.registerCustomConfigurationProvider(provider);
        cpptools.notifyReady(provider);
        disposables.push(cpptools);

        await changeCppProperties({
            configurations: [ { name: "modules-provider", configurationProvider: provider.extensionId } ],
            version: 4
        },
        disposables);
    });

    suiteTeardown(async function(): Promise<void> {
        disposables.forEach(d => d.dispose());
        await util.deleteFile(cppPropertiesPath());
        await util.deleteFile(compileCommandsPath());
    });

    test("GCC-style module compiler args are delivered - main2.cpp", async () => {
        const document: vscode.TextDocument = await openAndAwaitIntelliSenseReady(cpptools, disposables, "main2.cpp");
        const expected: api.SourceFileConfigurationItem[] = [ { uri: document.uri.toString(), configuration: gccModuleConfig } ];
        assert.strictEqual(configurationProvidedBeforeCanProvide, false);
        assert.deepStrictEqual(lastResult, expected);

        // Verify that the compilerArgs (including the GCC module flags) were
        // delivered to the language server for this translation unit.
        await assertSentinelDefineApplied(document, "return provider_gcc_sentinel_value;", "provider_gcc_sentinel_value");
    });

    test("MSVC-style module compiler args are delivered - main3.cpp", async () => {
        const document: vscode.TextDocument = await openAndAwaitIntelliSenseReady(cpptools, disposables, "main3.cpp");
        const expected: api.SourceFileConfigurationItem[] = [ { uri: document.uri.toString(), configuration: msvcModuleConfig } ];
        assert.strictEqual(configurationProvidedBeforeCanProvide, false);
        assert.deepStrictEqual(lastResult, expected);

        // Verify that the compilerArgs (including the MSVC module arguments)
        // were delivered to the language server for this translation unit.
        await assertSentinelDefineApplied(document, "return provider_msvc_sentinel_value;", "provider_msvc_sentinel_value");
    });
});
