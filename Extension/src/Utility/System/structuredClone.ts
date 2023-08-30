/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { deserialize, serialize } from 'v8';

/**
 * This performs a structured clone using the built-in serialization and deserialization
 * v8 APIs. This is the fastest thing available.
 *
 * This can be replaced with the built-in structuredClone() when it is available in
 * node.js and electron (it's in node V17+)
 *
 * for more information, see the Structured Clone Algorithm for JavaScript:
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
 *
 * @param instance any value to be cloned
 * @returns a copy of the instance
 */
export function structuredClone<T>(instance: T): T {
    return instance ? deserialize(serialize(instance)) : instance;
}
