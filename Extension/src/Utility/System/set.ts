/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { normalize } from 'path';
import { Uri } from 'vscode';
import { is } from './guards';

/**
 * Adds one or more values to a set (filters out falsy values)
 * @param set the set to add values to
 * @param values the one or more values to add
 * @returns the set
 */
export function add<T>(set: Set<T>, values: Iterable<T> | T | undefined): Set<T> {
    if (!is.iterable(values)) {
        return values ? set.add(values) : set;
    }

    for (const value of values) {
        if (value) {
            set.add(value);
        }
    }

    return set;
}

function normalizePath(path: string) {
    return Uri.file(normalize(path)).fsPath;
}

/**
 * Adds one or more file path values to a set (filters out falsy values)
 * @param set the set to add values to
 * @param values the one or more values to add
 * @returns the set
 */
export function addNormalizedPath(set: Set<string>, values: Iterable<string> | string | undefined): Set<string> {
    if (!is.iterable(values)) {
        return values ? set.add(normalizePath(values)) : set;
    }

    for (const value of values) {
        if (value) {
            set.add(normalizePath(value));
        }
    }

    return set;
}
