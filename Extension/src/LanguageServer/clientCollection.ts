/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as util from '../common';
import * as telemetry from '../telemetry';
import * as cpptools from './client';
import * as path from 'path';
import { getCustomConfigProviders } from './customProviders';

const defaultClientKey: string = "@@default@@";
export interface ClientKey {
    name: string;
    key: string;
}

export class ClientCollection {
    private disposables: vscode.Disposable[] = [];
    private languageClients = new Map<string, cpptools.Client>();
    private defaultClient: cpptools.Client;
    private activeClient: cpptools.Client;
    private activeDocument: vscode.TextDocument;

    public get ActiveClient(): cpptools.Client { return this.activeClient; }
    public get Names(): ClientKey[] {
        let result: ClientKey[] = [];
        this.languageClients.forEach((client, key) => {
            result.push({ name: client.Name, key: key });
        });
        return result;
    }
    public get Count(): number { return this.languageClients.size; }

    constructor() {
        let key: string = defaultClientKey;
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            let folder: vscode.WorkspaceFolder = vscode.workspace.workspaceFolders[0];
            key = util.asFolder(folder.uri);
            this.activeClient = cpptools.createClient(this, folder);
        } else {
            this.activeClient = cpptools.createClient(this);
        }
        this.defaultClient = this.activeClient;
        this.languageClients.set(key, this.activeClient);

        this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(e => this.onDidChangeWorkspaceFolders(e)));
        this.disposables.push(vscode.workspace.onDidOpenTextDocument(d => this.onDidOpenTextDocument(d)));
        this.disposables.push(vscode.workspace.onDidCloseTextDocument(d => this.onDidCloseTextDocument(d)));
    }

    public activeDocumentChanged(document: vscode.TextDocument): void {
        this.activeDocument = document;
        let activeClient: cpptools.Client = this.getClientFor(document.uri);

        // Notify the active client that the document has changed.
        activeClient.activeDocumentChanged(document);

        // If the active client changed, resume the new client and tell the currently active client to deactivate.
        if (activeClient !== this.activeClient) {
            activeClient.activate();
            this.activeClient.deactivate();
            this.activeClient = activeClient;
        }
    }

    /**
     * get a handle to a language client. returns null if the client was not found.
     */
    public get(key: string): cpptools.Client | null {
        if (this.languageClients.has(key)) {
            return this.languageClients.get(key);
        }
        console.assert("key not found");
        return null;
    }

    public forEach(callback: (client: cpptools.Client) => void): void {
        this.languageClients.forEach(callback);
    }

    public checkOwnership(client: cpptools.Client, document: vscode.TextDocument): boolean {
        let owners: cpptools.Client[] = [];
        this.languageClients.forEach(languageClient => {
            if (document.uri.fsPath.startsWith(languageClient.RootPath + path.sep)) {
                owners.push(languageClient);
            }
        });
        if (owners.length === 0) {
            owners.push(this.activeClient);
        }

        return (owners[0] === client);  // TODO: we may want to pick the owner with the longest path?
    }

    /**
     * creates a new client to replace one that crashed.
     */
    public replace(client: cpptools.Client, transferFileOwnership: boolean): cpptools.Client {
        let key: string = undefined;
        for (let pair of this.languageClients) {
            if (pair[1] === client) {
                key = pair[0];
                break;
            }
        }

        if (key) {
            this.languageClients.delete(key);

            if (transferFileOwnership) {
                // This will create a new Client for the workspace since we removed the old one from this.languageClients.
                client.TrackedDocuments.forEach(document => this.transferOwnership(document, client));
                client.TrackedDocuments.clear();
            } else {
                // Create an empty client that will continue to "own" files matching this workspace, but ignore all messages from VS Code.
                this.languageClients.set(key, cpptools.createNullClient());
            }

            if (this.activeClient === client && this.activeDocument) {
                this.activeClient = this.getClientFor(this.activeDocument.uri);
                this.activeClient.activeDocumentChanged(this.activeDocument);
            }

            client.dispose();
            return this.languageClients.get(key);
        } else {
            console.assert(key, "unable to locate language client");
            return null;
        }
    }

    /**
     * Remove folders that were closed. We don't check the e.added property because we will
     * add new clients on-demand as files are opened.
     */
    private onDidChangeWorkspaceFolders(e?: vscode.WorkspaceFoldersChangeEvent): void {
        let folderCount: number = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0;
        if (folderCount > 1) {
            telemetry.logLanguageServerEvent("workspaceFoldersChange", { "count": folderCount.toString() });
        }

        if (e !== undefined) {
            e.removed.forEach(folder => {
                let path: string = util.asFolder(folder.uri);
                let client: cpptools.Client = this.languageClients.get(path);
                if (client) {
                    this.languageClients.delete(path);  // Do this first so that we don't iterate on it during the ownership transfer process.

                    // Transfer ownership of the client's documents to another client.
                    // (this includes calling textDocument/didOpen on the new client so that the server knows it's open too)
                    client.TrackedDocuments.forEach(document => this.transferOwnership(document, client));
                    client.TrackedDocuments.clear();

                    if (this.activeClient === client && this.activeDocument) {
                        // Need to make a different client the active client.
                        this.activeClient = this.getClientFor(this.activeDocument.uri);
                        this.activeClient.activeDocumentChanged(this.activeDocument);
                        // may not need this, the navigation UI should not have changed.
                        // this.activeClient.selectionChanged(Range.create(vscode.window.activeTextEditor.selection.start, vscode.window.activeTextEditor.selection.end);
                    }

                    client.dispose();
                }
            });
        }
    }

    private transferOwnership(document: vscode.TextDocument, oldOwner: cpptools.Client): void {
        let newOwner: cpptools.Client = this.getClientFor(document.uri);
        console.assert(newOwner !== oldOwner, "'oldOwner' should not be in the list of clients to consider");
        newOwner.takeOwnership(document);
    }

    private onDidOpenTextDocument(document: vscode.TextDocument): void {
        if (document.languageId === "c" || document.languageId === "cpp") {
            // Make sure a client exists for this document's workspace.
            this.getClientFor(document.uri);
        }
    }

    private getClientFor(uri: vscode.Uri): cpptools.Client {
        let folder: vscode.WorkspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) {
            return this.defaultClient;
        } else {
            let key: string = util.asFolder(folder.uri);
            if (!this.languageClients.has(key)) {
                let newClient: cpptools.Client = cpptools.createClient(this, folder);
                this.languageClients.set(key, newClient);
                getCustomConfigProviders().forEach(provider => newClient.onRegisterCustomConfigurationProvider(provider));
            }
            return this.languageClients.get(key);
        }
    }

    private onDidCloseTextDocument(document: vscode.TextDocument): void {
        // Don't seem to need to do anything here since we clean up when the workspace is closed instead.
    }

    public dispose(): Thenable<void> {
        let promises: Thenable<void>[] = [];

        // this.defaultClient is already in this.languageClients, so do not call dispose() on it.
        this.defaultClient = undefined;

        this.languageClients.forEach(client => promises.push(client.dispose()));
        this.languageClients.clear();
        return Promise.all(promises).then(() => undefined);
    }
}