/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/unified-signatures */
import { is } from '../System/guards';
import { smash } from '../Text/identifiers';
import { Descriptors } from './descriptor';
import { emit, emitNow, notify, notifyNow, on, removeAllListeners, subscribe } from './dispatcher';
import { ArbitraryObject, Callback, Cancelled, Continue, EventStatus, Subscription } from './interfaces';

export interface EventOptions<TOutput = any> {
    now?: boolean;
    default?: TOutput | Promise<TOutput> | (() => TOutput) | (() => Promise<TOutput>);
    cancel?(): TOutput | never;
    descriptors?: Record<string, string | string[]>;
    once?: boolean;
}

export interface WithDefault<TOutput = any> {
    default(): TOutput;
}

export abstract class Emitter {

    readonly descriptors = new Descriptors(this);
    #knownEvents = new Set<string>();

    isKnownEvent(event: string) {
        return !!this.#knownEvents.has(event);
    }

    /** adds an event to the queue, to be dispatched when it is unqueued */
    protected async emit(event: string, text: string): Promise<EventStatus>;
    protected async emit(event: string, data: ArbitraryObject): Promise<EventStatus>;
    protected async emit(event: string, text: string, data: ArbitraryObject): Promise<EventStatus>;
    protected async emit(event: string, tOrD: any, data?: ArbitraryObject): Promise<EventStatus> {
        return data ?
            emit(event, this.descriptors, this, tOrD, data) :
            emit(event, this.descriptors, this, tOrD);
    }

    /** immediately dispatches an event */
    protected async emitNow(event: string, text: string): Promise<EventStatus>;
    protected async emitNow(event: string, data: ArbitraryObject): Promise<EventStatus>;
    protected async emitNow(event: string, text: string, data: ArbitraryObject): Promise<EventStatus>;
    protected async emitNow(event: string, tOrD: any, data?: ArbitraryObject): Promise<EventStatus> {
        return data ?
            emitNow(event, this.descriptors, this, tOrD, data) :
            emitNow(event, this.descriptors, this, tOrD);
    }

    /** adds a notification event to the queue, to be dispatched when it is unqueued */
    protected notify(event: string, text: string): void;
    protected notify(event: string, data: ArbitraryObject): void;
    protected notify(event: string, text: string, data: ArbitraryObject): void;
    protected notify(event: string, tOrD: any, data?: ArbitraryObject): void {
        return data ?
            notify(event, this.descriptors, this, tOrD, data) :
            notify(event, this.descriptors, this, tOrD);
    }

    /** immediately dispatches a notification event */
    protected notifyNow(event: string, text: string): void;
    protected notifyNow(event: string, data: ArbitraryObject): void;
    protected notifyNow(event: string, text: string, data: ArbitraryObject): void;
    protected notifyNow(event: string, tOrD: any, data?: ArbitraryObject): void {
        return data ?
            notifyNow(event, this.descriptors, this, tOrD, data) :
            notifyNow(event, this.descriptors, this, tOrD);
    }

    /**
   * Creates a named event function for triggering events in an {@link Emitter}
   *
   * @returns the created event trigger function of type `() => Promise<TOutput|EventStatus>`
   *
   * @remarks When the trigger is invoked, the event handler can return one of the following:
   *  - {@link Continue} (or `undefined`) - the event is not cancelled, and execution should continue normally.
   *  - {@link Cancelled} - the event is requested to be cancelled (there is no guarantee however.)
   *
   * @param eventName - the string name of the event
   * @param options - options for the event trigger
   */
    protected newEvent(eventName: string, options?: EventOptions): () => Promise<undefined | EventStatus>;

    /**
   * Creates a named event function for triggering events in an {@link Emitter}
   * @template TOutput - the expected output type of of the event handler function.
   *
   * @returns the created event trigger function of type `() => Promise<TOutput|EventStatus>`
   *
   * @remarks When the trigger is invoked, the event handler can return one of the following:
   *  - `<TOutput>` - an value of type `<TOutput>` - the event is not cancelled, and the emitter can use the data returned.
   *  - {@link Continue} (or `undefined`) - the event is not cancelled, and execution should continue normally.
   *  - {@link Cancelled} - the event is requested to be cancelled (there is no guarantee however.)
   *
   * @param eventName - the string name of the event
   * @param options - options for the event trigger (default: `{now: false}`)
   */
    protected newEvent<TOutput>(eventName: string, options?: EventOptions): () => Promise<TOutput | EventStatus>;

