/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Duplex, Readable, Writable } from 'stream';
import { TextDecoder, TextEncoder } from 'util';
import { ManualPromise } from '../Async/manualPromise';
import { returns } from '../Async/returns';
import { Signal } from '../Async/signal';
import { EventStatus } from '../Eventing/interfaces';
import { finalize } from '../System/finalize';
import { is } from '../System/guards';
import { verbose } from '../Text/streams';

/* eslint-disable no-constant-condition */

/** An iterator/iterable wrapper to process a stream of lines. */
export class LineIterator implements AsyncIterable<string>, AsyncIterator<string> {
    #current = 0;
    constructor(private lineBuffer: ReadableLineStream, private initial: number, private stopExpression?: string | RegExp) {
        this.#current = Math.max(initial, lineBuffer.head);
    }

    get current() {
        return Math.max(this.#current, this.lineBuffer.head);
    }

    advance() {
        this.#current = Math.max(this.current + 1, this.lineBuffer.head);
        return this;
    }

    /** this is both an iterator and the iterable itself. */
    [Symbol.asyncIterator](): AsyncIterator<string, string> {
        return this;
    }

    /**
     * splits the iterator into two, so that they can be advanced independently.
     *
     * @returns a new iterator that starts at the current position.
     */
    tee() {
        return new LineIterator(this.lineBuffer, this.current, this.stopExpression);
    }

    /**
     * Stops the iterator at the point where we find the matching line.
     *
     * @param expression the string or regex to stop at
     * @returns
     */
    until(expression: string | RegExp) {
        this.stopExpression = expression;
        return this;
    }

    /** allows the iterator to continue */
    resume() {
        this.stopExpression = undefined;
        return this;
    }

    /** resets the iterator to the beginning. */
    reset() {
        // reset the current position to the initial position (or head if it's trimmed)
        this.initial = this.#current = Math.max(
            this.initial,
            this.lineBuffer.head
        );

        return this.resume();
    }

    async filter(expression: string | RegExp) {
        const result = new Array<string>();
        const stream = this.tee();
        if (expression instanceof RegExp) {
            for await (const line of stream) {
                const check = expression.exec(line);
                if (check) {
                    result.push(check[1] || check[0]);
                }
            }
            return result;
        }
        for await (const line of stream) {
            if (line.includes(expression)) {
                result.push(line);
            }
        }

        return result;
    }

    /**
     * Splits the iterator into two, and advances the new iterator to the line that matches the expression.
     */
    from(expression: string | RegExp) {
        return this.tee().skipTo(expression);
    }

    /**
     * Stops the iterator at the point where we find the matching line.
     *
     * @param expression the string or regex to stop at
     */
    to(expression: string | RegExp) {
        return this.until(expression);
    }

    /**
     * Advances the iterator to the point where we find the line.
     */
    async skipTo(expression: string | RegExp) {
        this.stopExpression = undefined;
        do {
            let line = this.lineBuffer.at(this.current);
            while (line === undefined) {
                await this.lineBuffer.changed;
                line = this.lineBuffer.at(this.current);
                if (this.lineBuffer.completed) {
                    return this;
                }
            }
            this.advance();
            if (
                expression instanceof RegExp
                    ? expression.test(line)
                    : expression === line
            ) {
                return this;
            }
        } while (true);
    }

    /**
     * gets the current line, and advances the position.
     * @returns the current line
     */
    private async line() {
        let line = this.lineBuffer.at(this.current);
        while (line === undefined) {
            await this.lineBuffer.changed;
            line = this.lineBuffer.at(this.current);
        }
        this.advance();
        return line;
    }

    /**
     * Skips a number of lines.
     *
     * @param count the number of lines to skip
     * @returns this
     */
    async skip(count: number) {
        do {
            await this.line();
            if (--count === 0) {
                return this;
            }
        } while (true);
    }

    /**
     * Checks if the a line is a match for the current expression.
     *
     * @param line the line to check
     * @returns
     */
    private isMatch(line: string) {
        return this.stopExpression && this.stopExpression instanceof RegExp
            ? this.stopExpression.test(line)
            : this.stopExpression === line;
    }

    /**
     * Iterator next function.
     * @returns the next line, or undefined if the iterator is done.
     */

