/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ManualPromise } from '../../src/Automation/Async/manual-promise';
import { describe } from 'mocha';
import { ok, strictEqual, throws } from 'assert';
import { setTimeout } from 'timers/promises';

// force dev mode (which throws on duplicate resolve calls)
(global as any).DEVMODE = true;

describe('Manual Promise', () => {
    it('works as advertised', async () => {
        // create a promise
        const promise = new ManualPromise<string>();

        // starts off in the pending state
        ok(promise.isPending, "promise should be in the pending state.");

        // verify that the promise is still not resolved.
        strictEqual(await Promise.race([promise, setTimeout(1, "timed-out")]), "timed-out", "promise should not have resolved yet.");

        // explicitly resolve the promise
        promise.resolve("promise-resolved");

        // verify that the promise is resolved
        ok(promise.isResolved, "promise should be in the resolved state.");

        // await it
        strictEqual(await Promise.race([promise, setTimeout(1, "timed-out")]), "promise-resolved", "promise should have resolved.");

        // can't resolve it twice!
        throws(() => promise.resolve("promise-resolved-again"), "promise should not be able to resolve twice.");
    });
});