    /**
   * Creates a named event function for triggering events in an {@link Emitter}
   * @template TData - the expected input type of the event handler function.
   * @template TOutput - the expected output type of of the event handler function.
   *
   * @returns the created event trigger function of type `(input:TData) => Promise<TOutput|EventStatus>`
   *
   * @remarks When the trigger is invoked, the event handler can return one of the following:
   *  - `<TOutput>` - an value of type `<TOutput>` - the event is not cancelled, and the emitter can use the data returned.
   *  - {@link Continue} (or `undefined`) - the event is not cancelled, and execution should continue normally.
   *  - {@link Cancelled} - the event is requested to be cancelled (there is no guarantee however.)
   *
   * @param eventName - the string name of the event
   * @param options - options for the event trigger (default: `{now: false}`)
   */
    protected newEvent<TData, TOutput>(eventName: string, options?: EventOptions): (input: TData) => Promise<TOutput | EventStatus>;

    /**
   * Creates a named event function for triggering events in an {@link Emitter}
   * @template TText - a text string that can be used to filter events during subscription
   * @template TData - the expected input type of the event handler function.
   * @template TOutput - the expected output type of of the event handler function.
   *
   * @returns the created event trigger function of type `(text: TText, input:TData) => Promise<TOutput|EventStatus>`
   *
   * @remarks When the trigger is invoked, the event handler can return one of the following:
   *  - `<TOutput>` - an value of type `<TOutput>` - the event is not cancelled, and the emitter can use the data returned.
   *  - {@link Continue} (or `undefined`) - the event is not cancelled, and execution should continue normally.
   *  - {@link Cancelled} - the event is requested to be cancelled (there is no guarantee however.)
   *
   * @param eventName - the string name of the event
   * @param options - options for the event trigger (default: `{now: false}`)
   */
    protected newEvent<TText extends string, TData, TOutput>(eventName: string, options?: EventOptions<TOutput>): (text: TText, data: TData) => Promise<TOutput>;
    protected newEvent<TOutput>(eventName: string, options?: EventOptions & WithDefault<TOutput>): () => Promise<TOutput>;
    protected newEvent<TData, TOutput>(eventName: string, options?: EventOptions & WithDefault<TOutput>): (input: TData) => Promise<TOutput>;
    protected newEvent<TText extends string, TData, TOutput>(eventName: string, options?: EventOptions<TOutput> & WithDefault<TOutput>): (text: TText, data: TData) => Promise<TOutput>;
    protected newEvent<TText extends string, TData, TOutput>(eventName: string, options?: EventOptions<TOutput> & WithDefault<TOutput>): (text: TText, data: TData) => Promise<EventStatus | TOutput> {
        eventName = smash(eventName);
        this.#knownEvents.add(eventName);
        const descriptors = options?.descriptors ? new Descriptors(this.descriptors, options.descriptors) : this.descriptors;
        // is it an immediate event?
        if (options?.now) {
            return async (input?: TText, data?: TData): Promise<TOutput | EventStatus> => {
                switch (options?.once) {
                    case false:
                        // already triggered this one time event.
                        return;

                    case true:
                        options.once = false;
                }
                // trigger the event
                const result = await ((data !== undefined) ?
                    emitNow<TOutput>(eventName, descriptors, this, input || '', data as any) : // text and data
                    emitNow<TOutput>(eventName, descriptors, this, input || '', input as any)); // text or data (or neither)

                return is.cancelled(result) ? // was the event cancelled?
                    options?.cancel?.() || Cancelled : // the event was cancelled - call the cancel function, or return Cancelled
                    is.continue(result) ? // was the event continued (handler returned nothing)?
                        is.function(options?.default) ? // the event is continued, is the default handler a function?
                            options?.default() : // the default is a function, call it.
                            options?.default || Continue : // the default is a value, call it (or just return Continue)
                        result as TOutput; // the event was not cancelled, and the handler returned a value.
            };
        }

        // otherwise queue it
        return async (input?: TText, data?: TData): Promise<TOutput | EventStatus> => {
            switch (options?.once) {
                case false:
                    // already triggered this one time event.
                    return;

                case true:
                    options.once = false;
            }
            // trigger the event
            const result = await ((data !== undefined) ?
                emit<TOutput>(eventName, descriptors, this, input || '', data as any) : // text and data
                emit<TOutput>(eventName, descriptors, this, input || '', input as any)); // text or data (or neither)

            return is.cancelled(result) ? // was the event cancelled?
                options?.cancel?.() || Cancelled : // the event was cancelled - call the cancel function, or return Cancelled
                is.continue(result) ? // was the event continued (handler returned nothing)?
                    is.function(options?.default) ? // the event is continued, is the default handler a function?
                        options?.default() : // the default is a function, call it.
                        options?.default || Continue : // the default is a value, call it (or just return Continue)
                    result as TOutput; // the event was not cancelled, and the handler returned a value.
        };
    }

