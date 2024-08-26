/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { ResponseError } from 'vscode-languageclient';
import { DefaultClient, FormatParams, FormatRangeRequest, FormatResult } from '../client';
import { getEditorConfigSettings } from '../editorConfig';
import { RequestCancelled, ServerCancelled } from '../protocolFilter';
import { CppSettings } from '../settings';
import { makeVscodeTextEdits } from '../utils';

export class DocumentRangeFormattingEditProvider implements vscode.DocumentRangeFormattingEditProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range,
        options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
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
            let response: FormatResult;
            try {
                response = await this.client.languageClient.sendRequest(FormatRangeRequest, params, token);
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
            return configCallBack(undefined);
        } else {
            const editorConfigSettings: any = getEditorConfigSettings(filePath);
            return configCallBack(editorConfigSettings);
        }
    }

    // TODO: This is needed for correct Extract to function formatting.
    /*
    public async provideDocumentRangesFormattingEdits(_document: vscode.TextDocument, _ranges: vscode.Range[],
        _options: vscode.FormattingOptions, _token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        return [];
    }
    */
}