    async next(): Promise<IteratorResult<string>> {
        do {
            // is the current line (regardless of whether it's full or not) a match
            const value = this.lineBuffer.at(this.current);
            if (value !== undefined && this.isMatch(value)) {
                // we have a match, so we're done
                return { value: undefined, done: true };
            }

            // if we have lines to take, take them
            if (this.current < this.lineBuffer.last) {
                this.advance();
                return { value, done: false };
            }
            // otherwise, we're at the end. if the process is done, then so are we.
            if (this.lineBuffer.completed) {
                return { value: undefined, done: true };
            }

            // we need to wait for more lines to show up
            await this.lineBuffer.changed;
        } while (true);
    }

    /**
     * returns the number of lines available to read.
     */
    get available() {
        return this.lineBuffer.tail - this.current;
    }
}

/** A buffer of lines from a stream (stdout or stderr). */
export class ReadableLineStream implements AsyncIterable<string> {
    readonly changed = new Signal<void>();
    #decoder: TextDecoder;
    #completed = false;
    #buffer = new Array<string>();
    #head = 0;
    #pipes = new Set<ReadWriteLineStream>();
    #partial: string | undefined;

    setReadNotifier(notifier: (text: string) => void) {
        this.readStream = notifier;
    }
    setReadEvent(reading: (text: string) => Promise<EventStatus | string>) {
        this.streamRead = reading;
    }
    pipe(stream: ReadWriteLineStream) {
        this.#pipes.add(stream);
    }
    unpipe(stream: ReadableLineStream) {
        if (this.#pipes.delete(stream as ReadWriteLineStream)) {
            // reciprocate if we deleted it from here.
            stream.unpipe(this);
        }
    }

    get pipes() {
        return this.#pipes;
    }

    protected readStream?: (text: string) => void;
    protected streamRead?: (text: string) => Promise<EventStatus | string>;

    get head() {
        return this.#head;
    }

    get tail() {
        return this.#buffer.length;
    }

    at(index: number) {
        return this.#buffer[index];
    }

    trimTrailingWhitespace = true;

    constructor(private readable: Readable) {
        // if the stream is defined, then we're capturing
        this.#decoder = new TextDecoder();
        this.readable.on('data', (chunk: Buffer) => this.readChunk(chunk));
        this.readable.on('end', () => finalize(this));
    }

    close() {
        if (!this.#completed) {
            this.push();
            for (const each of this.pipes) {
                this.unpipe(each);
                each.unpipe(this);
            }
            this.#completed = true;

            this.changed.dispose();
        }
    }

    /** gets an iterator wrapper for the buffer */
    get iterator() {
        return new LineIterator(this, this.head);
    }

    [Symbol.asyncIterator]() {
        return new LineIterator(this, this.head);
    }

    /** returns true if the process is completed */
    get completed() {
        return this.#completed;
    }

    /** returns the current final line (may be empty!) */
    get currentLine() {
        return this.#buffer[this.#buffer.length - 1];
    }

    /** gets the index of the last actual whole line in the buffer */
    get last() {
        return this.#buffer.length - 1;
    }

