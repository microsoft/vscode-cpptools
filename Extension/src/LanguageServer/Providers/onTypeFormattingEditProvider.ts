/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import {DefaultClient,  FormatParams, FormatOnTypeRequest, cachedEditorConfigSettings} from '../client';
import { CppSettings } from '../settings';
import * as editorConfig from 'editorconfig';

export class OnTypeFormattingEditProvider implements vscode.OnTypeFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideOnTypeFormattingEdits(document: vscode.TextDocument, position: vscode.Position, ch: string, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        await this.client.awaitUntilLanguageClientReady();
        const filePath: string = document.uri.fsPath;
        const configCallBack = async (editorConfigSettings: any | undefined) => {
            const params: FormatParams = {
                settings: { ...editorConfigSettings },
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
        const settings: CppSettings = new CppSettings();
        if (settings.formattingEngine !== "vcFormat") {
            // If not using vcFormat, only process on-type requests for ';'
            if (ch !== ';') {
                const result: vscode.TextEdit[] = [];
                return result;
            } else {
                return configCallBack(undefined);
            }
        } else {
            const editorConfigSettings: any = cachedEditorConfigSettings.get(filePath);
            if (!editorConfigSettings) {
                const editorConfigContents: any = await editorConfig.parse(filePath);
                return configCallBack(editorConfigContents);
            } else {
                cachedEditorConfigSettings.set(filePath, editorConfigSettings);
                return configCallBack(editorConfigSettings);
            }
        }
    }
}
