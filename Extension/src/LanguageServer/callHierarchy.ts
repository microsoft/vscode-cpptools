/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import * as vscode from 'vscode';
import {
    CallHierarchyIncomingCall as ProtocolCallHierarchyIncomingCall,
    CallHierarchyIncomingCallsParams,
    CallHierarchyIncomingCallsRequest,
    CallHierarchyItem as ProtocolCallHierarchyItem,
    CallHierarchyOutgoingCall as ProtocolCallHierarchyOutgoingCall,
    CallHierarchyOutgoingCallsParams,
    CallHierarchyOutgoingCallsRequest,
    CallHierarchyPrepareParams,
    CallHierarchyPrepareRequest,
    ResponseError
} from 'vscode-languageclient';
import { DefaultClient } from './client';
import { RequestCancelled, ServerCancelled } from './protocolFilter';

export function addCallHierarchyItemDetail(client: DefaultClient, item: vscode.CallHierarchyItem): vscode.CallHierarchyItem {
    const containerDetail: string = item.detail !== "" ? `${item.detail} - ` : "";
    const isInWorkspace: boolean = client.RootUri !== undefined && item.uri.fsPath.startsWith(client.RootUri.fsPath);
    const dirPath: string = isInWorkspace ?
        path.relative(client.RootPath, path.dirname(item.uri.fsPath)) : path.dirname(item.uri.fsPath);
    const fileDetail: string = dirPath.length === 0 ?
        path.basename(item.uri.fsPath) : `${path.basename(item.uri.fsPath)} (${dirPath})`;
    item.detail = containerDetail + fileDetail;
    return item;
}

export async function sendPrepareCallHierarchyRequest(client: DefaultClient, uri: vscode.Uri, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CallHierarchyItem[] | undefined> {
    const params: CallHierarchyPrepareParams = {
        textDocument: { uri: uri.toString() },
        position: { line: position.line, character: position.character }
    };
    let response: ProtocolCallHierarchyItem[] | null;
    try {
        response = await client.languageClient.sendRequest(CallHierarchyPrepareRequest.type, params, token);
    } catch (e: any) {
        if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
            return undefined;
        }
        throw e;
    }

    const converter = await client.languageClient.getProtocol2CodeConverter();
    const result = await converter.asCallHierarchyItems(response, token);
    if (token.isCancellationRequested || !result) {
        return undefined;
    }
    return result.map(item => addCallHierarchyItemDetail(client, item));
}

export async function sendCallHierarchyCallsToRequest(client: DefaultClient, item: vscode.CallHierarchyItem, token: vscode.CancellationToken): Promise<vscode.CallHierarchyIncomingCall[] | undefined> {
    const converter = await client.languageClient.getCode2ProtocolConverter();
    const params: CallHierarchyIncomingCallsParams = { item: converter.asCallHierarchyItem(item) };
    let response: ProtocolCallHierarchyIncomingCall[] | null;
    try {
        response = await client.languageClient.sendRequest(CallHierarchyIncomingCallsRequest.type, params, token);
    } catch (e: any) {
        if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
            return undefined;
        }
        throw e;
    }

    const protocolConverter = await client.languageClient.getProtocol2CodeConverter();
    const result = await protocolConverter.asCallHierarchyIncomingCalls(response, token);
    if (token.isCancellationRequested || !result) {
        return undefined;
    }
    for (const call of result) {
        addCallHierarchyItemDetail(client, call.from);
    }
    return result;
}

export async function sendCallHierarchyCallsFromRequest(client: DefaultClient, item: vscode.CallHierarchyItem, token: vscode.CancellationToken): Promise<vscode.CallHierarchyOutgoingCall[] | undefined> {
    const converter = await client.languageClient.getCode2ProtocolConverter();
    const params: CallHierarchyOutgoingCallsParams = { item: converter.asCallHierarchyItem(item) };
    let response: ProtocolCallHierarchyOutgoingCall[] | null;
    try {
        response = await client.languageClient.sendRequest(CallHierarchyOutgoingCallsRequest.type, params, token);
    } catch (e: any) {
        if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
            return undefined;
        }
        throw e;
    }

    const protocolConverter = await client.languageClient.getProtocol2CodeConverter();
    const result = await protocolConverter.asCallHierarchyOutgoingCalls(response, token);
    if (token.isCancellationRequested || !result) {
        return undefined;
    }
    for (const call of result) {
        addCallHierarchyItemDetail(client, call.to);
    }
    return result;
}
