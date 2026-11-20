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
//  * a compile_commands.json that contains GCC and Clang module related flags
//    does not prevent the language server from providing IntelliSense for the
//    project, and its entries are actually applied to the translation units
//    (verified through sentinel defines and hover assertions, not just
//    readiness),
//  * module related compiler arguments (GCC, Clang and MSVC spellings) are
//    accepted and delivered through the custom configuration provider path.
//    The sentinel defines travel in the same `compilerArgs` array as the
//    module flags, so the hover assertions verify that these arguments -- not
//    a separate channel -- reach the language server and take effect.
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

// The (empty) fake compiler binaries are checked in with the scenario assets,
// following the SimpleCppProject pattern, so that the language server does not
// probe a real compiler and the tests stay deterministic across machines.
// MSVC-style compilers (cl) use the .exe suffix on every platform.
function fakeCompilerPath(name: string, exeOnAllPlatforms?: boolean): string {
    const suffix: string = exeOnAllPlatforms || process.platform === 'win32' ? ".exe" : "";
    return toPosixPath(`${workspacePath()}/bin/${name}${suffix}`);
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

// GCC spellings of the C++20 module related compiler flags. "-fmodules-ts" is
// the module flag GCC accepts (verified against g++; GCC 15 rejects
// "-fmodules-c++20"). Clang-only options such as "-fprebuilt-module-path" and
// "-fmodule-file" are deliberately NOT included here: GCC rejects the former,
// and "-fmodule-file" is a D language option in GCC.
function gccModuleArgs(): string[] {
    return ["-std=c++20", "-fmodules-ts"];
}

// Clang spellings of the C++20 module related compiler flags, kept separate
// from the GCC set because the two compilers accept different options
// ("-fmodules-ts" does not exist in Clang; "-fprebuilt-module-path" and
// "-fmodule-file" do not exist in GCC).
function clangModuleArgs(pcmDir: string): string[] {
    return [
        "-std=c++20",
        "-fmodules",
        `-fprebuilt-module-path=${pcmDir}`,
        `-fmodule-file=math=${pcmDir}/math.pcm`
    ];
}

function compileCommandEntry(file: string, compilerPath: string, moduleArgs: string[], extraArgs: string[] = []): CompileCommandEntry {
    const root: string = toPosixPath(workspacePath());
    const objectFile: string = `${root}/build/${file.replace(/\.[^.]+$/, "")}.o`;
    return {
        directory: root,
        arguments: [compilerPath, ...moduleArgs, ...extraArgs, "-c", "-o", objectFile, file],
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

suite("compile_commands.json with GCC and Clang C++20 module flags", function(): void {
    let cpptools: apit.CppToolsTestApi;
    const disposables: vscode.Disposable[] = [];

    suiteSetup(async function(): Promise<void> {
        cpptools = await apit.getCppToolsTestApi(api.Version.v2) ?? assert.fail('Could not get CppToolsTestApi');
        disposables.push(cpptools);

        await writeCompileCommands([
            // The sentinel defines carried by the importers' entries let the
            // tests verify through IntelliSense (hover) that the database
            // entries were applied, rather than IntelliSense falling back to a
            // default configuration. GCC and Clang module flag spellings are
            // exercised through separate importers.
            compileCommandEntry("main.cpp", fakeCompilerPath("gcc"), gccModuleArgs(), ["-DCPPMODULES_COMPILE_COMMANDS_SENTINEL=1"]),
            compileCommandEntry("main4.cpp", fakeCompilerPath("clang++"), clangModuleArgs(`${toPosixPath(workspacePath())}/build/pcm`), ["-DCLANG_COMPILE_COMMANDS_SENTINEL=1"]),
            compileCommandEntry("math.cppm", fakeCompilerPath("gcc"), gccModuleArgs()),
            compileCommandEntry("math.ixx", fakeCompilerPath("gcc"), gccModuleArgs())
        ]);

        await changeCppProperties({
            configurations: [
                {
                    name: "C++20 modules",
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

    test("IntelliSense is provided for the gcc module importer (main.cpp)", async () => {
        const document: vscode.TextDocument = await openAndAwaitIntelliSenseReady(cpptools, disposables, "main.cpp");

        // Verify that the compile_commands.json entry for this file -- the one
        // carrying the GCC module related flags -- was actually applied to the
        // translation unit (and not a fallback configuration).
        await assertSentinelDefineApplied(document, "return compile_database_sentinel_value;", "compile_database_sentinel_value");
    });

    test("IntelliSense is provided for the clang module importer (main4.cpp)", async () => {
        const document: vscode.TextDocument = await openAndAwaitIntelliSenseReady(cpptools, disposables, "main4.cpp");

        // Same verification for the Clang flag spellings.
        await assertSentinelDefineApplied(document, "return clang_compile_commands_sentinel_value;", "clang_compile_commands_sentinel_value");
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
    // Each configuration sets a compilerPath and carries its sentinel define
    // inside `compilerArgs` -- the same array as the module flags -- so the
    // hover assertions verify that the compilerArgs themselves (not a separate
    // channel) reach the language server and are applied to the translation
    // unit. The `defines` field stays empty on purpose: when a sentinel was
    // delivered through `defines` instead, dropping or rewriting the module
    // flags in `compilerArgs` would go unnoticed.
    const gccModuleConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}" ],
        defines: [],
        intelliSenseMode: "gcc-x64",
        standard: "c++20",
        compilerPath: fakeCompilerPath("gcc"),
        compilerArgs: [...gccModuleArgs(), "-DPROVIDER_GCC_SENTINEL=1"]
    };
    const msvcModuleConfig: api.SourceFileConfiguration = {
        includePath: [ "${workspaceFolder}" ],
        defines: [],
        intelliSenseMode: "msvc-x64",
        standard: "c++20",
        compilerPath: fakeCompilerPath("cl", true),
        compilerArgs: [...msvcModuleArgs(), "/DPROVIDER_MSVC_SENTINEL=1"]
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
        // Handshake check: the extension asked before configurations were
        // provided, and items were delivered for this file. (The objects
        // themselves are intentionally not re-compared against the provider's
        // own return value; the assertions below observe the delivered
        // configuration through its effect on IntelliSense instead.)
        assert.strictEqual(configurationProvidedBeforeCanProvide, false);
        assert.deepStrictEqual(lastResult.map(item => item.uri), [document.uri.toString()]);

        // Verify that the configuration -- whose compilerArgs carry the GCC
        // module flags -- was actually delivered and applied for this
        // translation unit.
        await assertSentinelDefineApplied(document, "return provider_gcc_sentinel_value;", "provider_gcc_sentinel_value");
    });

    test("MSVC-style module compiler args are delivered - main3.cpp", async () => {
        const document: vscode.TextDocument = await openAndAwaitIntelliSenseReady(cpptools, disposables, "main3.cpp");
        // Handshake check, as above.
        assert.strictEqual(configurationProvidedBeforeCanProvide, false);
        assert.deepStrictEqual(lastResult.map(item => item.uri), [document.uri.toString()]);

        // Verify that the configuration -- whose compilerArgs carry the MSVC
        // module arguments -- was actually delivered and applied for this
        // translation unit.
        await assertSentinelDefineApplied(document, "return provider_msvc_sentinel_value;", "provider_msvc_sentinel_value");
    });
});
