/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from '../System/guards';

export class AsyncMap<TKey, TValue> {
    private readonly map = new Map<TKey, TValue | Promise<TValue | undefined> | undefined>();
    clear(): void {
        return this.map.clear();
    }
    delete(key: TKey): boolean {
        return this.map.delete(key);
    }
    get(key: TKey): TValue | Promise<TValue | undefined> | undefined {
        return this.map.get(key);
    }
    has(key: TKey): boolean {
        return this.map.has(key);
    }
    get size(): number {
        return this.map.size;
    }
    async *entries(): AsyncIterable<[TKey, TValue]> {
        // eslint-disable-next-line prefer-const
        for (let [key, value] of this.map.entries()) {
            if (is.promise(value)) {
                value = await value;
            }
            if (!is.nullish(value)) {
                yield [key, value];
            }
        }
    }
    keys(): Iterator<TKey> {
        return this.map.keys();
    }
    async *values(): AsyncIterable<TValue > {
        for (let value of this.map.values()) {
            if (is.promise(value)) {
                value = await value;
            }
            if (!is.nullish(value)) {
                yield value;
            }
        }
    }

    [Symbol.asyncIterator](): AsyncIterable<[TKey, TValue]> {
        return this.entries();
    }

    getOrAdd(key: TKey, initializer: TValue | Promise<TValue> | Promise<undefined> | (() => Promise<TValue | undefined> | TValue | undefined)): Promise<TValue | undefined> | TValue | undefined {
        let result: Promise<TValue | undefined> | TValue | undefined = this.map.get(key);

        // if we don't get a match, then we'll try to set the value with the initializer
        if (is.nullish(result)) {
            // if the initializer is a function, then we'll call it to get the value
            if (is.function(initializer)) {
                result = initializer();
            }

            // if we're not handed a promise or a value, then we're done
            if (is.nullish(result)) {
                return undefined;
            }

            // set the value in the map to the result of the initializer
            this.map.set(key, result);

            // if the initializer is a promise, then we'll tack on a bit of logic to remove the value from the map if the promise resolves to undefined
            if (is.promise(result)) {
                return result.then(v => {
                    if (is.nullish(v)) {
                        this.map.delete(key);
                    }
                    return v;
                });
            }
        }
        return result;
    }
    set(key: TKey, value: Promise<TValue> | TValue): this {
        this.map.set(key, value);
        return this;
    }
}
