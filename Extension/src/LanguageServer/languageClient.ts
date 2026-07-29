/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Disposable } from 'vscode';
import { CancellationToken, NotificationHandler, NotificationType, RequestType } from 'vscode-languageclient';
import * as rpc from 'vscode-languageclient/node';
import { ManualSignal } from '../Utility/Async/manualSignal';

export class LanguageClient {
    private _rpcClient?: rpc.LanguageClient;
    private readonly _started = new ManualSignal<void>(true);

    /**
     * Returns a promise that waits for the RPC connection to be ready.
     */
    public get ready(): Promise<void> {
        return this._started;
    }

    /**
     * set the initialization state of the underlying RPC client.
     * This is used to indicate that the underlying RPC client has been initialized and is ready to send requests.
     * If resetting the RPC client, set this to false.
     */
    public set isStarted(value: boolean) {
        if (value) {
            this._started.resolve();
        } else {
            this._started.reset();
        }
    }

    /**
     * Returns true if the underlying RPC client has been initialized.
     * Used in cases where a quick check of the initialization state is desired instead of waiting on the `ready` promise.
     */
    public get isInitialized(): boolean {
        return !!this._rpcClient;
    }

    /**
     * Sets the underlying RPC client.
     * This should only be called once during initialization.
     */
    public setLanguageClient(languageClient?: rpc.LanguageClient): void {
        this._rpcClient = languageClient;
    }

    /**
     * Validate and return the underlying RPC client.
     * Strips away the `undefined` type from the RPC client.
     */
    private get rpcClient(): rpc.LanguageClient {
        if (!this._rpcClient) {
            throw new Error("Attempting to use languageClient before initialized");
        }

        return this._rpcClient;
    }

    public get protocol2CodeConverter(): rpc.LanguageClient["protocol2CodeConverter"] {
        return this.rpcClient.protocol2CodeConverter;
    }

    public get code2ProtocolConverter(): rpc.LanguageClient["code2ProtocolConverter"] {
        return this.rpcClient.code2ProtocolConverter;
    }

    public async sendRequest<P, R, E>(type: RequestType<P, R, E>, params: P, token?: CancellationToken): Promise<R> {
        await this.ready;
        return this.rpcClient.sendRequest(type, params, token);
    }

    public async sendNotification<P>(type: NotificationType<P>, params?: P): Promise<void> {
        await this.ready;
        return this.rpcClient.sendNotification(type, params);
    }

    public onNotification<P>(type: NotificationType<P>, handler: NotificationHandler<P>): Disposable {
        return this.rpcClient.onNotification(type, handler);
    }

    public stop(): Promise<void> {
        return this._rpcClient?.stop() ?? Promise.resolve();
    }
}
