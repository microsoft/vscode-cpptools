/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, workspaceReferences } from '../client';
import { Position, RequestType } from 'vscode-languageclient';
import { ReferencesParams, ReferencesResult, ReferenceType, ReferenceInfo } from '../references';

const FindAllReferencesRequest: RequestType<ReferencesParams, ReferencesResult, void> =
    new RequestType<ReferencesParams, ReferencesResult, void>('cpptools/findAllReferences');

export class FindAllReferencesProvider implements vscode.ReferenceProvider {
    private client: DefaultClient;

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken):
        Promise<vscode.Location[] | undefined> {
        await this.client.awaitUntilLanguageClientReady();

        const locationsResult: vscode.Location[] = [];
        const params: ReferencesParams = {
            newName: "",
            position: Position.create(position.line, position.character),
            textDocument: { uri: document.uri.toString() }
        };
        const response: ReferencesResult = await this.client.languageClient.sendRequest(FindAllReferencesRequest, params, token);

        workspaceReferences.resetProgressBar();

        if (token.isCancellationRequested || response.referenceInfos === null) {
            workspaceReferences.resetFindAllReferences();
            throw new vscode.CancellationError();
        } else if (response.referenceInfos.length !== 0) {
            response.referenceInfos.forEach((referenceInfo: ReferenceInfo) => {
                if (referenceInfo.type === ReferenceType.Confirmed) {
                    const uri: vscode.Uri = vscode.Uri.file(referenceInfo.file);
                    const range: vscode.Range = new vscode.Range(referenceInfo.position.line, referenceInfo.position.character,
                        referenceInfo.position.line, referenceInfo.position.character + response.text.length);
                    locationsResult.push(new vscode.Location(uri, range));
                }
            });

            // Display other reference types in panel or channel view.
            workspaceReferences.showResultsInPanelView(response);
        }

        workspaceReferences.resetFindAllReferences();
        return locationsResult;
    }
}
