/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { Middleware } from 'vscode-languageclient';
import * as util from '../common';
import { logAndReturn } from '../Utility/Async/returns';
import * as telemetry from '../telemetry';
import { addCallHierarchyItemDetail } from './callHierarchy';
import { Client, DefaultClient, SymbolScope, workspaceReferences } from './client';
import { clients } from './extension';
import { getLocalizedString, getLocalizedSymbolScope, LocalizeStringParams } from './localization';
import { CancellationSender } from './references';
import { hasFileAssociation } from './settings';
import { shouldChangeFromCToCpp } from './utils';

export const RequestCancelled: number = -32800;
export const ServerCancelled: number = -32802;

enum CallHierarchyRequestStatus {
    Unknown,
    Succeeded,
    Canceled,
    CanceledByUser,
    Failed
}

interface WorkspaceSymbolData {
    scope: SymbolScope;
    suffix?: LocalizeStringParams;
}

interface WorkspaceSymbolWithData extends vscode.SymbolInformation {
    data?: WorkspaceSymbolData;
}

export function createProtocolFilter(): Middleware {
    let isCallHierarchyEntryRootNodeTelemetry: boolean = false;

    const logCallHierarchyTelemetry = (eventName: string, requestStatus: CallHierarchyRequestStatus, progressBarDuration?: number): void => {
        const properties: { [key: string]: string } = {};
        const metrics: { [key: string]: number } = {};

        let status: string = "Unknown";
        switch (requestStatus) {
            case CallHierarchyRequestStatus.Unknown: status = "Unknown"; break;
            case CallHierarchyRequestStatus.Succeeded: status = "Succeeded"; break;
            case CallHierarchyRequestStatus.Canceled: status = "Canceled"; break;
            case CallHierarchyRequestStatus.CanceledByUser: status = "CanceledByUser"; break;
            case CallHierarchyRequestStatus.Failed: status = "Failed"; break;
        }

        properties["Status"] = status;
        metrics["FirstRequest"] = isCallHierarchyEntryRootNodeTelemetry ? 1 : 0;
        if (progressBarDuration) {
            metrics["ProgressBarDuration"] = progressBarDuration;
        }

        telemetry.logLanguageServerEvent(eventName, properties, metrics);
        isCallHierarchyEntryRootNodeTelemetry = false;
    };

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
                        // Don't override the user's setting.
                        if (!hasFileAssociation(path.basename(document.uri.fsPath))) {
                            const baseFileName: string = path.basename(document.fileName);
                            const mappingString: string = baseFileName + "@" + document.fileName;
                            client.addFileAssociations(mappingString, "cpp");
                            void client.sendDidChangeSettings();
                            // The following will cause the file to be closed and reopened.
                            void vscode.languages.setTextDocumentLanguage(document, "cpp");
                            return;
                        }
                    }
                    // client.takeOwnership() will call client.TrackedDocuments.add() again, but that's ok. It's a Set.
                    client.takeOwnership(document);
                    void sendMessage(document);
                    const cppEditors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => util.isCpp(e.document));
                    void client.onDidChangeVisibleTextEditors(cppEditors).catch(logAndReturn.undefined);
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
        },
        prepareCallHierarchy: async (document, position, token, next) => {
            const references = workspaceReferences;
            references?.cancelCurrentReferenceRequest(CancellationSender.NewRequest);
            references?.clearViews();

            if (document.getWordRangeAtPosition(position) === undefined) {
                return undefined;
            }

            const cancelSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
            const cancellationTokenListener: vscode.Disposable = token.onCancellationRequested(() => cancelSource.cancel());
            const requestCanceledListener: vscode.Disposable | undefined =
                references?.onCancellationRequested(() => cancelSource.cancel());

            let result: vscode.CallHierarchyItem | vscode.CallHierarchyItem[] | null | undefined;
            try {
                result = await next(document, position, cancelSource.token);
            } finally {
                cancellationTokenListener.dispose();
                requestCanceledListener?.dispose();
            }

            if (cancelSource.token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }

            const items: vscode.CallHierarchyItem[] = Array.isArray(result) ? result : result ? [result] : [];
            if (items.length === 0) {
                return undefined;
            }

            const client: Client = clients.getClientFor(document.uri);
            if (client instanceof DefaultClient) {
                items.forEach(item => addCallHierarchyItemDetail(client, item));
            }
            isCallHierarchyEntryRootNodeTelemetry = true;
            return items[0];
        },
        provideCallHierarchyIncomingCalls: async (item, token, next) => {
            const references = workspaceReferences;
            references?.cancelCurrentReferenceRequest(CancellationSender.NewRequest);

            let requestCanceled: CancellationSender | undefined;
            const cancelSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
            const cancellationTokenListener: vscode.Disposable = token.onCancellationRequested(() => {
                requestCanceled = CancellationSender.ProviderToken;
                cancelSource.cancel();
            });
            const requestCanceledListener: vscode.Disposable | undefined = references?.onCancellationRequested(sender => {
                requestCanceled = sender;
                cancelSource.cancel();
            });

            let result: vscode.CallHierarchyIncomingCall[] | null | undefined;
            let requestError: unknown;
            let progressBarDuration: number | undefined;
            try {
                result = await next(item, cancelSource.token);
            } catch (error) {
                requestError = error;
            } finally {
                progressBarDuration = references?.getCallHierarchyProgressBarDuration();
                references?.resetProgressBar();
                references?.resetReferences();
                cancellationTokenListener.dispose();
                requestCanceledListener?.dispose();
            }

            if (cancelSource.token.isCancellationRequested || requestCanceled !== undefined) {
                const requestStatus: CallHierarchyRequestStatus = requestCanceled === CancellationSender.User ?
                    CallHierarchyRequestStatus.CanceledByUser : CallHierarchyRequestStatus.Canceled;
                logCallHierarchyTelemetry("CallHierarchyCallsTo", requestStatus, progressBarDuration);
                throw new vscode.CancellationError();
            }
            if (requestError) {
                throw requestError;
            }

            if (result) {
                const client: Client = clients.getClientFor(item.uri);
                if (client instanceof DefaultClient) {
                    result.forEach(call => addCallHierarchyItemDetail(client, call.from));
                }
            }
            logCallHierarchyTelemetry("CallHierarchyCallsTo", CallHierarchyRequestStatus.Succeeded, progressBarDuration);
            return result && result.length !== 0 ? result : undefined;
        },
        provideCallHierarchyOutgoingCalls: async (item, token, next) => {
            let result: vscode.CallHierarchyOutgoingCall[] | null | undefined;
            try {
                result = await next(item, token);
            } catch (error) {
                if (token.isCancellationRequested || error instanceof vscode.CancellationError) {
                    logCallHierarchyTelemetry("CallHierarchyCallsFrom", CallHierarchyRequestStatus.Canceled);
                }
                throw error;
            }

            if (token.isCancellationRequested) {
                logCallHierarchyTelemetry("CallHierarchyCallsFrom", CallHierarchyRequestStatus.Canceled);
                throw new vscode.CancellationError();
            }

            if (result) {
                const client: Client = clients.getClientFor(item.uri);
                if (client instanceof DefaultClient) {
                    result.forEach(call => addCallHierarchyItemDetail(client, call.to));
                }
            }
            logCallHierarchyTelemetry("CallHierarchyCallsFrom", CallHierarchyRequestStatus.Succeeded);
            return result && result.length !== 0 ? result : undefined;
        },
        provideWorkspaceSymbols: async (query, token, next) => {
            if (!query) {
                return [];
            }

            const result = await next(query, token);
            if (token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            if (!result) {
                return [];
            }

            for (const symbol of result) {
                const data: WorkspaceSymbolData | undefined = (symbol as WorkspaceSymbolWithData).data;
                if (!data) {
                    continue;
                }

                let suffix: string = data.suffix ? getLocalizedString(data.suffix) : "";
                if (suffix.length) {
                    if (data.scope === SymbolScope.Private) {
                        suffix = getLocalizedSymbolScope("private", suffix);
                    } else if (data.scope === SymbolScope.Protected) {
                        suffix = getLocalizedSymbolScope("protected", suffix);
                    }
                    symbol.name += ` (${suffix})`;
                } else if (data.scope === SymbolScope.Private) {
                    symbol.name += " (private)";
                } else if (data.scope === SymbolScope.Protected) {
                    symbol.name += " (protected)";
                }
            }
            return result;
        }
    };
}