    /** filters the content to lines that match the expression */
    filter(expression: string | RegExp) {
        const result = new Array<string>();
        if (expression instanceof RegExp) {
            for (let i = this.#head; i < this.#buffer.length; i++) {
                const check = expression.exec(this.#buffer[i]);
                if (check) {
                    result.push(check[1] || check[0]);
                }
            }
            return result;
        }
        for (let i = this.#head; i < this.#buffer.length; i++) {
            const line = this.#buffer[i];
            if (line.includes(expression)) {
                result.push(line);
            }
        }
        return result;
    }

    private push(line?: string) {
        if (this.#partial !== undefined) {
            this.#partial = this.#partial.trimEnd();
            this.#buffer.push(this.#partial);
            for (const pipe of this.#pipes) {
                void pipe.writeln(this.#partial);
            }
        }
        this.#partial = line;
    }

    /** processes a chunk from the stream */
    private readChunk(chunk: Buffer) {
        // stick the lines into the line array
        if (!chunk || chunk.length === 0) {
            return;
        }

        // decode the chunk
        const content = this.#decoder.decode(chunk, { stream: true });

        // split into lines
        const incoming = content.split(/\r\n|\n/);
        const done = new Array<Promise<any>>();

        // carry over any partial line from before
        if (this.#partial) {
            incoming[0] = this.#partial + incoming[0];
            this.#partial = undefined;
        }

        for (let line of incoming) {
            line = this.trimTrailingWhitespace ? line.trimEnd() : line;

            if (this.readStream) {
                // call notifyReading quickly, so that we don't block the stream
                this.readStream(line);
            }

            if (this.streamRead) {
                // if we have a reading event, then we queue it up
                done.push(this.streamRead(line).then((text) => !is.cancelled(text) ? this.push(text !== undefined ? text : line) : undefined));
            } else {
                // otherwise, we just push the line into the buffer.
                this.push(line);
            }
        }

        if (done.length) {
            // if we have any pending emitted events, wait for them to finish before signaling that we have new lines
            void Promise.all(done).then(() => this.changed.resolve());
        } else {
            // signal that we have new lines
            this.changed.resolve();
        }
    }

    /** clears the buffer */
    clear() {
        this.trim();
    }

    /**
     * Trim elements from the front of the buffer.
     * @param count the number of elements to trim (defaults to trimming the whole buffer.)
     */
    trim(keepMaxLines = 0) {
        // figure out where the new head should be
        const newHead = Math.max(this.head, this.last - keepMaxLines);

        // if we are actually trimming (and the head should move forward), then fill the elements with undefined
        if (newHead > 0) {
            this.#buffer.fill(undefined as unknown as string, this.head, newHead);

            // set the new head position
            this.#head = newHead;
        }
    }

    /** returns a copy of the entire line buffer */
    all() {
        const result = this.#buffer.slice(this.head);
        if (this.#partial) {
            result.push(this.#partial);
        }
        return result;
    }
}

export class ReadWriteLineStream extends ReadableLineStream {
    #encoder = new TextEncoder();
    protected writeable: Writable;

    setWriteEvent(event: (text: string) => Promise<EventStatus | string>) {
        this.streamWrite = event;
    }
    setWriteNotifier(notifier: (text: string) => void) {
        this.wroteStream = notifier;
    }
    protected wroteStream?: (text: string) => void;
    protected streamWrite?: (text: string) => Promise<EventStatus | string>;

    constructor(stream: Duplex);
    constructor(readable: Readable, writeable: Writable);
    constructor(readable: Readable | Duplex, writeable?: Writable) {
        super(readable);
        this.writeable = writeable || readable as Writable;

        this.writeable.on('error', (_error) => {
            /*
            this is handy for debugging to see if errors are happening.

            if ((global as any).DEVMODE && error) {
              verbose(`write-stream - error - ${error.message}`);
            }
            */
        });
    }

    async write(...text: string[]): Promise<void> {
        let content = text;

        if (this.streamWrite) {
            content = new Array<string>();

            // allow the writing to be intercepted
            for (const each of text) {
                if (each) {
                    const result = await this.streamWrite(each);
                    if (!is.cancelled(result)) {
                        content.push(result || each);
                    }
                }
            }
        }
        if (this.wroteStream) {
            for (const each of content) {
                this.wroteStream(each);
            }
        }

        return new Promise((resolve, reject) => {
            // send the content to the stream
            this.writeable.write(this.#encoder.encode(content.join('')), (error: Error | null | undefined) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    async writeln(...text: string[]): Promise<void> {
        let content = text;

        if (this.streamWrite) {
            content = new Array<string>();

            // allow the writing to be intercepted
            for (const each of text) {
                if (each) {
                    const result = await this.streamWrite(each);
                    if (!is.cancelled(result)) {
                        content.push(result || each);
                    }
                }
            }
        }

        if (this.wroteStream) {
            for (const each of content) {
                this.wroteStream(each);
            }
        }

        return new Promise((resolve) => {
            // send the content to the stream
            try {
                if (!this.writeable.destroyed) {
                    this.writeable.write(this.#encoder.encode(content.join('\n') + '\n'), (error: Error | null | undefined) => {
                        if ((global as any).DEVMODE && error) {
                            verbose(`stream-closed - ${error.message}`);
                        }
                    });
                }
            } catch (e: any) {
                if ((global as any).DEVMODE) {
                    verbose(`stream-throws - ${e.message}`);
                }
            } finally {
                resolve(undefined);
            }
        }).catch(returns.undefined) as Promise<void>;
    }
}

export class WriteableLineStream {
    #stream: Writable;
    #encoder: TextEncoder;

    constructor(stream: Writable, encoder: TextEncoder) {
        this.#stream = stream;
        this.#encoder = encoder;
    }

    write(...text: string[]): Promise<void> {
        const result = new ManualPromise();
        this.#stream.write(this.#encoder.encode(text.join('')), (error: Error | null | undefined) => {
            if (error) {
                result.reject(error);
            } else {
                result.resolve();
            }
        });
        return result;
    }

    writeln(...text: string[]) {
        const result = new ManualPromise();
        this.#stream.write(this.#encoder.encode(text.join('\n')), (error: Error | null | undefined) => {
            if (error) {
                result.reject(error);
            } else {
                result.resolve();
            }
        });
        return result;
    }
}
