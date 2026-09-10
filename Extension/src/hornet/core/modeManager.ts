import { LanguageEngine, ParseMode } from '../engines/languageEngine';

/** Serializes transitions, including shutdown, so that rapid setting changes cannot leak servers. */
export class ModeManager {
    private active?: LanguageEngine;
    private queue: Promise<void> = Promise.resolve();
    private disposed = false;
    constructor(private readonly create: (mode: ParseMode) => LanguageEngine,
        private readonly changed: (engine?: LanguageEngine, error?: unknown) => void = () => {}) {}

    getActiveEngine(): LanguageEngine | undefined { return this.active; }

    switchMode(mode: ParseMode): Promise<void> {
        if (this.disposed) { return Promise.reject(new Error('Workspace is closed')); }
        const operation = this.queue.then(async () => {
            if (this.disposed) { return; }
            const previous = this.active;
            this.active = undefined;
            this.changed();
            await previous?.shutdown();
            const candidate = this.create(mode);
            try {
                await candidate.initialize();
                this.active = candidate;
                this.changed(candidate);
            } catch (error) {
                await candidate.shutdown();
                // Restore the previous usable mode after a failed switch.
                if (previous) {
                    try { await previous.initialize(); this.active = previous; } catch { await previous.shutdown(); }
                }
                this.changed(this.active, error);
                throw error;
            }
        });
        this.queue = operation.catch(() => {});
        return operation;
    }

    async shutdown(): Promise<void> {
        this.disposed = true;
        await this.queue;
        await this.active?.shutdown();
        this.active = undefined;
    }
}
