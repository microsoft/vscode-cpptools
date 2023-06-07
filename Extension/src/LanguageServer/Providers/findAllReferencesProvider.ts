/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, workspaceReferences } from '../client';
import { Position, TextDocumentIdentifier } from 'vscode-languageclient';
import * as refs from '../references';

export interface FindAllReferencesParams {
    position: Position;
    textDocument: TextDocumentIdentifier;
}

export class FindAllReferencesProvider implements vscode.ReferenceProvider {
    private client: DefaultClient;

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken):
        Promise<vscode.Location[] | undefined> {
        await this.client.awaitUntilLanguageClientReady();

        // Cancel any current reference requests by firing a cancellation event to listeners.
        workspaceReferences.cancelCurrentReferenceRequest(refs.CancellationSender.NewRequest);

        // Listen to VS Code cancellation.
        let requestCanceled: refs.CancellationSender = refs.CancellationSender.None;
        token.onCancellationRequested(e => { requestCanceled = refs.CancellationSender.ProviderToken; });

        // Process the request.
        return new Promise<vscode.Location[]>((resolve, reject) => {
            // Listen to cancellation from an incoming new request, user or language server.
            workspaceReferences.onCancellationRequested(sender => { requestCanceled = sender; });

            // Define the callback that will process results.
            const resultCallback: refs.ReferencesResultCallback = (result: refs.ReferencesResult | null) => {
                if (result === null) {
                    // Nothing to resolve.
                    reject(new vscode.CancellationError());
                } else {
                    const locationsResult: vscode.Location[] = [];
                    result.referenceInfos.forEach((referenceInfo: refs.ReferenceInfo) => {
                        if (referenceInfo.type === refs.ReferenceType.Confirmed) {
                            const uri: vscode.Uri = vscode.Uri.file(referenceInfo.file);
                            const range: vscode.Range = new vscode.Range(referenceInfo.position.line, referenceInfo.position.character,
                                referenceInfo.position.line, referenceInfo.position.character + result.text.length);
                            locationsResult.push(new vscode.Location(uri, range));
                        }
                    });

                    resolve(locationsResult);
                }
                return;
            };

            if (requestCanceled === refs.CancellationSender.None) {
                workspaceReferences.setReferencesResultsCallback(resultCallback);

                // Send the request to language server.
                const params: FindAllReferencesParams = {
                    position: Position.create(position.line, position.character),
                    textDocument: { uri: document.uri.toString() }
                };
                workspaceReferences.startFindAllReferences(params);
            } else {
                // Only complete the request at this point if the request to language server
                // has not been sent. Otherwise, the cancellation is handled when language
                // server has completed/canceled its processing and sends the results.
                resultCallback(null);
            }
        });
    }
}
