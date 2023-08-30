/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from '../System/guards';

export interface ScriptError {
    line: number;
    column: number;
    message: string;
    file: string;
    category: number;
    code: number;
    offset: number;
}

export interface CreateOptions {
    /** the filename (or identity of the the source code, which may or may not be an actual filename,
     * it could be any textual identifier that the caller wants to call it.) of the source to compile */
    filename?: string;

    /** the column in the physical file where the source starts
     *
     * @default 0
    */
    columnOffset?: number;

    /** the line in the physical file where the source starts
     *
     * @default 0
     */
    lineOffset?: number;

}

export type ArbitraryModule = Record<string, (...args: any[]) => unknown>;

export function hasErrors(instance: any): instance is ScriptError[] {
    if (is.array(instance)) {
        return instance.length > 0;
    }
    return false;
}
