/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { normalize } from 'path';
import { is } from '../Utility/System/guards';
import { OneOrMore } from './interfaces';

export function strings(input: OneOrMore<string> | undefined | Set<string> | (string | undefined)[]): string[] {
    if (!input) {
        return [];
    }
    if (input instanceof Set) {
        return [...input];
    }
    if (is.string(input)) {
        return [input];
    }
    return input as string[];
}

/** pushes one or more paths to the array if they aren't in there already. */
export function appendUniquePath(collection: string[] | Set<string>, elements: (string | undefined)[] | string | undefined) {
    if (!elements) {
        return collection;
    }

    for (let path of is.string(elements) ? [elements] : elements) {
        // skip empty values
        if (!path) {
            continue;
        }

        // normalize path first.
        path = normalize(path);

        // drop trailing slashes
        path = path.endsWith('\\') ? path.substring(0, path.length - 1) : path;

        // append if not present.

        // sets are smart
        if (is.set(collection)) {
            collection.add(path);
            continue;
        }

        // arrays we have to look
        if (!collection.includes(path)) {
            collection.push(path);
        }

    }
    return collection;
}

export function appendUnique(collection: string[] | string | undefined, elements: (string | undefined)[] | string | undefined) {
    if (!elements) {
        return collection;
    }

    if (!collection) {
        collection = [];
    }

    if (is.string(collection)) {
        collection = [collection];
    }

    for (let path of is.string(elements) ? [elements] : elements) {
        // skip empty values
        if (!path) {
            continue;
        }

        // normalize path first.
        path = normalize(path);

        // drop trailing slashes
        path = path.endsWith('\\') ? path.substring(0, path.length - 1) : path;

        // append if not present.
        if (!collection.includes(path)) {
            collection.push(path);
        }

    }
    return collection;

}

export function getActions<T>(obj: any, actions: [string, string[]][]) {
    if (!obj || typeof obj !== 'object') {
        return [];
    }

    return Object.entries(obj).map(([expression, block], ndx) => {
        const [, act, flag, comment] = /^([a-zA-Z]{4})(?:[a-zA-Z]*)(?:[:])?(.*?)(#.*?)?$/.exec(expression) || [];
        // coerce the action to be one of the valid actions, or empty string.
        const [action, validFlags] = actions.find(each => each[0].startsWith(act.toLowerCase())) || ['', []];

        // extract the flags
        const flags = new Map();
        for (const each of flag.split(',')) {
            // eslint-disable-next-line prefer-const
            let [,key, value] = /^([^=]+)=*(.*)?$/.exec(each) ?? [];
            if (!key) {
                continue;
            }
            key = key.toLowerCase().trim();

            if (validFlags.includes(key)) {
                flags.set(key, value?.trim() ?? true);
            }
        }
        // get the priority
        const priority = parseInt(flags.get('priority') ?? '0') || ndx;
        return { action, block, flags, priority, comment } as const;
    }).sort((a, b) => a.priority - b.priority).filter(each => each.action) as { action: string; block: T; flags: Map<string, string | boolean>; priority: number; comment?: string }[];
}

