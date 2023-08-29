/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/unified-signatures */

import { readFile } from 'node:fs/promises';
import { ManualPromise } from '../Async/manualPromise';
import { ManualSignal } from '../Async/manualSignal';
import { returns } from '../Async/returns';
import { filepath } from '../Filesystem/filepath';
import { hasErrors } from '../Sandbox/interfaces';
import { Sandbox } from '../Sandbox/sandbox';
import { collectGarbage } from '../System/garbageCollector';
import { is } from '../System/guards';
import { isAnonymousObject, members, typeOf } from '../System/info';
import { getOrAdd } from '../System/map';
import { verbose } from '../Text/streams';
import { Descriptors } from './descriptor';
import { parse } from './eventParser';
import { ArbitraryObject, Callback, Continue, EventData, EventStatus, Subscriber, Subscription, Unsubscribe } from './interfaces';

interface Event<TInput = any, TResult = void> {
    readonly name: string;
    readonly descriptors: Descriptors;

    completed?: ManualPromise<EventStatus | TResult>;
    readonly variableArgs: any[];
    source?: ArbitraryObject;
    data?: TInput;
    text?: string;
}

const sandbox = new Sandbox();

const syncHandlers = new Map<string, Subscriber[]>();
const asyncHandlers = new Map<string, Subscriber[]>();

const queue = new Array<Event<any, any>>();
const current = new Set<Callback>();

export const DispatcherBusy = new ManualSignal<void>();

/** starts the processing of the event queue. */
async function drain() {
    DispatcherBusy.reset();
    let event: Event | undefined;
    // eslint-disable-next-line no-cond-assign
    while (event = queue.shift()) {
        await dispatch(event);
    }
    DispatcherBusy.resolve();
}

/** dispatch the applicable handlers for an event  */
async function dispatch<TResult>(event: Event<any, TResult>): Promise<void> {
    // check the sync handlers first
    let resultValue: EventStatus | TResult | undefined = Continue;

    // sync handlers run and await one at a time
    // technically, it's possible for other events to run while a sync handler is running
    // but that doesn't make any difference; the sync handler will still run to completion
    // before the next handler is dispatched.
    for (const [callback, captures] of getHandlers(event, syncHandlers)) {
        try {
            // keep track of which handlers are currently running
            current.add(callback);

            // call the callback, collate the result.
            let r = callback(event as EventData, ...captures);
            r = is.promise(r) ? await r.catch(e => {
                console.error(e);
                return undefined;
            }) : r;

            // if it is an event/request (as opposed to a notification), then process it.
            if (is.promise(event.completed)) {
                // if they returned some kind of value, then use that as the result, otherwise, use the default
                resultValue = r as TResult | EventStatus;

                if (is.cancelled(resultValue)) {
                    return event.completed.resolve(resultValue); // the event has been cancelled
                }
            }
        } catch (e: any) {
            console.error(e);
            // if the handler throws, it isn't a reason to cancel the event
        } finally {
            // clear the callback from the current set
            current.delete(callback);
        }
    }

    // then the async handlers (for events with possible result handling)

    if (!is.promise(event.completed)) {
        // no event.completed, which means this is a notifier
        // since notifiers are not cancellable, we can run them all in parallel
        // and they don't need to worry about reentrancy
        for (const [callback, captures] of getHandlers(event, asyncHandlers)) {
            // call the event handler, but don't await it
            // we don't care about the result, and we don't want to block
            // (if the handler throws, too bad)
            try { void callback(event as EventData, ...captures); } catch (e: any) {
                console.error(e);
                /* ignore */
            }
        }
        return;
    }
    // this is an event/request (supports a result or cancellation)
    // when these are called, they are permitted to work in parallel, and we await them all at the end
    // the first one to respond with a non-Continue result will be the result of the event
    // (if a handler wants to cancel the event before others run, it should be marked with 'await' so that it runs first)
    const results = new Array<any | Promise<any>>(resultValue);

    for (const [callback, captures] of getHandlers(event, asyncHandlers)) {
        // keep track of which handlers are currently running
        current.add(callback);

        // call the event handler, but capture the result
        try {
            const r = callback(event as EventData, ...captures);
            results.push(is.promise(r) ? r.catch(returns.undefined).finally(() => current.delete(callback)) : r);
        } catch (e: any) {
            // if the handler throws, not our problem.
            console.error(e);
        } finally {
            // we should remove it from the current set
            current.delete(callback);
        }
    }

    // wait for all the async handlers to complete
    // and return the first result that isn't 'Continue'
    return event.completed.resolve((await Promise.all(results)).find((each: any) => each !== Continue));
}

