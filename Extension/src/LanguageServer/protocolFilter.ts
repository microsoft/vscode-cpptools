/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Middleware } from 'vscode-languageclient';
import { ClientCollection } from './clientCollection';
import { Client } from './client';
import { SourceFileConfiguration, CustomConfigurationProvider } from '../api';
import { getActiveCustomConfigurationProvider } from './extension';

export function createProtocolFilter(me: Client, clients: ClientCollection): Middleware {
    // Disabling lint for invoke handlers
    /* tslint:disable */
    let defaultHandler: (data: any, callback: (data: any) => void) => void = (data, callback: (data) => void) => { if (clients.ActiveClient === me) { callback(data); } };
    let invoke1 = (a, callback: (a) => any) => { if (clients.ActiveClient === me) { return callback(a); } return null; };
    let invoke2 = (a, b, callback: (a, b) => any) => { if (clients.ActiveClient === me) { return callback(a, b); } return null; };
    let invoke3 = (a, b, c, callback: (a, b, c) => any) => { if (clients.ActiveClient === me)  { return callback(a, b, c); } return null; };
    let invoke4 = (a, b, c, d, callback: (a, b, c, d) => any) => { if (clients.ActiveClient === me)  { return callback(a, b, c, d); } return null; };
    let invoke5 = (a, b, c, d, e, callback: (a, b, c, d, e) => any) => { if (clients.ActiveClient === me)  { return callback(a, b, c, d, e); } return null; };
    /* tslint:enable */

    return {
        didOpen: (document, sendMessage) => {
            if (clients.checkOwnership(me, document)) {
                me.TrackedDocuments.add(document);
                let provider: CustomConfigurationProvider = getActiveCustomConfigurationProvider(); 
                if (provider) {
                    // If custom config provider exists, ask for the custom configuration and send a notification to the server
                    // before the textDocument/didOpen message so that the right information is used when the file is opened.
                    provider.provideConfiguration(document.uri)
                    .then((config: SourceFileConfiguration) => {
                        me.sendCustomConfiguration(document, config);
                        sendMessage(document);
                    });
                } else {
                    sendMessage(document);
                }
            }
        },
        didChange: defaultHandler,
        willSave: defaultHandler,
        willSaveWaitUntil: (event, sendMessage) => {
            if (clients.ActiveClient === me) {
                return sendMessage(event);
            }
            return Promise.resolve([]);
        },
        didSave: defaultHandler,
        didClose: (document, sendMessage) => {
            if (clients.ActiveClient === me) {
                console.assert(me.TrackedDocuments.has(document));
                me.TrackedDocuments.delete(document);
                sendMessage(document);
            }
        },

        provideCompletionItem: invoke3,
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
