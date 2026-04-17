/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { Definition, DefinitionLink, DefinitionRequest, Position, ResponseError, TextDocumentPositionParams } from 'vscode-languageclient';
import { DefaultClient } from '../client';
import { RequestCancelled, ServerCancelled } from '../protocolFilter';

function convertDefinitionsToLocations(definitionsResult: vscode.Definition | vscode.DefinitionLink[] | undefined): vscode.Location[] {
    if (!definitionsResult) {
        return [];
    }

    if (!Array.isArray(definitionsResult)) {
        return [definitionsResult];
    }

    const result: vscode.Location[] = [];
    for (const definition of definitionsResult) {
        if (definition instanceof vscode.Location) {
            result.push(definition);
        } else {
            result.push(new vscode.Location(definition.targetUri, definition.targetSelectionRange ?? definition.targetRange));
        }
    }

    return result;
}

export async function sendGoToDefinitionRequest(client: DefaultClient, uri: vscode.Uri, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Location[] | undefined> {
    const params: TextDocumentPositionParams = {
        position: Position.create(position.line, position.character),
        textDocument: { uri: uri.toString() }
    };
    let response: Definition | DefinitionLink[] | null;
    try {
        response = await client.languageClient.sendRequest(DefinitionRequest.type, params, token);
    } catch (e: any) {
        if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
            return undefined;
        }
        throw e;
    }

    if (token.isCancellationRequested) {
        return undefined;
    }

    const result: vscode.Definition | vscode.DefinitionLink[] | undefined =
        await client.languageClient.protocol2CodeConverter.asDefinitionResult(response, token);
    if (token.isCancellationRequested) {
        return undefined;
    }

    return convertDefinitionsToLocations(result);
}
