/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';

interface FileData
{
    version: number;
    tokenBuilder: vscode.SemanticTokensBuilder;
}

export interface SemanticToken {
    line: number;
    character: number;
    length: number;
    type: number;
    modifiers?: number;
}

export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    public onDidChangeSemanticTokensEvent = new vscode.EventEmitter<void>();
    public onDidChangeSemanticTokens?: vscode.Event<void> = this.onDidChangeSemanticTokensEvent.event;
    private allFileData: Map<string, FileData> = new Map<string, FileData>();

    public async provideDocumentSemanticTokens(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
        const uri: vscode.Uri = document.uri;
        const uriString: string = uri.toString();

        // If we have some data, provide it immediately. Otherwise, complete with nothing.
        // We don't want to leave this request open, as that causes VS Code to delay sending us didClose.

        let fileData: FileData | undefined = this.allFileData.get(uriString);
        if (!fileData || fileData.version !== document.version) {
            fileData = {
                version: document.version,
                tokenBuilder: new vscode.SemanticTokensBuilder()
            };
            this.allFileData.set(uriString, fileData);
        }
        return fileData.tokenBuilder.build();
    }

    public deliverTokens(uriString: string, semanticTokens: SemanticToken[], startNewSet: boolean): void {
        if (!startNewSet && semanticTokens.length === 0) {
            return;
        }

        const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uriString);
        if (!editor) {
            return;
        }

        // No need to check the file version here, as the caller has already ensured it's current.
        let fileData: FileData | undefined = this.allFileData.get(uriString);
        if (!fileData) {
            fileData = {
                version: editor.document.version,
                tokenBuilder: new vscode.SemanticTokensBuilder()
            };
            this.allFileData.set(uriString, fileData);
        }
        semanticTokens.forEach((semanticToken) => {
            fileData?.tokenBuilder?.push(semanticToken.line, semanticToken.character, semanticToken.length, semanticToken.type, semanticToken.modifiers);
        });

        this.onDidChangeSemanticTokensEvent.fire();
    }

    public removeFile(uriString: string): void {
        const fileData: FileData | undefined = this.allFileData.get(uriString);
        if (!fileData) {
            return;
        }
        this.allFileData.delete(uriString);
    }
}
