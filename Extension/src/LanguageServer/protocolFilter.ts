/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Middleware } from 'vscode-languageclient';
import { ClientCollection } from './clientCollection';
import { Client } from './client';

export function createProtocolFilter(me: Client, clients: ClientCollection): Middleware {
    // Disabling lint for invoke handlers
    /* tslint:disable */
    let defaultHandler: (data: any, callback: (data: any) => void) => void = (data, callback: (data) => void) => { if (clients.ActiveClient === me) {me.notifyWhenReady(() => callback(data));}};
    let invoke1 = (a, callback: (a) => any) => { if (clients.ActiveClient === me) { return me.requestWhenReady(() => callback(a)); } return null; };
    let invoke2 = (a, b, callback: (a, b) => any) => { if (clients.ActiveClient === me) { return me.requestWhenReady(() => callback(a, b)); } return null; };
    let invoke3 = (a, b, c, callback: (a, b, c) => any) => { if (clients.ActiveClient === me)  { return me.requestWhenReady(() => callback(a, b, c)); } return null; };
    let invoke4 = (a, b, c, d, callback: (a, b, c, d) => any) => { if (clients.ActiveClient === me)  { return me.requestWhenReady(() => callback(a, b, c, d)); } return null; };
    let invoke5 = (a, b, c, d, e, callback: (a, b, c, d, e) => any) => { if (clients.ActiveClient === me)  { return me.requestWhenReady(() => callback(a, b, c, d, e)); } return null; };
    /* tslint:enable */

    return {
        didOpen: (document, sendMessage) => {
            if (clients.checkOwnership(me, document)) {
                me.TrackedDocuments.add(document);
                me.provideCustomConfiguration(document).then(() => {
                    sendMessage(document);
                }, () => {
                    sendMessage(document);
                });
            }
        },
        didChange: defaultHandler,
        willSave: defaultHandler,
        willSaveWaitUntil: (event, sendMessage) => {
            if (clients.ActiveClient === me) {
                return me.requestWhenReady(() => sendMessage(event));
            }
            return Promise.resolve([]);
        },
        didSave: defaultHandler,
        didClose: (document, sendMessage) => {
            if (clients.ActiveClient === me) {
                console.assert(me.TrackedDocuments.has(document));
                me.TrackedDocuments.delete(document);
                me.notifyWhenReady(() => sendMessage(document));
            }
        },

        provideCompletionItem: invoke4,
        resolveCompletionItem: invoke2,
        provideHover: invoke3,
        provideSignatureHelp: invoke3,
        provideDefinition: invoke3,
        provideReferences: invoke4,
        provideDocumentHighlights: invoke3,
        provideDocumentSymbols: invoke2,
        provideWorkspaceSymbols: invoke2,
        provideCodeActions: invoke4,
        provideCodeLenses: invoke2,
        resolveCodeLens: invoke2,
        provideDocumentFormattingEdits: invoke3,
        provideDocumentRangeFormattingEdits: invoke4,
        provideOnTypeFormattingEdits: invoke5,
        provideRenameEdits: invoke4,
        provideDocumentLinks: invoke2,
        resolveDocumentLink: invoke2,

        // I believe the default handler will do the same thing.
        // workspace: {
        //     didChangeConfiguration: (sections, sendMessage) => sendMessage(sections)
        // }
    };
}
