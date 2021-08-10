/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import {DefaultClient,  FormatParams, FormatOnTypeRequest} from '../client';
import { CppSettings, getEditorConfigSettings } from '../settings';

export class OnTypeFormattingEditProvider implements vscode.OnTypeFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideOnTypeFormattingEdits(document: vscode.TextDocument, position: vscode.Position, ch: string, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        await this.client.awaitUntilLanguageClientReady();
        const filePath: string = document.uri.fsPath;
        const settings: CppSettings = new CppSettings(this.client.RootUri);
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
                }
            };
            const textEdits: any[] = await this.client.languageClient.sendRequest(FormatOnTypeRequest, params);
            const result: vscode.TextEdit[] = [];
            textEdits.forEach((textEdit) => {
                result.push({
                    range: new vscode.Range(textEdit.range.start.line, textEdit.range.start.character, textEdit.range.end.line, textEdit.range.end.character),
                    newText: textEdit.newText
                });
            });
            return result;
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
