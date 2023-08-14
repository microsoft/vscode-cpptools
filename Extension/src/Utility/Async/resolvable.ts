/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export interface Resolveable<T> {
    /**
      * A method to manually resolve the Promise.
      *
      * @param value the value to resolve the promise with.
      */
    resolve(value: T): Resolveable<T>;

    /**
     * A method to manually reject the Promise.
     *
     * @param reason the reason to reject the promise with.
     */
    reject(reason: any): Resolveable<T>;

    /** Returns true if the promise has not been resolved */
    readonly isPending: boolean;

    /**
     * Returns true of the Promise has been Resolved or Rejected
     */
    readonly isCompleted: boolean;

    /**
     * Returns true if the Promise has been Resolved.
     */
    readonly isResolved: boolean;

    /**
     * Returns true if the Promise has been Rejected.
     */
    readonly isRejected: boolean;
}

export interface Resetable<T> extends Resolveable<T> {
    /**
      * A method to manually resolve the Promise.
      *
      * @param value the value to resolve the promise with.
      */
    resolve(value: T): Resetable<T>;

    /**
     * A method to manually reject the Promise.
     *
     * @param reason the reason to reject the promise with.
     */
    reject(reason: any): Resetable<T>;

    /** Use this to reactivate the ManualSignal */
    reset(): Resetable<T>;
}
