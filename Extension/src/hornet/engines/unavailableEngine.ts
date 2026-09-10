import { LanguageEngine, ParseMode } from './languageEngine';

/** Reserved modes fail explicitly; they never impersonate a working index. */
export class UnavailableEngine implements LanguageEngine {
    constructor(readonly mode: ParseMode.Tag | ParseMode.Flyweight) {}
    async initialize(): Promise<void> { throw new Error(`${this.mode} is planned for a later release. Select Compiler or Hybrid.`); }
    async shutdown(): Promise<void> {}
    async restart(): Promise<void> { await this.initialize(); }
    getCapabilities() { return {}; }
    async request<T>(): Promise<T | null> { return null; }
    async notify(): Promise<void> {}
}
