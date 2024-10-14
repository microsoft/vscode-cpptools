/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ok } from 'assert';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as proxyquire from 'proxyquire';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as util from '../../../../src/common';
import { ChatContextResult, DefaultClient, GetIncludesResult } from '../../../../src/LanguageServer/client';
import { CopilotApi, CopilotTrait } from '../../../../src/LanguageServer/copilotProviders';
import * as extension from '../../../../src/LanguageServer/extension';
import * as telemetry from '../../../../src/telemetry';

describe('registerRelatedFilesProvider', () => {
    let moduleUnderTest: any;
    let getIsRelatedFilesApiEnabledStub: sinon.SinonStub;
    let mockCopilotApi: sinon.SinonStubbedInstance<CopilotApi>;
    let getActiveClientStub: sinon.SinonStub;
    let activeClientStub: sinon.SinonStubbedInstance<DefaultClient>;
    let vscodeGetExtensionsStub: sinon.SinonStub;
    let callbackPromise: Promise<{ entries: vscode.Uri[]; traits?: CopilotTrait[] }> | undefined;
    let vscodeExtension: vscode.Extension<unknown>;

    beforeEach(() => {
        proxyquire.noPreserveCache(); // Tells proxyquire to not fetch the module from cache
        // Ensures that each test has a freshly loaded instance of moduleUnderTest
        moduleUnderTest = proxyquire(
            '../../../../src/LanguageServer/copilotProviders',
            {} // Stub if you need to, or keep the object empty
        );

        getIsRelatedFilesApiEnabledStub = sinon.stub(telemetry, 'isExperimentEnabled');
        sinon.stub(util, 'extensionContext').value({ extension: { id: 'test-extension-id' } });

        class MockCopilotApi implements CopilotApi {
            public registerRelatedFilesProvider(
                _providerId: { extensionId: string; languageId: string },
                _callback: (
                    uri: vscode.Uri,
                    context: { flags: Record<string, unknown> },
                    cancellationToken: vscode.CancellationToken
                ) => Promise<{ entries: vscode.Uri[]; traits?: CopilotTrait[] }>
            ): vscode.Disposable & { [Symbol.dispose](): void } {
                return {
                    dispose: () => { },
                    [Symbol.dispose]: () => { }
                };
            }
        }
        mockCopilotApi = sinon.createStubInstance(MockCopilotApi);
        vscodeExtension = {
            id: 'test-extension-id',
            extensionUri: vscode.Uri.parse('file:///test-extension-path'),
            extensionPath: 'test-extension-path',
            isActive: true,
            packageJSON: { name: 'test-extension-name' },
            activate: async () => { },
            exports: mockCopilotApi,
            extensionKind: vscode.ExtensionKind.UI
        };

        activeClientStub = sinon.createStubInstance(DefaultClient);
        getActiveClientStub = sinon.stub(extension, 'getActiveClient').returns(activeClientStub);
        activeClientStub.getIncludes.resolves({ includedFiles: [] });
    });

    afterEach(() => {
        sinon.restore();
    });

    const arrange = ({ cppToolsRelatedFilesApi, vscodeExtension, getIncludeFiles, chatContext, rootUri, flags }:
    { cppToolsRelatedFilesApi: boolean; vscodeExtension?: vscode.Extension<unknown>; getIncludeFiles?: GetIncludesResult; chatContext?: ChatContextResult; rootUri?: vscode.Uri; flags?: Record<string, unknown> } =
    { cppToolsRelatedFilesApi: false, vscodeExtension: undefined, getIncludeFiles: undefined, chatContext: undefined, rootUri: undefined, flags: {} }
    ) => {
        getIsRelatedFilesApiEnabledStub.withArgs('CppToolsRelatedFilesApi').resolves(cppToolsRelatedFilesApi);
        activeClientStub.getIncludes.resolves(getIncludeFiles);
        activeClientStub.getChatContext.resolves(chatContext);
        sinon.stub(activeClientStub, 'RootUri').get(() => rootUri);
        mockCopilotApi.registerRelatedFilesProvider.callsFake((_providerId: { extensionId: string; languageId: string }, callback: (uri: vscode.Uri, context: { flags: Record<string, unknown> }, cancellationToken: vscode.CancellationToken) => Promise<{ entries: vscode.Uri[]; traits?: CopilotTrait[] }>) => {
            const tokenSource = new vscode.CancellationTokenSource();
            try {
                callbackPromise = callback(vscode.Uri.parse('file:///test-extension-path'), { flags: flags ?? {} }, tokenSource.token);
            } finally {
                tokenSource.dispose();
            }

            return {
                dispose: () => { },
                [Symbol.dispose]: () => { }
            };
        });
        vscodeGetExtensionsStub = sinon.stub(vscode.extensions, 'getExtension').returns(vscodeExtension);
    };

    it('should not register provider if CppToolsRelatedFilesApi is not enabled', async () => {
        arrange(
            { cppToolsRelatedFilesApi: false }
        );

        await moduleUnderTest.registerRelatedFilesProvider();

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
    });

    it('should register provider if CppToolsRelatedFilesApi is enabled', async () => {
        arrange(
            { cppToolsRelatedFilesApi: true, vscodeExtension: vscodeExtension }
        );

        await moduleUnderTest.registerRelatedFilesProvider();

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
    });

    it('should not add #cpp traits when ChatContext isn\'t available.', async () => {
        arrange({
            cppToolsRelatedFilesApi: true,
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            chatContext: undefined,
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: { copilotcppTraits: true }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
        ok(getActiveClientStub.callCount !== 0, 'getActiveClient should be called');
        ok(callbackPromise, 'callbackPromise should be defined');
        ok(result, 'result should be defined');
        ok(result.entries.length === 1, 'result.entries should have 1 included file');
        ok(result.entries[0].toString() === 'file:///c%3A/src/my_project/foo.h', 'result.entries should have "file:///c%3A/src/my_project/foo.h"');
        ok(result.traits === undefined, 'result.traits should be undefined');
    });

    it('should not add #cpp traits when copilotcppTraits flag is false.', async () => {
        arrange({
            cppToolsRelatedFilesApi: true,
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            chatContext: {
                language: 'c++',
                standardVersion: 'c++20',
                compiler: 'msvc',
                targetPlatform: 'windows',
                targetArchitecture: 'x64'
            },
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: { copilotcppTraits: false }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
        ok(getActiveClientStub.callCount !== 0, 'getActiveClient should be called');
        ok(callbackPromise, 'callbackPromise should be defined');
        ok(result, 'result should be defined');
        ok(result.entries.length === 1, 'result.entries should have 1 included file');
        ok(result.entries[0].toString() === 'file:///c%3A/src/my_project/foo.h', 'result.entries should have "file:///c%3A/src/my_project/foo.h"');
        ok(result.traits === undefined, 'result.traits should be undefined');
    });

    it('should add #cpp traits when copilotcppTraits flag is true.', async () => {
        arrange({
            cppToolsRelatedFilesApi: true,
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            chatContext: {
                language: 'c++',
                standardVersion: 'c++20',
                compiler: 'msvc',
                targetPlatform: 'windows',
                targetArchitecture: 'x64'
            },
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: { copilotcppTraits: true }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledThrice, 'registerRelatedFilesProvider should be called three times');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
        ok(getActiveClientStub.callCount !== 0, 'getActiveClient should be called');
        ok(callbackPromise, 'callbackPromise should be defined');
        ok(result, 'result should be defined');
        ok(result.entries.length === 1, 'result.entries should have 1 included file');
        ok(result.entries[0].toString() === 'file:///c%3A/src/my_project/foo.h', 'result.entries should have "file:///c%3A/src/my_project/foo.h"');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.length === 5, 'result.traits should have 5 traits');
        ok(result.traits[0].name === 'language', 'result.traits[0].name should be "language"');
        ok(result.traits[0].value === 'c++', 'result.traits[0].value should be "c++"');
        ok(result.traits[0].includeInPrompt, 'result.traits[0].includeInPrompt should be true');
        ok(result.traits[0].promptTextOverride === 'The language is c++.', 'result.traits[0].promptTextOverride should be "The language is c++."');
        ok(result.traits[1].name === 'compiler', 'result.traits[1].name should be "compiler"');
        ok(result.traits[1].value === 'msvc', 'result.traits[1].value should be "msvc"');
        ok(result.traits[1].includeInPrompt, 'result.traits[1].includeInPrompt should be true');
        ok(result.traits[1].promptTextOverride === 'This project compiles using msvc.', 'result.traits[1].promptTextOverride should be "This project compiles using msvc."');
        ok(result.traits[2].name === 'standardVersion', 'result.traits[2].name should be "standardVersion"');
        ok(result.traits[2].value === 'c++20', 'result.traits[2].value should be "c++20"');
        ok(result.traits[2].includeInPrompt, 'result.traits[2].includeInPrompt should be true');
        ok(result.traits[2].promptTextOverride === 'This project uses the c++20 language standard.', 'result.traits[2].promptTextOverride should be "This project uses the c++20 language standard."');
        ok(result.traits[3].name === 'targetPlatform', 'result.traits[3].name should be "targetPlatform"');
        ok(result.traits[3].value === 'windows', 'result.traits[3].value should be "windows"');
        ok(result.traits[3].includeInPrompt, 'result.traits[3].includeInPrompt should be true');
        ok(result.traits[3].promptTextOverride === 'This build targets windows.', 'result.traits[3].promptTextOverride should be "This build targets windows."');
        ok(result.traits[4].name === 'targetArchitecture', 'result.traits[4].name should be "targetArchitecture"');
        ok(result.traits[4].value === 'x64', 'result.traits[4].value should be "x64"');
        ok(result.traits[4].includeInPrompt, 'result.traits[4].includeInPrompt should be true');
        ok(result.traits[4].promptTextOverride === 'This build targets x64.', 'result.traits[4].promptTextOverride should be "This build targets x64."');
    });

    it('should exclude #cpp traits per copilotcppExcludeTraits.', async () => {
        const excludeTraits = ['compiler', 'targetPlatform'];
        arrange({
            cppToolsRelatedFilesApi: true,
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            chatContext: {
                language: 'c++',
                standardVersion: 'c++20',
                compiler: 'msvc',
                targetPlatform: 'windows',
                targetArchitecture: 'x64'
            },
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: { copilotcppTraits: true, copilotcppExcludeTraits: excludeTraits }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledThrice, 'registerRelatedFilesProvider should be called three times');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
        ok(getActiveClientStub.callCount !== 0, 'getActiveClient should be called');
        ok(callbackPromise, 'callbackPromise should be defined');
        ok(result, 'result should be defined');
        ok(result.entries.length === 1, 'result.entries should have 1 included file');
        ok(result.entries[0].toString() === 'file:///c%3A/src/my_project/foo.h', 'result.entries should have "file:///c%3A/src/my_project/foo.h"');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.length === 3, 'result.traits should have 3 traits');
        ok(result.traits.filter(trait => excludeTraits.includes(trait.name)).length === 0, 'result.traits should not include excluded traits');
    });

    it('should handle errors during provider registration', async () => {
        arrange(
            { cppToolsRelatedFilesApi: true }
        );

        await moduleUnderTest.registerRelatedFilesProvider();

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.notCalled, 'registerRelatedFilesProvider should not be called');
    });
});

describe('registerRelatedFilesCommands', () => {
    let moduleUnderTest: any;
    let getIsRelatedFilesApiEnabledStub: sinon.SinonStub;
    let registerCommandStub: sinon.SinonStub;
    let commandDisposables: vscode.Disposable[];
    let getActiveClientStub: sinon.SinonStub;
    let activeClientStub: sinon.SinonStubbedInstance<DefaultClient>;
    let getIncludesResult: Promise<GetIncludesResult | undefined> = Promise.resolve(undefined);

    beforeEach(() => {
        proxyquire.noPreserveCache(); // Tells proxyquire to not fetch the module from cache
        // Ensures that each test has a freshly loaded instance of moduleUnderTest
        moduleUnderTest = proxyquire(
            '../../../../src/LanguageServer/copilotProviders',
            {} // Stub if you need to, or keep the object empty
        );

        activeClientStub = sinon.createStubInstance(DefaultClient);
        getActiveClientStub = sinon.stub(extension, 'getActiveClient').returns(activeClientStub);
        activeClientStub.getIncludes.resolves({ includedFiles: [] });
        getIsRelatedFilesApiEnabledStub = sinon.stub(telemetry, 'isExperimentEnabled');
        registerCommandStub = sinon.stub(vscode.commands, 'registerCommand');
        commandDisposables = [];
    });

    afterEach(() => {
        sinon.restore();
    });

    const arrange = ({ cppToolsRelatedFilesApi, getIncludeFiles, rootUri }:
    { cppToolsRelatedFilesApi: boolean; getIncludeFiles?: GetIncludesResult; rootUri?: vscode.Uri } =
    { cppToolsRelatedFilesApi: false, getIncludeFiles: undefined, rootUri: undefined }
    ) => {
        getIsRelatedFilesApiEnabledStub.withArgs('CppToolsRelatedFilesApi').resolves(cppToolsRelatedFilesApi);
        activeClientStub.getIncludes.resolves(getIncludeFiles);
        sinon.stub(activeClientStub, 'RootUri').get(() => rootUri);
        registerCommandStub.callsFake((command: string, callback: (maxDepth: number) => Promise<GetIncludesResult>) => {
            getIncludesResult = callback(1);
        });
    };

    it('should register C_Cpp.getIncludes command if CppToolsRelatedFilesApi is enabled', async () => {
        arrange({ cppToolsRelatedFilesApi: true });

        await moduleUnderTest.registerRelatedFilesCommands(commandDisposables, true);

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(registerCommandStub.calledOnce, 'registerCommand should be called once');
        ok(commandDisposables.length === 1, 'commandDisposables should have one disposable');
        ok(registerCommandStub.calledWithMatch('C_Cpp.getIncludes', sinon.match.func), 'registerCommand should be called with "C_Cpp.getIncludes" and a function');
    });

    it('should register C_Cpp.getIncludes command that can handle requests properly', async () => {
        arrange({
            cppToolsRelatedFilesApi: true,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo1.h', 'C:\\src\\my_project\\foo2.h'] },
            rootUri: vscode.Uri.file('C:\\src\\my_project')
        });
        await moduleUnderTest.registerRelatedFilesCommands(commandDisposables, true);

        const includesResult = await getIncludesResult;

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(getActiveClientStub.calledOnce, 'getActiveClient should be called once');
        ok(includesResult, 'includesResult should be defined');
        ok(includesResult?.includedFiles.length === 2, 'includesResult should have 2 included files');
        ok(includesResult?.includedFiles[0] === 'C:\\src\\my_project\\foo1.h', 'includesResult should have "C:\\src\\my_project\\foo1.h"');
        ok(includesResult?.includedFiles[1] === 'C:\\src\\my_project\\foo2.h', 'includesResult should have "C:\\src\\my_project\\foo2.h"');
    });

    it('should not register C_Cpp.getIncludes command if CppToolsRelatedFilesApi is not enabled', async () => {
        arrange({
            cppToolsRelatedFilesApi: false
        });

        await moduleUnderTest.registerRelatedFilesCommands(commandDisposables, true);

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(registerCommandStub.notCalled, 'registerCommand should not be called');
        ok(commandDisposables.length === 0, 'commandDisposables should be empty');
    });

    it('should register C_Cpp.getIncludes as no-op command if enabled is false', async () => {
        arrange({
            cppToolsRelatedFilesApi: true,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            rootUri: vscode.Uri.file('C:\\src\\my_project')
        });
        await moduleUnderTest.registerRelatedFilesCommands(commandDisposables, false);

        const includesResult = await getIncludesResult;

        ok(getIsRelatedFilesApiEnabledStub.calledOnce, 'getIsRelatedFilesApiEnabled should be called once');
        ok(registerCommandStub.calledOnce, 'registerCommand should be called once');
        ok(commandDisposables.length === 1, 'commandDisposables should have one disposable');
        ok(includesResult === undefined, 'includesResult should be undefined');
        ok(registerCommandStub.calledWithMatch('C_Cpp.getIncludes', sinon.match.func), 'registerCommand should be called with "C_Cpp.getIncludes" and a function');
    });
});
