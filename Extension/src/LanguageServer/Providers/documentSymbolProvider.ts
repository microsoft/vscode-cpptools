/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, LocalizeDocumentSymbol, GetDocumentSymbolRequestParams, GetDocumentSymbolRequest, SymbolScope } from '../client';
import * as util from '../../common';
import { processDelayedDidOpen } from '../extension';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }
    private getChildrenSymbols(symbols: LocalizeDocumentSymbol[]): vscode.DocumentSymbol[] {
        const documentSymbols: vscode.DocumentSymbol[] = [];
        if (symbols) {
            symbols.forEach((symbol) => {
                let detail: string = util.getLocalizedString(symbol.detail);
                if (symbol.scope === SymbolScope.Private) {
                    if (detail.length === 0) {
                        detail = "private";
                    } else {
                        detail = localize("c.cpp.symbolscope.separator", "{0}, {1}", "private", detail);
                    }
                } else if (symbol.scope === SymbolScope.Protected) {
                    if (detail.length === 0) {
                        detail = "protected";
                    } else {
                        detail = localize("c.cpp.symbolscope.separator", "{0}, {1}", "protected", detail);
                    }
                }
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
        return this.client.requestWhenReady(async () => {
            const params: GetDocumentSymbolRequestParams = {
                uri: document.uri.toString()
            };
            const symbols: LocalizeDocumentSymbol[] = await this.client.languageClient.sendRequest(GetDocumentSymbolRequest, params);
            const resultSymbols: vscode.DocumentSymbol[] = this.getChildrenSymbols(symbols);
            return resultSymbols;
        });
    }
}
