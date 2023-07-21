/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { fail } from 'node:assert';
import { returns } from './returns';
import { sleep } from './sleep';

/** wait on any of the promises to resolve, or if the timeout is reached, throw */
export async function timeout(msecs: number, ...promises: Promise<any>[]): Promise<any> {
    // get a promise for the timeout
    const t = sleep(msecs).then(() => fail(`Timeout expired after ${msecs}ms`));

    // wait until either the timout expires or one of the promises resolves
    await Promise.race([t, ...promises]);

    // tag the timeout with a catch to prevent unhandled rejection
    t.catch(returns.undefined);
}
