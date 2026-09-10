import type { CancellationToken } from 'vscode';
import { LanguageEngine, ParseMode } from './languageEngine';
import { fileURLToPath } from 'node:url';
import { canonical } from '../compdb/compileCommandsParser';

const preciseMethods = new Set(['textDocument/prepareRename', 'textDocument/rename',
    'textDocument/codeAction', 'codeAction/resolve', 'workspace/executeCommand']);

function requestUri(params: unknown): string | undefined {
    const p = params as { textDocument?: { uri: string }; item?: { uri: string } };
    return p?.textDocument?.uri ?? p?.item?.uri;
}

export function deduplicate<T>(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter(item => {
        type Location = { uri?: string; range?: { start: { line: number; character: number } } };
        const value = item as Location & { name?: string; location?: Location };
        const location = value.location ?? value;
        let uri = location.uri;
        if (uri?.startsWith('file:')) { try { uri = canonical(fileURLToPath(uri)); } catch { /* Keep non-file/malformed URI identity. */ } }
        const key = uri && location.range ? JSON.stringify([uri, location.range.start.line, location.range.start.character, value.name]) : JSON.stringify(item);
        if (seen.has(key)) { return false; }
        seen.add(key);
        return true;
    });
}

/** V1 runs Compiler alone. A future index engine can be injected without changing providers. */
export class HybridEngine implements LanguageEngine {
    readonly mode = ParseMode.Hybrid;
    constructor(private readonly compiler: LanguageEngine,
        private readonly hasCompileCommand: (uri: string) => boolean,
        private readonly fallback?: LanguageEngine) {}
    async initialize() { await this.compiler.initialize(); await this.fallback?.initialize(); }
    async shutdown() { await Promise.all([this.compiler.shutdown(), this.fallback?.shutdown()]); }
    async restart() { await this.shutdown(); await this.initialize(); }
    async buildIndex() { await this.compiler.buildIndex?.(); }
    getCapabilities() { return { ...this.fallback?.getCapabilities(), ...this.compiler.getCapabilities() }; }
    async notify(method: string, params: unknown) {
        await Promise.all([this.compiler.notify(method, params), this.fallback?.notify(method, params)]);
    }
    async request<T>(method: string, params: unknown, token?: CancellationToken): Promise<T | null> {
        const uri = requestUri(params);
        const covered = uri !== undefined && this.hasCompileCommand(uri);
        if (preciseMethods.has(method) && uri !== undefined && !covered) { return null; }
        if (method === 'workspace/symbol' && this.fallback) {
            const results = await Promise.all([
                this.compiler.request<unknown[]>(method, params, token), this.fallback.request<unknown[]>(method, params, token)
            ]);
            return deduplicate(results.flatMap(r => r ?? [])) as T;
        }
        const first = !covered && this.fallback ? this.fallback : this.compiler;
        const second = first === this.compiler ? this.fallback : this.compiler;
        const result = await first.request<T>(method, params, token);
        if (token?.isCancellationRequested || preciseMethods.has(method)) { return result; }
        if (result === null || (Array.isArray(result) && result.length === 0)) {
            return second ? second.request<T>(method, params, token) : result;
        }
        return result;
    }
}
