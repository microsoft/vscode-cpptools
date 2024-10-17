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

describe('copilotProviders Tests', () => {
    let moduleUnderTest: any;
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

    const arrange = ({ vscodeExtension, getIncludeFiles, chatContext, rootUri, flags }:
    { vscodeExtension?: vscode.Extension<unknown>; getIncludeFiles?: GetIncludesResult; chatContext?: ChatContextResult; rootUri?: vscode.Uri; flags?: Record<string, unknown> } =
    { vscodeExtension: undefined, getIncludeFiles: undefined, chatContext: undefined, rootUri: undefined, flags: {} }
    ) => {
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

    it('should register provider', async () => {
        arrange(
            { vscodeExtension: vscodeExtension }
        );

        await moduleUnderTest.registerRelatedFilesProvider();

        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
    });

    it('should not provide cpp context traits when ChatContext isn\'t available.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            chatContext: undefined,
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: { copilotcppTraits: true }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
        ok(getActiveClientStub.callCount !== 0, 'getActiveClient should be called');
        ok(callbackPromise, 'callbackPromise should be defined');
        ok(result, 'result should be defined');
        ok(result.entries.length === 1, 'result.entries should have 1 included file');
        ok(result.entries[0].toString() === 'file:///c%3A/src/my_project/foo.h', 'result.entries should have "file:///c%3A/src/my_project/foo.h"');
        ok(result.traits === undefined, 'result.traits should be undefined');
    });

    it('should not provide cpp context traits when copilotcppTraits flag is false.', async () => {
        arrange({
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

        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
        ok(getActiveClientStub.callCount !== 0, 'getActiveClient should be called');
        ok(callbackPromise, 'callbackPromise should be defined');
        ok(result, 'result should be defined');
        ok(result.entries.length === 1, 'result.entries should have 1 included file');
        ok(result.entries[0].toString() === 'file:///c%3A/src/my_project/foo.h', 'result.entries should have "file:///c%3A/src/my_project/foo.h"');
        ok(result.traits === undefined, 'result.traits should be undefined');
    });

    it('should provide cpp context traits when copilotcppTraits flag is true.', async () => {
        arrange({
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

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.length === 5, 'result.traits should have 5 traits');
        ok(result.traits.find((trait) => trait.name === 'language'), 'result.traits should have a language trait');
        ok(result.traits.find((trait) => trait.name === 'language')?.value === 'c++', 'result.traits should have a language trait with value "c++"');
        ok(result.traits.find((trait) => trait.name === 'language')?.includeInPrompt, 'result.traits should have a language trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'language')?.promptTextOverride === 'The language is c++.', 'result.traits should have a language trait with promptTextOverride "The language is c++."');
        ok(result.traits.find((trait) => trait.name === 'compiler'), 'result.traits should have a compiler trait');
        ok(result.traits.find((trait) => trait.name === 'compiler')?.value === 'msvc', 'result.traits should have a compiler trait with value "msvc"');
        ok(result.traits.find((trait) => trait.name === 'compiler')?.includeInPrompt, 'result.traits should have a compiler trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'compiler')?.promptTextOverride === 'This project compiles using msvc.', 'result.traits should have a compiler trait with promptTextOverride "This project compiles using msvc."');
        ok(result.traits.find((trait) => trait.name === 'standardVersion'), 'result.traits should have a standardVersion trait');
        ok(result.traits.find((trait) => trait.name === 'standardVersion')?.value === 'c++20', 'result.traits should have a standardVersion trait with value "c++20"');
        ok(result.traits.find((trait) => trait.name === 'standardVersion')?.includeInPrompt, 'result.traits should have a standardVersion trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'standardVersion')?.promptTextOverride === 'This project uses the c++20 language standard.', 'result.traits should have a standardVersion trait with promptTextOverride "This project uses the c++20 language standard."');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform'), 'result.traits should have a targetPlatform trait');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform')?.value === 'windows', 'result.traits should have a targetPlatform trait with value "windows"');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform')?.includeInPrompt, 'result.traits should have a targetPlatform trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform')?.promptTextOverride === 'This build targets windows.', 'result.traits should have a targetPlatform trait with promptTextOverride "This build targets windows."');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture'), 'result.traits should have a targetArchitecture trait');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture')?.value === 'x64', 'result.traits should have a targetArchitecture trait with value "x64"');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture')?.includeInPrompt, 'result.traits should have a targetArchitecture trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture')?.promptTextOverride === 'This build targets x64.', 'result.traits should have a targetArchitecture trait with promptTextOverride "This build targets x64."');
    });

    it('should provide compiler defines and arguments traits if available.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            chatContext: {
                language: 'c++',
                standardVersion: 'c++20',
                compiler: 'msvc',
                targetPlatform: 'windows',
                targetArchitecture: 'x64',
                compilerArgs: ['/std:c++17', '/permissive-'],
                compilerUserDefines: ['DEBUG', 'TEST']
            },
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: { copilotcppTraits: true }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.find((trait) => trait.name === 'compilerArgs'), 'result.traits should have a compiler args trait');
        ok(result.traits.find((trait) => trait.name === 'compilerArgs')?.value === '/std:c++17 /permissive-', 'result.traits should have a compiler args trait with value "/std:c++17 /permissive-"');
        ok(result.traits.find((trait) => trait.name === 'compilerArgs')?.includeInPrompt, 'result.traits should have a compiler args trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'compilerArgs')?.promptTextOverride === 'The compiler command line arguments contain: /std:c++17 /permissive-.', 'result.traits should have a compiler args trait with promptTextOverride "The compiler command line arguments contain: /std:c++17 /permissive-"');
        ok(result.traits.find((trait) => trait.name === 'compilerUserDefines'), 'result.traits should have a compiler defines trait');
        ok(result.traits.find((trait) => trait.name === 'compilerUserDefines')?.value === 'DEBUG, TEST', 'result.traits should have a compiler defines trait with value "DEBUG, TEST"');
        ok(result.traits.find((trait) => trait.name === 'compilerUserDefines')?.includeInPrompt, 'result.traits should have a compiler defines trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'compilerUserDefines')?.promptTextOverride === 'The compiler command line user defines contain: DEBUG, TEST.', 'result.traits should have a compiler defines trait with promptTextOverride "The compiler command line user defines contain: DEBUG, TEST."');
    });

    it('should exclude cpp context traits per copilotcppExcludeTraits.', async () => {
        const excludeTraits = ['compiler', 'targetPlatform'];
        arrange({
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
        arrange({});

        await moduleUnderTest.registerRelatedFilesProvider();

        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.notCalled, 'registerRelatedFilesProvider should not be called');
    });
});
