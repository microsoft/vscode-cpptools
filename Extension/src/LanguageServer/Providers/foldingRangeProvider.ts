/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, GetFoldingRangesParams, GetFoldingRangesRequest, FoldingRangeKind, GetFoldingRangesResult, CppFoldingRange } from '../client';
import { CppSettings } from '../settings';

export class FoldingRangeProvider implements vscode.FoldingRangeProvider {
    private client: DefaultClient;
    public onDidChangeFoldingRangesEvent = new vscode.EventEmitter<void>();
    public onDidChangeFoldingRanges?: vscode.Event<void>;
    constructor(client: DefaultClient) {
        this.client = client;
        this.onDidChangeFoldingRanges = this.onDidChangeFoldingRangesEvent.event;
    }
    async provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken): Promise<vscode.FoldingRange[] | undefined> {
        const settings: CppSettings = new CppSettings();
        if (!settings.codeFolding) {
            return [];
        }
        const params: GetFoldingRangesParams = {
            uri: document.uri.toString()
        };
        await this.client.awaitUntilLanguageClientReady();
        const ranges: GetFoldingRangesResult = await this.client.languageClient.sendRequest(GetFoldingRangesRequest, params, token);
        if (token.isCancellationRequested || ranges.canceled) {
            throw new vscode.CancellationError();
        }
        const result: vscode.FoldingRange[] = [];
        ranges.ranges.forEach((r: CppFoldingRange) => {
            const foldingRange: vscode.FoldingRange = {
                start: r.range.startLine,
                end: r.range.endLine
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
        return result;
    }

    public refresh(): void {
        this.onDidChangeFoldingRangesEvent.fire();
    }
}
