/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DocumentSelector } from 'vscode-languageserver-protocol';
import { getOutputChannelLogger, Logger } from '../logger';
import * as telemetry from '../telemetry';
import { CopilotContextTelemetry } from './copilotContextTelemetry';
import { getCopilotApi } from './copilotProviders';
import { clients } from './extension';
import { CodeSnippet, CompletionContext, ContextProviderApiV1, ContextResolver } from './tmp/contextProviderV1';

class DefaultValueFallback extends Error {
    static readonly DefaultValue = "DefaultValue";
    constructor() { super(DefaultValueFallback.DefaultValue); }
}

class CancellationError extends Error {
    static readonly Cancelled = "Cancelled";
    constructor() { super(CancellationError.Cancelled); }
}

// Mutually exclusive values for the kind of snippets. They either are:
// - computed.
// - obtained from the cache.
// - missing and the computation is taking too long and no cache is present (cache miss). The value
//   is asynchronously computed and stored in cache.
// - the token is signaled as cancelled, in which case all the operations are aborted.
// - an unknown state.
enum SnippetsKind {
    Computed = 'computed',
    GotFromCache = 'gotFromCacheHit',
    MissingCacheMiss = 'missingCacheMiss',
    Cancelled = 'cancelled',
    Unknown = 'unknown'
}

export class CopilotCompletionContextProvider implements ContextResolver<CodeSnippet> {
    private static readonly providerId = 'cppTools';
    private readonly completionContextCache: Map<string, CodeSnippet[]> = new Map<string, CodeSnippet[]>();
    private static readonly defaultCppDocumentSelector: DocumentSelector = [{ language: 'cpp' }, { language: 'c' }, { language: 'cuda-cpp' }];
    private static readonly defaultTimeBudgetFactor: number = 0.5;
    private completionContextCancellation = new vscode.CancellationTokenSource();

