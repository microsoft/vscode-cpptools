/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

const startTime = Date.now();

export function elapsed() {
    return `[${Date.now() - startTime}msec] `;
}

export function time(fn: (msec: number, elapsed: number) => void) {
    const now = Date.now();
    return {
        [Symbol.dispose]() {
            fn(Date.now() - now, Date.now() - startTime);
        }
    };
}
