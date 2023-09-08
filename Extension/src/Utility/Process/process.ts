/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/unified-signatures */
/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */

import { ChildProcess, spawn } from 'child_process';
import { basename, resolve } from 'path';
import { Async } from '../Async/constructor';
import { ManualPromise } from '../Async/manualPromise';

import { Emitter } from '../Eventing/emitter';
import { ArbitraryObject, Callback, Unsubscribe } from '../Eventing/interfaces';
import { events, notifications } from '../Eventing/names';
import { finalize } from '../System/finalize';
import { Primitive } from '../System/types';
import { verbose } from '../Text/streams';
import { ReadWriteLineStream, ReadableLineStream } from './streams';

export interface _Process extends Emitter {
    readonly console: ReadWriteLineStream;
    readonly error: ReadableLineStream;

    readonly active: boolean;
    readonly exitCode: Promise<number>;
    write(data: string): Promise<void>;
    writeln(data: string): Promise<void>;
    all(): string[];
    clear(): void;
    stop(): void;
}

interface ProcessEvents {
    on(event: 'started', handler: Callback<void>): Unsubscribe;
    on(event: 'exited', handler: Callback<void>): Unsubscribe;
    on(event: string, handler: Callback<any>): Unsubscribe;
    once(event: 'started', handler: Callback<void>): Unsubscribe;
    once(event: 'exited', handler: Callback<void>): Unsubscribe;
    once(event: string, handler: Callback<any>): Unsubscribe;
}

class ProcessEvents extends Emitter {

}

export class Process extends Async(class Process extends ProcessEvents {
    #process: ChildProcess;

    readonly stdio: ReadWriteLineStream;
    readonly error: ReadableLineStream;

    get active() {
        return !this.exitCode.isCompleted;
    }

    get name() {
        return basename(this.executable);
    }

    get pid() {
        return this.#process.pid;
    }

    /** Event signals when the process is being launched */
    started = this.newNotification(notifications.started, { now: true, once: true });

    /** Event signals when the process has stopped */
    exited = this.newNotification<number>(notifications.exited, { now: true, once: true });

    exitCode = new ManualPromise<number>();
    init: Promise<void> | undefined;

    constructor(readonly executable: string, readonly args: Primitive[], readonly cwd = process.cwd(), readonly env = process.env, stdInOpen = true, ...subscribers: ArbitraryObject[]) {
        super();
        // add any subscribers to the process events before anything else happens
        this.subscribe(...subscribers);

        let spawned = false;
        executable = resolve(executable); // ensure that slashes are correct -- if they aren't, cmd.exe itself fails when slashes are wrong. (other apps don't necessarily fail, but cmd.exe does)

        const startTime = Date.now();
        verbose(`Starting '${this.name}' ${args.map((each) => each.toString()).join(' ')}`);
        const process = this.#process = spawn(executable, args.map((each) => each.toString()), { cwd, env, stdio: [stdInOpen ? 'pipe' : null, 'pipe', 'pipe'], shell: false }).
            on('error', (err: Error) => {
                this.exitCode.reject(err);
            }).
            on('spawn', () => {
                spawned = true;
                void this.started();
            }).
            on('close', (code: number, signal: NodeJS.Signals) => {
                this.exitCode.resolve(code);

                if (spawned) {
                    // ensure the streams are completely closed before we emit the exited event
                    finalize(this.stdio);
                    finalize(this.error);
                }

                verbose(`Ending   '${this.name}' ${args.map((each) => each.toString()).join(' ')} // exiting with code ${code}. in ${Date.now() - startTime}ms}`);

                this.exited(code ?? (signal as any));
            });

        this.stdio = new ReadWriteLineStream(process.stdout, process.stdin);
        this.error = new ReadableLineStream(process.stderr);

        // enable stdio stream events/notifications
        this.stdio.setReadNotifier(this.newNotification<string>(notifications.read, { descriptors: { stdio: this.name } }));
        this.stdio.setReadEvent(this.newEvent<string, string>(events.reading, { descriptors: { stdio: this.name }, now: true }));
        this.stdio.setWriteNotifier(this.newNotification<string>(notifications.wrote, { descriptors: { stdio: this.name }, now: true }));
        this.stdio.setWriteEvent(this.newEvent<string, string>(events.writing, { descriptors: { stdio: this.name }, now: true }));

        // enable error streams events/notifications
        this.error.setReadNotifier(this.newNotification<string>(notifications.read, { descriptors: { error: this.name } }));
        this.error.setReadEvent(this.newEvent<string, string>(events.reading, { descriptors: { error: this.name }, now: true }));
    }

    write(...lines: string[]) {
        return this.stdio.write(...lines);
    }

    writeln(...lines: string[]) {
        return this.stdio.writeln(...lines);
    }

    all() {
        return [...this.stdio.all(), ...this.error.all()];
    }

    clear() {
        this.stdio.clear();
        this.error.clear();
    }

    close() {
        verbose(`closing process ${this.name}`);
        this.#process.kill('SIGTERM');
    }
}) { }
