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
import { ChatContextResult, DefaultClient } from '../../../../src/LanguageServer/client';
import { ClientCollection } from '../../../../src/LanguageServer/clientCollection';
import * as extension from '../../../../src/LanguageServer/extension';
import * as telemetry from '../../../../src/telemetry';

describe('CppConfigurationLanguageModelTool Tests', () => {
    let moduleUnderTest: any;
    let mockLanguageModelToolInvocationOptions: sinon.SinonStubbedInstance<vscode.LanguageModelToolInvocationOptions>;
    let activeClientStub: sinon.SinonStubbedInstance<DefaultClient>;
    let mockTextEditorStub: MockTextEditor;
    let mockTextDocumentStub: sinon.SinonStubbedInstance<vscode.TextDocument>;
    let logLanguageModelToolEventStub: sinon.SinonStub;

    class MockLanguageModelToolInvocationOptions implements vscode.LanguageModelToolInvocationOptions {
        toolInvocationToken: unknown;
        parameters: object = {};
        requestedContentTypes: string[] = [];
        tokenOptions?: { tokenBudget: number; countTokens(text: string, token?: vscode.CancellationToken): Thenable<number> } | undefined;
    }
    class MockTextEditor implements vscode.TextEditor {
        constructor(selection: vscode.Selection, selections: readonly vscode.Selection[], visibleRanges: readonly vscode.Range[], options: vscode.TextEditorOptions, document: vscode.TextDocument, viewColumn?: vscode.ViewColumn) {
            this.selection = selection;
            this.selections = selections;
            this.visibleRanges = visibleRanges;
            this.options = options;
            this.viewColumn = viewColumn;
            this.document = document;
        }
        selection: vscode.Selection;
        selections: readonly vscode.Selection[];
        visibleRanges: readonly vscode.Range[];
        options: vscode.TextEditorOptions;
        viewColumn: vscode.ViewColumn | undefined;
        edit(_callback: (editBuilder: vscode.TextEditorEdit) => void, _options?: { readonly undoStopBefore: boolean; readonly undoStopAfter: boolean }): Thenable<boolean> {
            throw new Error('Method not implemented.');
        }
        insertSnippet(_snippet: vscode.SnippetString, _location?: vscode.Position | vscode.Range | readonly vscode.Position[] | readonly vscode.Range[], _options?: { readonly undoStopBefore: boolean; readonly undoStopAfter: boolean }): Thenable<boolean> {
            throw new Error('Method not implemented.');
        }
        setDecorations(_decorationType: vscode.TextEditorDecorationType, _rangesOrOptions: readonly vscode.Range[] | readonly vscode.DecorationOptions[]): void {
            throw new Error('Method not implemented.');
        }
        revealRange(_range: vscode.Range, _revealType?: vscode.TextEditorRevealType): void {
            throw new Error('Method not implemented.');
        }
        show(_column?: vscode.ViewColumn): void {
            throw new Error('Method not implemented.');
        }
        hide(): void {
            throw new Error('Method not implemented.');
        }
        document: vscode.TextDocument;
    }
    class MockTextDocument implements vscode.TextDocument {
        uri: vscode.Uri;
        constructor(uri: vscode.Uri, fileName: string, isUntitled: boolean, languageId: string, version: number, isDirty: boolean, isClosed: boolean, eol: vscode.EndOfLine, lineCount: number) {
            this.uri = uri;
            this.fileName = fileName;
            this.isUntitled = isUntitled;
            this.languageId = languageId;
            this.version = version;
            this.isDirty = isDirty;
            this.isClosed = isClosed;
            this.eol = eol;
            this.lineCount = lineCount;
        }
        fileName: string;
        isUntitled: boolean;
        languageId: string;
        version: number;
        isDirty: boolean;
        isClosed: boolean;
        save(): Thenable<boolean> {
            throw new Error('Method not implemented.');
        }
        eol: vscode.EndOfLine;
        lineCount: number;

        lineAt(line: number): vscode.TextLine;
        // eslint-disable-next-line @typescript-eslint/unified-signatures
        lineAt(position: vscode.Position): vscode.TextLine;
        lineAt(_arg: number | vscode.Position): vscode.TextLine {
            throw new Error('Method not implemented.');
        }
        offsetAt(_position: vscode.Position): number {
            throw new Error('Method not implemented.');
        }
        positionAt(_offset: number): vscode.Position {
            throw new Error('Method not implemented.');
        }
        getText(_range?: vscode.Range): string {
            throw new Error('Method not implemented.');
        }
        getWordRangeAtPosition(_position: vscode.Position, _regex?: RegExp): vscode.Range | undefined {
            throw new Error('Method not implemented.');
        }
        validateRange(_range: vscode.Range): vscode.Range {
            throw new Error('Method not implemented.');
        }
        validatePosition(_position: vscode.Position): vscode.Position {
            throw new Error('Method not implemented.');
        }
    }
    beforeEach(() => {
        proxyquire.noPreserveCache(); // Tells proxyquire to not fetch the module from cache
        // Ensures that each test has a freshly loaded instance of moduleUnderTest
        moduleUnderTest = proxyquire(
            '../../../../src/LanguageServer/lmTool',
            {} // Stub if you need to, or keep the object empty
        );

        sinon.stub(util, 'extensionContext').value({ extension: { id: 'test-extension-id' } });

        mockTextDocumentStub = sinon.createStubInstance(MockTextDocument);
        mockTextEditorStub = new MockTextEditor(new vscode.Selection(0, 0, 0, 0), [], [], { tabSize: 4 }, mockTextDocumentStub);
        mockLanguageModelToolInvocationOptions = new MockLanguageModelToolInvocationOptions();
        activeClientStub = sinon.createStubInstance(DefaultClient);
        const clientsStub = sinon.createStubInstance(ClientCollection);
        sinon.stub(extension, 'getClients').returns(clientsStub);
        sinon.stub(clientsStub, 'ActiveClient').get(() => activeClientStub);
        activeClientStub.getIncludes.resolves({ includedFiles: [] });
        sinon.stub(vscode.window, 'activeTextEditor').get(() => mockTextEditorStub);
        logLanguageModelToolEventStub = sinon.stub(telemetry, 'logLanguageModelToolEvent').returns();
    });

    afterEach(() => {
        sinon.restore();
    });

    const arrange = ({ chatContext, requestedContentTypes }:
    { chatContext?: ChatContextResult; requestedContentTypes: string[] } =
    { chatContext: undefined, requestedContentTypes: [] }
    ) => {
        activeClientStub.getChatContext.resolves(chatContext);
        mockLanguageModelToolInvocationOptions.requestedContentTypes = requestedContentTypes;
        sinon.stub(util, 'isCpp').returns(true);
        sinon.stub(util, 'isHeaderFile').returns(false);
    };

    it('should provide cpp context.', async () => {
        arrange({
            requestedContentTypes: ['text/plain'],
            chatContext: {
                language: 'c++',
                standardVersion: 'c++20',
                compiler: 'msvc',
                targetPlatform: 'windows',
                targetArchitecture: 'x64'
            }
        });

        const result = await new moduleUnderTest.CppConfigurationLanguageModelTool().invoke(mockLanguageModelToolInvocationOptions, new vscode.CancellationTokenSource().token);

        ok(result['text/plain'], 'result should contain a text/plain entry');
        ok(result['text/plain'] === 'The user is working on a c++ project. The project uses language version C++20, compiles using the MSVC compiler, targets the Windows platform, and targets the x64 architecture.');
        ok(logLanguageModelToolEventStub.calledOnce, 'logLanguageModelToolEvent should be called once');
        ok(logLanguageModelToolEventStub.calledWithMatch('cpp', sinon.match({
            "language": "c++",
            "compiler": "msvc",
            "standardVersion": "c++20",
            "targetPlatform": "windows",
            "targetArchitecture": "x64"
        })));
    });

    it('should provide cpp context.', async () => {
        arrange({
            requestedContentTypes: ['text/plain'],
            chatContext: {
                language: 'c++',
                standardVersion: 'c++20',
                compiler: 'msvc',
                targetPlatform: 'windows',
                targetArchitecture: 'x64',
                compilerArgs: ['/std:c++17', '/permissive-'],
                compilerUserDefines: ['DEBUG', 'TEST']
            }
        });

        const result: vscode.LanguageModelToolResult = await new moduleUnderTest.CppConfigurationLanguageModelTool().invoke(mockLanguageModelToolInvocationOptions, new vscode.CancellationTokenSource().token);

        ok(result['text/plain'], 'result should contain a text/plain entry');
        ok(result['text/plain'] === 'The user is working on a c++ project. The project uses language version C++20, compiles using the MSVC compiler, targets the Windows platform, and targets the x64 architecture.');
        ok(logLanguageModelToolEventStub.calledOnce, 'logLanguageModelToolEvent should be called once');
        ok(logLanguageModelToolEventStub.calledWithMatch('cpp', sinon.match({
            "language": "c++",
            "compiler": "msvc",
            "standardVersion": "c++20",
            "targetPlatform": "windows",
            "targetArchitecture": "x64",
            "compilerArgs": "/std:c++17 /permissive-",
            "compilerUserDefines": "DEBUG, TEST"
        })));
    });
});
