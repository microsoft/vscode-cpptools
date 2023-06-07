/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import * as path from 'path';
import * as Telemetry from '../../telemetry';
import { DefaultClient, workspaceReferences } from '../client';
import { processDelayedDidOpen } from '../extension';
import { CallHierarchyResultCallback, CancellationSender } from '../references';
import { Position, Range, RequestType, TextDocumentIdentifier } from 'vscode-languageclient';
import { makeVscodeRange } from '../utils';

interface CallHierarchyItem {
    /**
     * The name of this item or symbol.
     */
    name: string;

    /**
     * The kind of this item.
     */
    kind: vscode.SymbolKind;

    /**
     * More detail for this item, e.g. the scope or class of a function.
     */
    detail: string;

    /**
     * The resource identifier of this item.
     */
    uri: string;

    /**
     * The range enclosing this symbol not including leading/trailing whitespace but everything else, e.g. comments and code.
     */
    range: Range;

    /**
     * The range that should be selected and revealed when this symbol is being picked, e.g. the name of a function.
     * Must be contained by the `CallHierarchyItem.range`.
     */
    selectionRange: Range;
}

export interface CallHierarchyParams {
    textDocument: TextDocumentIdentifier;
    position: Position;
}

interface CallHierarchyItemResult {
    item?: CallHierarchyItem;

    /**
     * If a request is cancelled, `succeeded` will be undefined to indicate no result was returned.
     * Therfore, object is not defined as optional on the language server.
     */
    succeeded: boolean;
}

interface CallHierarchyCallsItem {
    /**
     * For CallHierarchyIncomingCall or calls to, this is the item that makes the call.
     * For CallHierarchyOutgoingCall or calls from, this is the item that is called.
     */
    item: CallHierarchyItem;

    /**
     * For CallHierarchyIncomingCall or calls to, this is the range at which the call appears.
     * For CallHierarchyOutgoingCall or calls from, this is the range at which this item is called.
     */
    fromRanges: Range[];
}

export interface CallHierarchyCallsItemResult {
    calls: CallHierarchyCallsItem[];
}

enum CallHierarchyRequestStatus {
    Unknown,
    Succeeded,
    Canceled,
    CaneledByUser,
    Failed
}

const CallHierarchyItemRequest: RequestType<CallHierarchyParams, CallHierarchyItemResult, void> =
    new RequestType<CallHierarchyParams, CallHierarchyItemResult, void>('cpptools/prepareCallHierarchy');

const CallHierarchyCallsFromRequest: RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void> =
    new RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void>('cpptools/callHierarchyCallsFrom');

export class CallHierarchyProvider implements vscode.CallHierarchyProvider {
    // Indicates whether a request is from an entry root node (e.g. top function in the call tree).
    private isEntryRootNodeTelemetry: boolean = false;
    private client: DefaultClient;

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async prepareCallHierarchy(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Promise<vscode.CallHierarchyItem | undefined> {
        workspaceReferences.clearViews();
        const range: vscode.Range | undefined = document.getWordRangeAtPosition(position);
        if (range === undefined) {
            return undefined;
        }

        await this.client.requestWhenReady(() => processDelayedDidOpen(document));

        const params: CallHierarchyParams = {
            textDocument: { uri: document.uri.toString() },
            position: Position.create(position.line, position.character)
        };
        const response: CallHierarchyItemResult = await this.client.languageClient.sendRequest(CallHierarchyItemRequest, params, token);
        if (token.isCancellationRequested || response.succeeded === undefined) {
            throw new vscode.CancellationError();
        } else if (response.item === undefined) {
            return undefined;
        }

        this.isEntryRootNodeTelemetry = true;
        return this.makeVscodeCallHierarchyItem(response.item);
    }

    public async provideCallHierarchyIncomingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken):
        Promise<vscode.CallHierarchyIncomingCall[] | undefined | any> {
        await this.client.awaitUntilLanguageClientReady();

        // Cancel any current reference requests by firing a cancellation event to listeners.
        workspaceReferences.cancelCurrentReferenceRequest(CancellationSender.NewRequest);

        const CallHierarchyCallsToEvent: string = "CallHierarchyCallsTo";
        if (item === undefined) {
            this.logTelemetry(CallHierarchyCallsToEvent, CallHierarchyRequestStatus.Failed);
            return undefined;
        }

        // Listen to VS Code cancellation.
        let requestCanceled: CancellationSender = CancellationSender.None;
        token.onCancellationRequested(e => { requestCanceled = CancellationSender.ProviderToken; });

        // Process the request.
        return new Promise<vscode.CallHierarchyIncomingCall[] | undefined | any>((resolve, reject) => {
            // Listen to cancellation from an incoming new request, user or language server.
            workspaceReferences.onCancellationRequested(sender => { requestCanceled = sender; });

            // Define the callback that will process results.
            const resultCallback: CallHierarchyResultCallback = (result: CallHierarchyCallsItemResult | null, progressBarDuration?: number) => {
                if (requestCanceled !== CancellationSender.None || result === null || result?.calls === undefined) {
                    const requestStatus: CallHierarchyRequestStatus = requestCanceled === CancellationSender.User ?
                        CallHierarchyRequestStatus.CaneledByUser : CallHierarchyRequestStatus.Canceled;
                    this.logTelemetry(CallHierarchyCallsToEvent, requestStatus, progressBarDuration);

                    reject(new vscode.CancellationError());
                } else {
                    this.logTelemetry(CallHierarchyCallsToEvent, CallHierarchyRequestStatus.Succeeded, progressBarDuration);

                    if (result?.calls.length === 0) {
                        resolve(undefined);
                    } else {
                        resolve(this.createIncomingCalls(result.calls));
                    }
                }
                return;
            };

            if (requestCanceled === CancellationSender.None) {
                workspaceReferences.setCallHierarchyResultsCallback(resultCallback);

                // Send the request to language server.
                const params: CallHierarchyParams = {
                    textDocument: { uri: item.uri.toString() },
                    position: Position.create(item.range.start.line, item.range.start.character)
                };
                workspaceReferences.startCallHierarchyIncomingCalls(params);
            } else {
                // Only complete the request at this point if the request to language server
                // has not been sent. Otherwise, the cancellation is handled when language
                // server has completed/canceled its processing and sends the results.
                resultCallback(null, 0);
            }
        });
    }

    public async provideCallHierarchyOutgoingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken):
        Promise<vscode.CallHierarchyOutgoingCall[] | undefined> {
        const CallHierarchyCallsFromEvent: string = "CallHierarchyCallsFrom";
        if (item === undefined) {
            this.logTelemetry(CallHierarchyCallsFromEvent, CallHierarchyRequestStatus.Failed);
            return undefined;
        }

        await this.client.awaitUntilLanguageClientReady();

        let result: vscode.CallHierarchyOutgoingCall[] | undefined;
        const params: CallHierarchyParams = {
            textDocument: { uri: item.uri.toString() },
            position: Position.create(item.range.start.line, item.range.start.character)
        };

        const response: CallHierarchyCallsItemResult = await this.client.languageClient.sendRequest(CallHierarchyCallsFromRequest, params, token);
        if (token.isCancellationRequested || response.calls === undefined) {
            this.logTelemetry(CallHierarchyCallsFromEvent, CallHierarchyRequestStatus.Canceled);
            throw new vscode.CancellationError();
        } else if (response.calls.length !== 0) {
            result = this.createOutgoingCalls(response.calls);
        }

        this.logTelemetry(CallHierarchyCallsFromEvent, CallHierarchyRequestStatus.Succeeded);
        return result;
    }

    private makeVscodeCallHierarchyItem(item: CallHierarchyItem): vscode.CallHierarchyItem {
        const containerDetail: string = (item.detail !== "") ? `${item.detail} - ` : "";
        const fileDetail: string = `${path.basename(item.uri)} (${path.dirname(item.uri)})`;
        return new vscode.CallHierarchyItem(
            item.kind, item.name, containerDetail + fileDetail,
            vscode.Uri.file(item.uri),
            makeVscodeRange(item.range),
            makeVscodeRange(item.selectionRange));
    }

    private createIncomingCalls(calls: CallHierarchyCallsItem[]): vscode.CallHierarchyIncomingCall[] {
        const result: vscode.CallHierarchyIncomingCall[] = [];

        for (const call of calls) {
            const item: vscode.CallHierarchyItem = this.makeVscodeCallHierarchyItem(call.item);
            const ranges: vscode.Range[] = [];
            call.fromRanges.forEach(r => {
                ranges.push(makeVscodeRange(r));
            });

            const incomingCall: vscode.CallHierarchyIncomingCall =
                new vscode.CallHierarchyIncomingCall(item, ranges);
            result.push(incomingCall);
        }

        return result;
    }

    private createOutgoingCalls(calls: CallHierarchyCallsItem[]): vscode.CallHierarchyOutgoingCall[] {
        const result: vscode.CallHierarchyOutgoingCall[] = [];

        for (const call of calls) {
            const item: vscode.CallHierarchyItem = this.makeVscodeCallHierarchyItem(call.item);
            const ranges: vscode.Range[] = [];
            call.fromRanges.forEach(r => {
                ranges.push(makeVscodeRange(r));
            });

            const outgoingCall: vscode.CallHierarchyOutgoingCall =
                new vscode.CallHierarchyOutgoingCall(item, ranges);
            result.push(outgoingCall);
        }

        return result;
    }

    private logTelemetry(eventName: string, requestStatus: CallHierarchyRequestStatus, progressBarDuration?: number): void {
        const properties: { [key: string]: string } = {};
        const metrics: { [key: string]: number } = {};

        let status: string = "Unknown";
        switch (requestStatus) {
            case CallHierarchyRequestStatus.Unknown: status = "Unknown"; break;
            case CallHierarchyRequestStatus.Succeeded: status = "Succeeded"; break;
            case CallHierarchyRequestStatus.Canceled: status = "Canceled"; break;
            case CallHierarchyRequestStatus.CaneledByUser: status = "CaneledByUser"; break;
            case CallHierarchyRequestStatus.Failed: status = "Failed"; break;
        }

        properties["Status"] = status;
        metrics["FirstRequest"] = this.isEntryRootNodeTelemetry ? 1 : 0;
        if (progressBarDuration) {
            metrics["ProgressBarDuration"] = progressBarDuration;
        }

        Telemetry.logLanguageServerEvent(eventName, properties, metrics);

        // Reset telemetry
        this.isEntryRootNodeTelemetry = false;
    }
}
