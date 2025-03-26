/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ContextProviderApiV1 } from '@github/copilot-language-server';
import { ok } from 'assert';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as proxyquire from 'proxyquire';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as util from '../../../../src/common';
import { DefaultClient, GetIncludesResult } from '../../../../src/LanguageServer/client';
import { ClientCollection } from '../../../../src/LanguageServer/clientCollection';
import { CopilotApi, CopilotTrait } from '../../../../src/LanguageServer/copilotProviders';
import * as extension from '../../../../src/LanguageServer/extension';
import * as lmTool from '../../../../src/LanguageServer/lmTool';
import { ProjectContext } from '../../../../src/LanguageServer/lmTool';
import * as telemetry from '../../../../src/telemetry';

describe('copilotProviders Tests', () => {
    let moduleUnderTest: any;
    let mockCopilotApi: sinon.SinonStubbedInstance<CopilotApi>;
    let getClientsStub: sinon.SinonStub;
    let activeClientStub: sinon.SinonStubbedInstance<DefaultClient>;
    let vscodeGetExtensionsStub: sinon.SinonStub;
    let callbackPromise: Promise<{ entries: vscode.Uri[]; traits?: CopilotTrait[] }> | undefined;
    let vscodeExtension: vscode.Extension<unknown>;
    let telemetryStub: sinon.SinonStub;

    const includedFiles: string[] = process.platform === 'win32' ?
        ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] :
        ['/system/include/vector', '/system/include/string', '/home/src/my_project/foo.h'];
    const rootUri: vscode.Uri = vscode.Uri.file(process.platform === 'win32' ? 'C:\\src\\my_project' : '/home/src/my_project');
    const expectedInclude: string = process.platform === 'win32' ? 'file:///c%3A/src/my_project/foo.h' : 'file:///home/src/my_project/foo.h';
    const sourceFileUri: vscode.Uri = vscode.Uri.file(process.platform === 'win32' ? 'file:///c%3A/src/my_project/foo.cpp' : 'file:///home/src/my_project/foo.cpp');

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
            public getContextProviderAPI(_version: string): Promise<ContextProviderApiV1 | undefined> {
                throw new Error('Method not implemented.');
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
        const clientsStub = sinon.createStubInstance(ClientCollection);
        getClientsStub = sinon.stub(extension, 'getClients').returns(clientsStub);
        clientsStub.getClientFor.returns(activeClientStub);
        activeClientStub.getIncludes.resolves({ includedFiles: [] });
        telemetryStub = sinon.stub(telemetry, 'logCopilotEvent').returns();
    });

    afterEach(() => {
        sinon.restore();
    });

    const arrange = ({ vscodeExtension, getIncludeFiles, projectContext, rootUri, flags }:
    { vscodeExtension?: vscode.Extension<unknown>; getIncludeFiles?: GetIncludesResult; projectContext?: ProjectContext; rootUri?: vscode.Uri; flags?: Record<string, unknown> } =
    { vscodeExtension: undefined, getIncludeFiles: undefined, projectContext: undefined, rootUri: undefined, flags: {} }
    ) => {
        activeClientStub.getIncludes.resolves(getIncludeFiles);
        sinon.stub(lmTool, 'getProjectContext').resolves(projectContext);
        sinon.stub(activeClientStub, 'RootUri').get(() => rootUri);
        mockCopilotApi.registerRelatedFilesProvider.callsFake((_providerId: { extensionId: string; languageId: string }, callback: (uri: vscode.Uri, context: { flags: Record<string, unknown> }, cancellationToken: vscode.CancellationToken) => Promise<{ entries: vscode.Uri[]; traits?: CopilotTrait[] }>) => {
            if (_providerId.languageId === 'cpp') {
                const tokenSource = new vscode.CancellationTokenSource();
                try {
                    callbackPromise = callback(sourceFileUri, { flags: flags ?? {} }, tokenSource.token);
                } finally {
                    tokenSource.dispose();
                }
            }

            return {
                dispose: () => { },
                [Symbol.dispose]: () => { }
            };
        });
        vscodeGetExtensionsStub = sinon.stub(vscode.extensions, 'getExtension').returns(vscodeExtension);
    };

    it('should register provider.', async () => {
        arrange(
            { vscodeExtension: vscodeExtension }
        );

        await moduleUnderTest.registerRelatedFilesProvider();

        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
    });

    it('should not provide project context traits when project context isn\'t available.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles },
            projectContext: undefined,
            rootUri,
            flags: {}
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.calledWithMatch(sinon.match({ extensionId: 'test-extension-id', languageId: sinon.match.in(['c', 'cpp', 'cuda-cpp']) })), 'registerRelatedFilesProvider should be called with the correct providerId and languageId');
        ok(getClientsStub.callCount !== 0, 'getClients should be called');
        ok(callbackPromise, 'callbackPromise should be defined');
        ok(result, 'result should be defined');
        ok(result.entries.length === 1, 'result.entries should have 1 included file');
        ok(result.entries[0].toString() === expectedInclude, `result.entries should have "${expectedInclude}"`);
        ok(result.traits === undefined, 'result.traits should be undefined');
    });

    const projectContext: ProjectContext = {
        language: 'C++',
        standardVersion: 'C++20',
        compiler: 'MSVC',
        targetPlatform: 'Windows',
        targetArchitecture: 'x64'
    };

    it('provides standardVersion trait by default.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles },
            projectContext: projectContext,
            rootUri,
            flags: {}
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.length === 1, 'result.traits should have 1 trait');
        ok(result.traits.find((trait) => trait.name === 'standardVersion'), 'result.traits should have a standardVersion trait');
        ok(result.traits.find((trait) => trait.name === 'standardVersion')?.value === 'C++20', 'result.traits should have a standardVersion trait with value "C++20"');
        ok(result.traits.find((trait) => trait.name === 'standardVersion')?.includeInPrompt, 'result.traits should have a standardVersion trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'standardVersion')?.promptTextOverride === 'This project uses the C++20 language standard.', 'result.traits should have a standardVersion trait with promptTextOverride');
        ok(telemetryStub.calledOnce, 'Telemetry should be called once');
        ok(telemetryStub.calledWithMatch('RelatedFilesProvider', sinon.match({
            'traits': 'standardVersion'
        }), sinon.match({
            'duration': sinon.match.number
        })));
    });

    it('provides traits per copilotcppIncludeTraits.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles },
            projectContext: projectContext,
            rootUri,
            flags: { copilotcppIncludeTraits: ['language', 'compiler', 'targetPlatform', 'targetArchitecture'] }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.length === 5, 'result.traits should have 5 traits if none are excluded');
        ok(result.traits.find((trait) => trait.name === 'language'), 'result.traits should have a language trait');
        ok(result.traits.find((trait) => trait.name === 'language')?.value === 'C++', 'result.traits should have a language trait with value "C++"');
        ok(result.traits.find((trait) => trait.name === 'language')?.includeInPrompt, 'result.traits should have a language trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'language')?.promptTextOverride === 'The language is C++.', 'result.traits should have a language trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'compiler'), 'result.traits should have a compiler trait');
        ok(result.traits.find((trait) => trait.name === 'compiler')?.value === 'MSVC', 'result.traits should have a compiler trait with value "MSVC"');
        ok(result.traits.find((trait) => trait.name === 'compiler')?.includeInPrompt, 'result.traits should have a compiler trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'compiler')?.promptTextOverride === 'This project compiles using MSVC.', 'result.traits should have a compiler trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform'), 'result.traits should have a targetPlatform trait');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform')?.value === 'Windows', 'result.traits should have a targetPlatform trait with value "Windows"');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform')?.includeInPrompt, 'result.traits should have a targetPlatform trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform')?.promptTextOverride === 'This build targets Windows.', 'result.traits should have a targetPlatform trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture'), 'result.traits should have a targetArchitecture trait');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture')?.value === 'x64', 'result.traits should have a targetArchitecture trait with value "x64"');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture')?.includeInPrompt, 'result.traits should have a targetArchitecture trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture')?.promptTextOverride === 'This build targets x64.', 'result.traits should have a targetArchitecture trait with promptTextOverride');
        ok(telemetryStub.calledWithMatch('RelatedFilesProvider', sinon.match({
            'includeTraits': 'language,compiler,targetPlatform,targetArchitecture',
            'traits': 'language,compiler,standardVersion,targetPlatform,targetArchitecture'
        }), sinon.match({
            'duration': sinon.match.number
        })));
    });

    it('handles errors during provider registration.', async () => {
        arrange({});

        await moduleUnderTest.registerRelatedFilesProvider();

        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.notCalled, 'registerRelatedFilesProvider should not be called');
    });
});
