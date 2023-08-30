/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from './guards';
import { AribtraryObject } from './types';

export type Returns<TValue> = (...args: any) => TValue;
export type InitialValue<TValue> = TValue | Returns<TValue>;

export function getOrAdd<TKey extends AribtraryObject, TValue>(map: WeakMap<TKey, TValue>, key: TKey, defaultValue: InitialValue<TValue>): TValue;
export function getOrAdd<TKey extends AribtraryObject, TValue>(map: WeakMap<TKey, TValue>, key: TKey, defaultValue: InitialValue<Promise<TValue>>): Promise<TValue>;
export function getOrAdd<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, defaultValue: InitialValue<Promise<TValue>>): Promise<TValue>;
export function getOrAdd<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, defaultValue: InitialValue<TValue>): TValue;
export function getOrAdd<TKey, TValue>(map: Map<TKey, TValue> | WeakMap<any, TValue>, key: TKey, defaultValue: InitialValue<TValue | Promise<TValue>>): TValue | Promise<TValue> {
    const value = map.get(key);
    if (!is.nullish(value)) {
        return value;
    }
    const initializer = defaultValue instanceof Function ? defaultValue() : defaultValue;
    if (is.promise(initializer)) {
        return initializer.then(v => {
            if (v !== undefined) {
                map.set(key, v);
            }
            return v;
        });
    } else {
        if (initializer !== undefined) {
            map.set(key, initializer);
        }
        return initializer;
    }
}

export function entries<TKey, TValue>(map: Map<TKey, TValue>): [TKey, TValue][];
export function entries<TKey, TValue>(map: Promise<Map<TKey, TValue>>): Promise<[TKey, TValue][]>;
export function entries<TKey, TValue, TKeyOut, TValueOut>(map: Map<TKey, TValue>, selector?: (key: TKey, value: TValue) => [TKeyOut, TValueOut]): [TKeyOut, TValueOut][];
export function entries<TKey, TValue, TKeyOut, TValueOut>(map: Promise<Map<TKey, TValue>>, selector?: (key: TKey, value: TValue) => [TKeyOut, TValueOut]): Promise<[TKeyOut, TValueOut][]>;
export function entries<TKey, TValue, TKeyOut = TKey, TValueOut = TValue>(map: Promise<Map<TKey, TValue>> | Map<TKey, TValue>, selector?: (key: TKey, value: TValue) => [TKeyOut, TValueOut]): [TKeyOut, TValueOut][] | [TKey, TValue][] | Promise<[TKeyOut, TValueOut][] | [TKey, TValue][]> {
    return is.promise(map) ?
        map.then(m => entries(m, selector)) : // async version
        selector ?
            [...map.entries()].map(([key, value]) => selector(key, value)) : // map the values with a selector
            [...map.entries()]; // return the values
}
