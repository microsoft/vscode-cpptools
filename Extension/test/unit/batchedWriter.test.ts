/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import { describe, it } from 'mocha';
import { BatchedWriter } from '../../src/Utility/Async/batchedWriter';

interface ScheduledFlush {
    callback(): void;
    deadline: number;
    canceled: boolean;
}

class TestScheduler {
    public readonly timers: ScheduledFlush[] = [];
    private now: number = 0;

    public readonly schedule = (callback: () => void, delay: number): (() => void) => {
        const timer: ScheduledFlush = { callback, deadline: this.now + delay, canceled: false };
        this.timers.push(timer);
        return () => { timer.canceled = true; };
    };

    public get pendingCount(): number {
        return this.timers.filter(timer => !timer.canceled).length;
    }

    public advance(milliseconds: number): void {
        const end = this.now + milliseconds;
        for (; ;) {
            const next = this.timers.find(timer => !timer.canceled && timer.deadline <= end);
            if (!next) {
                break;
            }
            this.now = next.deadline;
            next.canceled = true;
            next.callback();
        }
        this.now = end;
    }
}

function createWriter(flushLength: number = 64 * 1024, onWrite?: (text: string) => void): {
    writer: BatchedWriter;
    scheduler: TestScheduler;
    chunks: string[];
} {
    const scheduler = new TestScheduler();
    const chunks: string[] = [];
    const writer = new BatchedWriter(text => {
        chunks.push(text);
        onWrite?.(text);
    }, flushLength, 50, scheduler.schedule);
    return { writer, scheduler, chunks };
}

