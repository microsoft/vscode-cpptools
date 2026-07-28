/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { ManualPromise } from '../Utility/Async/manualPromise';
import { ManualSignal } from '../Utility/Async/manualSignal';
import { is } from '../Utility/System/guards';

export class DispatchQueue {
    public readonly isStarted = new ManualSignal<void>(true);
    public readonly dispatching = new ManualSignal<void>();
    public static instance = new DispatchQueue();

    /** A queue of asynchronous tasks that need to be processed befofe ready is considered active. */
    private queue = new Array<[ManualPromise<unknown>, () => Promise<unknown>] | [ManualPromise<unknown>]>();

    /** returns a promise that waits initialization and/or a change to configuration to complete (i.e. language client is ready-to-use) */
    get ready(): Promise<void> {
        if (!this.dispatching.isCompleted || this.queue.length) {
            // if the dispatcher has stuff going on, then we need to stick in a promise into the queue so we can
            // be notified when it's our turn
            const p = new ManualPromise<void>();
            this.queue.push([p as ManualPromise<unknown>]);
            return p;
        }

        // otherwise, we're only waiting for the client to be in an initialized state, in which case just wait for that.
        return this.isStarted;
    }

    /**
     * Enqueue a task to ensure that the order is maintained. The tasks are executed sequentially after the client is ready.
     *
     * this is a bit more expensive than `.ready` - this ensures the task is absolutely finished executing before allowing
     * the dispatcher to move forward.
     *
     * Use `enqueue()` when you want to ensure that subsequent calls are blocked until a critical bit of code is run.
     * Use `await <client>.ready` when you need to ensure that the client is initialized, and still run in order.
     */
    enqueue<T>(task: () => Promise<T>) {
        // create a placeholder promise that is resolved when the task is complete.
        const result = new ManualPromise<unknown>();

        // add the task to the queue
        this.queue.push([result, task]);

        // if we're not already dispatching, start
        if (this.dispatching.isSet) {
            // start dispatching
            void this.dispatch();
        }

        // return the placeholder promise to the caller.
        return result as Promise<T>;
    }

    /**
     * The dispatch loop asynchronously processes items in the async queue in order, and ensures that tasks are dispatched in the
     * order they were inserted.
     */
    private async dispatch() {
        // reset the promise for the dispatcher
        this.dispatching.reset();

        do {
            // ensure that this is OK to start working
            await this.isStarted;

            // pick items up off the queue and run then one at a time until the queue is empty
            const [promise, task] = this.queue.shift() ?? [];
            if (is.promise(promise)) {
                try {
                    promise.resolve(task ? await task() : undefined);
                } catch (e) {
                    console.log(e);
                    promise.reject(e);
                }
            }
        } while (this.queue.length);

        // unblock anything that is waiting for the dispatcher to empty
        this.dispatching.resolve();
    }
}
