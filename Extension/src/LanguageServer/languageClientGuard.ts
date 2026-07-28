/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Disposable } from 'vscode';
import { CancellationToken, NotificationHandler, NotificationType, RequestType } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/node';
import { DispatchQueue } from './dispatchQueue';

export class LanguageClientGuard {
    private languageClient?: LanguageClient;

    public get isInitialized(): boolean {
        return !!this.languageClient;
    }

    public setLanguageClient(languageClient: LanguageClient): void {
        this.languageClient = languageClient;
    }

    private instance(): LanguageClient {
        const client: LanguageClient | undefined = this.languageClient;
        if (!client) {
            throw new Error("Attempting to use languageClient before initialized");
        }

        return client;
    }

    public get protocol2CodeConverter(): LanguageClient["protocol2CodeConverter"] {
        return this.instance().protocol2CodeConverter;
    }

    public get code2ProtocolConverter(): LanguageClient["code2ProtocolConverter"] {
        return this.instance().code2ProtocolConverter;
    }

    public async sendRequest<P, R, E>(type: RequestType<P, R, E>, params: P, token?: CancellationToken): Promise<R> {
        if (!this.languageClient) {
            throw new Error("Attempting to use languageClient before initialized");
        }
        await DispatchQueue.instance.ready;
        return this.languageClient.sendRequest(type, params, token);
    }

    public async sendNotification<P>(type: NotificationType<P>, params?: P): Promise<void> {
        if (!this.languageClient) {
            throw new Error("Attempting to use languageClient before initialized");
        }
        await DispatchQueue.instance.ready;
        return this.languageClient.sendNotification(type, params);
    }

    public onNotification<P>(type: NotificationType<P>, handler: NotificationHandler<P>): Disposable {
        if (!this.languageClient) {
            throw new Error("Attempting to use languageClient before initialized");
        }
        return this.languageClient.onNotification(type, handler);
    }

    public stop(): Promise<void> {
        return this.languageClient?.stop() ?? Promise.resolve();
    }
}
