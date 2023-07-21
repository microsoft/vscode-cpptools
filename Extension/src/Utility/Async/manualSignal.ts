/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ManualPromise } from './manualPromise';
import { Resetable } from './resolvable';

/**
 * A signal is an externally fulfillable promise ( @see ManualPromise )
 * that once awaited, can be manually reset to the unwaited state
 *
 * The virtue of this vs some kind of event emitter, is that it can be used
 * to arbitrarily await a change in some kind of status without the overhead
 * of managinng a subscription to an event emitter.
 */
export class ManualSignal<T> implements Promise<T>, Resetable<T> {
    [Symbol.toStringTag] = 'Promise';

    private promise = new ManualPromise<T>();
    constructor(initiallyReset = false) {
        if (!initiallyReset) {
            // initially not reset.
            this.promise.resolve();
        }
    }
    get isPending(): boolean {
        return this.promise.isPending;
    }
    get isCompleted(): boolean {
        return this.promise.isCompleted;
    }
    get isResolved(): boolean {
        return this.promise.isResolved;
    }
    get isRejected(): boolean {
        return this.promise.isRejected;
    }
    get isSet(): boolean {
        return this.promise.isCompleted;
    }
    get isReset(): boolean {
        return !this.promise.isCompleted;
    }
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: | ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined, onrejected?: | ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined): Promise<TResult1 | TResult2> {
        return this.promise.then(onfulfilled, onrejected);
    }

    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: | ((reason: any) => TResult | PromiseLike<TResult>) | null | undefined): Promise<T | TResult> {
        return this.promise.catch(onrejected);
    }

    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | null | undefined): Promise<T> {
        return this.promise.finally(onfinally);
    }

    /**
     * A method to manually resolve the Promise.
     *
     * This doesn't reset this instance to a new promise interally, call 'reset' to do that.
     * @param value
     */
    resolve(value: T): Resetable<T> {
        if (!this.promise.isCompleted) {
            this.promise.resolve(value);
        }
        return this as unknown as Resetable<T>;
    }

    /**
     * A method to manually reject the Promise.
     *
     * This doesn't reset this instance to a new promise interally, call 'reset' to do that.
     * @param value
     */
    reject(reason: any): Resetable<T> {
        if (!this.promise.isCompleted) {
            this.promise.reject(reason);
        }
        return this as unknown as Resetable<T>;
    }

    /** Manually reset the promise to an uncompleted state. */
    reset(): Resetable<T> {
        if (this.promise.isCompleted) {
            this.promise = new ManualPromise<T>();
        }
        return this as unknown as Resetable<T>;
    }
}
