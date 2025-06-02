/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { fail, ok } from 'node:assert';
import { isPromise } from 'node:util/types';
import { MessagePort, SHARE_ENV, Worker, isMainThread } from 'node:worker_threads';

import { ManualPromise } from '../Async/manualPromise';
import { finalize } from '../System/finalize';
import { is } from '../System/guards';

/*
 * SNARE: Simple Nodejs Asynchronous Remoting Engine
 *
 * SNARE is an extremely lightweight remoting engine that
 * allows you to call functions in a nodejs worker thread
 *
 * It supports:
 * - notifications (no response)
 * - requests (async calls with a response)
 * - error handling
 * - simple byref object management
 *
 * As long as the values you pass and return are supported by the Structured Clone Algorithm,
 * (see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
 * you can pass them by value to the remote thread.
 *
 * If you need to pass an object by reference, you can manually craft a remote object extending
 * the MarshalByReference.
 */

// Enable typescript disposable types/interfaces.
/// <reference lib="esnext.disposable" />

// Polyfill `Symbol.dispose`
(Symbol as any).dispose ??= Symbol("Symbol.dispose");
(Symbol as any).asyncDispose ??= Symbol("Symbol.asyncDispose");

const results = new Map<number, ManualPromise<any>>();
let next = 0;

/**
 * Internal interface representing a message payload exchanged between threads.
 * Contains operation names, sequence numbers, and associated data.
 */
interface Payload {
    /** The operation to perform (function name or built-in command). */
    operation: string;

    /** Sequence number for matching requests with responses (0 for notifications). */
    sequence: number;

    /** Function parameters when sending a request. */
    parameters?: any[];

    /** Return value when sending a response. */
    result?: any;

    /** Error information when an operation fails. */
    error?: any;
}

/**
 * Represents a connection to a remote thread that can be used to invoke operations.
 * Provides methods for making requests, sending notifications, and managing remote objects.
 */
export interface RemoteConnection {
    /** The underlying Worker or MessagePort used for communication. */
    connection: Worker | MessagePort;

    /** Terminates the connection and cleans up resources. */
    terminate(): void; /**
     * Makes a request to the remote thread and awaits a response.
     *
     * @param operation The operation name to invoke.
     * @param parameters Parameters to pass to the remote operation.
     * @returns A promise that resolves with the operation result.
     */
    request(operation: string, ...parameters: any[]): Promise<any>; /**
     * Sends a notification to the remote thread (fire and forget).
     *
     * @param operation The operation name to invoke.
     * @param parameters Parameters to pass to the remote operation.
     */
    notify(operation: string, ...parameters: any[]): void; /**
     * Creates a proxy for a remote object.
     *
     * @param ctor Constructor for the proxy type.
     * @param instance Promise of a remote object instance ID.
     * @returns Promise of a proxy to the remote object.
     */
    marshall<T extends MarshalByReference>(ctor: new (remote: RemoteConnection, instance: number) => T, instance: Promise<number>): Promise<T | undefined>; /**
     * Creates a proxy for a remote object.
     *
     * @param ctor Constructor for the proxy type.
     * @param instance A remote object instance ID.
     * @returns A proxy to the remote object.
     */
    marshall<T extends MarshalByReference>(ctor: new (remote: RemoteConnection, instance: number) => T, instance: number): T | undefined;
}

/**
 * Type representing a set of functions that can be called remotely.
 * The endpoint serves as the API that can be invoked from the other thread.
 */
export type Endpoint = Record<string, (...args: any[]) => any>;

