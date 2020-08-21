/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import {DefaultClient, GetFoldingRangesParams, GetFoldingRangesRequest, FoldingRangeKind, GetSemanticTokensParams, GetSemanticTokensRequest, openFileVersions, FormatParams, DocumentFormatRequest, cachedEditorConfigSettings} from './client';
import { CppSettings } from './settings';
import * as editorConfig from 'editorconfig';

let abortRequestId: number = 0;
export class FoldingRangeProvider implements vscode.FoldingRangeProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }
    provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext,
        token: vscode.CancellationToken): Promise<vscode.FoldingRange[]> {
        const id: number = ++abortRequestId;
        const params: GetFoldingRangesParams = {
            id: id,
            uri: document.uri.toString()
        };
        return new Promise<vscode.FoldingRange[]>((resolve, reject) => {
            this.client.notifyWhenReady(() => {
                this.client.languageClient.sendRequest(GetFoldingRangesRequest, params)
                    .then((ranges) => {
                        if (ranges.canceled) {
                            reject();
                        } else {
                            const result: vscode.FoldingRange[] = [];
                            ranges.ranges.forEach((r) => {
                                const foldingRange: vscode.FoldingRange = {
                                    start: r.range.start.line,
                                    end: r.range.end.line
                                };
                                switch (r.kind) {
                                    case FoldingRangeKind.Comment:
                                        foldingRange.kind = vscode.FoldingRangeKind.Comment;
                                        break;
                                    case FoldingRangeKind.Imports:
                                        foldingRange.kind = vscode.FoldingRangeKind.Imports;
                                        break;
                                    case FoldingRangeKind.Region:
                                        foldingRange.kind = vscode.FoldingRangeKind.Region;
                                        break;
                                    default:
                                        break;
                                }
                                result.push(foldingRange);
                            });
                            resolve(result);
                        }
                    });
                token.onCancellationRequested(e => this.client.abortRequest(id));
            });
        });
    }
}

export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    private client: DefaultClient;
    public onDidChangeSemanticTokensEvent = new vscode.EventEmitter<void>();
    public onDidChangeSemanticTokens?: vscode.Event<void>;
    private tokenCaches: Map<string, [number, vscode.SemanticTokens]> = new Map<string, [number, vscode.SemanticTokens]>();

    constructor(client: DefaultClient) {
        this.client = client;
        this.onDidChangeSemanticTokens = this.onDidChangeSemanticTokensEvent.event;
    }

    public async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
        return new Promise<vscode.SemanticTokens>((resolve, reject) => {
            this.client.notifyWhenReady(() => {
                const uriString: string = document.uri.toString();
                // First check the token cache to see if we already have results for that file and version
                const cache: [number, vscode.SemanticTokens] | undefined = this.tokenCaches.get(uriString);
                if (cache && cache[0] === document.version) {
                    resolve(cache[1]);
                } else {
                    const id: number = ++abortRequestId;
                    const params: GetSemanticTokensParams = {
                        id: id,
                        uri: uriString
                    };
                    this.client.languageClient.sendRequest(GetSemanticTokensRequest, params)
                        .then((tokensResult) => {
                            if (tokensResult.canceled) {
                                reject();
                            } else {
                                if (tokensResult.fileVersion !== openFileVersions.get(uriString)) {
                                    reject();
                                } else {
                                    const builder: vscode.SemanticTokensBuilder = new vscode.SemanticTokensBuilder(this.client.semanticTokensLegend);
                                    tokensResult.tokens.forEach((token) => {
                                        builder.push(token.line, token.character, token.length, token.type, token.modifiers);
                                    });
                                    const tokens: vscode.SemanticTokens = builder.build();
                                    this.tokenCaches.set(uriString, [tokensResult.fileVersion, tokens]);
                                    resolve(tokens);
                                }
                            }
                        });
                    token.onCancellationRequested(e => this.client.abortRequest(id));
                }
            });
        });
    }

    public invalidateFile(uri: string): void {
        this.tokenCaches.delete(uri);
        this.onDidChangeSemanticTokensEvent.fire();
    }
}


