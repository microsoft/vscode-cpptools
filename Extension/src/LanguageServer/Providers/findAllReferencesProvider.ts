/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, workspaceReferences, FindAllReferencesParams, ReferencesCancellationState, RequestReferencesNotification, CancelReferencesNotification } from '../client';
import { Position } from 'vscode-languageclient';
import * as refs from '../references';

export class FindAllReferencesProvider implements vscode.ReferenceProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }
    public async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken): Promise<vscode.Location[] | undefined> {
        return new Promise<vscode.Location[]>((resolve, reject) => {
            const callback: () => Promise<void> = async () => {
                const params: FindAllReferencesParams = {
                    position: Position.create(position.line, position.character),
                    textDocument: this.client.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document)
                };
                DefaultClient.referencesParams = params;
                await this.client.awaitUntilLanguageClientReady();
                // The current request is represented by referencesParams.  If a request detects
                // referencesParams does not match the object used when creating the request, abort it.
                if (params !== DefaultClient.referencesParams) {
                    // Complete with nothing instead of rejecting, to avoid an error message from VS Code
                    const locations: vscode.Location[] = [];
                    resolve(locations);
                    return;
                }
                DefaultClient.referencesRequestPending = true;
                // Register a single-fire handler for the reply.
                const resultCallback: refs.ReferencesResultCallback = (result: refs.ReferencesResult | null, doResolve: boolean) => {
                    DefaultClient.referencesRequestPending = false;
                    const locations: vscode.Location[] = [];
                    if (result) {
                        result.referenceInfos.forEach((referenceInfo: refs.ReferenceInfo) => {
                            if (referenceInfo.type === refs.ReferenceType.Confirmed) {
                                const uri: vscode.Uri = vscode.Uri.file(referenceInfo.file);
                                const range: vscode.Range = new vscode.Range(referenceInfo.position.line, referenceInfo.position.character, referenceInfo.position.line, referenceInfo.position.character + result.text.length);
                                locations.push(new vscode.Location(uri, range));
                            }
                        });
                    }
                    // If references were canceled while in a preview state, there is not an outstanding promise.
                    if (doResolve) {
                        resolve(locations);
                    }
                    if (DefaultClient.referencesPendingCancellations.length > 0) {
                        while (DefaultClient.referencesPendingCancellations.length > 1) {
                            const pendingCancel: ReferencesCancellationState = DefaultClient.referencesPendingCancellations[0];
                            DefaultClient.referencesPendingCancellations.pop();
                            pendingCancel.reject();
                        }
                        const pendingCancel: ReferencesCancellationState = DefaultClient.referencesPendingCancellations[0];
                        DefaultClient.referencesPendingCancellations.pop();
                        pendingCancel.callback();
                    }
                };
                if (!workspaceReferences.referencesRefreshPending) {
                    workspaceReferences.setResultsCallback(resultCallback);
                    workspaceReferences.startFindAllReferences(params);
                } else {
                    // We are responding to a refresh (preview or final result)
                    workspaceReferences.referencesRefreshPending = false;
                    if (workspaceReferences.lastResults) {
                        // This is a final result
                        const lastResults: refs.ReferencesResult = workspaceReferences.lastResults;
                        workspaceReferences.lastResults = null;
                        resultCallback(lastResults, true);
                    } else {
                        // This is a preview (2nd or later preview)
                        workspaceReferences.referencesRequestPending = true;
                        workspaceReferences.setResultsCallback(resultCallback);
                        this.client.languageClient.sendNotification(RequestReferencesNotification, false);
                    }
                }
                token.onCancellationRequested(e => {
                    if (params === DefaultClient.referencesParams) {
                        this.client.cancelReferences();
                    }
                });
            };

            if (DefaultClient.referencesRequestPending || (workspaceReferences.symbolSearchInProgress && !workspaceReferences.referencesRefreshPending)) {
                const cancelling: boolean = DefaultClient.referencesPendingCancellations.length > 0;
                DefaultClient.referencesPendingCancellations.push({
                    reject: () => {
                        // Complete with nothing instead of rejecting, to avoid an error message from VS Code
                        const locations: vscode.Location[] = [];
                        resolve(locations);
                    }, callback
                });
                if (!cancelling) {
                    DefaultClient.renamePending = false;
                    workspaceReferences.referencesCanceled = true;
                    if (!DefaultClient.referencesRequestPending) {
                        workspaceReferences.referencesCanceledWhilePreviewing = true;
                    }
                    this.client.languageClient.sendNotification(CancelReferencesNotification);
                }
            } else {
                callback();
            }
        });
    }
}
