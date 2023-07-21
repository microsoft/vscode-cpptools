/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * A manually (or externally) controlled asynchronous Promise implementation
 */
export class ManualPromise<T = void> implements Promise<T> {
    readonly [Symbol.toStringTag] = 'Promise';
    private promise: Promise<T>;

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
     */
    public resolve: (value?: T | PromiseLike<T> | undefined) => void = (v) => {
        void v; /* */
    };

    /**
     * A method to manually reject the Promise
     */
    public reject: (e: any) => void = (e) => {
        void e; /* */
    };

    private state: 'pending' | 'resolved' | 'rejected' = 'pending';

    /** Returns true if the promise has not been resolved */
    public get isPending() {
        return this.state === 'pending';
    }

    /**
     * Returns true of the Promise has been Resolved or Rejected
     */
    public get isCompleted(): boolean {
        return this.state !== 'pending';
    }

    /**
     * Returns true if the Promise has been Resolved.
     */
    public get isResolved(): boolean {
        return this.state === 'resolved';
    }

    /**
     * Returns true if the Promise has been Rejected.
     */
    public get isRejected(): boolean {
        return this.state === 'rejected';
    }

    public constructor() {
        this.promise = new Promise<T>((r, j) => {
            this.resolve = (v: T | PromiseLike<T> | undefined) => {
                if ((global as any).DEVMODE && this.state !== 'pending') {
                    throw new Error(`Can't resolve; Promise has already been resolved as ${this.state}`);
                }
                this.state = 'resolved';
                r(v as any);
            };
            this.reject = (e: any) => {
                if ((global as any).DEVMODE && this.state !== 'pending') {
                    throw new Error(`Can't reject; Promise has already been resolved as ${this.state}`);
                }
                this.state = 'rejected';
                j(e);
            };
        });
    }
}