describe('BatchedWriter', () => {
    it('preserves all text and ordering in a timer-flushed batch', () => {
        const { writer, scheduler, chunks } = createWriter();
        const messages = ['first\n', '\n', '  indented\r\n', '路径/é/😀\n', 'last\0\t\n\n'];
        messages.forEach(message => writer.append(message));

        assert.strictEqual(scheduler.pendingCount, 1);
        scheduler.advance(49);
        assert.deepStrictEqual(chunks, []);
        scheduler.advance(1);
        assert.deepStrictEqual(chunks, [messages.join('')]);
        assert.strictEqual(scheduler.pendingCount, 0);
    });

    it('does not postpone the first message deadline when more text arrives', () => {
        const { writer, scheduler, chunks } = createWriter();
        writer.append('first\n');
        scheduler.advance(30);
        writer.append('second\n');
        scheduler.advance(19);
        assert.deepStrictEqual(chunks, []);
        scheduler.advance(1);
        assert.deepStrictEqual(chunks, ['first\nsecond\n']);
        assert.strictEqual(scheduler.timers.length, 1);
    });

    it('flushes synchronously at the size threshold and cancels the timer', () => {
        const { writer, scheduler, chunks } = createWriter(8);
        writer.append('abc');
        writer.append('defgh');

        assert.deepStrictEqual(chunks, ['abcdefgh']);
        assert.strictEqual(scheduler.pendingCount, 0);
        scheduler.timers[0].callback();
        scheduler.advance(50);
        assert.deepStrictEqual(chunks, ['abcdefgh']);
    });

    it('keeps the complete threshold-crossing input in order', () => {
        const { writer, scheduler, chunks } = createWriter(8);
        writer.append('first-');
        writer.append('second');

        assert.deepStrictEqual(chunks, ['first-second']);
        assert.strictEqual(scheduler.pendingCount, 0);
    });

    it('writes an oversized input completely without splitting Unicode', () => {
        const { writer, scheduler, chunks } = createWriter(8);
        const oversized = '😀路径'.repeat(100) + '\r\n';
        writer.append('prefix\n');
        writer.append(oversized);

        assert.deepStrictEqual(chunks, ['prefix\n' + oversized]);
        assert.strictEqual(scheduler.pendingCount, 0);
        writer.append('tail\n');
        scheduler.advance(50);
        assert.deepStrictEqual(
            Buffer.concat(chunks.map(chunk => Buffer.from(chunk))),
            Buffer.from('prefix\n' + oversized + 'tail\n'));
    });

    it('does not retain empty writes or create timers for them', () => {
        const { writer, scheduler, chunks } = createWriter();
        writer.append('');
        writer.flush();
        writer.dispose();

        assert.deepStrictEqual(chunks, []);
        assert.strictEqual(scheduler.timers.length, 0);
    });

    it('ignores a canceled callback even after the next batch starts', () => {
        const { writer, scheduler, chunks } = createWriter();
        writer.append('first');
        const canceledCallback = scheduler.timers[0].callback;
        writer.flush();
        writer.flush();
        writer.append('second');
        canceledCallback();

        assert.deepStrictEqual(chunks, ['first']);
        assert.strictEqual(scheduler.pendingCount, 1);
        scheduler.advance(50);
        assert.deepStrictEqual(chunks, ['first', 'second']);
        writer.flush();
        assert.deepStrictEqual(chunks, ['first', 'second']);
    });

    it('retains a reentrant append after all text that triggered a size flush', () => {
        const { writer, scheduler, chunks } = createWriter(8, text => {
            if (text === 'first-second') {
                writer.append('third');
            }
        });
        writer.append('first-');
        writer.append('second');

        assert.deepStrictEqual(chunks, ['first-second']);
        assert.strictEqual(scheduler.pendingCount, 1);
        scheduler.advance(50);
        assert.deepStrictEqual(chunks, ['first-second', 'third']);
        assert.strictEqual(scheduler.pendingCount, 0);
    });

    it('retains reentrant text and its own deadline during a timer flush', () => {
        const { writer, scheduler, chunks } = createWriter(undefined, text => {
            if (text === 'first') {
                writer.append('second');
            }
        });
        writer.append('first');
        scheduler.advance(50);

        assert.deepStrictEqual(chunks, ['first']);
        assert.strictEqual(scheduler.pendingCount, 1);
        scheduler.advance(49);
        assert.deepStrictEqual(chunks, ['first']);
        scheduler.advance(1);
        assert.deepStrictEqual(chunks, ['first', 'second']);
        assert.strictEqual(scheduler.pendingCount, 0);
    });

    it('flushes pending and reentrant text on disposal without rearming', () => {
        const { writer, scheduler, chunks } = createWriter(undefined, text => {
            if (text === 'first') {
                writer.append('second');
            }
        });
        writer.append('first');
        const canceledCallback = scheduler.timers[0].callback;
        writer.dispose();
        writer.dispose();
        canceledCallback();
        scheduler.advance(100);

        assert.deepStrictEqual(chunks, ['first', 'second']);
        assert.strictEqual(scheduler.pendingCount, 0);
        writer.append('late');
        assert.deepStrictEqual(chunks, ['first', 'second', 'late']);
        assert.strictEqual(scheduler.pendingCount, 0);
    });

    it('bounds pending text and substantially reduces writes for a large burst', () => {
        const flushLength = 64 * 1024;
        let writtenLength = 0;
        const { writer, scheduler, chunks } = createWriter(flushLength, text => { writtenLength += text.length; });
        const messages: string[] = [];
        let receivedLength = 0;
        for (let index = 0; index < 10000; ++index) {
            const message = `  /workspace/路径/directory/file-${index}.cpp\r\n`;
            messages.push(message);
            receivedLength += message.length;
            writer.append(message);
            assert.ok(receivedLength - writtenLength < flushLength);
            assert.ok(scheduler.pendingCount <= 1);
        }
        writer.dispose();

        assert.deepStrictEqual(
            Buffer.concat(chunks.map(chunk => Buffer.from(chunk))),
            Buffer.from(messages.join('')));
        assert.ok(chunks.length < messages.length / 100);
        assert.strictEqual(writtenLength, receivedLength);
        assert.strictEqual(scheduler.pendingCount, 0);
    });
});
