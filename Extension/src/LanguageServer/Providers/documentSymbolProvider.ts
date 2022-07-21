/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, LocalizeDocumentSymbol, GetDocumentSymbolRequestParams, GetDocumentSymbolRequest, SymbolScope } from '../client';
import { processDelayedDidOpen } from '../extension';
import { makeVscodeRange } from '../utils';
import { getLocalizedString, getLocalizedSymbolScope } from '../localization';

export class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }
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
        if (!this.client.TrackedDocuments.has(document)) {
            processDelayedDidOpen(document);
        }
        return this.client.requestWhenReady(async () => {
            const params: GetDocumentSymbolRequestParams = {
                uri: document.uri.toString()
            };
            const symbols: LocalizeDocumentSymbol[] = await this.client.languageClient.sendRequest(GetDocumentSymbolRequest, params, token);
            const resultSymbols: vscode.DocumentSymbol[] = this.getChildrenSymbols(symbols);
            return resultSymbols;
        });
    }
}
