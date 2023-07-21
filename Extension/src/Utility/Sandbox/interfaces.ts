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
    /** the "filename" of the source to compile */
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

    /**
     * set to true to invoke the TS transpiler (to resolve imports/exports/etc)
     *
     * Transpiling isn't super fast (~300ms), so this should only be turned on when the consumer is
     * using exports/imports or other TS features.
     *
     * @default false
     *
    */
    transpile?: boolean;
}

export type ArbitraryModule = Record<string, (...args: any[]) => unknown>;

export function hasErrors(instance: any): instance is ScriptError[] {
    if (is.array(instance)) {
        return instance.length > 0;
    }
    return false;
}
