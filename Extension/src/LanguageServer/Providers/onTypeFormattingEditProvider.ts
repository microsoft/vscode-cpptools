/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { ResponseError } from 'vscode-languageclient';
import { DefaultClient, FormatOnTypeRequest, FormatParams, FormatResult } from '../client';
import { getEditorConfigSettings } from '../editorConfig';
import { RequestCancelled, ServerCancelled } from '../protocolFilter';
import { CppSettings } from '../settings';
import { makeVscodeTextEdits } from '../utils';

export class OnTypeFormattingEditProvider implements vscode.OnTypeFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideOnTypeFormattingEdits(document: vscode.TextDocument, position: vscode.Position, ch: string, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        const settings: CppSettings = new CppSettings(vscode.workspace.getWorkspaceFolder(document.uri)?.uri);
        if (settings.formattingEngine === "disabled") {
            return [];
        }
        await this.client.ready;
        const filePath: string = document.uri.fsPath;
        const useVcFormat: boolean = settings.useVcFormat(document);
        const configCallBack = async (editorConfigSettings: any | undefined) => {
            const params: FormatParams = {
                editorConfigSettings: { ...editorConfigSettings },
                useVcFormat: useVcFormat,
                uri: document.uri.toString(),
                insertSpaces: options.insertSpaces,
                tabSize: options.tabSize,
                character: ch,
                range: {
                    start: {
                        character: position.character,
                        line: position.line
                    },
                    end: {
                        character: 0,
                        line: 0
                    }
                },
                onChanges: false
            };
            let response: FormatResult;
            try {
                response = await this.client.languageClient.sendRequest(FormatOnTypeRequest, params, token);
            } catch (e: any) {
                if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
                    throw new vscode.CancellationError();
                }
                throw e;
            }
            if (token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            return makeVscodeTextEdits(response.edits);
        };
        if (!useVcFormat) {
            // If not using vcFormat, only process on-type requests for ';'
            if (ch !== ';') {
                const result: vscode.TextEdit[] = [];
                return result;
            } else {
                return configCallBack(undefined);
            }
        } else {
            const editorConfigSettings: any = getEditorConfigSettings(filePath);
            return configCallBack(editorConfigSettings);
        }
    }
}
