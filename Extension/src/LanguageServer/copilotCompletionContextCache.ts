/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export interface CompletionContextCachePolicy {
    featureFlag: number;
    maxSnippetCount: number;
    maxSnippetLength: number;
    doAggregateSnippets: boolean;
}

export interface CompletionContextCacheEntry<T> {
    id: string;
    result: T;
    policy: CompletionContextCachePolicy;
}

export class CompletionContextCache<T extends { caretOffset: number }> {
    private readonly entries = new Map<string, CompletionContextCacheEntry<T>>();
    private generation = 0;

    public get size(): number {
        return this.entries.size;
    }

    public get currentGeneration(): number {
        return this.generation;
    }

    public set(uri: string, id: string, result: T, policy: CompletionContextCachePolicy, generation = this.generation): boolean {
        if (generation !== this.generation) {
            return false;
        }
        this.entries.set(uri, { id, result, policy });
        return true;
    }

    public get(uri: string, caretOffset: number, maxCaretDistance: number,
        policy: CompletionContextCachePolicy): CompletionContextCacheEntry<T> | undefined {
        const entry = this.entries.get(uri);
        if (!entry || Math.abs(caretOffset - entry.result.caretOffset) > maxCaretDistance) {
            return undefined;
        }
        const cachedPolicy = entry.policy;
        return cachedPolicy.featureFlag === policy.featureFlag &&
            cachedPolicy.maxSnippetCount === policy.maxSnippetCount &&
            cachedPolicy.maxSnippetLength === policy.maxSnippetLength &&
            cachedPolicy.doAggregateSnippets === policy.doAggregateSnippets ? entry : undefined;
    }

    public has(uri: string): boolean {
        return this.entries.has(uri);
    }

    public clear(): void {
        this.entries.clear();
        this.generation++;
    }
}

export class DisposableStore<T extends { dispose(): unknown }> {
    private disposables: T[] = [];
    private disposed = false;

    public add(disposable: T): boolean {
        if (this.disposed) {
            disposable.dispose();
            return false;
        }
        this.disposables.push(disposable);
        return true;
    }

    public dispose(): void {
        this.disposed = true;
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}