/** SNARE: Simple Nodejs Asynchronous Remoting Engine */
export function startRemoting(connection: Worker | MessagePort, endpoint: Endpoint): RemoteConnection { // Main thread needs to wait for the connection to be ready before doing anything.
    // The worker threads don't have an 'online' event (the port is already connected).
    let ready = isMainThread ? new ManualPromise<undefined>() : undefined;
    connection.on('online', () => ready?.resolve());

    function postResult(sequence: number, retVal: any) {
        if (is.promise(retVal)) {
            retVal.then(
                (result) => connection.postMessage({ operation: "#result", sequence: sequence, result: sanitize(result) }),
                (error) => connection.postMessage({ operation: "#error", sequence: sequence, error: sanitize(error) })); // Call failed, threw an error.
            return;
        }

        connection.postMessage({ operation: "#result", sequence: sequence, result: sanitize(retVal) });
    }

    // Handle messages from the remote thread.
    connection.on('message', ({ operation, sequence, parameters, result, error }: Payload) => {
        // Unwrap incoming parameters that are byref or function references.
        parameters = parameters?.map(unwrapValue) || []; // Switch based on the operation type.
        switch (operation) {
            // If the message is an error, reject the promise.
            case '#error':
                results.get(sequence)?.reject(error);
                return results.delete(sequence);

            // If the message is a result, resolve the promise.
            case '#result':
                results.get(sequence)?.resolve(unwrapValue(result));
                return results.delete(sequence);

            // Unref is a built-in function to release a byref object.
            case '#unref':
                unref(parameters[0]);
                return;

            // Callback is a built-in function to call a callback function.
            case '#callback':
                try {
                    postResult(sequence, getByRef(parameters[0])(...parameters.slice(1)));
                } catch (err) {
                    connection.postMessage({ operation: "#error", sequence, error: sanitize(err) });
                }
                return;
        }
        // Otherwise, we're going to call a remote function.

        // Get the sequence number for the result (0 indicates that it's a notification).
        try {
            // Call the endpoint.
            if (!is.function(endpoint[operation])) {
                throw new Error(`Attempting to call unknown remote method on endpoint: ${operation}`);
            }

            const retVal = endpoint[operation](...parameters);
            if (sequence) {
                // Is it a request? If so, post the result.
                postResult(sequence, retVal);
            }
        } catch (err) {
            if (sequence) {
                connection.postMessage({ operation: "#error", sequence, error: sanitize(err) }); // Call failed, threw an error.
            }
        }
    });

    const remote = {
        connection,
        request: async (operation: string, ...parameters: any[]) => {
            let result: ManualPromise<any> | undefined;
            let payload: Payload | undefined;
            try {
                if (ready) {
                    await ready;
                }
                result = new ManualPromise<any>();
                payload = { operation, parameters: sanitizeParameters(parameters), sequence: ++next };
                results.set(payload.sequence, result);

                connection.postMessage(payload);
            } catch (err) {
                // If we can't post the message, then we need to reject the promise.
                if (payload) {
                    results.delete(payload.sequence);
                }
                if (result) {
                    result.reject(err);
                }
            }
            return result;
        },
        notify: (operation: string, ...parameters: any[]) => {
            try {
                if (ready) {
                    void ready.then(() => {
                        ready = undefined;
                        connection.postMessage({ operation, parameters: sanitizeParameters(parameters), sequence: 0 });
                    });
                } else {
                    connection.postMessage({ operation, parameters: sanitizeParameters(parameters), sequence: 0 });
                }
            } catch (err: any) {
                // Ignore the errors on notifications, as they are not expected to return a result.
            }
        },
        marshall: <T extends MarshalByReference>(ctor: new (remote: RemoteConnection, instance: number) => T, instance: number | Promise<number>) => instance ? is.promise(instance) ? instance.then(i => new ctor(remote, i)) : new ctor(remote, instance) : undefined,
        terminate: () => isMainThread ? finalize(connection) : undefined
    };

    function unwrapValue(value: any) {
        return isReference(value) ?
            value.kind === 'function' ? (...args: any[]) => remote.request('#callback', value.identity, ...args) : // If it is a referenced function, we'll create a wrapper function to call it.
                getByRef(value.identity) : // If it is a referenced object, we'll get the object.
            value;
    }
    connection.on('close', () => { // Disable the remote connection interface so that it can't be used anymore.
        const r = remote as any;
        r.request = r.marshal = async () => { };
        r.notify = r.terminate = () => { };
        r.connection = undefined;

        // The connection is closed, so reject all pending requests.
        for (const result of results.values()) {
            try {
                result.reject('Connection closed');
            } catch {
                // Ignore errors when rejecting.
            }
        }
        // Clear the results map.
        results.clear();

        // Clear out any byref objects.
        identityIndex.length = 0;
        instanceIndex.clear();

    });

    return remote;
}

