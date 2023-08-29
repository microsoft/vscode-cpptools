/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from '../System/guards';

class Lazy<T> extends Promise<T> {
    #promise!: Promise<T>;
    constructor(private initializer: T | (() => Promise<T>) | (() => T) | (new () => T)) {
        super(resolve => resolve(undefined as any));
    }

    override then<TResult1 = T, TResult2 = never>(onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2> {
        return (this.#promise ??= Promise.resolve(typeof this.initializer === 'function' ? is.Constructor(this.initializer) ? new this.initializer() : (this.initializer as () => T | Promise<T>)() : this.initializer)).then(onfulfilled, onrejected);
    }
    override catch(onrejected?: (reason: any) => never): Promise<T> {
        return (this.#promise ??= Promise.resolve(typeof this.initializer === 'function' ? is.Constructor(this.initializer) ? new this.initializer() : (this.initializer as () => T | Promise<T>)() : this.initializer)).catch(onrejected);
    }
}

/** Returns a promise from a value (value/lambda/constructor) that isn't resolved until is is awaited. */
export function lazy<T>(initializer: T | (() => Promise<T>) | (() => T) | (new () => T)): Promise<T> {
    return new Lazy(initializer);
}
