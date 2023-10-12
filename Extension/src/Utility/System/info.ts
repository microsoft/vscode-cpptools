/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { is } from './guards';
import { AribtraryObject, Constructor } from './types';

export function typeOf(instance: any) {
    const t = typeof instance;
    const c = (classOf(instance) as any);
    switch (t) {
        case 'number':
            return Number.isNaN(instance) ? 'NaN' : 'number';

        case 'object':
            if (instance === null) {
                return 'null';
            }
            if (is.promise(instance)) {
                return c.class ? `Promise<${classOf(c.class)?.name || parentClassOf(classOf(c.class)!)?.name}>` : 'Promise';
            }
            return classOf(instance)?.name || parentClassOf(classOf(instance)!)?.name || '<anonymous>';
        case 'function':
            if (is.Constructor(instance)) {
                return `class ${c?.name || parentClassOf(c!)?.name || '<anonymous>'}`;
            }
            return 'function';

    }
    return t;
}

export function hierarchy(instance: AribtraryObject | Constructor): string[] {
    const result = new Array<string>();
    let type = classOf(instance);
    while (type) {
        if (type.name) {
            result.push(type.name);
        }
        type = parentClassOf(type);
    }
    return result;
}

export function parentClassOf(instance: AribtraryObject | Constructor): Constructor | undefined {
    if (is.nullish(instance)) {
        return undefined;
    }
    const parent = Object.getPrototypeOf(typeof instance === 'function' ? instance : instance.constructor);
    return parent.name ? parent : undefined;
}

export function classOf(instance: AribtraryObject | Constructor): Constructor | undefined {
    return instance ? typeof instance === 'function' ? // is it a JavaScript function of some kind?
        is.asyncConstructor(instance) ? classOf(instance.class) :
            is.Constructor(instance) ? instance as Constructor // is it really a constructor?
                : undefined // no, it's a function, but not a constructor
        : instance.constructor as Constructor : // it's an object, so get the constructor from the object
        undefined;
}

/** returns true if the instance is an anonymous object (as opposed to constructed via a class) */
export function isAnonymousObject(instance: any): boolean {
    return instance.constructor.name === 'Object';
}

interface FunctionInfo {
    /** was this declared with quotes or other non-word characters in the function name */
    hasNonWordCharacters: boolean;

    /** is the function async */
    isAsync: boolean;

    /** a bound callable function for the member (saves us from having to do it later anyway) */

    // eslint-disable-next-line @typescript-eslint/ban-types
    fn: Function;
}

interface Members {
    methods: Map<string, FunctionInfo>;
    fields: Map<string, string>;
    properties: Map<string, string>;
}

const builtIns = new Set(Object.keys(Object.getOwnPropertyDescriptors(Object.getPrototypeOf({}))));

export function members(obj: any): Members {
    const result = {
        methods: new Map<string, FunctionInfo>(),
        fields: new Map<string, string>(),
        properties: new Map<string, string>()
    };

    if (typeof obj === 'object') {
        let instance = obj;
        do {
            // enumerate all the properties at this level.
            for (const [memberName, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(instance))) {
                // check if we're filtering it out because it's built into object, or it's using a leading underscore.
                if (!(builtIns.has(memberName) || memberName.startsWith('_') || memberName.startsWith('$'))) {
                    let value: any;

                    // look at the value/type of the member
                    try {
                        value = descriptor.value === undefined ? obj[memberName] : descriptor.value;
                    } catch {
                        continue;
                    }
                    const type = typeof value;

                    // is it a function
                    if (type === 'function') {
                        // it is actually possible to get the 'declared name' of a member (if it was quoted in the source code)
                        // (this might be useful in the future. For now, we're just going to use the member name)
                        // const declaredName = obj[memberName].toString().replace(/\([\S\s]*/gm,'') || memberName;

                        // distill out the info for the function itself
                        result.methods.set(memberName, {
                            hasNonWordCharacters: /\W/.test(obj[memberName].toString().replace(/^async\s+|\([\S\s]*/gm, '') || memberName),
                            isAsync: value.toString().startsWith('async '),
                            fn: value.bind(obj)
                        });
                        continue;
                    }

                    // is this a property (via accessors?)
                    if (descriptor.set || descriptor.get) {
                        // this is a property, it has an accessor.
                        if (descriptor.get) {
                            // only actually use properties that can be retrieved.
                            result.properties.set(memberName, type);
                            continue;
                        }
                    }

                    // must be a field.
                    result.fields.set(memberName, type);
                }
            }
        // eslint-disable-next-line no-cond-assign
        } while (instance = Object.getPrototypeOf(instance));
    }
    return result;
}

