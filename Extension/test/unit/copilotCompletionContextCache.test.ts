/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe } from 'mocha';
import { strictEqual } from 'node:assert';
import { CompletionContextCache, CompletionContextCachePolicy, DisposableStore } from '../../src/LanguageServer/copilotCompletionContextCache';

interface TestContext {
    caretOffset: number;
    value: string;
}

const defaultPolicy: CompletionContextCachePolicy = {
    featureFlag: 1,
    maxSnippetCount: 7,
    maxSnippetLength: 3072,
    doAggregateSnippets: true
};

describe('Copilot completion context cache', () => {
    it('requires a matching request policy and caret distance', () => {
        const cache = new CompletionContextCache<TestContext>();
        cache.set('file:///source.cpp', 'entry', { caretOffset: 100, value: 'cached' }, defaultPolicy);

        strictEqual(cache.get('file:///source.cpp', 108, 8, defaultPolicy)?.result.value, 'cached');
        strictEqual(cache.get('file:///source.cpp', 109, 8, defaultPolicy), undefined);
        strictEqual(cache.get('file:///source.cpp', 100, 8, { ...defaultPolicy, featureFlag: 2 }), undefined);
        strictEqual(cache.get('file:///source.cpp', 100, 8, { ...defaultPolicy, maxSnippetCount: 1 }), undefined);
        strictEqual(cache.get('file:///source.cpp', 100, 8, { ...defaultPolicy, maxSnippetLength: 128 }), undefined);
        strictEqual(cache.get('file:///source.cpp', 100, 8, { ...defaultPolicy, doAggregateSnippets: false }), undefined);
    });

    it('clears cached results when source or configuration state changes', () => {
        const cache = new CompletionContextCache<TestContext>();
        cache.set('file:///source.cpp', 'entry', { caretOffset: 100, value: 'cached' }, defaultPolicy);

        cache.clear();

        strictEqual(cache.size, 0);
        strictEqual(cache.get('file:///source.cpp', 100, 8, defaultPolicy), undefined);
    });

    it('does not repopulate after an in-flight computation is invalidated', () => {
        const cache = new CompletionContextCache<TestContext>();
        const computationGeneration = cache.currentGeneration;

        cache.clear();

        strictEqual(
            cache.set('file:///source.cpp', 'stale-entry', { caretOffset: 100, value: 'stale' }, defaultPolicy, computationGeneration),
            false);
        strictEqual(cache.size, 0);
        strictEqual(
            cache.set('file:///source.cpp', 'current-entry', { caretOffset: 100, value: 'current' }, defaultPolicy),
            true);
        strictEqual(cache.get('file:///source.cpp', 100, 8, defaultPolicy)?.result.value, 'current');
    });

    it('disposes registrations that complete after provider disposal', () => {
        const store = new DisposableStore<{ dispose(): void }>();
        let disposed = 0;

        strictEqual(store.add({ dispose: () => disposed++ }), true);
        store.dispose();
        strictEqual(disposed, 1);
        strictEqual(store.add({ dispose: () => disposed++ }), false);
        strictEqual(disposed, 2);
    });
});
