/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, GetSymbolInfoRequest, WorkspaceSymbolParams } from '../client';
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

        return this.client.languageClient.sendRequest(GetSymbolInfoRequest, params)
            .then((symbols) => {
                const resultSymbols: vscode.SymbolInformation[] = [];

                // Convert to vscode.Command array
                symbols.forEach((symbol) => {
                    const suffix: string = util.getLocalizedString(symbol.suffix);
                    let name: string = symbol.name;
                    if (suffix.length) {
                        name = name + ' (' + suffix + ')';
                    }
                    const vscodeSymbol: vscode.SymbolInformation = new vscode.SymbolInformation(
                        name,
                        symbol.kind,
                        symbol.containerName,
                        symbol.location
                    );
                    resultSymbols.push(vscodeSymbol);
                });
                return resultSymbols;
            });
    }
}