function* getHandlers<TResult>(event: Event<any, TResult>, category: Map<string, Subscriber[]>): Iterable<[Callback, string[]]> {
    if (category.size === 0) {
        return;
    }

    loop:
    for (const subscriber of [...category.get(event.name) || [], ...category.get('*') || []]) {
        if (current.has(subscriber.handler)) {
            // the current callback is executing, and is (either directly or indirectly) the source of the event
            // so, we don't want to execute it again.
            continue;
        }

        // when the subscriber is bound to a specific object, then the source must match
        if (subscriber.eventSource && subscriber.eventSource.deref() !== event.source) {
            continue;
        }

        const captures = [] as string[];

        // now we can check discriminators to see if they match
        for (const [name, discriminator] of subscriber.filters) {
            // verify we have a matching descriptor/eventname in the set

            // get the descriptor text values
            const strings = name === event.name || name === '*' ? [] : event.descriptors.get(name);
            if (!strings) {
                // the event name isn't a match (or wildcard), and it doesn't have a descriptor with that name
                continue loop;
            }

            if (discriminator === true) {
                continue;
            }

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (!discriminator(event.data || event.source, [...strings, event.text!], captures)) {
                // the filter (if it exists) didn't match, so skip this handler
                continue loop;
            }
        }

        // looks like we have a match
        yield [subscriber.handler, captures];
    }
}
const boundSubscribers = new WeakMap<ArbitraryObject, (() => void)[]>();
const autoUnsubscribe = new FinalizationRegistry((unsubscribe: () => void) => {
    unsubscribe();
});

export function removeAllListeners(eventSrc: ArbitraryObject) {
    if (eventSrc) {
        // call unsubscribe
        const all = boundSubscribers.get(eventSrc);
        if (all) {
            verbose(`Unsubscribing all from ${typeOf(eventSrc)}`);
            for (const unsubscribe of all) {
                unsubscribe();
            }
        }
        autoUnsubscribe.unregister(eventSrc);
        collectGarbage();
    }
}

/** Subscribe to an event given a trigger expression */
export function on<T>(triggerExpression: string, callback: Callback<T>, eventSrc?: ArbitraryObject): Unsubscribe {
    // parse the event expression into a chain of checks
    const [isSync, once, filters, eventSource] = parse(triggerExpression, eventSrc);
    out:
    if ((global as any).DEVMODE && is.emitter(eventSrc)) {
        const filterNames = [...filters.keys()];
        for (const filterName of filterNames) {
            if (eventSrc.isKnownEvent(filterName)) {
                break out;
            }
        }
        // this is not always an error (as an emitter may not know about all the events it emits in advance)
        // but I like to know if it's happening so I can fix it if I can.
        verbose(`Handler with ${filterNames} [${triggerExpression}] has no events in ${typeOf(eventSrc)}`);
    }
    const subscriber = {
        filters,
        eventSource: eventSource ? new WeakRef(eventSource) : undefined,
        handler: undefined as any
    } as Subscriber;

    // pick the right subscription map depending on if it is an await call or not
    const subscription = isSync ? syncHandlers : asyncHandlers;

    for (const eventName of filters.keys()) {
        // add the handler to the front of the array for that event
        // (since we want newer handlers to run first)
        getOrAdd(subscription, eventName, []).unshift(subscriber);
    }

    // create a function that will remove the handler from the chain
    const unsubscribe = () => {
        for (const eventName of filters.keys()) {
            // remove it from the queue from whence it came
            const subscribers = subscription.get(eventName);
            if (subscribers) {
                const i = subscribers.indexOf(subscriber);
                if (i >= 0) {
                    subscribers.splice(i, 1);
                    // if there are no more listeners for that handler, remove the array too.
                    if (subscribers.length === 0) {
                        subscription.delete(eventName);
                    }
                }
            }
        }
    };

    // setup auto unsubscribe when a bound object is garbage collected
    if (eventSource) {
        autoUnsubscribe.register(eventSource, unsubscribe);
        getOrAdd(boundSubscribers, eventSource, []).push(unsubscribe);
    }

    // set the callback into the handler object (with auto-unsubscribe if it is a 'once' handler)
    subscriber.handler = once ? (...args) => { unsubscribe(); return callback(...args); } : callback;

    return unsubscribe;
}

/** Subscribe to an event given a trigger expression, only for a single time  */
export function once<T>(triggerExpression: string, callback: Callback<T>, eventSrc?: ArbitraryObject): Unsubscribe {
    return on(`once ${triggerExpression}`, callback, eventSrc);
}

