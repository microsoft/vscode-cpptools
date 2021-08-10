/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, FormatParams, FormatRangeRequest } from '../client';
import { CppSettings, getEditorConfigSettings } from '../settings';

export class DocumentRangeFormattingEditProvider implements vscode.DocumentRangeFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
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
                }
            };
            const textEdits: any = await this.client.languageClient.sendRequest(FormatRangeRequest, params);
            const result: vscode.TextEdit[] = [];
            textEdits.forEach((textEdit: any) => {
                result.push({
                    range: new vscode.Range(textEdit.range.start.line, textEdit.range.start.character, textEdit.range.end.line, textEdit.range.end.character),
                    newText: textEdit.newText
                });
            });
            return result;
        };
        if (!useVcFormat) {
            return configCallBack(undefined);
        } else {
            const editorConfigSettings: any = getEditorConfigSettings(filePath);
            return configCallBack(editorConfigSettings);
        }
    };
}
