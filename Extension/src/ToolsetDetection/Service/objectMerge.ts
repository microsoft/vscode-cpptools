/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-dynamic-delete */

import { is } from '../../Utility/System/guards';
import { structuredClone } from '../../Utility/System/structuredClone';
import { strings } from '../strings';

function isMergeble(item: any): boolean {
    return item !== null && typeof item === 'object' && !is.array(item);
}

export function replaceOrInsert(original: Record<string, any>, key: string, value: any): Record<string, any> {
    return Object.keys(original).reduce((result, existingKey, index) => {
        if (!index) {
            result[key] = value;
        }
        if (existingKey !== key) {
            result[existingKey] = original[existingKey];
        }
        return result;
    }, {} as Record<string, any>);
}

function expandArray(value: any): any {
    return is.array(value) ? value.map(each => expandArray(each)).flat() : is.string(value) && value.includes('\u0007') ? value.split('\u0007') : value;
}

export function mergeObjects<T extends Record<string, any>>(input: T, dataToMerge: Record<string, any>, options?: {uniqueArrays?: boolean}): T {
    const target: any = input;
    const uniqueArrays = options?.uniqueArrays ?? false;

    if (is.promise(input) || is.promise(dataToMerge)) {
        throw new Error('Should not get promises here!');
    }

    if (isMergeble(target) && isMergeble(dataToMerge)) {

        for (let [key, value] of Object.entries(dataToMerge)) {
            if (key === '') {
                continue;
            }

            if (key.startsWith('remove:')) {
                key = key.substring(7);
                if (target[key]) {
                    const v: string[] = strings(value);
                    if (is.array(target[key])) {
                        target.key[key] = target[key].filter((each: string) => !v.includes(each));
                    } else if (is.string(target[key]) && v.includes(target[key])) {
                        delete target[key];
                    }
                }
                continue;
            }
            const prepend: boolean = key.startsWith('prepend:');
            if (prepend) {
                key = key.substring(8);
            }

            // if this is supposed to be an array, lets expand it now.
            value = expandArray(value);

            // if there isn't a target value, just assign a copy of the source value
            if (target[key] === undefined) {
                target[key] = structuredClone(value);
                continue;
            }

            if (target[key] === value) {
                //* console.log(`Same Same -> '${key}' => '${value}'`);
                continue;
            }

            // if the source value is null, we're going to delete the target value
            if (value === null) {
                delete target[key];
                continue;
            }

            // if the source value is empty/undefined, we're going to leave the target value as is
            if (value === undefined) {
                continue;
            }

            // if the source value is an array, the target is going to be an array.
            if (is.array(value)) {
                // arrays are appended
                if (target[key] === undefined) {
                    // no target value, just assign
                    target[key] = [...value];
                } else if (is.array(target[key])) {
                    // target value is an array, append or prepend
                    if (prepend) {
                        target[key].unshift(...value);
                    } else {
                        target[key].push(...value);
                    }
                    if (uniqueArrays) {
                        target[key] = [...new Set(target[key])];
                    }
                } else if (is.string(target[key])) {
                    // strings are converted to arrays
                    target[key] = [value, ...value];
                }
                continue;
            }

            // if the source value is an object, we're going to merge that with the target
            if (isMergeble(value)) {
                mergeObjects(target[key], value, { uniqueArrays : key === 'path' });
                continue;
            }

            // otherwise,
            target[key] = value;

        }
    }

    return target;
}

