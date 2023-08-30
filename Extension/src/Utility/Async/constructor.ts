/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { is } from '../System/guards';
import { ConstructorReturn, Reject, Resolve, AsyncConstructor } from '../System/types';

export function Async<TClass extends new (...args: ConstructorParameters<TClass>) => ConstructorReturn<TClass>>(ctor: TClass) {
    class AsyncConstructed extends Promise<TClass> {
        static class: TClass = ctor;
        constructor(...args: ConstructorParameters<TClass>);
        constructor(...args: any[]) {

            if (args.length === 1 && typeof args[0] === 'function') {
                // this is being called because a new Promise is being created for an async function invocation (not user code)
                super(args[0]);
                return;
            }

            // this is being called because a user is creating an instance of the class, and we want to call the init() method
            super((resolve: Resolve<TClass>, reject: Reject) => {
                try {
                    // call the constructor with the arguments that they provided
                    const instance = new ctor(...(args as any)) as any;

                    // if .init is a function, call it
                    const pInit = typeof instance.init === 'function' ? instance.init(...args) : instance.init;

                    // if the result of .init is a promise (or is a promise itself), then on completion, it should propogate the result (or error) to the promise
                    if (is.promise(pInit)) {
                        pInit.then(() => resolve(instance)).catch(reject);
                    } else {
                        // otherwise, the result of init is not a promise (or it didn't have an init), so just resolve the promise with the result
                        resolve(instance);
                    }
                } catch (error) {
                    // if the constructor throws, we should reject the promise with that error.
                    reject(error);
                }
            });
        }
    }
    // return a new constructor as a type that creates a Promise<T>
    return AsyncConstructed as any as AsyncConstructor<TClass>;
}
