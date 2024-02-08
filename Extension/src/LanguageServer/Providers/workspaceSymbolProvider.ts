/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { isExperimentEnabled } from '../../telemetry';
import { DefaultClient, GetSymbolInfoRequest, LocalizeSymbolInformation, SymbolScope, WorkspaceSymbolParams } from '../client';
import { getLocalizedString, getLocalizedSymbolScope } from '../localization';
import { makeVscodeLocation } from '../utils';

export class WorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
        // if the query is empty, then return as quickly as possible
        if (!query) {
            return [];
        }

        const params: WorkspaceSymbolParams = {
            query: query,
            experimentEnabled: await isExperimentEnabled('CppTools1')
        };

        const symbols: LocalizeSymbolInformation[] = await this.client.languageClient.sendRequest(GetSymbolInfoRequest, params, token);
        const resultSymbols: vscode.SymbolInformation[] = [];
        if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        // Convert to vscode.Command array
        symbols.forEach((symbol) => {
            let suffix: string = getLocalizedString(symbol.suffix);
            let name: string = symbol.name;
            if (suffix.length) {
                if (symbol.scope === SymbolScope.Private) {
                    suffix = getLocalizedSymbolScope("private", suffix);
                } else if (symbol.scope === SymbolScope.Protected) {
                    suffix = getLocalizedSymbolScope("protected", suffix);
                }
                name = name + ' (' + suffix + ')';
            } else {
                if (symbol.scope === SymbolScope.Private) {
                    name = name + " (private)";
                } else if (symbol.scope === SymbolScope.Protected) {
                    name = name + " (protected)";
                }
            }
            const vscodeSymbol: vscode.SymbolInformation = new vscode.SymbolInformation(
                name,
                symbol.kind,
                symbol.containerName,
                makeVscodeLocation(symbol.location)
            );
            resultSymbols.push(vscodeSymbol);
        });
        return resultSymbols;
    }
}
