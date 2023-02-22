/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient } from '../client';
import { processDelayedDidOpen } from '../extension';

export class CallHierarchyProvider implements vscode.CallHierarchyProvider {
    private client: DefaultClient;

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async prepareCallHierarchy(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
    Promise<vscode.CallHierarchyItem | vscode.CallHierarchyItem[] | undefined> {
        const range: vscode.Range | undefined = document.getWordRangeAtPosition(position);
        if (range === undefined) {
            return undefined;
        }

        const symbol: string = document.getText(range);
        await this.client.requestWhenReady(() => processDelayedDidOpen(document));

        // Get call items denoted by given document and position
        // items = await this.client.languageClient.sendRequest(PrepareCallHierarchyRequest, params, token);

        // create a vscode.CallHierarchyItem for each returned call item.
        const callItemsResult: vscode.CallHierarchyItem[] = [];
        callItemsResult.push(new vscode.CallHierarchyItem(vscode.SymbolKind.Function, symbol, 'scope name of item', document.uri, range, range));

        return callItemsResult;
    }

    public async provideCallHierarchyIncomingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken):
    Promise<vscode.CallHierarchyIncomingCall[]> {
        //await this.client.awaitUntilLanguageClientReady();
        const incomingCallItemsResult: vscode.CallHierarchyIncomingCall[] = [];

        // Get "call to" items from language server
        // items = await this.client.languageClient.sendRequest(CallHierarchyCallsToRequest, params, token);

        // create a vscode.CallHierarchyIncomingCall for each returned call item.
        const callItem: vscode.CallHierarchyItem = new vscode.CallHierarchyItem(
            vscode.SymbolKind.Function, item.name, 'scope name of item', item.uri, item.range, item.selectionRange);
        const incomingCall: vscode.CallHierarchyIncomingCall = new vscode.CallHierarchyIncomingCall(callItem, []);
        incomingCallItemsResult.push(incomingCall);

        return incomingCallItemsResult;
    }

    public async provideCallHierarchyOutgoingCalls(item: vscode.CallHierarchyItem, token: vscode.CancellationToken):
    Promise<vscode.CallHierarchyOutgoingCall[]> {
        //await this.client.awaitUntilLanguageClientReady();
        const outgoingCallItemsResult: vscode.CallHierarchyOutgoingCall[] = [];

        // Get "call from" items from language server
        // items = await this.client.languageClient.sendRequest(CallHierarchyCallsFromRequest, params, token);

        // create a vscode.CallHierarchyOutgoingCall for each returned call item.
        const callItem: vscode.CallHierarchyItem = new vscode.CallHierarchyItem(
            vscode.SymbolKind.Function, item.name, 'scope name of item', item.uri, item.range, item.selectionRange);
        const outgoingCall: vscode.CallHierarchyOutgoingCall = new vscode.CallHierarchyOutgoingCall(callItem, []);
        outgoingCallItemsResult.push(outgoingCall);

        return outgoingCallItemsResult;
    }
}