/**
 * Ensures that the current code is running on the main thread.
 *
 * @throws If not running on the main thread.
 */
export function ensureIsMainThread() {
    ok(isMainThread, "Remoting: Failed to start host thread responder - not on main thread");
}

/**
 * Starts a new worker thread.
 *
 * @param workerPath Path to the worker script file.
 * @returns A new Worker instance with stderr, stdout, and environment variables shared.
 */
export function startWorker(workerPath: string) {
    return new Worker(workerPath, { stderr: true, stdout: true, env: SHARE_ENV });
}

/**
 * Returns a value that is safe to go over the connection.
 *
 * This includes:
 *  - functions (which are marshalled as references)
 *  - MarshalByReference objects (which are marshalled as references)
 *
 * Otherwise, we do a deep filtered clone of the object.
 *
 * @param value The value to sanitize
 * @returns A sanitized version of the value that can be safely sent over the connection
 */
function sanitize(value: any) {
    return is.function(value) || value instanceof MarshalByReference ? ref(value) : filteredClone(value);
}

/**
 * Sanitizes an array of parameters for remoting.
 *
 * @param parameters Array of parameter values to sanitize
 * @returns Array of sanitized parameters
 */
function sanitizeParameters(parameters: any[]) {
    return parameters.map(sanitize);
}

/**
 * Type guard to check if a value is a reference object.
 * References are objects with identity and kind properties.
 *
 * @param p The value to check.
 * @returns True if the value is a reference object.
 */
function isReference(p: any): p is Reference {
    return is.object(p) && 'identity' in p && 'kind' in p;
}

/**
 * Interface representing a reference to an object or function in another thread.
 * References are used to represent values that cannot be cloned.
 */
interface Reference {
    /** Unique identifier for the referenced object. */
    identity: number;

    /** The kind of reference - either an object or function. */
    kind: 'object' | 'function';
}

/** Array of objects indexed by their identity number. */
const identityIndex = new Array<any>();

/** Maps objects to their [identity, reference count] pairs. */
const instanceIndex = new Map<any, [number, number]>();

/**
 * Gets an object by its reference identity.
 *
 * @param identity The unique identifier of the referenced object.
 * @returns The referenced object.
 * @throws If the identity doesn't correspond to a valid referenced object.
 */
export function getByRef<T = any>(identity: number): T {
    return identityIndex[identity] ?? fail(`Invalid ${identity} for ByRef object`);
}

/**
 * Creates a reference to an object or function that can be sent to another thread.
 *
 * @param instance A Promise resolving to the object to reference.
 * @returns A Promise resolving to a reference object, or undefined if the value can't be referenced.
 */
export function ref(instance: Promise<any>): Promise<Reference | undefined>;

/**
 * Creates a reference to an object or function that can be sent to another thread.
 *
 * @param instance The object to reference.
 * @returns A reference object, or undefined if the value can't be referenced.
 */
export function ref(instance: any): Reference | undefined;

/**
 * Implementation of the ref function handling both synchronous and asynchronous cases.
 *
 * @param instance The object or Promise to reference.
 * @returns A reference object, a Promise to a reference object, or undefined.
 */
export function ref(instance: any | Promise<any>): Reference | undefined | Promise<Reference | undefined> {
    if (is.promise(instance)) {
        return instance.then(ref);
    }

    const kind = typeof instance;
    switch (kind) {
        case 'object':
        case 'function':
            // Lookup the instance in the index.
            const [identity, refcount] = instanceIndex.get(instance) ?? [++next, 0];

            // If refcount is zero, then we need to add it to the index.
            if (!refcount) {
                identityIndex[identity] = instance;
            }

            // Increment the refcount.
            instanceIndex.set(instance, [identity, refcount + 1]);

            // Return the identity.
            return { identity, kind };
    }
    // Otherwise, we can't ref it.
    return undefined;
}

