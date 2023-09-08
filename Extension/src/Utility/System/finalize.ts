/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { returns } from '../Async/returns';
import { DispatcherBusy } from '../Eventing/dispatcher';
import { is } from './guards';

export function ignore<T>(fn: () => T | undefined) {
    try {
        return fn();
    } catch (e: any) {
        // ignore
        console.error(`Ignored error in finalize ${e.toString()}\n${e.stack}`);
        return undefined;
    }
}
const finalized = new WeakSet();

export let ActiveFinalizers = Promise.resolve();

/** This closes/ends/stops/destroys/disposes of an object or a Promise<object>
 * If the input is a promise, the finalization will be delayed until the promise resolves.
 * This gives a consistent way to dispose of objects that might be in a variety of states.
*/
export function finalize(...items: any[]): void {
    for (const item of items) {
        if (!item) {
            return;
        }

        // ensure that we're not finalizing the same item twice for no reason (or in a loop).
        if (finalized.has(item)) {
            continue;
        }

        // store the value in the set so that we don't finalize it again.
        finalized.add(item);

        if (item.finalize) {
            try {
                const result = item.finalize();
                if (is.promise(result)) {
                    // if the item has a finalize method, and it returns a promise,
                    // then we'll put the rest of the finalization on hold until that promise resolves.
                    // (this is useful when things need a few moments to stop (i.e. node:net:Server)

                    const fin = result.catch(returns.undefined).then(() => {
                        ignore(() => item.end?.());
                        ignore(() => item.stop?.());
                        ignore(() => item.close?.());
                        ignore(() => item.destroy?.());
                        ignore(() => item.dispose?.());
                    });
                    ActiveFinalizers = Promise.all([fin, ActiveFinalizers, DispatcherBusy]).then(() => item.removeAllListeners?.());
                    return;
                }
            } catch {
                // ignore
            }
        }

        // progressively call the various methods that might be available
        // to tear down and release resources that might be held by the item.
        ignore(() => item.end?.());
        ignore(() => item.stop?.());
        ignore(() => item.close?.());
        ignore(() => item.destroy?.());
        ignore(() => item.dispose?.());

        // cleaning up listeners isn't as time critical, and it's possible there are some
        // events that are still in the queue, so we'll do this asynchronously.
        // and we expose the promise so that we can await it before exiting the process.
        ActiveFinalizers = Promise.all([ActiveFinalizers, DispatcherBusy]).then(() => item.removeAllListeners?.());
    }
}

