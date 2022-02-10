/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as util from '../common';
import * as cpptools from './client';
import * as telemetry from '../telemetry';
import { getCustomConfigProviders } from './customProviders';
import { TimeTelemetryCollector } from './timeTelemetryCollector';

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
    private activeDocument?: vscode.TextDocument;
    public timeTelemetryCollector: TimeTelemetryCollector = new TimeTelemetryCollector();

    public get ActiveClient(): cpptools.Client { return this.activeClient; }
    public get Names(): ClientKey[] {
        const result: ClientKey[] = [];
        this.languageClients.forEach((client, key) => {
            result.push({ name: client.Name, key: key });
        });
        return result;
    }
    public get Count(): number { return this.languageClients.size; }

    constructor() {
        let key: string = defaultClientKey;
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            let isFirstWorkspaceFolder: boolean = true;
            vscode.workspace.workspaceFolders.forEach(folder => {
                const newClient: cpptools.Client = cpptools.createClient(this, folder);
                this.languageClients.set(util.asFolder(folder.uri), newClient);
                if (isFirstWorkspaceFolder) {
                    isFirstWorkspaceFolder = false;
                } else {
                    newClient.deactivate();
                }
            });
            key = util.asFolder(vscode.workspace.workspaceFolders[0].uri);
            const client: cpptools.Client | undefined = this.languageClients.get(key);
            if (!client) {
                throw new Error("Failed to construct default client");
            }
            this.activeClient = client;
        } else {
            this.activeClient = cpptools.createClient(this);
        }
        this.defaultClient = this.activeClient;
        this.languageClients.set(key, this.activeClient);

        this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(e => this.onDidChangeWorkspaceFolders(e)));
        this.disposables.push(vscode.workspace.onDidCloseTextDocument(d => this.onDidCloseTextDocument(d)));
    }

    public async activeDocumentChanged(document: vscode.TextDocument): Promise<void> {
        this.activeDocument = document;
        const activeClient: cpptools.Client = this.getClientFor(document.uri);

        // Notify the active client that the document has changed.
        await activeClient.activeDocumentChanged(document);

        // If the active client changed, resume the new client and tell the currently active client to deactivate.
        if (activeClient !== this.activeClient) {
            activeClient.activate();
            this.activeClient.deactivate();
            this.activeClient = activeClient;
        }
    }

    /**
     * get a handle to a language client. returns undefined if the client was not found.
     */
    public get(key: string): cpptools.Client | undefined {
        const client: cpptools.Client | undefined = this.languageClients.get(key);
        console.assert(client, "key not found");
        return client;
    }

    public forEach(callback: (client: cpptools.Client) => void): void {
        // Copy this.languageClients to languageClients to avoid an infinite foreach loop
        // when callback modifies this.languageClients (e.g. when cpptools crashes).
        const languageClients: cpptools.Client[] = [];
        this.languageClients.forEach(client => languageClients.push(client));
        languageClients.forEach(callback);
    }

    public checkOwnership(client: cpptools.Client, document: vscode.TextDocument): boolean {

        return (this.getClientFor(document.uri) === client);
    }

    /**
     * creates a new client to replace one that crashed.
     */
    public recreateClients(transferFileOwnership: boolean): void {

        // Swap out the map, so we are not changing it while iterating over it.
        const oldLanguageClients: Map<string, cpptools.Client> = this.languageClients;
        this.languageClients = new Map<string, cpptools.Client>();

        for (const pair of oldLanguageClients) {
            const key: string = pair[0];
            const client: cpptools.Client = pair[1];

            let newClient: cpptools.Client;
            if (transferFileOwnership) {
                newClient = this.getClientForFolder(client.RootFolder);
                client.TrackedDocuments.forEach(document => this.transferOwnership(document, client));
            } else {
                newClient = cpptools.createNullClient();
            }

            if (this.activeClient === client) {
                this.activeClient = newClient;
            }

            if (this.defaultClient === client) {
                this.defaultClient = newClient;
            }

            client.dispose();
            this.languageClients.set(key, newClient);
        }

        // In case a folder was removed and the active document now needs to be associated with a different folder.
        if (this.activeDocument) {
            this.activeClient = this.getClientFor(this.activeDocument.uri);
            this.activeClient.activeDocumentChanged(this.activeDocument);
        }
    }

    private onDidChangeWorkspaceFolders(e?: vscode.WorkspaceFoldersChangeEvent): void {
        const folderCount: number = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0;
        if (folderCount > 1) {
            telemetry.logLanguageServerEvent("workspaceFoldersChange", { "count": folderCount.toString() });
        }

        if (e !== undefined) {
            let oldDefaultClient: cpptools.Client | undefined;
            let needNewDefaultClient: boolean = false;
            let needNewActiveClient: boolean = false;

            e.removed.forEach(folder => {
                const path: string = util.asFolder(folder.uri);
                const client: cpptools.Client | undefined = this.languageClients.get(path);
                if (client) {
                    this.languageClients.delete(path);  // Do this first so that we don't iterate on it during the ownership transfer process.

                    // Transfer ownership of the client's documents to another client.
                    // (this includes calling textDocument/didOpen on the new client so that the server knows it's open too)
                    client.TrackedDocuments.forEach(document => this.transferOwnership(document, client));

                    if (this.activeClient === client) {
                        needNewActiveClient = true;
                    }

                    // Defer selecting a new default client until all adds and removes have been processed.
                    if (this.defaultClient === client) {
                        oldDefaultClient = client;
                    } else {
                        client.dispose();
                    }
                }
            });

            e.added.forEach(folder => {
                const path: string = util.asFolder(folder.uri);
                const client: cpptools.Client | undefined = this.languageClients.get(path);
                if (!client) {
                    const newClient: cpptools.Client = cpptools.createClient(this, folder);
                    this.languageClients.set(path, newClient);
                    newClient.deactivate(); // e.g. prevent the current config from switching.
                    const defaultClient: cpptools.DefaultClient = <cpptools.DefaultClient>newClient;
                    defaultClient.sendAllSettings();
                }
            });

            if (needNewActiveClient && this.activeDocument) {
                this.activeClient = this.getClientFor(this.activeDocument.uri);
                this.activeClient.activeDocumentChanged(this.activeDocument);
                needNewActiveClient = false;
            }

            // Note: VS Code currently reloads the extension whenever the primary (first) workspace folder is added or removed.
            // So the following handling of changes to defaultClient are likely unnecessary, unless the behavior of
            // VS Code changes. The handling of changes to activeClient are still needed.

            if (oldDefaultClient) {
                const uri: vscode.Uri | undefined = oldDefaultClient.RootUri;
                // uri will be set.
                if (uri) {
                    this.defaultClient = this.getClientFor(uri);
                    needNewDefaultClient = this.defaultClient === oldDefaultClient;
                }
                oldDefaultClient.dispose();
            } else {
                const defaultDefaultClient: cpptools.Client | undefined = this.languageClients.get(defaultClientKey);
                if (defaultDefaultClient) {
                    // If there is an entry in languageClients for defaultClientKey, we were not previously tracking any workspace folders.
                    this.languageClients.delete(defaultClientKey);
                    needNewDefaultClient = true;
                    needNewActiveClient = this.activeClient === this.defaultClient;
                }
            }

            if (needNewDefaultClient || needNewActiveClient) {
                // Use the first workspaceFolder, if any.
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    const key: string = util.asFolder(vscode.workspace.workspaceFolders[0].uri);
                    const client: cpptools.Client | undefined = this.languageClients.get(key);
                    if (!client) {
                        // This should not occur.  If there is a workspace folder, we should have a client for it by now.
                        throw new Error("Failed to construct default client");
                    }
                    if (needNewDefaultClient) {
                        this.defaultClient = client;
                    }
                    if (needNewActiveClient) {
                        this.activeClient = client;
                    }
                } else {
                    // The user removed the last workspace folder. Create a new default defaultClient/activeClient.
                    this.activeClient = cpptools.createClient(this);
                    this.defaultClient = this.activeClient;
                    this.languageClients.set(defaultClientKey, this.defaultClient);
                }
            }
        }
    }

    private transferOwnership(document: vscode.TextDocument, oldOwner: cpptools.Client): void {
        const newOwner: cpptools.Client = this.getClientFor(document.uri);
        if (newOwner !== oldOwner) {
            newOwner.takeOwnership(document);
        }
    }

    public getClientFor(uri: vscode.Uri): cpptools.Client {
        const folder: vscode.WorkspaceFolder | undefined = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
        return this.getClientForFolder(folder);
    }

    public getClientForFolder(folder?: vscode.WorkspaceFolder): cpptools.Client {
        if (!folder) {
            return this.defaultClient;
        } else {
            const key: string = util.asFolder(folder.uri);
            const client: cpptools.Client | undefined = this.languageClients.get(key);
            if (client) {
                return client;
            }
            const newClient: cpptools.Client = cpptools.createClient(this, folder);
            this.languageClients.set(key, newClient);
            getCustomConfigProviders().forEach(provider => newClient.onRegisterCustomConfigurationProvider(provider));
            const defaultClient: cpptools.DefaultClient = <cpptools.DefaultClient>newClient;
            defaultClient.sendAllSettings();
            return newClient;
        }
    }

    private onDidCloseTextDocument(document: vscode.TextDocument): void {
        // Don't seem to need to do anything here since we clean up when the workspace is closed instead.
    }

    public dispose(): Thenable<void> {
        this.disposables.forEach((d: vscode.Disposable) => d.dispose());

        // this.defaultClient is already in this.languageClients, so do not call dispose() on it.
        this.languageClients.forEach(client => client.dispose());
        this.languageClients.clear();
        cpptools.disposeWorkspaceData();
        return cpptools.DefaultClient.stopLanguageClient();
    }
}