/**
 * Decrements the reference count for a referenced object.
 * If the reference count reaches zero, the object is removed from the index and finalized.
 *
 * @param identity The identity of the referenced object to unreference.
 */
export function unref(identity: number) {
    // Lookup the instance.
    const instance = getByRef(identity);
    if (instance) {
        // Decrement the refcount.
        const [identity, refcount] = instanceIndex.get(instance) ?? [0, 0];
        if (refcount > 1) {
            // Reduce the refcount by one.
            return instanceIndex.set(instance, [identity, refcount - 1]);
        }
        // It's the last reference, so remove it from the index.
        identityIndex[identity] = undefined;
        instanceIndex.delete(instance);
        finalize(instance);
    }
}

/**
 * A base class for objects that are passed by reference to a remote thread.
 *
 * All MarshalByReference wrappers are references to an object that lives in the remote thread.
 * It is important to call .dispose() when you are done with it, as this enables the remote
 * thread to release the object and free up resources.
 */
export class MarshalByReference implements Disposable {
    constructor(protected remote: RemoteConnection, protected instance: number) {
    } /**
     * This disposes the ByRef object and notifies the remote thread to reduce the refcount,
     * which would dispose the remote object if it was the last reference.
     */
    [Symbol.dispose]() {
        void this.remote.notify('#unref', this.instance);
        this.instance = 0;
    }
}

/**
 * Returns a filtered structured clone of an object that can be safely transmitted between threads.
 *
 * This recursively drops items that are:
 *  - undefined
 *  - functions
 *  - symbols
 *  - promises
 *  - asyncIterators
 *
 * It should correctly handle:
 *  - circular references by keeping a map of references that have already been cloned
 *  - arrays, sets, maps, and iterables (iterables are converted to arrays)
 *  - dates, regex, errors, and buffers by returning them directly
 *  - vscode.Uri by converting it to a string
 *  - all other objects by recursively cloning them
 *
 * @param data The data to clone.
 * @param references Map of already cloned objects (for handling circular references).
 * @param options Additional options for controlling the cloning process.
 * @returns A filtered clone of the input data suitable for transmission.
 */
export function filteredClone(data: any, references = new Map<any, any>(), options?: { breakCircular?: boolean }): any {
    // Fast checks for null and undefined.
    if (data === undefined || data === null) {
        return undefined;
    }
    if (references.has(data)) {
        return references.get(data);
    }

    switch (typeof data) {
        case 'symbol':
        case 'function':
            return undefined;

        case 'object':
            if (options?.breakCircular) {
                references.set(data, undefined);
            }
            if (isPromise(data) || typeof data.then === 'function' || typeof data[Symbol.asyncIterator] === 'function') {
                return undefined;
            }

            if (data instanceof Set) {
                const result = new Set();
                references.set(data, result);
                for (const item of data) {
                    result.add(filteredClone(item, references, options));
                }
                return result;
            }

            if (data instanceof Map) {
                const result = new Map();
                references.set(data, result);
                for (const [key, value] of data) {
                    const k = filteredClone(key, references, options);
                    if (k !== undefined) {
                        result.set(k, filteredClone(value, references, options));
                    }
                }
                return result;
            }

            if (data[Symbol.iterator]) {
                const result: any[] = [];
                references.set(data, result);
                for (const item of data) {
                    result.push(filteredClone(item, references, options));
                } return result;
            }

            // These are ok to return the value directly.
            if (data instanceof Date || data instanceof RegExp || data instanceof Error || data instanceof Buffer) {
                return data;
            }

            // Special case for vscode.Uri - we'll just return the string.
            if ('path' in data && 'scheme' in data && 'authority' in data && 'fragment' in data) {
                return data.toString();
            }

            // Everything else is an object that we'll recursively clone.
            const result: any = {};
            if (!options?.breakCircular) {
                references.set(data, result);
            }

            for (const key in data) {
                if (key.startsWith('_')) {
                    continue;
                }
                const v = filteredClone(data[key], references, options);
                if (v !== undefined) {
                    // Drop undefined values entirely.
                    result[key] = v;
                }
            }
            return result;
    }

    return data;
}