    // Get the default value if the timeout expires, but throws an exception if the token is cancelled.
    private async waitForCompletionWithTimeoutAndCancellation<T>(promise: Promise<T>, defaultValue: T | undefined,
        timeout: number, token: vscode.CancellationToken): Promise<[T | undefined, SnippetsKind]> {
        const defaultValuePromise = new Promise<T>((resolve, reject) => setTimeout(() => {
            if (token.isCancellationRequested) {
                reject(new CancellationError());
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
                return [defaultValue, defaultValue !== undefined ? SnippetsKind.GotFromCache : SnippetsKind.MissingCacheMiss];
            } else if (e instanceof CancellationError) {
                return [undefined, SnippetsKind.Cancelled];
            } else {
                throw e;
            }
        }

        return [snippetsOrNothing, SnippetsKind.Computed];
    }

    // Get the completion context with a timeout and a cancellation token.
    // The cancellationToken indicates that the value should not be returned nor cached.
    private async getCompletionContextWithCancellation(documentUri: string, caretOffset: number,
        startTime: number, out: Logger, telemetry: CopilotContextTelemetry, token: vscode.CancellationToken): Promise<CodeSnippet[]> {
        try {
            const docUri = vscode.Uri.parse(documentUri);
            const snippets = await clients.getClientFor(docUri).getCompletionContext(docUri, caretOffset, token);

            const codeSnippets = snippets.context.map((item) => {
                if (token.isCancellationRequested) {
                    telemetry.addCancelledLate();
                    throw new CancellationError();
                }
                return {
                    importance: item.importance, uri: item.uri, value: item.text
                };
            });

            this.completionContextCache.set(documentUri, codeSnippets);
            const duration: number = performance.now() - startTime;
            out.appendLine(`Copilot: getCompletionContextWithCancellation(): Cached in [ms]: ${duration}`);
            telemetry.addSnippetCount(codeSnippets?.length);
            telemetry.addCacheComputedElapsed(duration);

            return codeSnippets;
        } catch (e) {
            const err = e as Error;
            out.appendLine(`Copilot: getCompletionContextWithCancellation(): Error: '${err?.message}', stack '${err?.stack}`);
            telemetry.addError();
            return [];
        }
    }

    private async fetchTimeBudgetFactor(context: CompletionContext): Promise<number> {
        const budgetFactor = context.activeExperiments.get("CppToolsCopilotTimeBudget");
        return (budgetFactor as number) !== undefined ? budgetFactor as number : CopilotCompletionContextProvider.defaultTimeBudgetFactor;
    }

    public static async Create() {
        const copilotCompletionProvider = new CopilotCompletionContextProvider();
        await copilotCompletionProvider.registerCopilotContextProvider();
        return copilotCompletionProvider;
    }

    public removeFile(fileUri: string): void {
        this.completionContextCache.delete(fileUri);
    }

    public async resolve(context: CompletionContext, copilotAborts: vscode.CancellationToken): Promise<CodeSnippet[]> {
        const startTime = performance.now();
        const out: Logger = getOutputChannelLogger();
        const timeBudgetFactor = await this.fetchTimeBudgetFactor(context);
        const telemetry = new CopilotContextTelemetry();
        let codeSnippets: CodeSnippet[] | undefined;
        let codeSnippetsKind: SnippetsKind = SnippetsKind.Unknown;
        try {
            this.completionContextCancellation.cancel();
            this.completionContextCancellation = new vscode.CancellationTokenSource();
            const docUri = context.documentContext.uri;
            const cachedValue: CodeSnippet[] | undefined = this.completionContextCache.get(docUri.toString());
            const snippetsPromise = this.getCompletionContextWithCancellation(docUri,
                context.documentContext.offset, startTime, out, telemetry.fork(), this.completionContextCancellation.token);
            [codeSnippets, codeSnippetsKind] = await this.waitForCompletionWithTimeoutAndCancellation(
                snippetsPromise, cachedValue, context.timeBudget * timeBudgetFactor, copilotAborts);
            if (codeSnippetsKind === SnippetsKind.Cancelled) {
                const duration: number = performance.now() - startTime;
                out.appendLine(`Copilot: getCompletionContext(): cancelled, elapsed time (ms) : ${duration}`);
                telemetry.addCancelled();
                telemetry.addCancellationElapsed(duration);
                throw new CancellationError();
            }
            telemetry.addSnippetCount(codeSnippets?.length);
            return codeSnippets ?? [];
        } catch (e: any) {
            telemetry.addError();
            throw e;
        } finally {
            telemetry.addKind(codeSnippetsKind.toString());
            const duration: number = performance.now() - startTime;
            if (codeSnippets === undefined) {
                out.appendLine(`Copilot: getCompletionContext(): no snkppets provided (${codeSnippetsKind.toString()}), elapsed time (ms): ${duration}`);
            } else {
                out.appendLine(`Copilot: getCompletionContext(): provided ${codeSnippets?.length} snippets (${codeSnippetsKind.toString()}), elapsed time (ms): ${duration}`);
            }
            telemetry.addResolvedElapsed(duration);
            telemetry.addCacheSize(this.completionContextCache.size);
            // //?? TODO telemetry.file();
        }

        return [];
    }

    public async registerCopilotContextProvider(): Promise<void> {
        try {
            const isCustomSnippetProviderApiEnabled = await telemetry.isExperimentEnabled("CppToolsCustomSnippetsApi");
            if (isCustomSnippetProviderApiEnabled) {
                const contextAPI = (await getCopilotApi() as any).getContextProviderAPI('v1') as ContextProviderApiV1;
                contextAPI.registerContextProvider({
                    id: CopilotCompletionContextProvider.providerId,
                    selector: CopilotCompletionContextProvider.defaultCppDocumentSelector,
                    resolver: this
                });
            }
        } catch {
            console.warn("Failed to register the Copilot Context Provider.");
            telemetry.logCopilotEvent("registerCopilotContextProviderError", { "message": "Failed to register the Copilot Context Provider." });
        }
    }
}
