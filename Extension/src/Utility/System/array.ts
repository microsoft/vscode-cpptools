/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/unified-signatures */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { fail } from 'assert';
import { is } from '../System/guards';

export function first<TElement>(iterable: undefined): undefined;
export function first<TElement>(iterable: Iterable<TElement> | undefined): TElement | undefined;
export function first<TElement>(iterable: Iterable<TElement> | undefined, predicate: (element: TElement) => true | undefined): TElement | undefined;

export function first<TElement>(iterable: Promise<Iterable<TElement> | undefined>): Promise<TElement | undefined>;
export function first<TElement>(iterable: Promise<Iterable<TElement> | undefined>, predicate: (element: TElement) => true | undefined): Promise<TElement | undefined>;

export function first<TElement>(iterable: Iterable<TElement> | undefined | Promise<Iterable<TElement> | undefined>, predicate: (element: TElement) => true | undefined = (e) => e as any): TElement | Promise<TElement | undefined> | undefined {
    if (iterable === undefined) {
        return undefined;
    }
    if (is.promise(iterable)) {
        return iterable.then(i => first(i, predicate));
    }

    for (const each of iterable) {
        if (predicate(each)) {
            return each;
        }
    }
    return undefined;
}

export function firstOrFail<TElement>(iterable: undefined, message: string | Error): never;
export function firstOrFail<TElement>(iterable: Iterable<TElement>, message: string | Error): TElement | never;
export function firstOrFail<TElement>(iterable: Iterable<TElement>, predicate: (element: TElement) => true | undefined, message: string | Error): TElement | never;

export function firstOrFail<TElement>(iterable: Promise<Iterable<TElement>>, message: string | Error): Promise<TElement> | never;
export function firstOrFail<TElement>(iterable: Promise<Iterable<TElement>>, predicate: (element: TElement) => true | undefined, message: string | Error): Promise<TElement> | never;

export function firstOrFail<TElement>(iterable: Iterable<TElement> | undefined | Promise<Iterable<TElement> | undefined>, predicateOrMessage: string | Error | ((element: TElement) => true | undefined) = (e) => e as any, message?: string | Error): TElement | Promise<TElement> | never {
    let result: any;
    if (message === undefined) {
        message = predicateOrMessage as string | Error;
        predicateOrMessage = (e) => e as any;
        result = first(iterable as Iterable<TElement>, predicateOrMessage);
    } else {
        result = first(iterable as any, predicateOrMessage as any);
    }
    if (is.promise(result)) {
        return result.then(r => r !== undefined ? r : fail(message));
    }
    return result !== undefined ? result as TElement : fail(message);
}

