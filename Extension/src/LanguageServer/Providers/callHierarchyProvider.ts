/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient } from '../client';
import { processDelayedDidOpen } from '../extension';
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

interface CallHierarchyParams {
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

interface CallHierarchyCallsItemResult {
    calls: CallHierarchyCallsItem[];
}

const CallHierarchyItemRequest: RequestType<CallHierarchyParams, CallHierarchyItemResult, void> =
    new RequestType<CallHierarchyParams, CallHierarchyItemResult, void>('cpptools/prepareCallHierarchy');

const CallHierarchyCallsToRequest: RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void> =
    new RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void>('cpptools/callHierarchyCallsTo');

const CallHierarchyCallsFromRequest: RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void> =
    new RequestType<CallHierarchyParams, CallHierarchyCallsItemResult, void>('cpptools/callHierarchyCallsFrom');

export class CallHierarchyProvider implements vscode.CallHierarchyProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async prepareCallHierarchy(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Promise<vscode.CallHierarchyItem | undefined> {
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

        return this.makeVscodeCallHierarchyItem(response.item);
    }

    public async provideCallHierarchyIncomingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken):
        Promise<vscode.CallHierarchyIncomingCall[] | undefined> {
        if (item === undefined) {
            return undefined;
        }

        await this.client.awaitUntilLanguageClientReady();
        const params: CallHierarchyParams = {
            textDocument: { uri: item.uri.toString() },
            position: Position.create(item.range.start.line, item.range.start.character)
        };
        const response: CallHierarchyCallsItemResult = await this.client.languageClient.sendRequest(CallHierarchyCallsToRequest, params, token);
        if (token.isCancellationRequested || response.calls === undefined) {
            throw new vscode.CancellationError();
        } else if (response.calls.length === 0) {
            return undefined;
        }

        return this.createIncomingCalls(response.calls);
    }

    public async provideCallHierarchyOutgoingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken):
        Promise<vscode.CallHierarchyOutgoingCall[] | undefined> {
        if (item === undefined) {
            return undefined;
        }

        await this.client.awaitUntilLanguageClientReady();
        const params: CallHierarchyParams = {
            textDocument: { uri: item.uri.toString() },
            position: Position.create(item.range.start.line, item.range.start.character)
        };
        const response: CallHierarchyCallsItemResult = await this.client.languageClient.sendRequest(CallHierarchyCallsFromRequest, params, token);
        if (token.isCancellationRequested || response.calls === undefined) {
            throw new vscode.CancellationError();
        } else if (response.calls.length === 0) {
            return undefined;
        }

        return this.createOutgoingCalls(response.calls);
    }

    private makeVscodeCallHierarchyItem(item: CallHierarchyItem): vscode.CallHierarchyItem {
        return new vscode.CallHierarchyItem(
            item.kind, item.name, item.detail,
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
}
