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
import { DefaultClient, GetIncludesResult } from '../../../../src/LanguageServer/client';
import { CopilotApi, CopilotTrait } from '../../../../src/LanguageServer/copilotProviders';
import * as extension from '../../../../src/LanguageServer/extension';
import * as lmTool from '../../../../src/LanguageServer/lmTool';
import { ProjectContext } from '../../../../src/LanguageServer/lmTool';
import * as telemetry from '../../../../src/telemetry';

describe('copilotProviders Tests', () => {
    let moduleUnderTest: any;
    let mockCopilotApi: sinon.SinonStubbedInstance<CopilotApi>;
    let getActiveClientStub: sinon.SinonStub;
    let activeClientStub: sinon.SinonStubbedInstance<DefaultClient>;
    let vscodeGetExtensionsStub: sinon.SinonStub;
    let callbackPromise: Promise<{ entries: vscode.Uri[]; traits?: CopilotTrait[] }> | undefined;
    let vscodeExtension: vscode.Extension<unknown>;
    let telemetryStub: sinon.SinonStub;

    const includedFiles = process.platform === 'win32' ?
        ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] :
        ['/system/include/vector', '/system/include/string', '/home/src/my_project/foo.h'];
    const rootUri = vscode.Uri.file(process.platform === 'win32' ? 'C:\\src\\my_project' : '/home/src/my_project');
    const expectedInclude = process.platform === 'win32' ? 'file:///c%3A/src/my_project/foo.h' : 'file:///home/src/my_project/foo.h';

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
                    callbackPromise = callback(vscode.Uri.parse('file:///test-extension-path'), { flags: flags ?? {} }, tokenSource.token);
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
        ok(getActiveClientStub.callCount !== 0, 'getActiveClient should be called');
        ok(callbackPromise, 'callbackPromise should be defined');
        ok(result, 'result should be defined');
        ok(result.entries.length === 1, 'result.entries should have 1 included file');
        ok(result.entries[0].toString() === expectedInclude, `result.entries should have "${expectedInclude}"`);
        ok(result.traits === undefined, 'result.traits should be undefined');
    });

    const projectContextNoArgs: ProjectContext = {
        language: 'C++',
        standardVersion: 'C++20',
        compiler: 'MSVC',
        targetPlatform: 'Windows',
        targetArchitecture: 'x64',
        compilerArguments: {}
    };

    it('provides standardVersion trait by default.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles },
            projectContext: projectContextNoArgs,
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
    });

    it('provides traits per copilotcppIncludeTraits.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles },
            projectContext: projectContextNoArgs,
            rootUri,
            flags: { copilotcppIncludeTraits: ['intelliSenseDisclaimer', 'intelliSenseDisclaimerBeginning', 'language', 'compiler', 'targetPlatform', 'targetArchitecture', 'intelliSenseDisclaimerEnd'] }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.length === 8, 'result.traits should have 8 traits if none are excluded');
        ok(result.traits.find((trait) => trait.name === 'intelliSenseDisclaimer'), 'result.traits should have a intellisense trait');
        ok(result.traits.find((trait) => trait.name === 'intelliSenseDisclaimer')?.includeInPrompt, 'result.traits should have a intellisense trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'intelliSenseDisclaimer')?.promptTextOverride === 'IntelliSense is currently configured with the following compiler information. It reflects the active configuration, and the project may have more configurations targeting different platforms.', 'result.traits should have a intellisense trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'intelliSenseDisclaimerBeginning'), 'result.traits should have a intellisenseBegin trait');
        ok(result.traits.find((trait) => trait.name === 'intelliSenseDisclaimerBeginning')?.includeInPrompt, 'result.traits should have a intellisenseBegin trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'intelliSenseDisclaimerBeginning')?.promptTextOverride === 'Beginning of IntelliSense information.', 'result.traits should have a intellisenseBegin trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'language'), 'result.traits should have a language trait');
        ok(result.traits.find((trait) => trait.name === 'language')?.value === 'C++', 'result.traits should have a language trait with value "C++"');
        ok(result.traits.find((trait) => trait.name === 'language')?.includeInPrompt, 'result.traits should have a language trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'language')?.promptTextOverride === 'The language is C++.', 'result.traits should have a language trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'compiler'), 'result.traits should have a compiler trait');
        ok(result.traits.find((trait) => trait.name === 'compiler')?.value === 'MSVC', 'result.traits should have a compiler trait with value "MSVC"');
        ok(result.traits.find((trait) => trait.name === 'compiler')?.includeInPrompt, 'result.traits should have a compiler trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'compiler')?.promptTextOverride === 'This project compiles using MSVC.', 'result.traits should have a compiler trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'standardVersion'), 'result.traits should have a standardVersion trait');
        ok(result.traits.find((trait) => trait.name === 'standardVersion')?.value === 'C++20', 'result.traits should have a standardVersion trait with value "C++20"');
        ok(result.traits.find((trait) => trait.name === 'standardVersion')?.includeInPrompt, 'result.traits should have a standardVersion trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'standardVersion')?.promptTextOverride === 'This project uses the C++20 language standard.', 'result.traits should have a standardVersion trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform'), 'result.traits should have a targetPlatform trait');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform')?.value === 'Windows', 'result.traits should have a targetPlatform trait with value "Windows"');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform')?.includeInPrompt, 'result.traits should have a targetPlatform trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'targetPlatform')?.promptTextOverride === 'This build targets Windows.', 'result.traits should have a targetPlatform trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture'), 'result.traits should have a targetArchitecture trait');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture')?.value === 'x64', 'result.traits should have a targetArchitecture trait with value "x64"');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture')?.includeInPrompt, 'result.traits should have a targetArchitecture trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'targetArchitecture')?.promptTextOverride === 'This build targets x64.', 'result.traits should have a targetArchitecture trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'intelliSenseDisclaimerEnd'), 'result.traits should have a intellisenseEnd trait');
        ok(result.traits.find((trait) => trait.name === 'intelliSenseDisclaimerEnd')?.includeInPrompt, 'result.traits should have a intellisenseEnd trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'intelliSenseDisclaimerEnd')?.promptTextOverride === 'End of IntelliSense information.', 'result.traits should have a intellisenseEnd trait with promptTextOverride');
    });

    it('handles errors during provider registration.', async () => {
        arrange({});

        await moduleUnderTest.registerRelatedFilesProvider();

        ok(vscodeGetExtensionsStub.calledOnce, 'vscode.extensions.getExtension should be called once');
        ok(mockCopilotApi.registerRelatedFilesProvider.notCalled, 'registerRelatedFilesProvider should not be called');
    });

    const projectContext: ProjectContext = {
        language: 'C++',
        standardVersion: 'C++17',
        compiler: 'MSVC',
        targetPlatform: 'Windows',
        targetArchitecture: 'x64',
        compilerArguments: { "/std:c++\d+": '/std:c++17', "/GR-?": '/GR-', "/EH[ascr-]+": '/EHs-c-', "/await": '/await' }
    };

    it('provides compiler argument traits.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            projectContext: projectContext,
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: {
                copilotcppIncludeTraits: ['compilerArguments'],
                copilotcppMsvcCompilerArgumentFilter: '{"/std:c++\d+": "", "/GR-?": "", "/EH[ascr-]+": "", "/await": ""}'
            }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments'), 'result.traits should have a compiler arguments trait');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments')?.value === '/std:c++17, /GR-, /EHs-c-, /await', 'result.traits should have a compiler arguments trait with value "/std:c++17, /GR-, /EHs-c-, /await"');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments')?.includeInPrompt, 'result.traits should have a compiler arguments trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments')?.promptTextOverride === 'The compiler arguments include: /std:c++17, /GR-, /EHs-c-, /await.', 'result.traits should have a compiler arguments trait with promptTextOverride');
        ok(!result.traits.find((trait) => trait.name === 'directAsks'), 'result.traits should not have a direct asks trait');
    });

    it('provide direct ask traits of compiler arguments.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            projectContext: projectContext,
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: {
                copilotcppIncludeTraits: ['directAsks', 'compilerArguments'],
                copilotcppMsvcCompilerArgumentFilter: '{"/std:c++\d+": "", "/await": "", "/GR-?": "", "/EH[ascr-]+": ""}',
                copilotcppCompilerArgumentDirectAskMap: '{"/GR-": "Do not generate code using RTTI keywords.", "/EHs-c-": "Do not generate code using exception handling keywords."}'
            }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments'), 'result.traits should have a compiler arguments trait');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments')?.value === '/std:c++17, /await', 'result.traits should have a compiler arguments trait with value "/std:c++17, /await"');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments')?.includeInPrompt, 'result.traits should have a compiler arguments trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments')?.promptTextOverride === 'The compiler arguments include: /std:c++17, /await.', 'result.traits should have a compiler arguments trait with promptTextOverride');
        ok(result.traits.find((trait) => trait.name === 'directAsks'), 'result.traits should have a direct asks trait');
        ok(result.traits.find((trait) => trait.name === 'directAsks')?.value === 'Do not generate code using RTTI keywords. Do not generate code using exception handling keywords. ', 'result.traits should have a direct asks value');
        ok(result.traits.find((trait) => trait.name === 'directAsks')?.includeInPrompt, 'result.traits should have a direct asks trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'directAsks')?.promptTextOverride === 'Do not generate code using RTTI keywords. Do not generate code using exception handling keywords. ', 'result.traits should have a direct ask trait with promptTextOverride');
        ok(telemetryStub.calledOnce, 'Telemetry should be called once');
        ok(telemetryStub.calledWithMatch('RelatedFilesProvider', sinon.match({
            "includeTraits": 'directAsks,compilerArguments',
            'traits': 'standardVersion,compilerArguments,directAsks'
        }), sinon.match({
            'duration': sinon.match.number
        })));
    });

    it('ignore compilerArguments trait if empty.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            projectContext: projectContext,
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: {
                copilotcppIncludeTraits: ['directAsks', 'compilerArguments'],
                copilotcppMsvcCompilerArgumentFilter: '{"/std:c++\d+": "", "/await": "", "/GR-?": "", "/EH[ascr-]+": ""}',
                copilotcppCompilerArgumentDirectAskMap: '{"/GR-": "abc.", "/EHs-c-": "def.", "/std:c++17": "ghi.", "/await": "jkl."}'
            }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments') === undefined, 'result.traits should not have a compiler arguments trait');
        ok(result.traits.find((trait) => trait.name === 'directAsks'), 'result.traits should have a direct asks trait');
        ok(telemetryStub.calledOnce, 'Telemetry should be called once');
        ok(telemetryStub.calledWithMatch('RelatedFilesProvider', sinon.match({
            "includeTraits": 'directAsks,compilerArguments',
            'traits': 'standardVersion,directAsks'
        })));
    });

    it('uses only last argument from the duplicates.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            projectContext: {
                language: 'C++',
                standardVersion: 'C++20',
                compiler: 'MSVC',
                targetPlatform: 'Windows',
                targetArchitecture: 'x64',
                compilerArguments: { "/std:c++\d+": '/std:c++20', "/await": '/await' }
            },
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: {
                copilotcppIncludeTraits: ['compilerArguments'],
                copilotcppMsvcCompilerArgumentFilter: '{"/std:c++\d+": "", "/await": ""}'
            }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments'), 'result.traits should have a compiler arguments trait');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments')?.value === '/std:c++20, /await', 'result.traits should have a compiler arguments trait with value "/std:c++20, /await"');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments')?.includeInPrompt, 'result.traits should have a compiler arguments trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'compilerArguments')?.promptTextOverride === 'The compiler arguments include: /std:c++20, /await.', 'result.traits should have a compiler arguments trait with promptTextOverride');
    });

    it('provides direct asks trait for absence of arguments.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            projectContext: projectContextNoArgs,
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: {
                copilotcppIncludeTraits: ['directAsks'],
                copilotcppMsvcCompilerArgumentFilter:
                    '{"/FOO": "/FOO is not set.", "/BAR": "/BAR is not set."}'
            }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.find((trait) => trait.name === 'directAsks'), 'result.traits should have a direct asks trait');
        ok(result.traits.find((trait) => trait.name === 'directAsks')?.value === '/FOO is not set. /BAR is not set. ', 'result.traits should have a direct asks value');
        ok(result.traits.find((trait) => trait.name === 'directAsks')?.includeInPrompt, 'result.traits should have a direct asks trait with includeInPrompt true');
        ok(result.traits.find((trait) => trait.name === 'directAsks')?.promptTextOverride === "/FOO is not set. /BAR is not set. ", 'result.traits should have a direct ask trait with promptTextOverride');
    });

    it('does not accept empty regex.', async () => {
        arrange({
            vscodeExtension: vscodeExtension,
            getIncludeFiles: { includedFiles: ['c:\\system\\include\\vector', 'c:\\system\\include\\string', 'C:\\src\\my_project\\foo.h'] },
            projectContext: projectContextNoArgs,
            rootUri: vscode.Uri.file('C:\\src\\my_project'),
            flags: {
                copilotcppIncludeTraits: ['directAsks'],
                copilotcppMsvcCompilerArgumentFilter:
                    '{"": "Empty regex not allowed."}'
            }
        });
        await moduleUnderTest.registerRelatedFilesProvider();

        const result = await callbackPromise;

        ok(result, 'result should be defined');
        ok(result.traits, 'result.traits should be defined');
        ok(result.traits.find((trait) => trait.name === 'directAsks') === undefined, 'result.traits should not have a direct asks trait');
    });
});
