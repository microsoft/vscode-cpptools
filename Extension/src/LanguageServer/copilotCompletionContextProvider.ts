/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DocumentSelector } from 'vscode-languageserver-protocol';
import { getOutputChannelLogger, Logger } from '../logger';
import * as telemetry from '../telemetry';
import { getCopilotApi } from "./copilotProviders";
import { clients } from './extension';
import { CodeSnippet, CompletionContext, ContextProviderApiV1 } from './tmp/contextProviderV1';

// An ever growing cache of completion context snippets. //?? TODO Evict old entries.
const completionContextCache: Map<string, CodeSnippet[]> = new Map<string, CodeSnippet[]>();
const cppDocumentSelector: DocumentSelector = [{ language: 'cpp' }, { language: 'c' }];

class DefaultValueFallback extends Error {
    static readonly DefaultValue = "DefaultValue";
    constructor() { super(DefaultValueFallback.DefaultValue); }
}

class CancellationError extends Error {
    static readonly Cancelled = "Cancelled";
    constructor() { super(CancellationError.Cancelled); }
}

let completionContextCancellation = new vscode.CancellationTokenSource();

// Mutually exclusive values for the kind of snippets. They either come from the cache,
// are computed, or the computation is taking too long and no cache is present. In the latter
// case, the cache is computed anyway while unblocking the execution flow returning undefined.
enum SnippetsKind {
    Computed = 'computed',
    CacheHit = 'cacheHit',
    CacheMiss = 'cacheMiss'
}

// Get the default value if the timeout expires, but throws an exception if the token is cancelled.
async function waitForCompletionWithTimeoutAndCancellation<T>(promise: Promise<T>, defaultValue: T | undefined,
    timeout: number, token: vscode.CancellationToken): Promise<[T | undefined, SnippetsKind]> {
    const defaultValuePromise = new Promise<T>((resolve, reject) => setTimeout(() => {
        if (token.isCancellationRequested) {
            reject('DefaultValuePromise was cancelled');
        } else {
            reject(new DefaultValueFallback());
        }
    }, timeout));
    const cancellationPromise = new Promise<T>((_, reject) => {
        token.onCancellationRequested(() => {
            reject(new CancellationError());
        });
    });
    let snippetsOrNothing: T | undefined;
    try {
        snippetsOrNothing = await Promise.race([promise, cancellationPromise, defaultValuePromise]);
    } catch (e) {
        if (e instanceof DefaultValueFallback) {
            return [defaultValue, defaultValue !== undefined ? SnippetsKind.CacheHit : SnippetsKind.CacheMiss];
        }

        // Rethrow the error for cancellation cases.
        throw e;
    }

    return [snippetsOrNothing, SnippetsKind.Computed];
}

// Get the completion context with a timeout and a cancellation token.
// The cancellationToken indicates that the value should not be returned nor cached.
async function getCompletionContextWithCancellation(documentUri: string, caretOffset: number,
    startTime: number, out: Logger, token: vscode.CancellationToken): Promise<CodeSnippet[]> {
    try {
        const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!activeEditor ||
            activeEditor.document.uri.toString() !== vscode.Uri.parse(documentUri).toString()) {
            return [];
        }

        const snippets = await clients.ActiveClient.getCompletionContext(activeEditor.document.uri, caretOffset, token);

        const codeSnippets = snippets.context.map((item) => {
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            return {
                importance: item.importance, uri: item.uri, value: item.text
            };
        });

        completionContextCache.set(documentUri, codeSnippets);
        const duration: number = Date.now() - startTime;
        out.appendLine(`Copilot: getCompletionContextWithCancellation(): Cached in [ms]: ${duration}`);
        // //?? TODO Add telemetry for elapsed time.

        return codeSnippets;
    } catch (e) {
        const err = e as Error;
        out.appendLine(`Copilot: getCompletionContextWithCancellation(): Error: '${err?.message}', stack '${err?.stack}`);

        // //?? TODO Add telemetry for failure.
        return [];
    }
}

const timeBudgetFactor: number = 0.5;
const cppToolsResolver = {
    async resolve(context: CompletionContext, copilotAborts: vscode.CancellationToken): Promise<CodeSnippet[]> {
        const startTime = Date.now();
        const out: Logger = getOutputChannelLogger();
        let snippetsKind: SnippetsKind = SnippetsKind.Computed;
        try {
            completionContextCancellation.cancel();
            completionContextCancellation = new vscode.CancellationTokenSource();
            const docUri = context.documentContext.uri;
            const cachedValue: CodeSnippet[] | undefined = completionContextCache.get(docUri.toString());
            const snippetsPromise = getCompletionContextWithCancellation(docUri,
                context.documentContext.offset, startTime, out, completionContextCancellation.token);
            const [codeSnippets, kind] = await waitForCompletionWithTimeoutAndCancellation(
                snippetsPromise, cachedValue, context.timeBudget * timeBudgetFactor, copilotAborts);
            snippetsKind = kind;
            // //?? TODO Add telemetry for Computed vs Cached.

            return codeSnippets ?? [];
        } catch (e: any) {
            if (e instanceof CancellationError) {
                out.appendLine(`Copilot: getCompletionContext(): cancelled!`);
            }
            // //?? TODO Add telemetry for failure.
        } finally {
            const duration: number = Date.now() - startTime;
            out.appendLine(`Copilot: getCompletionContext(): snippets retrieval (${snippetsKind.toString()}) elapsed time (ms): ${duration}`);
            // //?? TODO Add telemetry for elapsed time.
        }

        return [];
    }
};

export async function registerCopilotContextProvider(): Promise<void> {
    try {
        const isCustomSnippetProviderApiEnabled = await telemetry.isExperimentEnabled("CppToolsCustomSnippetsApi");
        if (isCustomSnippetProviderApiEnabled) {
            const contextAPI = (await getCopilotApi() as any).getContextProviderAPI('v1') as ContextProviderApiV1;
            contextAPI.registerContextProvider({
                id: 'cppTools',
                selector: cppDocumentSelector,
                resolver: cppToolsResolver
            });
        }
    } catch {
        console.warn("Failed to register the Copilot Context Provider.");
        // //?? TODO Add telemetry for failure.
    }
}
