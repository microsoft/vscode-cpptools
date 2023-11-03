/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, FormatDocumentRequest, FormatParams, FormatResult } from '../client';
import { CppSettings, OtherSettings, getEditorConfigSettings } from '../settings';
import { makeVscodeTextEdits } from '../utils';

export class DocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        const settings: CppSettings = new CppSettings(vscode.workspace.getWorkspaceFolder(document.uri)?.uri);
        if (settings.formattingEngine === "disabled") {
            return [];
        }
        await this.client.ready;
        const filePath: string = document.uri.fsPath;
        if (options.onChanges) {
            let insertSpacesSet: boolean = false;
            let tabSizeSet: boolean = false;
            // Even when preserveFocus is true, VS Code is making the document active (when we don't want that).
            // The workaround is for the code invoking the formatting to call showTextDocument again afterwards on the previously active document.
            const editor: vscode.TextEditor = await vscode.window.showTextDocument(document, { preserveFocus: options.preserveFocus as boolean });
            if (editor.options.insertSpaces && typeof editor.options.insertSpaces === "boolean") {
                options.insertSpaces = editor.options.insertSpaces;
                insertSpacesSet = true;
            }
            if (editor.options.tabSize && typeof editor.options.tabSize === "number") {
                options.tabSize = editor.options.tabSize;
                tabSizeSet = true;
            }

            if (!insertSpacesSet || !tabSizeSet) {
                const settings: OtherSettings = new OtherSettings(vscode.workspace.getWorkspaceFolder(document.uri)?.uri);
                if (!insertSpacesSet) {
                    options.insertSpaces = settings.editorInsertSpaces ?? true;
                }
                if (!tabSizeSet) {
                    options.tabSize = settings.editorTabSize ?? 4;
                }
            }
        }
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
                },
                onChanges: options.onChanges === true
            };
            // We do not currently pass the CancellationToken to sendRequest
            // because there is not currently cancellation logic for formatting
            // in the native process. Formatting is currently done directly in
            // message handling thread.
            const response: FormatResult = await this.client.languageClient.sendRequest(FormatDocumentRequest, params, token);
            if (token.isCancellationRequested || response.edits === undefined) {
                throw new vscode.CancellationError();
            }
            const results: vscode.TextEdit[] = makeVscodeTextEdits(response.edits);
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