export function subscribe(subscriber: Record<string, Callback>, options?: { bindAll?: boolean; eventSource?: ArbitraryObject }): Unsubscribe;
export function subscribe(subscriber: string, options?: { folder?: string; bindAll?: boolean; eventSource?: ArbitraryObject; once?: boolean }): Promise<Unsubscribe>;
export function subscribe<T extends Record<string, any>>(subscriber: Promise<Subscription<T>>, options?: { bindAll?: boolean; eventSource?: ArbitraryObject }): Promise<Unsubscribe>;
export function subscribe(subscriber: Record<string, string>, options?: { folder: string; bindAll?: boolean; eventSource?: ArbitraryObject }): Promise<Unsubscribe>;
export function subscribe<T extends Record<string, any>>(subscriber: Subscription<T>, options?: { bindAll?: boolean; eventSource?: ArbitraryObject }): Unsubscribe;
export function subscribe<T extends Record<string, any>>(subscriber: Promise<Subscription<T>> | string | Subscription<T> | Record<string, string>, options: { folder?: string; bindAll?: boolean; eventSource?: ArbitraryObject; once?: boolean } = {}): Unsubscribe | Promise<Unsubscribe> {
    if (is.promise(subscriber)) {
        return subscriber.then((sub) => subscribe(sub, options));
    }

    const { properties, fields, methods } = members(subscriber);

    if (options.folder) {
        subscriber = subscriber as Record<string, string>;
        return (async () => { // this has to be async - we may be pulling data from a file...
            const unsubs = new Array<Unsubscribe>();

            // if a folder is passed in, then we're subscribing to *members* that are strings (either actual function-lets or strings that are the names of files that contain code)
            for (const [name, _type] of [...properties, ...fields]) {
                // this is a string property, so it might be an event handler
                const text = subscriber[name] as string;

                try {
                    const filename = await filepath.isFile(text, options.folder);
                    if (filename) {
                        // it is a file, so load it as a function-let
                        const code = await readFile(filename, 'utf8');
                        const fn = sandbox.createFunction(code, ['event'], { filename });
                        if (hasErrors(fn)) {
                            for (const each of fn) {
                                console.error(each);
                            }
                            throw new Error(`Error loading ${filename}: ${fn}`);
                        }
                        unsubs.push(on(options.once ? `once ${name}` : name, fn as Callback, options.eventSource));
                        continue;
                    }

                    // if it's not a file, then treat it as a function-let
                    const fn = sandbox.createFunction(text, ['event'], { filename: `launch.json/${name}` });
                    if (hasErrors(fn)) {
                        for (const each of fn) {
                            console.error(each);
                        }
                        throw new Error(`Error loading ${name}: ${fn}`);
                    }
                    unsubs.push(on(options.once ? `once ${name}` : name, fn as Callback, options.eventSource));
                } catch (e: any) {
                    console.error(e);
                    // if that fails
                    continue;
                }
            }

            return () => unsubs.forEach((u) => u());
        })();

    }

    // otherwise, we're subscribing to members that are functions
    const unsubs = new Array<Unsubscribe>();
    for (const [name, info] of methods) {
        if (options.bindAll || info.hasNonWordCharacters || isAnonymousObject(subscriber)) {
            // subscribe this function, (ensure it's an async function)
            unsubs.push(on(options.once ? `once ${name}` : name, info.fn as Callback, options.eventSource));
        }
    }
    return () => unsubs.forEach((u) => u());
}

export function reset() {
    syncHandlers.clear();
    asyncHandlers.clear();
}

function expandVariableArgs<TInput = any, TResult = void>(variableArgs: any[], event: Event<TInput, TResult>): Event<TInput, TResult> {
    const [first, second, third] = variableArgs;

    switch (event.variableArgs.length) {
        case 0:
            event.text = '';
            event.data = undefined;
            event.source = undefined;
            return event;

        case 1:
            if (typeof first === 'string') {
                event.text = first;
            } else {
                event.text = '';
                event.data = first;
            }
            return event;
        case 2:
            if (typeof first === 'string') {
                event.text = first;
                event.data = second;
            } else {
                if (typeof second === 'string') {
                    event.text = second;
                    event.source = first;
                    event.data = undefined;
                } else {
                    event.text = '';
                    event.source = first;
                    event.data = second;
                }
            }
            return event;
        case 3:
            event.source = first;
            event.text = second;
            event.data = third;
            return event;
    }
    throw new Error('Invalid number of arguments');
}

function isSubscribed(name: string) {
    return syncHandlers.has(name) || asyncHandlers.has(name) || asyncHandlers.has('*') || syncHandlers.has('*');
}

