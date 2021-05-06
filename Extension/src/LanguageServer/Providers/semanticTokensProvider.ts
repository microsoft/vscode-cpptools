/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, GetSemanticTokensParams, GetSemanticTokensRequest, openFileVersions, GetSemanticTokensResult } from '../client';

export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    private client: DefaultClient;
    public onDidChangeSemanticTokensEvent = new vscode.EventEmitter<void>();
    public onDidChangeSemanticTokens?: vscode.Event<void>;
    private tokenCaches: Map<string, [number, vscode.SemanticTokens]> = new Map<string, [number, vscode.SemanticTokens]>();

    constructor(client: DefaultClient) {
        this.client = client;
        this.onDidChangeSemanticTokens = this.onDidChangeSemanticTokensEvent.event;
    }

    public async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
        await this.client.awaitUntilLanguageClientReady();
        const uriString: string = document.uri.toString();
        // First check the token cache to see if we already have results for that file and version
        const cache: [number, vscode.SemanticTokens] | undefined = this.tokenCaches.get(uriString);
        if (cache && cache[0] === document.version) {
            return cache[1];
        } else {
            token.onCancellationRequested(_e => this.client.abortRequest(id));
            const id: number = ++DefaultClient.abortRequestId;
            const params: GetSemanticTokensParams = {
                id: id,
                uri: uriString
            };
            const tokensResult: GetSemanticTokensResult = await this.client.languageClient.sendRequest(GetSemanticTokensRequest, params);
            if (tokensResult.canceled) {
                throw new vscode.CancellationError();
            } else {
                if (tokensResult.fileVersion !== openFileVersions.get(uriString)) {
                    throw new vscode.CancellationError();
                } else {
                    const builder: vscode.SemanticTokensBuilder = new vscode.SemanticTokensBuilder(this.client.semanticTokensLegend);
                    tokensResult.tokens.forEach((token) => {
                        builder.push(token.line, token.character, token.length, token.type, token.modifiers);
                    });
                    const tokens: vscode.SemanticTokens = builder.build();
                    this.tokenCaches.set(uriString, [tokensResult.fileVersion, tokens]);
                    return tokens;
                }
            }
        }
    }

    public invalidateFile(uri: string): void {
        this.tokenCaches.delete(uri);
        this.onDidChangeSemanticTokensEvent.fire();
    }
}
