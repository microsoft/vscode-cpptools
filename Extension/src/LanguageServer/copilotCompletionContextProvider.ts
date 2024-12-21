/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { CodeSnippet, ContextResolver, ResolveRequest } from '@github/copilot-language-server';
import * as vscode from 'vscode';
import { DocumentSelector } from 'vscode-languageserver-protocol';
import { getOutputChannelLogger, Logger } from '../logger';
import * as telemetry from '../telemetry';
import { CopilotCompletionContextTelemetry } from './copilotCompletionContextTelemetry';
import { getCopilotApi } from './copilotProviders';
import { clients } from './extension';

class DefaultValueFallback extends Error {
    static readonly DefaultValue = "DefaultValue";
    constructor() { super(DefaultValueFallback.DefaultValue); }
}

class CancellationError extends Error {
    static readonly Canceled = "Canceled";
    constructor() { super(CancellationError.Canceled); }
}

class CopilotContextProviderException extends Error {
}

class WellKnownErrors extends Error {
    static readonly ClientNotFound = "ClientNotFound";
    private constructor(message: string) { super(message); }
    public static clientNotFound(): Error {
        return new WellKnownErrors(WellKnownErrors.ClientNotFound);
    }
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
    Canceled = 'canceled',
    Unknown = 'unknown'
}

export class CopilotCompletionContextProvider implements ContextResolver<CodeSnippet> {
    private static readonly providerId = 'cppTools';
    private readonly completionContextCache: Map<string, CodeSnippet[]> = new Map<string, CodeSnippet[]>();
    private static readonly defaultCppDocumentSelector: DocumentSelector = [{ language: 'cpp' }, { language: 'c' }, { language: 'cuda-cpp' }];
    private static readonly defaultTimeBudgetFactor: number = 0.5;
    private completionContextCancellation = new vscode.CancellationTokenSource();
    private contextProviderDisposable: vscode.Disposable | undefined;

