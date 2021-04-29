/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, workspaceReferences, ReferencesCancellationState, RenameParams, CancelReferencesNotification } from '../client';
import * as refs from '../references';
import { CppSettings } from '../settings';
import { Position } from 'vscode-languageclient';
import * as nls from 'vscode-nls';
import * as util from '../../common';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class RenameProvider implements vscode.RenameProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }
    public async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Promise<vscode.WorkspaceEdit> {
        const settings: CppSettings = new CppSettings();
        if (settings.renameRequiresIdentifier && !util.isValidIdentifier(newName)) {
            vscode.window.showErrorMessage(localize("invalid.identifier.for.rename", "Invalid identifier provided for the Rename Symbol operation."));
            const workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
            return workspaceEdit;
        }
        // Normally, VS Code considers rename to be an atomic operation.
        // If the user clicks anywhere in the document, it attempts to cancel it.
        // Because that prevents our rename UI, we ignore cancellation requests.
        // VS Code will attempt to issue new rename requests while another is still active.
        // When we receive another rename request, cancel the one that is in progress.
        DefaultClient.renamePending = true;
        ++DefaultClient.renameRequestsPending;
        return new Promise<vscode.WorkspaceEdit>((resolve, reject) => {
            const callback: () => Promise<void> = async () => {
                const params: RenameParams = {
                    newName: newName,
                    position: Position.create(position.line, position.character),
                    textDocument: this.client.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document)
                };
                DefaultClient.referencesParams = params;
                await this.client.awaitUntilLanguageClientReady();
                // The current request is represented by referencesParams.  If a request detects
                // referencesParams does not match the object used when creating the request, abort it.
                if (params !== DefaultClient.referencesParams) {
                    if (--DefaultClient.renameRequestsPending === 0) {
                        DefaultClient.renamePending = false;
                    }

                    // Complete with nothing instead of rejecting, to avoid an error message from VS Code
                    const workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                    resolve(workspaceEdit);
                    return;
                }
                DefaultClient.referencesRequestPending = true;
                workspaceReferences.setResultsCallback((referencesResult: refs.ReferencesResult | null, doResolve: boolean) => {
                    DefaultClient.referencesRequestPending = false;
                    --DefaultClient.renameRequestsPending;
                    const workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                    const cancelling: boolean = DefaultClient.referencesPendingCancellations.length > 0;
                    if (cancelling) {
                        while (DefaultClient.referencesPendingCancellations.length > 1) {
                            const pendingCancel: ReferencesCancellationState = DefaultClient.referencesPendingCancellations[0];
                            DefaultClient.referencesPendingCancellations.pop();
                            pendingCancel.reject();
                        }
                        const pendingCancel: ReferencesCancellationState = DefaultClient.referencesPendingCancellations[0];
                        DefaultClient.referencesPendingCancellations.pop();
                        pendingCancel.callback();
                    } else {
                        if (DefaultClient.renameRequestsPending === 0) {
                            DefaultClient.renamePending = false;
                        }
                        // If rename UI was canceled, we will get a null result.
                        // If null, return an empty list to avoid Rename failure dialog.
                        if (referencesResult) {
                            for (const reference of referencesResult.referenceInfos) {
                                const uri: vscode.Uri = vscode.Uri.file(reference.file);
                                const range: vscode.Range = new vscode.Range(reference.position.line, reference.position.character, reference.position.line, reference.position.character + referencesResult.text.length);
                                const metadata: vscode.WorkspaceEditEntryMetadata = {
                                    needsConfirmation: reference.type !== refs.ReferenceType.Confirmed,
                                    label: refs.getReferenceTagString(reference.type, false, true),
                                    iconPath: refs.getReferenceItemIconPath(reference.type, false)
                                };
                                workspaceEdit.replace(uri, range, newName, metadata);
                            }
                        }
                    }
                    if (referencesResult && (referencesResult.referenceInfos === null || referencesResult.referenceInfos.length === 0)) {
                        vscode.window.showErrorMessage(localize("unable.to.locate.selected.symbol", "A definition for the selected symbol could not be located."));
                    }
                    resolve(workspaceEdit);
                });
                workspaceReferences.startRename(params);
            };

            if (DefaultClient.referencesRequestPending || workspaceReferences.symbolSearchInProgress) {
                const cancelling: boolean = DefaultClient.referencesPendingCancellations.length > 0;
                DefaultClient.referencesPendingCancellations.push({
                    reject: () => {
                        --DefaultClient.renameRequestsPending;
                        // Complete with nothing instead of rejecting, to avoid an error message from VS Code
                        const workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                        resolve(workspaceEdit);
                    }, callback
                });
                if (!cancelling) {
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
