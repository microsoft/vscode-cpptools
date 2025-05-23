/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ok } from 'assert';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as util from '../../../../src/common';
import { ChatContextResult, DefaultClient } from '../../../../src/LanguageServer/client';
import { ClientCollection } from '../../../../src/LanguageServer/clientCollection';
import * as extension from '../../../../src/LanguageServer/extension';
import { CppConfigurationLanguageModelTool, getProjectContext } from '../../../../src/LanguageServer/lmTool';
import * as telemetry from '../../../../src/telemetry';

describe('CppConfigurationLanguageModelTool Tests', () => {
    let mockLanguageModelToolInvocationOptions: sinon.SinonStubbedInstance<vscode.LanguageModelToolInvocationOptions<void>>;
    let activeClientStub: sinon.SinonStubbedInstance<DefaultClient>;
    let mockTextEditorStub: MockTextEditor;
    let mockTextDocumentStub: sinon.SinonStubbedInstance<vscode.TextDocument>;
    let telemetryStub: sinon.SinonStub;

    class MockLanguageModelToolInvocationOptions implements vscode.LanguageModelToolInvocationOptions<void> {
        tokenizationOptions?: vscode.LanguageModelToolTokenizationOptions | undefined;
        toolInvocationToken: undefined;
        input: undefined;
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
            this.encoding = '';
        }
        fileName: string;
        isUntitled: boolean;
        languageId: string;
        version: number;
        isDirty: boolean;
        isClosed: boolean;
        encoding: string;
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
        telemetryStub = sinon.stub(telemetry, 'logCopilotEvent').returns();
    });

    afterEach(() => {
        sinon.restore();
    });

    const arrangeChatContextFromCppTools = ({ chatContextFromCppTools, isCpp, isHeaderFile }:
        { chatContextFromCppTools?: ChatContextResult; isCpp?: boolean; isHeaderFile?: boolean } =
        { chatContextFromCppTools: undefined, isCpp: undefined, isHeaderFile: false }
    ) => {
        activeClientStub.getChatContext.resolves(chatContextFromCppTools);
        sinon.stub(util, 'isCpp').returns(isCpp ?? true);
        sinon.stub(util, 'isHeaderFile').returns(isHeaderFile ?? false);
    };

    it('should log telemetry and provide #cpp chat context.', async () => {
        arrangeChatContextFromCppTools({
            chatContextFromCppTools: {
                language: 'cpp',
                standardVersion: 'c++20',
                compiler: 'msvc',
                targetPlatform: 'windows',
                targetArchitecture: 'x64',
                usedTestFrameworks: ['GTest', 'Catch2']
            }
        });

        const result = await new CppConfigurationLanguageModelTool().invoke(mockLanguageModelToolInvocationOptions, new vscode.CancellationTokenSource().token);

        ok(telemetryStub.calledOnce, 'Telemetry should be called once');
        ok(telemetryStub.calledWithMatch('Chat/Tool/cpp', sinon.match({
            "language": 'C++',
            "compiler": 'MSVC',
            "standardVersion": 'C++20',
            "targetPlatform": 'Windows',
            "targetArchitecture": 'x64',
            'testFrameworks': 'GTest, Catch2'
        })));
        ok(result, 'result should not be undefined');
        const text = result.content[0] as vscode.LanguageModelTextPart;
        ok(text, 'result should contain a text part');
        const traits_text = `The user is working on a C++ project. The project uses language version C++20. The project compiles using the MSVC compiler. The project targets the Windows platform. The project targets the x64 architecture. The project uses the following C++ test frameworks: GTest, Catch2. `;
        ok(text.value === traits_text);
    });

    const testGetProjectContext = async ({
        compiler,
        expectedCompiler,
        context,
        telemetryProperties,
        telemetryMetrics
    }: {
        compiler: string;
        expectedCompiler: string;
        context: { flags: Record<string, unknown> };
        telemetryProperties: Record<string, string>;
        telemetryMetrics: Record<string, number>;
    }) => {
        arrangeChatContextFromCppTools({
            chatContextFromCppTools: {
                language: 'cpp',
                standardVersion: 'c++20',
                compiler: compiler,
                targetPlatform: 'windows',
                targetArchitecture: 'x64',
                usedTestFrameworks: []
            }
        });

        const result = await getProjectContext(mockTextDocumentStub.uri, context, new vscode.CancellationTokenSource().token, telemetryProperties, telemetryMetrics);

        ok(result, 'result should not be undefined');
        ok(result.language === 'C++');
        ok(result.compiler === expectedCompiler);
        ok(result.standardVersion === 'C++20');
        ok(result.targetPlatform === 'Windows');
        ok(result.targetArchitecture === 'x64');
    };

    it('should send telemetry.', async () => {
        const telemetryProperties: Record<string, string> = {};
        const telemetryMetrics: Record<string, number> = {};
        const input = {
            compiler: 'msvc',
            expectedCompiler: 'MSVC',
            context: { flags: {} },
            telemetryProperties,
            telemetryMetrics
        };
        await testGetProjectContext(input);

        ok(telemetryProperties['language'] === 'C++');
        ok(telemetryProperties['compiler'] === input.expectedCompiler);
        ok(telemetryProperties['standardVersion'] === 'C++20');
        ok(telemetryProperties['targetPlatform'] === 'Windows');
        ok(telemetryProperties['targetArchitecture'] === 'x64');
        ok(telemetryMetrics['projectContextDuration'] !== undefined);
    });

    it('should not send telemetry for unknown values', async () => {
        arrangeChatContextFromCppTools({
            chatContextFromCppTools: {
                language: 'java',
                standardVersion: 'gnu++17',
                compiler: 'javac',
                targetPlatform: 'arduino',
                targetArchitecture: 'bar',
                usedTestFrameworks: []
            }
        });
        const telemetryProperties: Record<string, string> = {};
        const telemetryMetrics: Record<string, number> = {};

        const result = await getProjectContext(mockTextDocumentStub.uri, {
            flags: {}
        }, new vscode.CancellationTokenSource().token, telemetryProperties, telemetryMetrics);

        ok(telemetryProperties["targetArchitecture"] === 'bar');
        ok(telemetryProperties["language"] === undefined);
        ok(telemetryProperties["compiler"] === undefined);
        ok(telemetryProperties["standardVersion"] === undefined);
        ok(telemetryProperties["originalStandardVersion"] === 'gnu++17');
        ok(telemetryProperties["targetPlatform"] === undefined);
        ok(result, 'result should not be undefined');
        ok(result.language === '');
        ok(result.compiler === '');
        ok(result.standardVersion === '');
        ok(result.targetPlatform === '');
        ok(result.targetArchitecture === 'bar');
    });
});
