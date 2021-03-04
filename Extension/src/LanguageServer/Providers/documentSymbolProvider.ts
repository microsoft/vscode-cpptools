/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, LocalizeDocumentSymbol, GetDocumentSymbolRequestParams, GetDocumentSymbolRequest } from '../client';
import * as util from '../../common';
import { processDelayedDidOpen } from '../extension';

export class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }
    private getChildrenSymbols(symbols: LocalizeDocumentSymbol[]): vscode.DocumentSymbol[] {
        const documentSymbols: vscode.DocumentSymbol[] = [];
        if (symbols) {
            symbols.forEach((symbol) => {
                const detail: string = util.getLocalizedString(symbol.detail);
                const r: vscode.Range = new vscode.Range(symbol.range.start.line, symbol.range.start.character, symbol.range.end.line, symbol.range.end.character);
                const sr: vscode.Range = new vscode.Range(symbol.selectionRange.start.line, symbol.selectionRange.start.character, symbol.selectionRange.end.line, symbol.selectionRange.end.character);
                const vscodeSymbol: vscode.DocumentSymbol = new vscode.DocumentSymbol(symbol.name, detail, symbol.kind, r, sr);
                vscodeSymbol.children = this.getChildrenSymbols(symbol.children);
                documentSymbols.push(vscodeSymbol);
            });
        }
        return documentSymbols;
    }
    public async provideDocumentSymbols(document: vscode.TextDocument): Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        if (!this.client.TrackedDocuments.has(document)) {
            processDelayedDidOpen(document);
        }
        return this.client.requestWhenReady(() => {
            const params: GetDocumentSymbolRequestParams = {
                uri: document.uri.toString()
            };
            return this.client.languageClient.sendRequest(GetDocumentSymbolRequest, params)
                .then((symbols) => {
                    const resultSymbols: vscode.DocumentSymbol[] = this.getChildrenSymbols(symbols);
                    return resultSymbols;
                });
        });
    }
}
