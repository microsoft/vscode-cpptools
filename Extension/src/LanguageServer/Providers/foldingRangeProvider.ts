/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { ManualPromise } from '../../Utility/Async/manualPromise';
import { CppFoldingRange, DefaultClient, FoldingRangeKind, GetFoldingRangesParams, GetFoldingRangesRequest, GetFoldingRangesResult } from '../client';
import { CppSettings } from '../settings';

interface FoldingRangeRequestInfo {
    promise: ManualPromise<vscode.FoldingRange[] | undefined> | undefined;
}

export class FoldingRangeProvider implements vscode.FoldingRangeProvider {
    private client: DefaultClient;
    public onDidChangeFoldingRangesEvent = new vscode.EventEmitter<void>();
    public onDidChangeFoldingRanges?: vscode.Event<void>;

    // Mitigate an issue where VS Code sends us an inordinate number of requests
    // for the same file without waiting for the prior request to complete or cancelling them.
    private pendingRequests: Map<string, FoldingRangeRequestInfo> = new Map<string, FoldingRangeRequestInfo>();

    constructor(client: DefaultClient) {
        this.client = client;
        this.onDidChangeFoldingRanges = this.onDidChangeFoldingRangesEvent.event;
    }
    async provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken): Promise<vscode.FoldingRange[] | undefined> {
        await this.client.ready;
        const settings: CppSettings = new CppSettings();
        if (!settings.codeFolding) {
            return [];
        }

        const pendingRequest: FoldingRangeRequestInfo | undefined = this.pendingRequests.get(document.uri.toString());
        if (pendingRequest !== undefined) {
            if (pendingRequest.promise === undefined) {
                pendingRequest.promise = new ManualPromise<vscode.FoldingRange[] | undefined>();
            }
            console.log("Redundant folding ranges request received for: " + document.uri.toString());
            return pendingRequest.promise;
        }
        const foldingRangeRequestInfo: FoldingRangeRequestInfo = {
            promise: undefined
        };
        this.pendingRequests.set(document.uri.toString(), foldingRangeRequestInfo);

        const promise: Promise<vscode.FoldingRange[] | undefined> = this.requestRanges(document.uri.toString(), token);
        await promise;
        this.pendingRequests.delete(document.uri.toString());
        if (foldingRangeRequestInfo.promise !== undefined) {
            promise.then(() => {
                foldingRangeRequestInfo.promise?.resolve(promise);
            }, () => {
                foldingRangeRequestInfo.promise?.reject(new vscode.CancellationError());
            });
        }
        return promise;
    }

    private async requestRanges(uri: string, token: vscode.CancellationToken): Promise<vscode.FoldingRange[] | undefined>
    {
        const params: GetFoldingRangesParams = {
            uri
        };

        const response: GetFoldingRangesResult = await this.client.languageClient.sendRequest(GetFoldingRangesRequest, params, token);
        if (token.isCancellationRequested || response.ranges === undefined) {
            throw new vscode.CancellationError();
        }
        const result: vscode.FoldingRange[] = [];
        response.ranges.forEach((r: CppFoldingRange) => {
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
        // Consider all pending requests as being outdated. Cancel them all.
        const oldPendingRequests: Map<string, FoldingRangeRequestInfo> = this.pendingRequests;
        this.pendingRequests = new Map<string, FoldingRangeRequestInfo>();
        this.onDidChangeFoldingRangesEvent.fire();
        oldPendingRequests.forEach((value: FoldingRangeRequestInfo | undefined, _key: string) => {
            if (value !== undefined && value.promise !== undefined) {
                value.promise.reject(new vscode.CancellationError());
            }
        });
    }
}
