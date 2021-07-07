/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, GetFoldingRangesParams, GetFoldingRangesRequest, FoldingRangeKind, GetFoldingRangesResult, CppFoldingRange } from '../client';

export class FoldingRangeProvider implements vscode.FoldingRangeProvider {
    private client: DefaultClient;
    public onDidChangeFoldingRangesEvent = new vscode.EventEmitter<void>();
    public onDidChangeFoldingRanges?: vscode.Event<void>;
    constructor(client: DefaultClient) {
        this.client = client;
        this.onDidChangeFoldingRanges = this.onDidChangeFoldingRangesEvent.event;
    }
    async provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext,
        token: vscode.CancellationToken): Promise<vscode.FoldingRange[] | undefined> {
        const id: number = ++DefaultClient.abortRequestId;
        const params: GetFoldingRangesParams = {
            id: id,
            uri: document.uri.toString()
        };
        await this.client.awaitUntilLanguageClientReady();
        token.onCancellationRequested(e => this.client.abortRequest(id));
        const ranges: GetFoldingRangesResult = await this.client.languageClient.sendRequest(GetFoldingRangesRequest, params);
        if (ranges.canceled) {
            return undefined;
        }
        const result: vscode.FoldingRange[] = [];
        ranges.ranges.forEach((r: CppFoldingRange, index: number, array: CppFoldingRange[]) => {
            let nextNonNestedIndex: number = index + 1; // Skip over nested if's.
            for (; nextNonNestedIndex < array.length; ++nextNonNestedIndex) {
                if (array[nextNonNestedIndex].range.start.line >= r.range.end.line) {
                    break;
                }
            }
            const foldingRange: vscode.FoldingRange = {
                start: r.range.start.line,
                // Move the end range up one if it overlaps with the next start range, because
                // VS Code doesn't support column-based folding: https://github.com/microsoft/vscode/issues/50840
                end: r.range.end.line - (nextNonNestedIndex >= array.length ? 0 :
                    (array[nextNonNestedIndex].range.start.line !== r.range.end.line ? 0 : 1))
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
