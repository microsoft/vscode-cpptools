/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, workspaceReferences } from '../client';
import { ReferencesParams, ReferencesResult, ReferenceType, getReferenceTagString, getReferenceItemIconPath } from '../references';
import { CppSettings } from '../settings';
import { Position, RequestType } from 'vscode-languageclient';
import * as nls from 'vscode-nls';
import * as util from '../../common';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const RenameRequest: RequestType<ReferencesParams, ReferencesResult, void> =
    new RequestType<ReferencesParams, ReferencesResult, void>('cpptools/rename');

export class RenameProvider implements vscode.RenameProvider {
    private client: DefaultClient;
    private cancellationToken: vscode.CancellationTokenSource | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken):
        Promise<vscode.WorkspaceEdit | undefined> {
        await this.client.awaitUntilLanguageClientReady();

        const settings: CppSettings = new CppSettings();
        if (settings.renameRequiresIdentifier && !util.isValidIdentifier(newName)) {
            vscode.window.showErrorMessage(localize("invalid.identifier.for.rename", "Invalid identifier provided for the Rename Symbol operation."));
            return undefined;
        }

        // Cancel the previous request and listen to a next cancellation.
        if (this.cancellationToken) {
            this.cancellationToken.cancel();
        }
        this.cancellationToken = new vscode.CancellationTokenSource();
        const cancelToken: vscode.CancellationTokenSource = this.cancellationToken;
        this.disposables.push(token.onCancellationRequested(() => { cancelToken.cancel(); }));
        this.disposables.push(workspaceReferences.onCancellationRequested(sender => { cancelToken.cancel(); }));

        // Send request to the language server.
        workspaceReferences.startRename();
        const workspaceEditResult: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
        const params: ReferencesParams = {
            newName: newName,
            position: Position.create(position.line, position.character),
            textDocument: { uri: document.uri.toString() }
        };
        const response: ReferencesResult = await this.client.languageClient.sendRequest(RenameRequest, params, cancelToken.token);

        // Reset anything that can be cleared before procossing the result.
        workspaceReferences.resetProgressBar();
        workspaceReferences.resetRename();
        this.dispose();

        // Process the result.
        if (token.isCancellationRequested || response.referenceInfos === null || response.isCanceled) {
            throw new vscode.CancellationError();
        } else if (response.referenceInfos.length === 0) {
            vscode.window.showErrorMessage(localize("unable.to.locate.selected.symbol", "A definition for the selected symbol could not be located."));
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

    private dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }
}
