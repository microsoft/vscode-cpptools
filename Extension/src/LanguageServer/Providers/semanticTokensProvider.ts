/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { ManualPromise } from '../../Utility/Async/manualPromise';

interface FileData
{
    version: number;
    promise: ManualPromise<vscode.SemanticTokens>;
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

    public async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
        const uri: vscode.Uri = document.uri;
        const uriString: string = uri.toString();
        let fileData: FileData | undefined = this.allFileData.get(uriString);
        if (fileData) {
            if (fileData.promise.isCompleted) {
                // Make sure file hasn't been changed since the last set of results.
                // If a complete promise is present, there should also be a cache.
                if (fileData.version === document.version) {
                    return fileData.promise;
                }
            } else {
                // A new request requires a new ManualPromise, as each promise returned needs
                // to be associated with the cancellation token provided at the time.
                fileData.promise.reject(new vscode.CancellationError());
            }
        }
        fileData = {
            version: document.version,
            promise: new ManualPromise<vscode.SemanticTokens>(),
            tokenBuilder: new vscode.SemanticTokensBuilder()
        };
        this.allFileData.set(uriString, fileData);

        // Capture a local variable instead of referring to the member variable directly,
        // to avoid race conditions where the member variable is changed before the
        // cancallation token is triggered.
        const currentPromise = fileData.promise;
        token.onCancellationRequested(() => {
            const fileData: FileData | undefined = this.allFileData.get(uriString);
            if (fileData && currentPromise === fileData.promise) {
                this.allFileData.delete(uriString);
                currentPromise.reject(new vscode.CancellationError());
            }
        });

        return currentPromise;
    }

    public deliverTokens(uriString: string, semanticTokens: SemanticToken[], startNewSet: boolean): void {
        if (!startNewSet && semanticTokens.length === 0) {
            return;
        }

        const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uriString);
        if (!editor) {
            const builder: vscode.SemanticTokensBuilder = new vscode.SemanticTokensBuilder();
            const tokens: vscode.SemanticTokens = builder.build();
            this.allFileData.get(uriString)?.promise.resolve(tokens);
            return;
        }

        // Use a lambda to remove ambiguity about whether fileData may be undefined.
        const [fileData, wasNewPromiseCreated]: [FileData, boolean] = (() => {
            let fileData = this.allFileData.get(uriString);
            let newPromiseCreated = false;
            if (!fileData) {
                fileData = {
                    version: editor.document.version,
                    promise: new ManualPromise<vscode.SemanticTokens>(),
                    tokenBuilder: new vscode.SemanticTokensBuilder()
                };
                newPromiseCreated = true;
                this.allFileData.set(uriString, fileData);
            } else {
                if (!fileData.promise.isPending) {
                    fileData.promise.reject(new vscode.CancellationError());
                    fileData.promise = new ManualPromise<vscode.SemanticTokens>();
                    newPromiseCreated = true;
                }
                if (fileData.version !== editor.document.version) {
                    fileData.version = editor.document.version;
                    fileData.tokenBuilder = new vscode.SemanticTokensBuilder();
                }
            }
            return [fileData, newPromiseCreated];
        })();
        if (startNewSet) {
            fileData.tokenBuilder = new vscode.SemanticTokensBuilder();
        }

        semanticTokens.forEach((semanticToken) => {
            fileData.tokenBuilder.push(semanticToken.line, semanticToken.character, semanticToken.length, semanticToken.type, semanticToken.modifiers);
        });

        fileData?.promise.resolve(fileData.tokenBuilder.build());
        if (wasNewPromiseCreated) {
            this.onDidChangeSemanticTokensEvent.fire();
        }
    }

    public removeFile(uriString: string): void {
        const fileData: FileData | undefined = this.allFileData.get(uriString);
        if (!fileData) {
            return;
        }
        if (fileData.promise.isPending) {
            fileData.promise.reject(new vscode.CancellationError());
        }
        this.allFileData.delete(uriString);
    }
}
