/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, workspaceReferences } from '../client';
import * as refs from '../references';
import { CppSettings } from '../settings';
import { Position, TextDocumentIdentifier } from 'vscode-languageclient';
import * as nls from 'vscode-nls';
import * as util from '../../common';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface RenameReferencesParams {
    newName: string;
    position: Position;
    textDocument: TextDocumentIdentifier;
}

export class RenameProvider implements vscode.RenameProvider {
    private client: DefaultClient;

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken):
        Promise<vscode.WorkspaceEdit | undefined> {
        await this.client.awaitUntilLanguageClientReady();

        // Cancel any current requests by firing a cancellation event to listeners.
        workspaceReferences.cancelCurrentReferenceRequest(refs.CancellationSender.NewRequest);

        const settings: CppSettings = new CppSettings();
        if (settings.renameRequiresIdentifier && !util.isValidIdentifier(newName)) {
            vscode.window.showErrorMessage(localize("invalid.identifier.for.rename", "Invalid identifier provided for the Rename Symbol operation."));
            return undefined;
        }

        // Listen to VS Code cancellation.
        let requestCanceled: refs.CancellationSender = refs.CancellationSender.None;
        token.onCancellationRequested(e => { requestCanceled = refs.CancellationSender.ProviderToken; });

        // Process the request.
        return new Promise<vscode.WorkspaceEdit>((resolve, reject) => {
            // Listen to cancellation from an incoming new request, user or language server.
            workspaceReferences.onCancellationRequested(sender => { requestCanceled = sender; });

            // Define the callback that will process results.
            const resultsCallback: refs.ReferencesResultCallback = (result: refs.ReferencesResult | null) => {
                workspaceReferences.renamePending = false;

                if (result === null ||
                    (requestCanceled !== refs.CancellationSender.None && requestCanceled !== refs.CancellationSender.ProviderToken)) {
                    // Request canceled either by language server, document was edited (user) or an incoming new request.
                    // Note: cancellation from provider is not considered here because only text edits
                    // are considered a cancellation which is handled in onDidChangeTextDocument.
                    reject(new vscode.CancellationError());
                } else {
                    const workspaceEditResult: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                    for (const reference of result.referenceInfos) {
                        const uri: vscode.Uri = vscode.Uri.file(reference.file);
                        const range: vscode.Range = new vscode.Range(reference.position.line, reference.position.character,
                            reference.position.line, reference.position.character + result.text.length);
                        const metadata: vscode.WorkspaceEditEntryMetadata = {
                            needsConfirmation: reference.type !== refs.ReferenceType.Confirmed,
                            label: refs.getReferenceTagString(reference.type, false, true),
                            iconPath: refs.getReferenceItemIconPath(reference.type, false)
                        };
                        workspaceEditResult.replace(uri, range, newName, metadata);
                    }

                    if (result.referenceInfos === null || result.referenceInfos.length === 0) {
                        vscode.window.showErrorMessage(localize("unable.to.locate.selected.symbol", "A definition for the selected symbol could not be located."));
                    }

                    resolve(workspaceEditResult);
                }
                return;
            };

            if (requestCanceled === refs.CancellationSender.None) {
                workspaceReferences.renamePending = true;
                workspaceReferences.setReferencesResultsCallback(resultsCallback);

                // Send the request to language server
                const params: RenameReferencesParams = {
                    newName: newName,
                    position: Position.create(position.line, position.character),
                    textDocument: { uri: document.uri.toString() }
                };
                workspaceReferences.startRename(params);
            } else {
                // Only complete the request at this point if the request to language server
                // has not been sent. Otherwise, the cancellation is handled when language
                // server has completed/canceled its processing and sends the results.
                resultsCallback(null);
            }
        });
    }
}
