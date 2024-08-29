/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { ResponseError } from 'vscode-languageclient';
import { Client, DefaultClient, GetDocumentSymbolRequest, GetDocumentSymbolRequestParams, GetDocumentSymbolResult, LocalizeDocumentSymbol, SymbolScope } from '../client';
import { clients } from '../extension';
import { getLocalizedString, getLocalizedSymbolScope } from '../localization';
import { RequestCancelled, ServerCancelled } from '../protocolFilter';
import { makeVscodeRange } from '../utils';

export class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private getChildrenSymbols(symbols: LocalizeDocumentSymbol[]): vscode.DocumentSymbol[] {
        const documentSymbols: vscode.DocumentSymbol[] = [];
        if (symbols) {
            symbols.forEach((symbol) => {
                let detail: string = getLocalizedString(symbol.detail);
                if (symbol.scope === SymbolScope.Private) {
                    if (detail.length === 0) {
                        detail = "private";
                    } else {
                        detail = getLocalizedSymbolScope("private", detail);
                    }
                } else if (symbol.scope === SymbolScope.Protected) {
                    if (detail.length === 0) {
                        detail = "protected";
                    } else {
                        detail = getLocalizedSymbolScope("protected", detail);
                    }
                }

                // Move the scope in the name to the detail.
                if (detail.length === 0) {
                    let offset_paren: number = symbol.name.indexOf("(");
                    if (offset_paren < 0) {
                        offset_paren = symbol.name.length;
                    }
                    const offset_scope: number = symbol.name.lastIndexOf("::", offset_paren - 2);
                    if (offset_scope > 0) {
                        detail = symbol.name.substring(0, offset_scope);
                        symbol.name = symbol.name.substring(offset_scope + 2);
                    }
                }

                let r: vscode.Range = makeVscodeRange(symbol.range);
                const sr: vscode.Range = makeVscodeRange(symbol.selectionRange);
                if (!r.contains(sr)) {
                    r = sr;
                }
                const vscodeSymbol: vscode.DocumentSymbol = new vscode.DocumentSymbol(symbol.name, detail, symbol.kind, r, sr);
                vscodeSymbol.children = this.getChildrenSymbols(symbol.children);
                documentSymbols.push(vscodeSymbol);
            });
        }
        return documentSymbols;
    }
    public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        const client: Client = clients.getClientFor(document.uri);
        if (client instanceof DefaultClient) {
            const defaultClient: DefaultClient = <DefaultClient>client;
            await client.ready;
            const params: GetDocumentSymbolRequestParams = {
                uri: document.uri.toString()
            };
            let response: GetDocumentSymbolResult;
            try {
                response = await defaultClient.languageClient.sendRequest(GetDocumentSymbolRequest, params, token);
            } catch (e: any) {
                if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
                    throw new vscode.CancellationError();
                }
                throw e;
            }
            if (token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            const resultSymbols: vscode.DocumentSymbol[] = this.getChildrenSymbols(response.symbols);
            return resultSymbols;
        }
        return [];
    }
}
