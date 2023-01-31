/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Middleware } from 'vscode-languageclient';
import { Client } from './client';
import * as vscode from 'vscode';
import { clients, onDidChangeActiveTextEditor, processDelayedDidOpen } from './extension';

export function createProtocolFilter(): Middleware {
    // Disabling lint for invoke handlers
    const invoke1 = (a: any, next: (a: any) => any): any => clients.ActiveClient.requestWhenReady(() => next(a));
    const invoke2 = (a: any, b: any, next: (a: any, b: any) => any): any => clients.ActiveClient.requestWhenReady(() => next(a, b));
    const invoke3 = (a: any, b: any, c: any, next: (a: any, b: any, c: any) => any): any => clients.ActiveClient.requestWhenReady(() => next(a, b, c));
    const invoke4 = (a: any, b: any, c: any, d: any, next: (a: any, b: any, c: any, d: any) => any): any => clients.ActiveClient.requestWhenReady(() => next(a, b, c, d));

    return {
        didOpen: async (document, sendMessage) => {
            const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document === document);
            if (editor) {
                // If the file was visible editor when we were activated, we will not get a call to
                // onDidChangeVisibleTextEditors, so immediately open any file that is visible when we receive didOpen.
                // Otherwise, we defer opening the file until it's actually visible.
                await processDelayedDidOpen(document);
                if (editor && editor === vscode.window.activeTextEditor) {
                    onDidChangeActiveTextEditor(editor);
                }
            } else {
                // NO-OP
                // If the file is not opened into an editor (such as in response for a control-hover),
                // we do not actually load a translation unit for it.  When we receive a didOpen, the file
                // may not yet be visible.  So, we defer creation of the translation until we receive a
                // call to onDidChangeVisibleTextEditors(), in extension.ts.  A file is only loaded when
                // it is actually opened in the editor (not in response to control-hover, which sends a
                // didOpen), and first becomes visible.
            }
        },
        didChange: async (textDocumentChangeEvent, sendMessage) => {
            await clients.ActiveClient.requestWhenReady(async () => {
                const me: Client = clients.getClientFor(textDocumentChangeEvent.document.uri);
                me.onDidChangeTextDocument(textDocumentChangeEvent);
                await sendMessage(textDocumentChangeEvent);
            });
        },
        willSave: invoke1,
        willSaveWaitUntil: async (event, sendMessage) => {
            // await clients.ActiveClient.awaitUntilLanguageClientReady();
            // Don't use awaitUntilLanguageClientReady.
            // Otherwise, the message can be delayed too long.
            const me: Client = clients.getClientFor(event.document.uri);
            if (me.TrackedDocuments.has(event.document)) {
                return sendMessage(event);
            }
            return [];
        },
        didSave: invoke1,
        didClose: async (document, sendMessage) => {
            await clients.ActiveClient.requestWhenReady(async () => {
                const me: Client = clients.getClientFor(document.uri);
                if (me.TrackedDocuments.has(document)) {
                    me.onDidCloseTextDocument(document);
                    me.TrackedDocuments.delete(document);
                    await sendMessage(document);
                }
            });
        },
        provideCompletionItem: invoke4,
        resolveCompletionItem: invoke2,
        provideHover: async (document, position, token, next: (document: any, position: any, token: any) => any) =>
            clients.ActiveClient.requestWhenReady(async () => {
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
