/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, GetSymbolInfoRequest, WorkspaceSymbolParams, LocalizeSymbolInformation, SymbolScope } from '../client';
import * as util from '../../common';

export class WorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
        const params: WorkspaceSymbolParams = {
            query: query
        };

        const symbols: LocalizeSymbolInformation[] = await this.client.languageClient.sendRequest(GetSymbolInfoRequest, params);
        const resultSymbols: vscode.SymbolInformation[] = [];

        // Convert to vscode.Command array
        symbols.forEach((symbol) => {
            let suffix: string = util.getLocalizedString(symbol.suffix);
            let name: string = symbol.name;
            if (suffix.length) {
                if (symbol.scope === SymbolScope.Private) {
                    suffix = util.getLocalizedSymbolScope("private", suffix);
                } else if (symbol.scope === SymbolScope.Protected) {
                    suffix = util.getLocalizedSymbolScope("protected", suffix);
                }
                name = name + ' (' + suffix + ')';
            } else {
                if (symbol.scope === SymbolScope.Private) {
                    name = name + " (private)";
                } else if (symbol.scope === SymbolScope.Protected) {
                    name = name + " (protected)";
                }
            }
            const range: vscode.Range = new vscode.Range(symbol.location.range.start.line, symbol.location.range.start.character, symbol.location.range.end.line, symbol.location.range.end.character);
            const uri: vscode.Uri = vscode.Uri.parse(symbol.location.uri.toString());
            const vscodeSymbol: vscode.SymbolInformation = new vscode.SymbolInformation(
                name,
                symbol.kind,
                symbol.containerName,
                new vscode.Location(uri, range)
            );
            resultSymbols.push(vscodeSymbol);
        });
        return resultSymbols;
    }
}