    private async waitForCompletionWithTimeoutAndCancellation<T>(promise: Promise<T>, defaultValue: T | undefined,
        timeout: number, token: vscode.CancellationToken): Promise<[T | undefined, SnippetsKind]> {
        const defaultValuePromise = new Promise<T>((_resolve, reject) => setTimeout(() => {
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
                return [undefined, SnippetsKind.Canceled];
            } else {
                throw e;
            }
        }

        return [snippetsOrNothing, SnippetsKind.Computed];
    }

    // Get the completion context with a timeout and a cancellation token.
    // The cancellationToken indicates that the value should not be returned nor cached.
    private async getCompletionContextWithCancellation(documentUri: string, caretOffset: number,
        startTime: number, out: Logger, telemetry: CopilotCompletionContextTelemetry, token: vscode.CancellationToken): Promise<CodeSnippet[]> {
        try {
            const docUri = vscode.Uri.parse(documentUri);
            const client = clients.getClientFor(docUri);
            if (!client) { throw WellKnownErrors.clientNotFound(); }
            const getContextStartTime = performance.now();
            const snippets = await client.getCompletionContext(docUri, caretOffset, token);

            const codeSnippets = snippets.context.map((item) => {
                if (token.isCancellationRequested) {
                    telemetry.addInternalCanceled();
                    throw new CancellationError();
                }
                return {
                    importance: item.importance, uri: item.uri, value: item.text
                };
            });

            this.completionContextCache.set(documentUri, codeSnippets);
            const duration = CopilotCompletionContextProvider.getRoundedDuration(startTime);
            out.appendLine(`Copilot: getCompletionContextWithCancellation(): ${codeSnippets.length} snippets cached in [ms]: ${duration}`);
            telemetry.addSnippetCount(codeSnippets.length);
            telemetry.addCacheComputedElapsed(duration);
            telemetry.addComputeContextElapsed(CopilotCompletionContextProvider.getRoundedDuration(getContextStartTime));
            return codeSnippets;
        } catch (e) {
            if (e instanceof CancellationError) {
                telemetry.addInternalCanceled(CopilotCompletionContextProvider.getRoundedDuration(startTime));
                throw e;
            } else if (e instanceof vscode.CancellationError || (e as Error)?.message === CancellationError.Canceled) {
                telemetry.addCopilotCanceled(CopilotCompletionContextProvider.getRoundedDuration(startTime));
                throw e;
            }

            if (e instanceof WellKnownErrors) {
                telemetry.addWellKnownError(e.message);
            }

            const err = e as Error;
            out.appendLine(`Copilot: getCompletionContextWithCancellation(): Error: '${err?.message}', stack '${err?.stack}`);
            telemetry.addError();
            return [];
        } finally {
            telemetry.file();
        }
    }

    private async fetchTimeBudgetFactor(context: ResolveRequest): Promise<number> {
        const budgetFactor = context.activeExperiments.get("CppToolsCopilotTimeBudget");
        return (budgetFactor as number) !== undefined ? budgetFactor as number : CopilotCompletionContextProvider.defaultTimeBudgetFactor;
    }

    private static getRoundedDuration(startTime: number): number {
        return Math.round(performance.now() - startTime);
    }

    public static async Create() {
        const copilotCompletionProvider = new CopilotCompletionContextProvider();
        await copilotCompletionProvider.registerCopilotContextProvider();
        return copilotCompletionProvider;
    }

    public dispose(): void {
        this.completionContextCancellation.cancel();
        this.contextProviderDisposable?.dispose();
    }

    public removeFile(fileUri: string): void {
        this.completionContextCache.delete(fileUri);
    }

    public async resolve(context: ResolveRequest, copilotCancel: vscode.CancellationToken): Promise<CodeSnippet[]> {
        const resolveStartTime = performance.now();
        const out: Logger = getOutputChannelLogger();
        const timeBudgetFactor = await this.fetchTimeBudgetFactor(context);
        const telemetry = new CopilotCompletionContextTelemetry();
        let codeSnippets: CodeSnippet[] | undefined;
        let codeSnippetsKind: SnippetsKind = SnippetsKind.Unknown;
        try {
            this.completionContextCancellation.cancel();
            this.completionContextCancellation = new vscode.CancellationTokenSource();
            const docUri = context.documentContext.uri;
            const cachedValue: CodeSnippet[] | undefined = this.completionContextCache.get(docUri.toString());
            const computeSnippetsPromise = this.getCompletionContextWithCancellation(docUri,
                context.documentContext.offset, resolveStartTime, out, telemetry.fork(), this.completionContextCancellation.token);
            [codeSnippets, codeSnippetsKind] = await this.waitForCompletionWithTimeoutAndCancellation(
                computeSnippetsPromise, cachedValue, context.timeBudget * timeBudgetFactor, copilotCancel);
            if (codeSnippetsKind === SnippetsKind.Canceled) {
                const duration: number = CopilotCompletionContextProvider.getRoundedDuration(resolveStartTime);
                out.appendLine(`Copilot: getCompletionContext(): cancelled, elapsed time (ms) : ${duration}`);
                telemetry.addInternalCanceled(duration);
                throw new CancellationError();
            }
            telemetry.addSnippetCount(codeSnippets?.length);
            return codeSnippets ?? [];
        } catch (e: any) {
            if (e instanceof CancellationError) {
                throw e;
            }

            // For any other exception's type, it is an error.
            telemetry.addError();
            throw e;
        } finally {
            telemetry.addKind(codeSnippetsKind.toString());
            const duration: number = CopilotCompletionContextProvider.getRoundedDuration(resolveStartTime);
            if (codeSnippets === undefined) {
                out.appendLine(`Copilot: getCompletionContext(): no snippets provided (${codeSnippetsKind.toString()}), elapsed time (ms): ${duration}`);
            } else {
                out.appendLine(`Copilot: getCompletionContext(): provided ${codeSnippets?.length} snippets (${codeSnippetsKind.toString()}), elapsed time (ms): ${duration}`);
            }
            telemetry.addResolvedElapsed(duration);
            telemetry.addCacheSize(this.completionContextCache.size);
            telemetry.file();
        }
    }

    public async registerCopilotContextProvider(): Promise<void> {
        try {
            const isCustomSnippetProviderApiEnabled = await telemetry.isExperimentEnabled("CppToolsCustomSnippetsApi");
            if (isCustomSnippetProviderApiEnabled) {
                const copilotApi = await getCopilotApi();
                if (!copilotApi) { throw new CopilotContextProviderException("getCopilotApi() returned null."); }
                const contextAPI = await copilotApi.getContextProviderAPI("v1");
                if (!contextAPI) { throw new CopilotContextProviderException("getContextProviderAPI(v1) returned null."); }
                this.contextProviderDisposable = contextAPI.registerContextProvider({
                    id: CopilotCompletionContextProvider.providerId,
                    selector: CopilotCompletionContextProvider.defaultCppDocumentSelector,
                    resolver: this
                });
            }
        } catch (e) {
            console.warn("Failed to register the Copilot Context Provider.");
            let msg = "Failed to register the Copilot Context Provider";
            if (e instanceof CopilotContextProviderException) {
                msg = msg + ": " + e.message;
            }
            telemetry.logCopilotEvent("registerCopilotContextProviderError", { "message": msg });
        }
    }
}
