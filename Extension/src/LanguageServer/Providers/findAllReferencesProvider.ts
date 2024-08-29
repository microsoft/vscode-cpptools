/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { Position, RequestType, ResponseError } from 'vscode-languageclient';
import { DefaultClient, workspaceReferences } from '../client';
import { RequestCancelled, ServerCancelled } from '../protocolFilter';
import { CancellationSender, ReferenceInfo, ReferenceType, ReferencesParams, ReferencesResult } from '../references';

const FindAllReferencesRequest: RequestType<ReferencesParams, ReferencesResult, void> =
    new RequestType<ReferencesParams, ReferencesResult, void>('cpptools/findAllReferences');

export class FindAllReferencesProvider implements vscode.ReferenceProvider {
    private client: DefaultClient;

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken): Promise<vscode.Location[] | undefined> {
        await this.client.ready;
        workspaceReferences.cancelCurrentReferenceRequest(CancellationSender.NewRequest);

        // Listen to a cancellation for this request. When this request is cancelled,
        // use a local cancellation source to explicitly cancel a token.
        const cancelSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
        const cancellationTokenListener: vscode.Disposable = token.onCancellationRequested(() => { cancelSource.cancel(); });
        const requestCanceledListener: vscode.Disposable = workspaceReferences.onCancellationRequested(_sender => { cancelSource.cancel(); });

        // Send the request to the language server.
        const locationsResult: vscode.Location[] = [];
        const params: ReferencesParams = {
            newName: "",
            position: Position.create(position.line, position.character),
            textDocument: { uri: document.uri.toString() }
        };
        let response: ReferencesResult | undefined;
        let cancelled: boolean = false;
        try {
            response = await this.client.languageClient.sendRequest(FindAllReferencesRequest, params, cancelSource.token);
        } catch (e: any) {
            cancelled = e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled);
            if (!cancelled) {
                throw e;
            }
        }

        // Reset anything that can be cleared before processing the result.
        workspaceReferences.resetProgressBar();
        cancellationTokenListener.dispose();
        requestCanceledListener.dispose();

        // Process the result.
        if (cancelSource.token.isCancellationRequested || cancelled || (response && response.isCanceled)) {
            // Return undefined instead of vscode.CancellationError to avoid the following error message from VS Code:
            // "Cannot destructure property 'range' of 'e.location' as it is undefined."
            // TODO: per issue https://github.com/microsoft/vscode/issues/169698
            // vscode.CancellationError is expected, so when VS Code fixes the error use vscode.CancellationError again.
            workspaceReferences.resetReferences();
            return undefined;
        } else if (response && response.referenceInfos.length > 0) {
            response.referenceInfos.forEach((referenceInfo: ReferenceInfo) => {
                if (referenceInfo.type === ReferenceType.Confirmed) {
                    const uri: vscode.Uri = vscode.Uri.file(referenceInfo.file);
                    const range: vscode.Range = new vscode.Range(referenceInfo.position.line, referenceInfo.position.character,
                        referenceInfo.position.line, referenceInfo.position.character + response.text.length);
                    locationsResult.push(new vscode.Location(uri, range));
                }
            });

            // Display other reference types in panel or channel view.
            // Note: ReferencesManager.resetReferences is called in ReferencesManager.showResultsInPanelView
            workspaceReferences.showResultsInPanelView(response);
        } else {
            workspaceReferences.resetReferences();
        }

        return locationsResult;
    }
}
