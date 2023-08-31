/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export interface EventData<TInput = any | undefined> {
    readonly name: string;
    completed?: Promise<unknown>;
    readonly source?: ArbitraryObject;
    readonly data: TInput;
    readonly text: string;
}

export interface Descriptor {
    name: string;
    values?: string[];
}

export type Unsubscribe = () => void;

export type Callback<TOutput = unknown> = (event: EventData<TOutput>, ...args: any[]) => Promise<TOutput> | Promise<EventStatus> | Promise<undefined> | TOutput | EventStatus | undefined | Promise<void>;

export type PickByType<T, TKeepType> = {
    [P in keyof T as T[P] extends TKeepType ? P : never]: T[P]
};

export type Subscription<T extends Record<string, any> = Record<string, any>> = PickByType<T, Callback | string>;

export type ArbitraryObject = Record<string, any>;

export type EventStatus = 'Cancelled' | undefined;

export const Cancelled = 'Cancelled';
export const Continue = undefined;

export type Filter = ($data: ArbitraryObject, $strings: string[], $captures: string[]) => boolean;

export interface Subscriber {
    /** the filter checks generated from the event registration  */
    filters: Map<string, Filter | true>;

    /** the source (aka 'this') value that must match if the handler is tied to an object  */
    eventSource?: WeakRef<ArbitraryObject>;

    /** the event handler function itself */
    handler: Callback<any>;
}
