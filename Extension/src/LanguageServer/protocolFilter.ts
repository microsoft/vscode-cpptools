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

export const RequestCancelled: number = -32800;
export const ServerCancelled: number = -32802;

export function createProtocolFilter(): Middleware {
    return {
        didOpen: async (document, sendMessage) => {
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
                        // This will cause the file to be closed and reopened.
                        void vscode.languages.setTextDocumentLanguage(document, "cpp");
                        return;
                    }
                    // client.takeOwnership() will call client.TrackedDocuments.add() again, but that's ok. It's a Set.
                    client.onDidOpenTextDocument(document);
                    client.takeOwnership(document);
                    void sendMessage(document);
                }
            }
        },
        willSaveWaitUntil: async (event, sendMessage) => {
            const me: Client = clients.getClientFor(event.document.uri);
            if (me.TrackedDocuments.has(event.document.uri.toString())) {
                return sendMessage(event);
            }
            return [];
        },
        didClose: async (document, sendMessage) => {
            const me: Client = clients.getClientFor(document.uri);
            const uriString: string = document.uri.toString();
            if (me.TrackedDocuments.has(uriString)) {
                me.onDidCloseTextDocument(document);
                me.TrackedDocuments.delete(uriString);
                void sendMessage(document);
            }
        }
    };
}