export class DocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        return new Promise<vscode.TextEdit[]>((resolve, reject) => {
            this.client.notifyWhenReady(() => {
                const filePath: string = document.uri.fsPath;
                const configCallBack = (editorConfigSettings: any | undefined) => {
                    const params: FormatParams = {
                        settings: { ...editorConfigSettings },
                        uri: document.uri.toString(),
                        insertSpaces: options.insertSpaces,
                        tabSize: options.tabSize,
                        character: "",
                        range: {
                            start: {
                                character: 0,
                                line: 0
                            },
                            end: {
                                character: 0,
                                line: 0
                            }
                        }
                    };
                    return this.client.languageClient.sendRequest(DocumentFormatRequest, params)
                        .then((textEdits) => {
                            const result: vscode.TextEdit[] = [];
                            textEdits.forEach((textEdit) => {
                                result.push({
                                    range: new vscode.Range(textEdit.range.start.line, textEdit.range.start.character, textEdit.range.end.line, textEdit.range.end.character),
                                    newText: textEdit.newText
                                });
                            });
                            resolve(result);
                        });
                };
                const settings: CppSettings = new CppSettings();
                if (settings.formattingEngine !== "vcFormat") {
                    configCallBack(undefined);
                } else {
                    const editorConfigSettings: any = cachedEditorConfigSettings.get(filePath);
                    if (!editorConfigSettings) {
                        editorConfig.parse(filePath).then(configCallBack);
                    } else {
                        cachedEditorConfigSettings.set(filePath, editorConfigSettings);
                        configCallBack(editorConfigSettings);
                    }
                }
            });
        });
    }
}

export class DocumentRangeFormattingEditProvider implements vscode.DocumentRangeFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        return new Promise<vscode.TextEdit[]>((resolve, reject) => {
            this.client.notifyWhenReady(() => {
                const filePath: string = document.uri.fsPath;
                const configCallBack = (editorConfigSettings: any | undefined) => {
                    const params: FormatParams = {
                        settings: { ...editorConfigSettings },
                        uri: document.uri.toString(),
                        insertSpaces: options.insertSpaces,
                        tabSize: options.tabSize,
                        character: "",
                        range: {
                            start: {
                                character: range.start.character,
                                line: range.start.line
                            },
                            end: {
                                character: range.end.character,
                                line: range.end.line
                            }
                        }
                    };
                    return this.client.languageClient.sendRequest(DocumentFormatRequest, params)
                        .then((textEdits) => {
                            const result: vscode.TextEdit[] = [];
                            textEdits.forEach((textEdit) => {
                                result.push({
                                    range: new vscode.Range(textEdit.range.start.line, textEdit.range.start.character, textEdit.range.end.line, textEdit.range.end.character),
                                    newText: textEdit.newText
                                });
                            });
                            resolve(result);
                        });
                };
                const settings: CppSettings = new CppSettings();
                if (settings.formattingEngine !== "vcFormat") {
                    configCallBack(undefined);
                } else {
                    const editorConfigSettings: any = cachedEditorConfigSettings.get(filePath);
                    if (!editorConfigSettings) {
                        editorConfig.parse(filePath).then(configCallBack);
                    } else {
                        cachedEditorConfigSettings.set(filePath, editorConfigSettings);
                        configCallBack(editorConfigSettings);
                    }
                }
            });
        });
    };
}

export class OnTypeFormattingEditProvider implements vscode.OnTypeFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public provideOnTypeFormattingEdits(document: vscode.TextDocument, position: vscode.Position, ch: string, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        return new Promise<vscode.TextEdit[]>((resolve, reject) => {
            this.client.notifyWhenReady(() => {
                const filePath: string = document.uri.fsPath;
                const configCallBack = (editorConfigSettings: any | undefined) => {
                    const params: FormatParams = {
                        settings: { ...editorConfigSettings },
                        uri: document.uri.toString(),
                        insertSpaces: options.insertSpaces,
                        tabSize: options.tabSize,
                        character: ch,
                        range: {
                            start: {
                                character: position.character,
                                line: position.line
                            },
                            end: {
                                character: 0,
                                line: 0
                            }
                        }
                    };
                    return this.client.languageClient.sendRequest(DocumentFormatRequest, params)
                        .then((textEdits) => {
                            const result: vscode.TextEdit[] = [];
                            textEdits.forEach((textEdit) => {
                                result.push({
                                    range: new vscode.Range(textEdit.range.start.line, textEdit.range.start.character, textEdit.range.end.line, textEdit.range.end.character),
                                    newText: textEdit.newText
                                });
                            });
                            resolve(result);
                        });
                };
                const settings: CppSettings = new CppSettings();
                if (settings.formattingEngine !== "vcFormat") {
                    // If not using vcFormat, only process on-type requests for ';'
                    if (ch !== ';') {
                        const result: vscode.TextEdit[] = [];
                        resolve(result);
                    } else {
                        configCallBack(undefined);
                    }
                } else {
                    const editorConfigSettings: any = cachedEditorConfigSettings.get(filePath);
                    if (!editorConfigSettings) {
                        editorConfig.parse(filePath).then(configCallBack);
                    } else {
                        cachedEditorConfigSettings.set(filePath, editorConfigSettings);
                        configCallBack(editorConfigSettings);
                    }
                }
            });
        });
    }
}
