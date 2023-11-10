/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from '../System/guards';

/** takes an identifier string and deconstructs and normalizes it. */
export function deconstruct(identifier: string | string[]): string[] {
    if (is.array(identifier)) {
        return identifier.flatMap(deconstruct);
    }
    return `${identifier}`
        .replace(/([a-z]+)([A-Z])/g, '$1 $2')
        .replace(/(\d+)([a-z|A-Z]+)/g, '$1 $2')
        .replace(/\b([A-Z]+)([A-Z])([a-z])/, '$1 $2$3')
        .split(/[\W|_]+/)
        .map((each) => each.toLowerCase());
}
/**
 * Takes an identifier string and deconstructs and normalizes it and smashes it together.
 *
 * This is useful for supporting multiple naming conventions for the same identifier. (i.e. 'fooBar' and 'foo-bar' are the same identifier)
 */
export function smash(identifier: string | string[]): string {
    return deconstruct(identifier).join('');
}

/** reformat an identifier to pascal case */
export function pascalCase(identifier: string | string[]): string {
    return deconstruct(identifier)
        .map((each) => each.charAt(0).toUpperCase() + each.slice(1))
        .join('');
}

/** reformat an identifier to camel case */
export function camelCase(identifier: string | string[]): string {
    return deconstruct(identifier)
        .map((each, index) => index === 0 ? each : each.charAt(0).toUpperCase() + each.slice(1))
        .join('');
}

/** reformat an identifier to dash case  */
export function dashCase(identifier: string | string[]): string {
    return deconstruct(identifier).join('-');
}
