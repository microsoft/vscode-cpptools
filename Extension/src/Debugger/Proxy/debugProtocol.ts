/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { DebugProtocol } from 'vscode-debugprotocol'

export function serializeProtocolEvent(message: DebugProtocol.ProtocolMessage): string {
    const payload: string = JSON.stringify(message);
    const finalPayload: string = `Content-Length: ${payload.length}\r\n\r\n${payload}`;
    return finalPayload;
}

/** Response sent to the client when dependencies are still being downloaded.
 * Note this class is not a general purpose error response.
 */
export class InitializationErrorResponse implements DebugProtocol.ErrorResponse {
    public body: { error?: DebugProtocol.Message };
    public request_seq: number;
    public success: boolean;
    public command: string;
    public seq: number;
    public type: string;

    constructor(public message: string) {
        this.request_seq = 1;
        this.seq = 1;
        this.type = "response";
        this.success = false;
        this.command = "initialize";
    }
}
