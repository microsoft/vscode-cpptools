/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

type ScheduleFlush = (callback: () => void, delay: number) => () => void;

export class BatchedWriter {
    private buffer: string = "";
    private cancelFlush: (() => void) | undefined;
    private flushGeneration: number = 0;
    private disposed: boolean = false;

    constructor(
        private readonly writer: (text: string) => void,
        private readonly flushLength: number = 64 * 1024,
        private readonly flushDelay: number = 50,
        private readonly scheduleFlush: ScheduleFlush = (callback, delay) => {
            const timer = setTimeout(callback, delay);
            return () => clearTimeout(timer);
        }
    ) { }

    public append(text: string): void {
        if (!text) {
            return;
        }
        if (this.disposed) {
            this.writer(text);
            return;
        }

        // Include this append before calling the writer so reentrant appends cannot overtake it.
        // Keep each input intact; an oversized input is flushed synchronously, not truncated.
        this.buffer += text;
        if (this.buffer.length >= this.flushLength) {
            this.flush();
        } else if (!this.cancelFlush) {
            const generation = this.flushGeneration;
            this.cancelFlush = this.scheduleFlush(() => {
                if (generation === this.flushGeneration) {
                    this.flush();
                }
            }, this.flushDelay);
        }
    }

    public flush(): void {
        const text = this.buffer;
        this.buffer = "";
        const cancel = this.cancelFlush;
        this.cancelFlush = undefined;
        ++this.flushGeneration;
        cancel?.();
        if (text) {
            this.writer(text);
        }
    }

    public dispose(): void {
        // Reentrant or late writes must not leave another timer behind during shutdown.
        this.disposed = true;
        this.flush();
    }
}
