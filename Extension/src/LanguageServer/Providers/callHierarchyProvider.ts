/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import * as vscode from 'vscode';
import { Position, Range, RequestType, ResponseError, TextDocumentIdentifier } from 'vscode-languageclient';
import * as Telemetry from '../../telemetry';
import { DefaultClient, workspaceReferences } from '../client';
import { RequestCancelled, ServerCancelled } from '../protocolFilter';
import { CancellationSender } from '../references';
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
     * The file path of this item.
     */
    file: string;

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
    CanceledByUser,
    Failed
}

const CallHierarchyItemRequest: RequestType<CallHierarchyParams, CallHierarchyItemResult, void> =
    new RequestType<CallHierarchyParams, CallHierarchyItemResult, void>('cpptools/prepareCallHierarchy');

const CallHierarchyCallsToRequest: RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void> =
    new RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void>('cpptools/callHierarchyCallsTo');

const CallHierarchyCallsFromRequest: RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void> =
    new RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void>('cpptools/callHierarchyCallsFrom');

function makeVscodeCallHierarchyItem(client: DefaultClient, item: CallHierarchyItem): vscode.CallHierarchyItem {
    const containerDetail: string = (item.detail !== "") ? `${item.detail} - ` : "";
    const itemUri: vscode.Uri = vscode.Uri.file(item.file);

    // Get file detail
    const isInWorkspace: boolean = client.RootUri !== undefined &&
        itemUri.fsPath.startsWith(client.RootUri.fsPath);
    const dirPath: string = isInWorkspace ?
        path.relative(client.RootPath, path.dirname(item.file)) : path.dirname(item.file);
    const fileDetail: string = dirPath.length === 0 ?
        `${path.basename(item.file)}` : `${path.basename(item.file)} (${dirPath})`;

    return new vscode.CallHierarchyItem(
        item.kind,
        item.name,
        containerDetail + fileDetail,
        itemUri,
        makeVscodeRange(item.range),
        makeVscodeRange(item.selectionRange));
}

