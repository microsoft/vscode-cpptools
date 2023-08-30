/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { setTimeout as after, setImmediate } from 'timers/promises';

/** pause for a number of milliseconds */
export const sleep = after as (msec: number) => Promise<void>;

/** enqueue the call to the callback function to happen on the next available tick, and return a promise to the result */
export function then<T>(callback: () => Promise<T> | T): Promise<T> {
    return setImmediate().then(callback);
}
