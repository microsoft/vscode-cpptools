/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from './guards';

export function equal(a: any, b: any) {
    return is.array(a) && is.array(b) ? sequenceEqual(a, b) : deepEqual(a, b);
}

/** determines if two collections are equal */
export function sequenceEqual(a: any[], b: any[]) {
    if (a.length !== b.length) {
        return false;
    }

    for (let i: number = 0; i < a.length; ++i) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}

/** determines if two arbitrary things are equvalent (deep) */
export function deepEqual(a: any, b: any) {
    if (a === b) {
        return true; // identical primitives, undefined, null, or same object
    }

    if (a !== Object(a) || b !== Object(b) || (Object.keys(a).length !== Object.keys(b).length)) {
        return false; // not object, or objects that have different number of keys
    }

    // compare objects
    for (const key in a) {
        // if the key isn't in both, or the values aren't equal, return false
        if (!(key in b || deepEqual(a[key], b[key]))) {
            return false;
        }
    }

    return true;
}

/** Extending this class makes an easy way for ensuring that a comparison for changed state is cached, and then
 * when the state is changed, the new state is cached.  This is useful for determining
 */
export class LastKnownState {
    changed<T extends keyof this, V extends this[T] >(k: T, content: V): boolean {
        if (!(k in this)) {
            return false;
        }

        if (equal(content, this[k])) {
            return false;
        }
        this[k] = content;
        return true;
    }

    unchanged<T extends keyof this, V extends this[T] >(k: T, content: V): boolean {
        if (!(k in this)) {
            return true;
        }

        if (equal(content, this[k])) {
            return true;
        }

        this[k] = content;
        return false;
    }
}
