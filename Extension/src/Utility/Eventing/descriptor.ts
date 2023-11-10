/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from '../System/guards';
import { hierarchy } from '../System/info';
import { getOrAdd } from '../System/map';
import { smash } from '../Text/identifiers';
import { ArbitraryObject } from './interfaces';

const ignore = new Set(['Object', 'Emitter']);

/** A set of descriptors for describing the context of an Event Emitter */
export class Descriptors extends Map<string, Set<string>> {
    static none = new Descriptors();

    constructor(instance?: ArbitraryObject, descriptors?: Record<string, string | string[] | Set<string>>) {
        super();

        if (instance) {
            if (instance instanceof Descriptors) {
                // inherit whatever is in that instance
                instance.forEach((value, key) => this.add(key, ...value));
            } else {
                // add all of the class names of the instance to the set of descriptors
                for (const c of hierarchy(instance)) {
                    if (!ignore.has(c)) {
                        this.add(c, '');
                    }
                }
            }
        }

        // add the specified descriptors
        if (descriptors) {
            Object.getOwnPropertyNames(descriptors).forEach(key => {
                const value = descriptors[key];
                if (!(value instanceof Function)) {
                    const v = descriptors[key];
                    if (is.array(v)) {
                        this.add(key, ...v);
                    } else if (is.string(v)) {
                        this.add(key, v);
                    }
                }
            });
        }
    }

    override get(key: string): Set<string> | undefined {
        return super.get(smash(key));
    }

    add(key: string, ...values: string[]) {
        if (values.length) {
            const set = getOrAdd(this, smash(key), () => new Set<string>());
            values.forEach(each => set.add(each));
        }
    }
}