    /** notification with event name, but no data in the event. */
    protected newNotification(eventName: string, options?: EventOptions): () => void;

    /** notification with event name, and some data (of <TData>) */
    protected newNotification<TData>(eventName: string, options?: EventOptions): (input: TData) => void;

    /** notification with an event name, an event string <TInput>, and some data<TData>  */
    protected newNotification<TText extends string, TData>(eventName: string, options?: EventOptions): (text: TText, data: TData) => void;
    protected newNotification<TText extends string, TData>(eventName: string, options?: EventOptions): (text: TText, data: TData) => void {
        eventName = smash(eventName);
        this.#knownEvents.add(eventName);
        const descriptors = options?.descriptors ? new Descriptors(this.descriptors, options.descriptors) : this.descriptors;
        // is it an immediate event?
        if (options?.now) {
            return (input?: TText, data?: TData): void => {
                switch (options.once) {
                    case false:
                        // already triggered this one time event.
                        return;

                    case true:
                        options.once = false;
                }
                // trigger the event
                return (data !== undefined) ?
                    notifyNow(eventName, descriptors, this, input || '', data as any) : // text and data
                    notifyNow(eventName, descriptors, this, input || '', input as any); // text or data (or neither)
            };
        }

        // otherwise queue it

        return (input?: TText, data?: TData): void => {
            switch (options?.once) {
                case false:
                    // already triggered this one time event.
                    return;

                case true:
                    options.once = false;
            }
            // trigger the event
            return (data !== undefined) ?
                notify(eventName, descriptors, this, input || '', data as any) : // text and data
                notify(eventName, descriptors, this, input || '', input as any); // text or data (or neither)
        };
    }

    /** subscribe to events (assumes 'this' modifier, and handler is filtered to the instance) */
    on(eventExpression: string, callback: Callback) {
        return on(`this ${eventExpression}`, callback, this);
    }
    /** subscribe to events (assumes 'this' modifier, and handler is filtered to the instance) */
    once(eventExpression: string, callback: Callback) {
        return on(`this once ${eventExpression}`, callback, this);
    }

    /** subscribe directly to events on this object */
    subscribe(): void;
    subscribe<T>(...subscribers: string[]): Promise<void>;
    subscribe<T extends Record<string, any>>(...subscribers: Subscription<T>[]): void;
    subscribe<T extends Record<string, any>>(...subscribers: string[] | Subscription<T>[]): void | Promise<void> {
        if (subscribers.length === 0) {
            return subscribe(this as unknown as Subscription, { eventSource: this }) && undefined;
        }
        if (typeof subscribers[0] === 'string') {
            return Promise.all(subscribers.map(each => subscribe(each as string, { eventSource: this }))) as unknown as Promise<void>;
        }

        for (const each of subscribers as ArbitraryObject[]) {
            subscribe(each, { eventSource: this });
        }
    }

    removeAllListeners() {
        removeAllListeners(this);
    }

    wait(eventExpression: string, _timeout?: number): Promise<void> {
        return new Promise<void>((e: () => void) => this.on(eventExpression, e));
    }
}

