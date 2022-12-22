/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, FormatParams, FormatRangeRequest } from '../client';
import { TextEdit } from '../commonTypes';
import { CppSettings, getEditorConfigSettings } from '../settings';
import { makeVscodeTextEdits } from '../utils';

export class DocumentRangeFormattingEditProvider implements vscode.DocumentRangeFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        const settings: CppSettings = new CppSettings(vscode.workspace.getWorkspaceFolder(document.uri)?.uri);
        if (settings.formattingEngine === "disabled") {
            return [];
        }
        await this.client.awaitUntilLanguageClientReady();
        const filePath: string = document.uri.fsPath;
        const useVcFormat: boolean = settings.useVcFormat(document);
        const configCallBack = async (editorConfigSettings: any | undefined) => {
            const params: FormatParams = {
                editorConfigSettings: { ...editorConfigSettings },
                useVcFormat: useVcFormat,
                uri: document.uri.toString(),
                insertSpaces: options.insertSpaces,
                tabSize: options.tabSize,
                character: "",
                range: {
                    start: {
                        character: range.start.character,
                        line: range.start.line
                    },
                    end: {
                        character: range.end.character,
                        line: range.end.line
                    }
                },
                onChanges: false
            };
            // We do not currently pass the CancellationToken to sendRequest
            // because there is not currently cancellation logic for formatting
            // in the native process. Formatting is currently done directly in
            // message handling thread.
            const response: TextEdit[] = await this.client.languageClient.sendRequest(FormatRangeRequest, params, token);
            if (token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            return makeVscodeTextEdits(response);
        };
        if (!useVcFormat) {
            return configCallBack(undefined);
        } else {
            const editorConfigSettings: any = getEditorConfigSettings(filePath);
            return configCallBack(editorConfigSettings);
        }
    };
}
