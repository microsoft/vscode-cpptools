/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ok, strictEqual } from 'assert';
import { describe } from 'mocha';
import { setTimeout } from 'timers/promises';
import { ManualSignal } from '../../src/Utility/Async/manualSignal';
import { Signal } from '../../src/Utility/Async/signal';

describe('Signal', () => {
    it('automatically resets once awaited', async () => {
        // create a signal
        const signal = new Signal<string>();

        // really, this one is always pending, since resolving it resets it.
        ok(signal.isPending, "signal should be in the pending state.");

        // verify that the signal is still not resolved.
        strictEqual(await Promise.race([signal, setTimeout(1, "timed-out")]), "timed-out", "signal should not have resolved yet.");

        // create a promise that resolves when the signal is tripped
        const p = signal.then();
        // still not resolved...
        strictEqual(await Promise.race([p, setTimeout(1, "timed-out")]), "timed-out", "signal should not have resolved yet.");

        // explicitly resolve the signal
        signal.resolve("signal-tripped");

        // which the promise is now tripped.
        strictEqual(await p, "signal-tripped", "signal should have resolved.");

        // yet the signal is still pending.
        ok(signal.isPending, "signal should be in the pending state.");
    });
});

describe('Manual Signal', () => {
    it('manually reset signal', async () => {
        // create a signal
        const signal = new ManualSignal<string>();

        // starts out in the completed state.
        ok(signal.isCompleted, "signal should be in the completed state.");

        signal.reset();

        // really, this one is always pending, since resolving it resets it.
        ok(signal.isPending, "signal should be in the pending state.");

        // verify that the signal is still not resolved.
        strictEqual(await Promise.race([signal, setTimeout(1, "timed-out")]), "timed-out", "signal should not have resolved yet.");

        // create a promise that resolves when the signal is tripped
        const p = signal.then();
        // still not resolved...
        strictEqual(await Promise.race([p, setTimeout(1, "timed-out")]), "timed-out", "signal should not have resolved yet.");

        // explicitly resolve the signal
        signal.resolve("signal-tripped");

        // which the promise is now tripped.
        strictEqual(await p, "signal-tripped", "signal should have resolved.");

        // yet the signal is still pending.
        ok(signal.isResolved, "signal is now in the resolved state.");

        signal.reset();

        // should be back in the pending state.
        ok(signal.isPending, "signal should be in the pending state.");
    });
});
