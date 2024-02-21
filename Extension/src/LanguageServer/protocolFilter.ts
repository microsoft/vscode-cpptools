/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { Middleware } from 'vscode-languageclient';
import * as util from '../common';
import { Client } from './client';
import { clients } from './extension';
import { shouldChangeFromCToCpp } from './utils';

let anyFileOpened: boolean = false;

export function createProtocolFilter(): Middleware {
    // Disabling lint for invoke handlers
    const invoke1 = (a: any, next: (a: any) => any): any => clients.ActiveClient.enqueue(() => next(a));
    const invoke2 = (a: any, b: any, next: (a: any, b: any) => any): any => clients.ActiveClient.enqueue(() => next(a, b));
    const invoke3 = (a: any, b: any, c: any, next: (a: any, b: any, c: any) => any): any => clients.ActiveClient.enqueue(() => next(a, b, c));
    const invoke4 = (a: any, b: any, c: any, d: any, next: (a: any, b: any, c: any, d: any) => any): any => clients.ActiveClient.enqueue(() => next(a, b, c, d));

    return {
        didOpen: async (document, sendMessage) => clients.ActiveClient.enqueue(async () => {
            if (!util.isCpp(document)) {
                return;
            }
            util.setWorkspaceIsCpp();
            const client: Client = clients.getClientFor(document.uri);
            if (clients.checkOwnership(client, document)) {
                const uriString: string = document.uri.toString();
                if (!client.TrackedDocuments.has(uriString)) {
                    client.TrackedDocuments.set(uriString, document);
                    // Work around vscode treating ".C" or ".H" as c, by adding this file name to file associations as cpp
                    if (document.languageId === "c" && shouldChangeFromCToCpp(document)) {
                        const baseFileName: string = path.basename(document.fileName);
                        const mappingString: string = baseFileName + "@" + document.fileName;
                        client.addFileAssociations(mappingString, "cpp");
                        client.sendDidChangeSettings();
                        document = await vscode.languages.setTextDocumentLanguage(document, "cpp");
                    }
                    await client.provideCustomConfiguration(document.uri, undefined);
                    // client.takeOwnership() will call client.TrackedDocuments.add() again, but that's ok. It's a Set.
                    client.onDidOpenTextDocument(document);
                    client.takeOwnership(document);
                    await sendMessage(document);

                    // For a file already open when we activate, sometimes we don't get any notifications about visible
                    // or active text editors, visible ranges, or text selection. As a workaround, we trigger
                    // onDidChangeVisibleTextEditors here, only for the first file opened.
                    if (!anyFileOpened)
                    {
                        anyFileOpened = true;
                        const cppEditors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => util.isCpp(e.document));
                        await client.onDidChangeVisibleTextEditors(cppEditors);
                    }
                }
            }
        }),
        didChange: async (textDocumentChangeEvent, sendMessage) => clients.ActiveClient.enqueue(async () => {
            const me: Client = clients.getClientFor(textDocumentChangeEvent.document.uri);
            me.onDidChangeTextDocument(textDocumentChangeEvent);
            await sendMessage(textDocumentChangeEvent);
        }),
        willSave: invoke1,
        willSaveWaitUntil: async (event, sendMessage) => {
            // await clients.ActiveClient.ready;
            // Don't use awaitUntilLanguageClientReady.
            // Otherwise, the message can be delayed too long.
            const me: Client = clients.getClientFor(event.document.uri);
            if (me.TrackedDocuments.has(event.document.uri.toString())) {
                return sendMessage(event);
            }
            return [];
        },
        didSave: invoke1,
        didClose: async (document, sendMessage) => clients.ActiveClient.enqueue(async () => {
            const me: Client = clients.getClientFor(document.uri);
            const uriString: string = document.uri.toString();
            if (me.TrackedDocuments.has(uriString)) {
                me.onDidCloseTextDocument(document);
                me.TrackedDocuments.delete(uriString);
                await sendMessage(document);
            }
        }),
        provideCompletionItem: invoke4,
        resolveCompletionItem: invoke2,
        provideHover: async (document, position, token, next: (document: any, position: any, token: any) => any) => clients.ActiveClient.enqueue(async () => {
            const me: Client = clients.getClientFor(document.uri);
            if (me.TrackedDocuments.has(document.uri.toString())) {
                return next(document, position, token);
            }
            return null;
        }),
        provideSignatureHelp: invoke4,
        provideDefinition: invoke3,
        provideReferences: invoke4,
        provideDocumentHighlights: invoke3,
        provideDeclaration: invoke3,
        workspace: {
            didChangeConfiguration: invoke1
        }
    };
}
