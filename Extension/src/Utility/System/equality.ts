/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

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
