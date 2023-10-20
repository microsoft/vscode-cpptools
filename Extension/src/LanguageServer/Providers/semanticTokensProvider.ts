/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { ManualPromise } from '../../Utility/Async/manualPromise';
import { DefaultClient } from '../client';

export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    //private client: DefaultClient;
    public onDidChangeSemanticTokensEvent = new vscode.EventEmitter<void>();
    public onDidChangeSemanticTokens?: vscode.Event<void>;
    //private tokenCaches: Map<string, [number, vscode.SemanticTokens]> = new Map<string, [number, vscode.SemanticTokens]>();
    private currentPromises: Map<vscode.Uri, ManualPromise<vscode.SemanticTokens>> = new Map<vscode.Uri, ManualPromise<vscode.SemanticTokens>>();

    constructor(_client: DefaultClient) {
        //this.client = client;
        this.onDidChangeSemanticTokens = this.onDidChangeSemanticTokensEvent.event;
    }

    public async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
        const uri: vscode.Uri = document.uri;
        let currentPromise: ManualPromise<vscode.SemanticTokens> | undefined = this.currentPromises.get(uri);
        if (currentPromise) {
            if (currentPromise.isCompleted) {
                return currentPromise;
            }
            // A new request requires a new ManualPromise, as each promise returned needs
            // to be associated with the cancellation token provided at the time.
            currentPromise.reject(new vscode.CancellationError());
        }
        currentPromise = new ManualPromise<vscode.SemanticTokens>();
        this.currentPromises.set(uri, currentPromise);

        // Capture a local variable instead of referring to the member variable directly,
        // to avoid race conditions where the member variable is changed before the
        // cancallation token is triggered.
        token.onCancellationRequested(() => {
            const storedPromise: ManualPromise<vscode.SemanticTokens> | undefined = this.currentPromises.get(uri);
            if (storedPromise && currentPromise === storedPromise) {
                currentPromise.reject(new vscode.CancellationError());
                this.currentPromises.delete(uri);
            }
        });

        return currentPromise;
    }

    // TODO: Process received tokens
    public processTokens(): void {
        // const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document === document);
        // if (!editor) {
        //     // Don't provide document semantic tokens for files that aren't visible,
        //     // which prevents launching a lot of IntelliSense processes from a find/replace.
        //     const builder: vscode.SemanticTokensBuilder = new vscode.SemanticTokensBuilder();
        //     const tokens: vscode.SemanticTokens = builder.build();
        //     return tokens;
        // }
        //await this.client.ready;

        // const uriString: string = document.uri.toString();
        // // First check the semantic token cache to see if we already have results for that file and version
        // const cache: [number, vscode.SemanticTokens] | undefined = this.tokenCaches.get(uriString);
        // if (cache && cache[0] === document.version) {
        //     return cache[1];
        // }
        // const params: GetSemanticTokensParams = {
        //     uri: uriString
        // };
        // const tokensResult: GetSemanticTokensResult = await this.client.languageClient.sendRequest(GetSemanticTokensRequest, params, token);
        // if (token.isCancellationRequested || tokensResult.tokens === undefined || tokensResult.fileVersion !== openFileVersions.get(uriString)) {
        //     throw new vscode.CancellationError();
        // }
        // const builder: vscode.SemanticTokensBuilder = new vscode.SemanticTokensBuilder(semanticTokensLegend);
        // tokensResult.tokens.forEach((semanticToken) => {
        //     builder.push(semanticToken.line, semanticToken.character, semanticToken.length, semanticToken.type, semanticToken.modifiers);
        // });
        // const tokens: vscode.SemanticTokens = builder.build();
        // this.tokenCaches.set(uriString, [tokensResult.fileVersion, tokens]);
        // return tokens;
    }

    // public invalidateFile(uri: string): void {
    //     this.tokenCaches.delete(uri);
    //     this.onDidChangeSemanticTokensEvent.fire();
    // }
}
