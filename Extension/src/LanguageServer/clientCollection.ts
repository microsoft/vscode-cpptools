/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as util from '../common';
import * as telemetry from '../telemetry';
import * as cpptools from './client';
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

    // This is a one-time switch to a mode that suppresses launching of the cpptools client process.
    private useFailsafeMode: boolean = false;

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
                const newClient: cpptools.Client = cpptools.createClient(folder);
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
            this.activeClient = cpptools.createClient();
        }
        this.defaultClient = this.activeClient;
        this.languageClients.set(key, this.activeClient);

        this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(e => this.onDidChangeWorkspaceFolders(e)));
    }

    public async didChangeActiveEditor(editor?: vscode.TextEditor): Promise<void> {
        this.activeDocument = editor?.document;

        // Notify the active client that the document has changed.
        // If there is no active document, switch to the default client.
        const activeClient: cpptools.Client = !editor ? this.defaultClient : this.getClientFor(editor.document.uri);
        await activeClient.didChangeActiveEditor(editor);

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

        return this.getClientFor(document.uri) === client;
    }

    /**
     * creates a new client to replace one that crashed.
     */
    public async recreateClients(switchToFailsafeMode?: boolean): Promise<void> {

        // Swap out the map, so we are not changing it while iterating over it.
        const oldLanguageClients: Map<string, cpptools.Client> = this.languageClients;
        this.languageClients = new Map<string, cpptools.Client>();

        if (switchToFailsafeMode) {
            this.useFailsafeMode = true;
        }

        for (const pair of oldLanguageClients) {
            const client: cpptools.Client = pair[1];

            const newClient: cpptools.Client = this.createClient(client.RootFolder, true);
            for (const document of client.TrackedDocuments.values()) {
                this.transferOwnership(document, client);
                await newClient.sendDidOpen(document);
            }

            if (this.activeClient === client) {
                // It cannot be undefined. If there is an active document, we activate it later.
                this.activeClient = newClient;
            }

            if (this.defaultClient === client) {
                this.defaultClient = newClient;
            }

            client.dispose();
        }

        if (this.activeDocument) {
            this.activeClient = this.getClientFor(this.activeDocument.uri);
            this.activeClient.updateActiveDocumentTextOptions();
            this.activeClient.activate();
            await this.activeClient.didChangeActiveEditor(vscode.window.activeTextEditor);
        }
        const cppEditors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => util.isCpp(e.document));
        await this.defaultClient.onDidChangeVisibleTextEditors(cppEditors);
    }

    private async onDidChangeWorkspaceFolders(e?: vscode.WorkspaceFoldersChangeEvent): Promise<void> {
        const folderCount: number = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0;
        if (folderCount > 1) {
            telemetry.logLanguageServerEvent("workspaceFoldersChange", { "count": folderCount.toString() });
        }

        if (e !== undefined) {

            e.removed.forEach(folder => {
                const path: string = util.asFolder(folder.uri);
                const client: cpptools.Client | undefined = this.languageClients.get(path);
                if (client) {
                    this.languageClients.delete(path); // Do this first so that we don't iterate on it during the ownership transfer process.

                    // Transfer ownership of the client's documents to another client.
                    client.TrackedDocuments.forEach(document => this.transferOwnership(document, client));

                    if (this.activeClient === client) {
                        this.activeClient.deactivate();
                    }

                    client.dispose();
                }
            });

            if (e.added.length > 0) {
                // Send a new set of settings. This will ensure the settings are
                // read for new workspace folders. Send them up before creating new
                // clients, so the native process is already aware of all workspace
                // folders before receiving new CppProperties for new folders.
                this.defaultClient.sendDidChangeSettings();
                e.added.forEach(folder => {
                    const path: string = util.asFolder(folder.uri);
                    const client: cpptools.Client | undefined = this.languageClients.get(path);
                    if (!client) {
                        this.createClient(folder, true);
                    }
                });
            }

            // From https://code.visualstudio.com/api/references/vscode-api
            //
            //      Note: this event will not fire if the first workspace folder is added, removed or changed,
            //      because in that case the currently executing extensions (including the one that listens to
            //      this event) will be terminated and restarted so that the (deprecated) rootPath property is
            //      updated to point to the first workspace folder.

            // Ensure the best client for the currently active document is activated.
            if (this.activeDocument) {
                const newActiveClient: cpptools.Client = this.getClientFor(this.activeDocument.uri);
                // If a client is newly created here, it will be activated by default.
                if (this.activeClient !== newActiveClient) {
                    // Redundant deactivate should be OK.
                    this.activeClient.deactivate();
                    this.activeClient = newActiveClient;
                    this.activeClient.updateActiveDocumentTextOptions();
                    this.activeClient.activate();
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

    public getDefaultClient(): cpptools.Client {
        return this.defaultClient;
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
            return this.createClient(folder);
        }
    }

    public createClient(folder?: vscode.WorkspaceFolder, deactivated?: boolean): cpptools.Client {
        const newClient: cpptools.Client = this.useFailsafeMode ? cpptools.createNullClient() : cpptools.createClient(folder);
        if (deactivated) {
            newClient.deactivate(); // e.g. prevent the current config from switching.
        }
        const key: string = folder ? util.asFolder(folder.uri) : defaultClientKey;
        this.languageClients.set(key, newClient);
        getCustomConfigProviders().forEach(provider => void newClient.onRegisterCustomConfigurationProvider(provider));
        return newClient;
    }

    public dispose(): Thenable<void> {
        this.disposables.forEach((d: vscode.Disposable) => d.dispose());

        // this.defaultClient is already in this.languageClients, so do not call dispose() on it.
        this.languageClients.forEach(client => client.dispose());
        this.languageClients.clear();
        return cpptools.DefaultClient.stopLanguageClient();
    }
}