/** adds an event to the queue, to be dispatched when it is unqueued */
export async function emit<TResult>(name: string, descriptors: Descriptors, text: string): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string, descriptors: Descriptors, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string, descriptors: Descriptors, text: string, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string, descriptors: Descriptors, source: ArbitraryObject, text: string): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string, descriptors: Descriptors, source: ArbitraryObject, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string, descriptors: Descriptors, source: ArbitraryObject, text: string, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string, text: string): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string, text: string, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string): Promise<TResult | EventStatus>;
export async function emit<TResult>(name: string, ...variableArgs: any[]): Promise<TResult | EventStatus> {
    // quickly check if there are any possible handlers for this event
    if (isSubscribed(name)) {
        const descriptors = variableArgs[0] instanceof Descriptors ? variableArgs.shift() : Descriptors.none;

        // create a promise that will be resolved when the event is dispatched
        const result = new ManualPromise<TResult | EventStatus>();

        // add the event to the queue
        queue.push(expandVariableArgs(variableArgs, { name, variableArgs, descriptors, completed: result }));

        // if the queue was empty, start it draining the queue
        if (DispatcherBusy.isCompleted) {
            void drain(); // don't wait for the queue to finish draining
        }

        // return the promise
        return result;
    }
    return Continue;
}

/** immediately dispatches an event */
export async function emitNow<TResult>(name: string, descriptors: Descriptors, text: string): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string, descriptors: Descriptors, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string, descriptors: Descriptors, text: string, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string, descriptors: Descriptors, source: ArbitraryObject, text: string): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string, descriptors: Descriptors, source: ArbitraryObject, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string, descriptors: Descriptors, source: ArbitraryObject, text: string, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string, text: string): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string, text: string, data: ArbitraryObject): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string): Promise<TResult | EventStatus>;
export async function emitNow<TResult>(name: string, ...variableArgs: any[]): Promise<TResult | EventStatus> {
    // quickly check if there are any possible handlers for this event
    if (isSubscribed(name)) {
        const descriptors = variableArgs[0] instanceof Descriptors ? variableArgs.shift() : Descriptors.none;

        // create a promise that will be resolved when the event is dispatched
        const result = new ManualPromise<TResult | EventStatus>();

        // dispatch the event immediately (the result comes from inside the EventDetails)
        void dispatch(expandVariableArgs(variableArgs, { name, descriptors, variableArgs, completed: result }));

        // return the result promise
        return result;
    }
    return Continue;
}

/** adds an event to the queue, to be dispatched when it is unqueued */
export function notify(name: string, descriptors: Descriptors, text: string): void;
export function notify(name: string, descriptors: Descriptors, data: ArbitraryObject): void;
export function notify(name: string, descriptors: Descriptors, text: string, data: ArbitraryObject): void;
export function notify(name: string, descriptors: Descriptors, source: ArbitraryObject, text: string): void;
export function notify(name: string, descriptors: Descriptors, source: ArbitraryObject, data: ArbitraryObject): void;
export function notify(name: string, descriptors: Descriptors, source: ArbitraryObject, text: string, data: ArbitraryObject): void;
export function notify(name: string, text: string): void;
export function notify(name: string, text: string, data: ArbitraryObject): void;
export function notify(name: string, data: ArbitraryObject): void;
export function notify(name: string): void;
export function notify(name: string, ...variableArgs: any[]): void {
    // quickly check if there are any possible handlers for this event
    if (isSubscribed(name)) {
        const descriptors = variableArgs[0] instanceof Descriptors ? variableArgs.shift() : Descriptors.none;

        // add the event to the queue
        queue.push(expandVariableArgs(variableArgs, { name, variableArgs, descriptors }));

        // if the queue was empty, start it draining the queue
        if (DispatcherBusy.isCompleted) {
            void drain(); // don't wait for the queue to finish draining
        }
    }
}

/** immediately dispatches an event */
export function notifyNow(name: string, descriptors: Descriptors, text: string): void;
export function notifyNow(name: string, descriptors: Descriptors, data: ArbitraryObject): void;
export function notifyNow(name: string, descriptors: Descriptors, text: string, data: ArbitraryObject): void;
export function notifyNow(name: string, descriptors: Descriptors, source: ArbitraryObject, text: string): void;
export function notifyNow(name: string, descriptors: Descriptors, source: ArbitraryObject, data: ArbitraryObject): void;
export function notifyNow(name: string, descriptors: Descriptors, source: ArbitraryObject, text: string, data: ArbitraryObject): void;
export function notifyNow(name: string, text: string): void;
export function notifyNow(name: string, data: ArbitraryObject): void;
export function notifyNow(name: string, text: string, data: ArbitraryObject): void;
export function notifyNow(name: string): void;
export function notifyNow(name: string, ...variableArgs: any[]): void {
    // quickly check if there are any possible handlers for this event
    if (isSubscribed(name)) {
        const descriptors = variableArgs[0] instanceof Descriptors ? variableArgs.shift() : Descriptors.none;

        // dispatch the event immediately
        void dispatch(expandVariableArgs(variableArgs, { name, descriptors, variableArgs }));
    }
}
