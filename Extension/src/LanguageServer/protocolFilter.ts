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
            if (util.isCpp(document)) {
                util.setWorkspaceIsCpp();
            }

            const client: Client = clients.getClientFor(document.uri);
            if (clients.checkOwnership(client, document)) {
                if (!client.TrackedDocuments.has(document)) {
                    client.TrackedDocuments.add(document);
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

                    // For a file already open when we active, sometimes we don't get any notifications about visible
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

            // const client: Client = clients.getClientFor(document.uri);
            // if (client) {
            //     // Log warm start.
            //     if (clients.checkOwnership(client, document)) {
            //         if (!client.isInitialized()) {
            //             // This can randomly get hit when adding/removing workspace folders.
            //             await client.ready;
            //         }
            //         // Do not call await between TrackedDocuments.has() and TrackedDocuments.add(),
            //         // to avoid sending redundant didOpen notifications.
            //         if (!client.TrackedDocuments.has(document)) {
            //             // If not yet tracked, process as a newly opened file.  (didOpen is sent to server in client.takeOwnership()).
            //             client.TrackedDocuments.add(document);
            //             clients.timeTelemetryCollector.setDidOpenTime(document.uri);
            //             // Work around vscode treating ".C" or ".H" as c, by adding this file name to file associations as cpp
            //             if (document.languageId === "c" && shouldChangeFromCToCpp(document)) {
            //                 const baseFileName: string = path.basename(document.fileName);
            //                 const mappingString: string = baseFileName + "@" + document.fileName;
            //                 client.addFileAssociations(mappingString, "cpp");
            //                 client.sendDidChangeSettings();
            //                 document = await vscode.languages.setTextDocumentLanguage(document, "cpp");
            //             }
            //             await client.provideCustomConfiguration(document.uri, undefined);
            //             // client.takeOwnership() will call client.TrackedDocuments.add() again, but that's ok. It's a Set.
            //             client.onDidOpenTextDocument(document);
            //             await client.takeOwnership(document);
            //         }
            //     }
            // }

            // const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document === document);
            // if (editor) {
            //     // If the file was visible editor when we were activated, we will not get a call to
            //     // onDidChangeVisibleTextEditors, so immediately open any file that is visible when we receive didOpen.
            //     // Otherwise, we defer opening the file until it's actually visible.
            //     await clients.ActiveClient.ready;
            //     if (editor && editor === vscode.window.activeTextEditor) {
            //         onDidChangeActiveTextEditor(editor);
            //     }
            // } else {
            //     // NO-OP
            //     // If the file is not opened into an editor (such as in response for a control-hover),
            //     // we do not actually load a translation unit for it.  When we receive a didOpen, the file
            //     // may not yet be visible.  So, we defer creation of the translation until we receive a
            //     // call to onDidChangeVisibleTextEditors(), in extension.ts.  A file is only loaded when
            //     // it is actually opened in the editor (not in response to control-hover, which sends a
            //     // didOpen), and first becomes visible.
            // }
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
            if (me.TrackedDocuments.has(event.document)) {
                return sendMessage(event);
            }
            return [];
        },
        didSave: invoke1,
        didClose: async (document, sendMessage) => clients.ActiveClient.enqueue(async () => {
            const me: Client = clients.getClientFor(document.uri);
            if (me.TrackedDocuments.has(document)) {
                me.onDidCloseTextDocument(document);
                me.TrackedDocuments.delete(document);
                await sendMessage(document);
            }
        }),
        provideCompletionItem: invoke4,
        resolveCompletionItem: invoke2,
        provideHover: async (document, position, token, next: (document: any, position: any, token: any) => any) => clients.ActiveClient.enqueue(async () => {
            const me: Client = clients.getClientFor(document.uri);
            if (me.TrackedDocuments.has(document)) {
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
