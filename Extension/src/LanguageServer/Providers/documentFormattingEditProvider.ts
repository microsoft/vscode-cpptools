/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, FormatParams, FormatDocumentRequest } from '../client';
import { CppSettings, getEditorConfigSettings } from '../settings';

export class DocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
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
            // Apply insert_final_newline from .editorconfig
            if (document.lineCount > 0 && editorConfigSettings !== undefined && editorConfigSettings.insert_final_newline) {
                // Check if there is already a newline at the end.  If so, formatting edits should not replace it.
                const lastLine: vscode.TextLine = document.lineAt(document.lineCount - 1);
                if (!lastLine.isEmptyOrWhitespace) {
                    const endPosition: vscode.Position = lastLine.range.end;
                    // Check if there is an existing edit that extends the end of the file.
                    // It would be the last edit, but edit may not be sorted.  If multiple, we need the last one.
                    let lastEdit: vscode.TextEdit | undefined;
                    results.forEach(edit => {
                        if (edit.range.end.isAfterOrEqual(endPosition) && (!lastEdit || edit.range.start.isAfterOrEqual(lastEdit.range.start)) && edit.newText !== "") {
                            lastEdit = edit;
                        }
                    });
                    if (lastEdit === undefined) {
                        results.push({
                            range: new vscode.Range(endPosition, endPosition),
                            newText: "\n"
                        });
                    } else {
                        if (!lastEdit.newText.endsWith("\n")) {
                            lastEdit.newText += "\n";
                        }
                    }
                }
            }
            return results;
        };
        if (!useVcFormat) {
            return configCallBack(undefined);
        } else {
            const editorConfigSettings: any = getEditorConfigSettings(filePath);
            return configCallBack(editorConfigSettings);
        }
    }
}
