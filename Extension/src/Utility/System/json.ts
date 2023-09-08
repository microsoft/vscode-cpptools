/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from './guards';

/** creates a JSON object,
 *
 * @param instance the object to clone into a plain old JavaScript object
 * @param options.format if true, the JSON will be formatted with 2 spaces
 * @param options.types the types to explicitly use getOwnPropertyNames instead of just enumerating the properties
 */
export function stringify(value: Promise<any>, options?: { format?: boolean; types?: (new () => any)[] }): Promise<string>;
export function stringify(value: any, options?: { format?: boolean; types?: (new () => any)[] }): string;
export function stringify(value: any, options?: { format?: boolean; types?: (new () => any)[] }): string | Promise<string> {
    if (is.promise(value)) {
        return value.then(v => stringify(v));
    }
    const types = options?.types ?? [];
    const format = options?.format ?? false;

    const visited = new WeakSet();

    return JSON.stringify(value, (key: any, value: any) => {
        if (typeof value === 'object' && value !== null) {
            if (visited.has(value)) {
                return '[\'Circular\']';
            }
            visited.add(value);
        }
        if (value?.constructor?.name === 'Error' || types.filter(each => value instanceof each).length) {
            const result = {} as Record<string, any>;
            Object.getOwnPropertyNames(value).forEach((propName) => result[propName] = (value as any)[propName]);
            return result;
        }
        return value;
    }, format ? 2 : undefined);
}
