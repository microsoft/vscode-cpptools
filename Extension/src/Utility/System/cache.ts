/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from './guards';

export function isExpired(timeoutValue: number) {
    return timeoutValue && timeoutValue < Date.now();
}

export function isLater(a: number, b: number) {
    return a ? b ? a > b : true : false;
}

export class Cache<T = any> implements Iterable<[string, T]> {
    static OneMinute = 60 * 1000;
    static OneHour = 60 * Cache.OneMinute;
    static OneDay = 24 * Cache.OneHour;
    static OneWeek = 7 * Cache.OneDay;
    static OneMonth = 30 * Cache.OneDay;
    static OneYear = 365 * Cache.OneDay;

    private map = new Map<string, [number, T]>();
    private defaultTimeout = 0;

    *[Symbol.iterator](): Iterator<[string, T]> {
        for (const [key, [timeout, value]] of this.map.entries()) {
            if (!isExpired(timeout)) {
                yield [key, value];
            }
        }
    }

    constructor(defaultTimeout?: number);
    constructor(entries?: readonly (readonly [string, [number, T]])[], defaultTimeout?: number);
    constructor(arg1?: number | readonly (readonly [string, [number, T]])[], defaultTimeout?: number) {
        if (arg1 === undefined) {
            // overload #0 : no arguments
            return;
        }

        if (is.numeric(arg1)) {
            // overload #1 : default timeout
            this.defaultTimeout = arg1 ?? 0;
            return;
        }

        // overload #2 : entries and default timeout
        this.defaultTimeout = defaultTimeout ?? 0;
        this.loadValues(arg1);
    }

    /** Loads the values into the cache, overwriting any existing values that are older. */
    loadValues(values: Iterable<readonly [string, [number, T]]>) {
        for (const [key, newValue] of values) {
            if (isExpired(newValue[0])) {
                // if the current value is expired, skip it
                continue;
            }

            const existing = this.map.get(key);
            // if there is an existing value, and the new value is older, skip it
            if (existing) {
                if (isLater(existing[0], newValue[0])) {
                    continue;
                }
            }

            // the new value is either not present, or is newer than the existing value
            this.map.set(key, newValue);
        }
    }

    /**  Returns a value for a given key if it exists in the cache (and is not expired) otherwise, returns undefined */
    get(key: string, timeout?: number): T | undefined {
        const existing = this.map.get(key);
        if (!existing) {
            // no data for this key
            return undefined;
        }

        if (existing[0] && existing[0] < Date.now()) {
            // data in this key has expired
            this.map.delete(key);
            return undefined;
        }

        // update the timeout for this key
        existing[0] = Date.now() + (timeout ?? this.defaultTimeout);
        return existing[1];
    }

    getCacheEntry(key: string) {
        return this.map.get(key);
    }

    /**
     * Returns a value for a given key if it exists in the cache (and is not expired)
     * or runs the action to get the value, and adds it to the cache, and then returns the value.
     */
    getOrAdd(key: string, action: () => T | undefined, timeout?: number): T | undefined;
    getOrAdd(key: string, action: () => Promise<T | undefined>, timeout?: number): Promise<T | undefined>;
    getOrAdd(key: string, action: () => T | undefined | Promise<T | undefined>, timeout?: number): T | undefined | Promise<T | undefined>{
        const result = this.get(key);
        if (result !== undefined) {
            return result;
        }
        const v = action();
        if (is.promise(v)) {
            return v.then(v => this.set(key, v, timeout));
        }
        return this.set(key, v, timeout);
    }

    /**
     * Sets the value in the cache to the given value, with an optional timeout
     *
     * If the value is undefined, the key is removed from the cache.
     *
     */
    set(key: string, value: T | undefined, timeout?: number): T | undefined{
        timeout = timeout ?? this.defaultTimeout;
        if (timeout && timeout < Cache.OneMonth) {
            // the timeout value is the number of milliseconds to keep the value in the cache
            timeout += Date.now();
        }
        // temporary: sanity check
        if (timeout > Date.now() + Cache.OneYear) {
            // this date is clearly wrong, and too far in the future.
            throw new Error('Timeout should not be that far in the future');
        }

        if (timeout && timeout < Date.now()) {
            // this is already expired.
            throw new Error('Timeout should not be in the past');
        }

        if (value === undefined) {
            // auto delete undefined values
            this.map.delete(key);
            return undefined;
        }
        // insert the item with the timeout (or 0 for no timeout)
        this.map.set(key, [timeout, value]);

        return value;
    }

    /** Clears out the cache of entries that are expired. */
    clean() {
        for (const [key, [timeout]] of this.map) {
            if (isExpired(timeout)) {
                this.map.delete(key);
            }
        }
    }

    /** Clear out the Cache of all entries */
    clear() {
        this.map.clear();
    }

    /** Returns the entries in the cache that are not expired as an array of [key,T] */
    entries() {
        // filter out entries that are expired before returning
        return [...this.map.entries()].filter(([,[timeout]]) => !isExpired(timeout)).map(([key, [,value]]) => [key, value] as const);
    }

    /** Returns the entries in the cache that are not expired as an array of [key, [timeout,T]] */
    cacheEntries() {
        // filter out entries that are expired before returning
        return [...this.map.entries()].filter(([,[timeout]]) => !isExpired(timeout));
    }

    /** returns the values in the cache as an array of T */
    values() {
        // filter out entries that are expired before returning
        return [...this.map.values()].filter(([timeout]) => !isExpired(timeout)).map(([,value]) => value);
    }

    /** returns the number of entries in the cache */
    get size() {
        return this.map.size;
    }
}
