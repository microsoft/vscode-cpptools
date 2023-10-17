/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import EventEmitter = require('events');
import { ManualPromise } from './manualPromise';

export class PriorityQueue<T> extends EventEmitter {
    private queued = new Map<string, () => Promise<T>>();
    private inProgress = new Map<string, Promise<T>>();
    private completed = new Map<string, T>();
    private failed = new Map<string, any>();

    constructor(private maxParallel: number = 10) {
        super();
    }

    get completedKeys() {
        return [...this.completed.keys()];
    }

    get keys() {
        return [...this.queued.keys(), ...this.inProgress.keys(), ...this.completed.keys(), ...this.failed.keys()];
    }

    has(key: string) {
        return this.queued.has(key) || this.inProgress.has(key) || this.completed.has(key) || this.failed.has(key);
    }

    /** returns the number of items not yet processed */
    get length() {
        return this.queued.size + this.inProgress.size;
    }

    /** returns the total number of items regardless of status */
    get size() {
        return this.failed.size + this.completed.size + this.length;
    }

    // removes a task from the queue, regardless if it is queued, in progress, or completed
    async reset(key: string) {
        // if it's currently running, we have to wait for it to finish what it was doing
        // so that we can remove it from the results.

        if (this.inProgress.has(key)) {
            await this.inProgress.get(key);
        }

        // regardless,  remove it from the queue entirely
        this.queued.delete(key);
        this.completed.delete(key);
        this.failed.delete(key);
    }

    async enqueue(key: string, task: () => Promise<T>): Promise<T> {
        // reset this if it was already queued
        await this.reset(key);

        // returning a promise to the thing we're queueing
        const result = new ManualPromise<T>();

        // add it to the queue, and make it resolve the promise when it's done
        this.queued.set(key, () => {
            void task().then(result.resolve, result.reject);
            return result;
        });

        // start the queue if it's not already running
        if (this.inProgress.size === 0) {
            void this.start();
        }

        // return the promise to the result
        return result;
    }

    async get(key: string): Promise<T | undefined> {
        // if it's already completed
        const value = this.completed.get(key);
        if (value !== undefined) {
            return value;
        }

        // if it's in progress
        const p = this.inProgress.get(key);
        if (p !== undefined) {
            return p;
        }

        // if it failed, throw that to the consumer.
        const f = this.failed.get(key);
        if (f !== undefined) {
            throw f;
        }

        // if it's queued, let's run it right away and return that result
        const task = this.queued.get(key);

        // if we do have a task, run it thru exec
        // so that if we ask for the value again
        // it will cache the result
        return task ? this.exec(key, task) : undefined;
    }

    async getOrEnqueue(key: string, task: () => Promise<T>): Promise<T> {
        const result = await this.get(key);
        return result === undefined ? this.enqueue(key, task) : result;
    }

    private exec(key: string, task: () => Promise<T>) {
        this.queued.delete(key);
        const result = new ManualPromise<T>();
        this.inProgress.set(key, result);

        task().then((value: T) => {
            // when we're done, remove the task from the in progress list
            this.inProgress.delete(key);
            this.completed.set(key, value);
            this.emit('item', key, value);
            result.resolve(value);
        }, (reason: any) => {
            this.inProgress.delete(key);
            this.completed.delete(key);
            this.failed.set(key, reason);
            result.reject(reason);
        });

        return result;
    }

    private async start() {
        while (this.queued.size || this.inProgress.size) {
            if (this.inProgress.size > this.maxParallel || this.queued.size === 0) {
                // if we reached the max parallel tasks, or we have nothing left to queue, wait for one to complete
                await Promise.any(this.inProgress.values());
            }

            //* const {value, done} = this.queued.entries().next();
            // if (!done) {
            // void this.exec(value[0], value[1]);
            //}

            // grab the first task from the queue
            for (const [key, task] of this.queued.entries()) {
                void this.exec(key, task);
                break;
            }
        }

        this.emit('empty', this);
    }

    override on(event: 'item', listener: (key: string, value: T) => void): this;
    override on(event: 'empty', listener: (queue: PriorityQueue<T>) => void): this;
    override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(eventName, listener);
    }

    override once(event: 'item', listener: (key: string, value: T) => void): this;
    override once(event: 'empty', listener: (queue: PriorityQueue<T>) => void): this;
    override once(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.once(eventName, listener);
    }

}