function createIncomingCalls(client: DefaultClient, calls: CallHierarchyCallsItem[]): vscode.CallHierarchyIncomingCall[] {
    const result: vscode.CallHierarchyIncomingCall[] = [];

    for (const call of calls) {
        const item: vscode.CallHierarchyItem = makeVscodeCallHierarchyItem(client, call.item);
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

function createOutgoingCalls(client: DefaultClient, calls: CallHierarchyCallsItem[]): vscode.CallHierarchyOutgoingCall[] {
    const result: vscode.CallHierarchyOutgoingCall[] = [];

    for (const call of calls) {
        const item: vscode.CallHierarchyItem = makeVscodeCallHierarchyItem(client, call.item);
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

export async function sendPrepareCallHierarchyRequest(client: DefaultClient, uri: vscode.Uri, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CallHierarchyItem[] | undefined> {
    const params: CallHierarchyParams = {
        textDocument: { uri: uri.toString() },
        position: Position.create(position.line, position.character)
    };
    let response: CallHierarchyItemResult;
    try {
        response = await client.languageClient.sendRequest(CallHierarchyItemRequest, params, token);
    } catch (e: any) {
        if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
            return undefined;
        }
        throw e;
    }

    if (token.isCancellationRequested) {
        return undefined;
    }

    return response.item === undefined ? [] : [makeVscodeCallHierarchyItem(client, response.item)];
}

export async function sendCallHierarchyCallsToRequest(client: DefaultClient, item: vscode.CallHierarchyItem, token: vscode.CancellationToken): Promise<vscode.CallHierarchyIncomingCall[] | undefined> {
    const params: CallHierarchyParams = {
        textDocument: { uri: item.uri.toString() },
        position: Position.create(item.selectionRange.start.line, item.selectionRange.start.character)
    };
    let response: CallHierarchyCallsItemResult;
    try {
        response = await client.languageClient.sendRequest(CallHierarchyCallsToRequest, params, token);
    } catch (e: any) {
        if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
            return undefined;
        }
        throw e;
    }

    if (token.isCancellationRequested) {
        return undefined;
    }

    return response.calls.length !== 0 ? createIncomingCalls(client, response.calls) : [];
}

export async function sendCallHierarchyCallsFromRequest(client: DefaultClient, item: vscode.CallHierarchyItem, token: vscode.CancellationToken): Promise<vscode.CallHierarchyOutgoingCall[] | undefined> {
    const params: CallHierarchyParams = {
        textDocument: { uri: item.uri.toString() },
        position: Position.create(item.selectionRange.start.line, item.selectionRange.start.character)
    };
    let response: CallHierarchyCallsItemResult;
    try {
        response = await client.languageClient.sendRequest(CallHierarchyCallsFromRequest, params, token);
    } catch (e: any) {
        if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
            return undefined;
        }
        throw e;
    }

    if (token.isCancellationRequested) {
        return undefined;
    }

    return response.calls.length !== 0 ? createOutgoingCalls(client, response.calls) : [];
}

export class CallHierarchyProvider implements vscode.CallHierarchyProvider {
    // Indicates whether a request is from an entry root node (e.g. top function in the call tree).
    private isEntryRootNodeTelemetry: boolean = false;
    private client: DefaultClient;

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async prepareCallHierarchy(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CallHierarchyItem | undefined> {
        await this.client.ready;

        workspaceReferences.cancelCurrentReferenceRequest(CancellationSender.NewRequest);
        workspaceReferences.clearViews();

        const range: vscode.Range | undefined = document.getWordRangeAtPosition(position);
        if (range === undefined) {
            return undefined;
        }

        // Listen to a cancellation for this request. When this request is cancelled,
        // use a local cancellation source to explicitly cancel a token.
        const cancelSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
        const cancellationTokenListener: vscode.Disposable = token.onCancellationRequested(() => {
            cancelSource.cancel();
        });
        const requestCanceledListener: vscode.Disposable = workspaceReferences.onCancellationRequested(_sender => {
            cancelSource.cancel();
        });

        let result: vscode.CallHierarchyItem[] | undefined;
        try {
            result = await sendPrepareCallHierarchyRequest(this.client, document.uri, position, cancelSource.token);
        } finally {
            cancellationTokenListener.dispose();
            requestCanceledListener.dispose();
        }

        if (cancelSource.token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        if (!result || result.length === 0) {
            return undefined;
        }

        this.isEntryRootNodeTelemetry = true;
        return result[0];
    }

    public async provideCallHierarchyIncomingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken): Promise<vscode.CallHierarchyIncomingCall[] | undefined> {
        await this.client.ready;
        workspaceReferences.cancelCurrentReferenceRequest(CancellationSender.NewRequest);

        const CallHierarchyCallsToEvent: string = "CallHierarchyCallsTo";
        if (item === undefined) {
            this.logTelemetry(CallHierarchyCallsToEvent, CallHierarchyRequestStatus.Failed);
            return undefined;
        }

        // Listen to a cancellation for this request. When this request is cancelled,
        // use a local cancellation source to explicitly cancel a token.
        let requestCanceled: CancellationSender | undefined;
        const cancelSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
        const cancellationTokenListener: vscode.Disposable = token.onCancellationRequested(() => {
            requestCanceled = CancellationSender.ProviderToken;
            cancelSource.cancel();
        });
        const requestCanceledListener: vscode.Disposable = workspaceReferences.onCancellationRequested(sender => {
            requestCanceled = sender;
            cancelSource.cancel();
        });

        // Send the request to the language server.
        let result: vscode.CallHierarchyIncomingCall[] | undefined;
        let progressBarDuration: number | undefined;
        try {
            result = await sendCallHierarchyCallsToRequest(this.client, item, cancelSource.token);
        } finally {
            // Reset anything that can be cleared before processing the result.
            progressBarDuration = workspaceReferences.getCallHierarchyProgressBarDuration();
            workspaceReferences.resetProgressBar();
            workspaceReferences.resetReferences();
            cancellationTokenListener.dispose();
            requestCanceledListener.dispose();
        }

        // Process the result.
        if (cancelSource.token.isCancellationRequested || result === undefined || requestCanceled !== undefined) {
            const requestStatus: CallHierarchyRequestStatus = requestCanceled === CancellationSender.User ?
                CallHierarchyRequestStatus.CanceledByUser : CallHierarchyRequestStatus.Canceled;
            this.logTelemetry(CallHierarchyCallsToEvent, requestStatus, progressBarDuration);
            throw new vscode.CancellationError();
        }

        this.logTelemetry(CallHierarchyCallsToEvent, CallHierarchyRequestStatus.Succeeded, progressBarDuration);
        return result.length !== 0 ? result : undefined;
    }

    public async provideCallHierarchyOutgoingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken): Promise<vscode.CallHierarchyOutgoingCall[] | undefined> {
        const CallHierarchyCallsFromEvent: string = "CallHierarchyCallsFrom";
        if (item === undefined) {
            this.logTelemetry(CallHierarchyCallsFromEvent, CallHierarchyRequestStatus.Failed);
            return undefined;
        }

        await this.client.ready;

        const result: vscode.CallHierarchyOutgoingCall[] | undefined =
            await sendCallHierarchyCallsFromRequest(this.client, item, token);
        if (token.isCancellationRequested || result === undefined) {
            this.logTelemetry(CallHierarchyCallsFromEvent, CallHierarchyRequestStatus.Canceled);
            throw new vscode.CancellationError();
        }

        this.logTelemetry(CallHierarchyCallsFromEvent, CallHierarchyRequestStatus.Succeeded);
        return result.length !== 0 ? result : undefined;
    }

    private logTelemetry(eventName: string, requestStatus: CallHierarchyRequestStatus, progressBarDuration?: number): void {
        const properties: { [key: string]: string } = {};
        const metrics: { [key: string]: number } = {};

        let status: string = "Unknown";
        switch (requestStatus) {
            case CallHierarchyRequestStatus.Unknown: status = "Unknown"; break;
            case CallHierarchyRequestStatus.Succeeded: status = "Succeeded"; break;
            case CallHierarchyRequestStatus.Canceled: status = "Canceled"; break;
            case CallHierarchyRequestStatus.CanceledByUser: status = "CanceledByUser"; break;
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
