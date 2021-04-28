/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, FormatParams, FormatDocumentRequest, cachedEditorConfigSettings } from '../client';
import { CppSettings } from '../settings';
import * as editorConfig from 'editorconfig';

export class DocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        await this.client.notifyWhenReady(() => { });
        const filePath: string = document.uri.fsPath;
        const configCallBack = async (editorConfigSettings: any | undefined) => {
            const params: FormatParams = {
                settings: { ...editorConfigSettings },
                uri: document.uri.toString(),
                insertSpaces: options.insertSpaces,
                tabSize: options.tabSize,
                character: "",
                range: {
                    start: {
                        character: 0,
                        line: 0
                    },
                    end: {
                        character: 0,
                        line: 0
                    }
                }
            };
            const textEdits: any = await this.client.languageClient.sendRequest(FormatDocumentRequest, params);
            const results: vscode.TextEdit[] = [];
            textEdits.forEach((textEdit: any) => {
                results.push({
                    range: new vscode.Range(textEdit.range.start.line, textEdit.range.start.character, textEdit.range.end.line, textEdit.range.end.character),
                    newText: textEdit.newText
                });
            });
            return results;
        };
        const settings: CppSettings = new CppSettings();
        if (settings.formattingEngine !== "vcFormat") {
            return configCallBack(undefined);
        } else {
            const editorConfigSettings: any = cachedEditorConfigSettings.get(filePath);
            if (!editorConfigSettings) {
                await editorConfig.parse(filePath);
                return configCallBack(undefined);
            } else {
                cachedEditorConfigSettings.set(filePath, editorConfigSettings);
                return configCallBack(editorConfigSettings);
            }
        }
    }
}
