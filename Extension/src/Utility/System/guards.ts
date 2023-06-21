/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Socket } from 'node:net';
import { isPromise } from 'node:util/types';
import { AsyncConstructor, Constructor, Primitive } from './types';

// eslint-disable-next-line @typescript-eslint/naming-convention
export class is {
    /** Returns true if the value is a string, number, or boolean */
    static primitive(node: any): node is Primitive {
        switch (typeof node) {
            case 'boolean':
            case 'number':
            case 'string':
                return true;
        }
        return false;
    }

    static object(node: any): node is Record<string, any> {
        return typeof node === 'object' && node !== null && !is.array(node);
    }

    static nullish(value: any): value is null | undefined {
        return value === null || value === undefined || value === '';
    }

    static promise(value: any): value is Promise<any> {
        return isPromise(value) || (value && typeof (value.then) === 'function');
    }

    static iterable<T = unknown>(instance: any): instance is Iterable<T> {
        return typeof instance !== 'string' && !!instance[Symbol.iterator];
    }

    static asyncIterable(instance: any): instance is AsyncIterable<unknown> {
        return !!instance[Symbol.asyncIterator];
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    static Constructor(instance: any): instance is Constructor {
        return typeof instance === 'function' && !!instance.prototype && !Object.getOwnPropertyNames(instance).includes('arguments') && instance.toString().match(/^function.*\{ \[native code\] \}|^class/g);
    }

    static asyncConstructor(instance: any): instance is AsyncConstructor<any> {
        return typeof instance === 'function' && !!instance.class && is.Constructor(instance.class);
    }

    static array(instance: any): instance is any[] {
        return Array.isArray(instance);
    }

    static string(instance: any): instance is string {
        return typeof instance === 'string';
    }

    static socket(instance: any): instance is Socket {
        return instance instanceof Socket;
    }

    static function(instance: any): instance is Function {
        return typeof instance === 'function';
    }
}
