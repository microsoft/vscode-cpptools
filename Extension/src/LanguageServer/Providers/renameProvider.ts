/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { Position, RequestType } from 'vscode-languageclient';
import * as nls from 'vscode-nls';
import * as util from '../../common';
import { DefaultClient, workspaceReferences } from '../client';
import { CancellationSender, ReferenceType, ReferencesParams, ReferencesResult, getReferenceItemIconPath, getReferenceTagString } from '../references';
import { CppSettings } from '../settings';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const RenameRequest: RequestType<ReferencesParams, ReferencesResult, void> =
    new RequestType<ReferencesParams, ReferencesResult, void>('cpptools/rename');

export class RenameProvider implements vscode.RenameProvider {
    private client: DefaultClient;

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, _token: vscode.CancellationToken): Promise<vscode.WorkspaceEdit | undefined> {
        await this.client.ready;
        workspaceReferences.cancelCurrentReferenceRequest(CancellationSender.NewRequest);

        const settings: CppSettings = new CppSettings();
        if (settings.renameRequiresIdentifier && !util.isValidIdentifier(newName)) {
            void vscode.window.showErrorMessage(localize("invalid.identifier.for.rename", "Invalid identifier provided for the Rename Symbol operation."));
            return undefined;
        }

        // Listen to a cancellation for this request. When this request is cancelled,
        // use a local cancellation source to explicitly cancel a token.
        // Don't listen to the token from the provider, as it will cancel when the cursor is moved to a different position.
        const cancelSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
        const requestCanceledListener: vscode.Disposable = workspaceReferences.onCancellationRequested(_sender => { cancelSource.cancel(); });

        // Send the request to the language server.
        workspaceReferences.startRename();
        const workspaceEditResult: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
        const params: ReferencesParams = {
            newName: newName,
            position: Position.create(position.line, position.character),
            textDocument: { uri: document.uri.toString() }
        };
        const response: ReferencesResult = await this.client.languageClient.sendRequest(RenameRequest, params, cancelSource.token);

        // Reset anything that can be cleared before processing the result.
        workspaceReferences.resetProgressBar();
        workspaceReferences.resetReferences();
        requestCanceledListener.dispose();

        // Process the result.
        if (cancelSource.token.isCancellationRequested || response.referenceInfos === null || response.isCanceled) {
            throw new vscode.CancellationError();
        } else if (response.referenceInfos.length === 0) {
            void vscode.window.showErrorMessage(localize("unable.to.locate.selected.symbol", "A definition for the selected symbol could not be located."));
        } else {
            for (const reference of response.referenceInfos) {
                const uri: vscode.Uri = vscode.Uri.file(reference.file);
                const range: vscode.Range = new vscode.Range(reference.position.line, reference.position.character,
                    reference.position.line, reference.position.character + response.text.length);
                const metadata: vscode.WorkspaceEditEntryMetadata = {
                    needsConfirmation: reference.type !== ReferenceType.Confirmed,
                    label: getReferenceTagString(reference.type, false, true),
                    iconPath: getReferenceItemIconPath(reference.type, false)
                };
                workspaceEditResult.replace(uri, range, newName, metadata);
            }
        }

        return workspaceEditResult;
    }
}
