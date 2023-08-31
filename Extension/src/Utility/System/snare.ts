/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { fail } from 'assert';
import { MessagePort, Worker, isMainThread } from 'worker_threads';
import { ManualPromise } from '../Async/manualPromise';
import { finalize } from './finalize';
import { is } from './guards';

// enable typescript disposable types/interfaces
/// <reference lib="esnext.disposable" />

// polyfill Symbol.dispose
(Symbol as any).dispose ??= Symbol("Symbol.dispose");
(Symbol as any).asyncDispose ??= Symbol("Symbol.asyncDispose");

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
 * - some simple byref object management
 *
 * As long as the values you pass and return are supported by the Structured Clone Algorithm,
 * (see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
 * you can pass them by value to the remote thread.
 *
 * If you need to pass an object by reference, you can manually craft a remote object extending
 * the MarshalByReference; see the Toolset class for an example.
 */

const results = new Map<number, ManualPromise<any>>();
let next = 0;

interface EventData {
    id: string;
    sequence: number;
    parameters?: any[];
    result?: any;
    error?: any;
}

export interface RemoteConnection {
    connection: Worker | MessagePort;
    terminate(): void;
    request(id: string, ...parameters: any[]): Promise<any>;
    notify(id: string, ...parameters: any[]): void;
    marshall<T extends MarshalByReference>(ctor: new (remote: RemoteConnection, instance: number) => T, instance: Promise<number>): Promise<T | undefined>;
    marshall<T extends MarshalByReference>(ctor: new (remote: RemoteConnection, instance: number) => T, instance: number): T | undefined;
}

/** SNARE: Simple Nodejs Asynchronous Remoting Engine */
export function startRemoting(connection: Worker | MessagePort, endpoint: Record<string, (...args: any[]) => any>): RemoteConnection {
    const ready = new ManualPromise<void>();
    connection.on('online', () => ready.resolve());
    // the worker threads don't have an 'online' event (the port is already connected)
    if (!isMainThread) {
        ready.resolve();
    }

    connection.on('message', (eventData: EventData) => {
        // if the event is an error, reject the promise
        if (eventData.id === '$error') {
            results.get(eventData.sequence)?.reject(eventData.error);
            return results.delete(eventData.sequence);
        }

        // if the event is a result, resolve the promise
        if (eventData.id === '$result') {
            results.get(eventData.sequence)?.resolve(eventData.result);
            return results.delete(eventData.sequence);
        }

        // otherwise, we're going to call a remote function

        // get the sequence number for the result (0 indicates that it's a notification)
        const sequence = eventData.sequence;

        try {
            // call the endpoint
            const result = endpoint[eventData.id](...eventData.parameters ?? []);

            // is it a request?
            if (sequence) {
                if (is.promise(result)) {
                    // wait for the async call to complete, then post the result back
                    void result.then(
                        (result) => connection.postMessage({ id:"$result", sequence, result }),
                        (error) => connection.postMessage({ id:"$error", sequence, error })); // call failed, threw
                    return;
                }
                // post the result back (call returned synchronously)
                connection.postMessage({id:"$result", sequence, result }); // call succeeded
            }
        } catch (error) {
            if (sequence) {
                connection.postMessage({id:"$error", sequence, error }); // call failed, threw
            }
        }
    });

    connection.on('messageerror', (error) => {
        console.log(error);
    });

    connection.on('error', (error) => {
        console.log(error);
    });

    const remote = {
        connection,
        request: async (id: string, ...parameters: any[]) => {
            if (isMainThread) {
                await ready;
            }
            const result = new ManualPromise<any>();
            const eventData: EventData = { id, parameters, sequence: ++next };
            results.set(eventData.sequence, result);

            // watch call times:
            // const now = Date.now();
            // result.then(() => console.log(`REMOTE RESULT ${JSON.stringify(eventData)} ${Date.now() - now}`), () => console.log(`REMOTE ERROR ${JSON.stringify(eventData)} ${Date.now() - now}`));

            connection.postMessage(eventData);
            return result;
        },
        notify: (id: string, ...parameters: any[]) => isMainThread ? void ready.then(() => connection.postMessage({ id, parameters, sequence: 0 })) : connection.postMessage({ id, parameters, sequence: 0 }),
        marshall: <T extends MarshalByReference>(ctor: new (remote: RemoteConnection, instance: number) => T, instance: number | Promise<number>) => instance ? is.promise(instance) ? instance.then(i => new ctor(remote, i)) : new ctor(remote, instance) : undefined,
        terminate: () => { if (isMainThread) { void (connection as Worker).terminate(); } }
    };

    connection.on('close', () => {
        // disable the remote connection interface so that it can't be used anymore
        const r = remote as any;
        r.request = r.marshal = async () => {};
        r.notify = r.terminate = () => {};
        r.connection = undefined;

        // the connection is closed, so reject all pending requests
        for (const result of results.values()) {
            try {
                result.reject('Connection closed');
            } catch {
                // ignore
            }
        }
        // and clear the results map
        results.clear();

        // clear out any byref objects
        identityIndex.length = 0;
        instanceIndex.clear();

    });

    return remote;
}

const identityIndex = new Array<any>();
const instanceIndex = new Map<any, [number, number]>();

export function getByRef<T = any>(identity: number): T {
    return identityIndex[identity] ?? fail(`Invalid ${identity} for ByRef object`);
}

export function ref(instance: Promise<any>): Promise<number | undefined>;
export function ref(instance: any): number | undefined;
export function ref(instance: any | Promise<any>): number | undefined | Promise<number | undefined> {
    if (is.promise(instance)) {
        return instance.then(ref);
    }

    if (is.object(instance)){
        // lookup the instance in the index
        const [identity, refcount] = instanceIndex.get(instance) ?? [++next, 0];

        // if refcount is zero, then we need to add it to the index
        if (!refcount) {
            identityIndex[identity] = instance;
        }

        // and increment the refcount
        instanceIndex.set(instance, [identity, refcount + 1]);

        // and return the identity
        return identity;
    }
    // if it's not an object, we can't ref it.
    return undefined;
}

export function unref(identity: number) {
    // lookup the instance
    const instance = getByRef(identity);
    if (instance) {
        // decrement the refcount
        const [identity, refcount] = instanceIndex.get(instance) ?? [0, 0];
        if (refcount > 1) {
            // reduce the refcount by one
            return instanceIndex.set(instance, [identity, refcount - 1]);
        }
        // it's the last reference, so remove it from the index
        identityIndex[identity] = undefined;
        instanceIndex.delete(instance);
        finalize(instance);
    }
}

/**
 * A base class for objects that are passed by reference to a remote thread.
 *
 * All MarshalByReference wrappers, are references to an object that lives in the remote thread.
 * It is important to call .dispose() when you are done with it, as this enables the remote
 * thread to release the object and free up resources.
 */
export class MarshalByReference implements Disposable {
    constructor(protected remote: RemoteConnection, protected instance: number){
    }

    /**
     * This disposes the ByRef object, and notifies the remote thread to reduce the refcount,
     * which would dispose the remote object if it was the last reference.
    */
    [Symbol.dispose]() {
        void this.remote.notify('unref', this.instance);
        this.instance = 0;
    }
}
