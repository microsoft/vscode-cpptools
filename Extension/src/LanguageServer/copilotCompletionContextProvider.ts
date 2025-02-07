/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { CodeSnippet, ContextResolver, ResolveRequest } from '@github/copilot-language-server';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { DocumentSelector } from 'vscode-languageserver-protocol';
import { getOutputChannelLogger, Logger } from '../logger';
import * as telemetry from '../telemetry';
import { CopilotCompletionContextResult } from './client';
import { CopilotCompletionContextTelemetry } from './copilotCompletionContextTelemetry';
import { getCopilotApi } from './copilotProviders';
import { clients } from './extension';
import { CppSettings } from './settings';

export interface SnippetEntry {
    uri: string;
    value: string;
    startLine: number;
    endLine: number;
    importance: number;
}

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

export enum CopilotCompletionContextFeatures {
    None = 0,
    Instant = 1,
    Deferred = 2,
}

// Mutually exclusive values for the kind of returned completion context. They either are:
// - computed.
// - obtained from the cache.
// - available in cache but stale (e.g. actual context is far away).
// - missing since the computation took too long and no cache is present (cache miss). The value
//   is asynchronously computed and stored in cache.
// - the token is signaled as cancelled, in which case all the operations are aborted.
// - an unknown state.
export enum CopilotCompletionKind {
    Computed = 'computed',
    GotFromCache = 'gotFromCacheHit',
    StaleCacheHit = 'staleCacheHit',
    MissingCacheMiss = 'missingCacheMiss',
    Canceled = 'canceled',
    Unknown = 'unknown'
}

type CacheEntry = [string, CopilotCompletionContextResult];

export class CopilotCompletionContextProvider implements ContextResolver<CodeSnippet> {
    private static readonly providerId = 'ms-vscode.cpptools';
    private readonly completionContextCache: Map<string, CacheEntry> = new Map();
    private static readonly defaultCppDocumentSelector: DocumentSelector = [{ language: 'cpp' }, { language: 'c' }, { language: 'cuda-cpp' }];
    private static readonly defaultTimeBudgetFactor: number = 0.5;
    private static readonly defaultMaxCaretDistance = 4096;
    private completionContextCancellation = new vscode.CancellationTokenSource();
    private contextProviderDisposable: vscode.Disposable | undefined;

    private async waitForCompletionWithTimeoutAndCancellation<T>(promise: Promise<T>, defaultValue: T | undefined,
        timeout: number, token: vscode.CancellationToken): Promise<[T | undefined, CopilotCompletionKind]> {
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
                return [defaultValue, defaultValue !== undefined ? CopilotCompletionKind.GotFromCache : CopilotCompletionKind.MissingCacheMiss];
            } else if (e instanceof CancellationError) {
                return [undefined, CopilotCompletionKind.Canceled];
            } else {
                throw e;
            }
        }

        return [snippetsOrNothing, CopilotCompletionKind.Computed];
    }

    // Get the completion context with a timeout and a cancellation token.
    // The cancellationToken indicates that the value should not be returned nor cached.
    private async getCompletionContextWithCancellation(context: ResolveRequest, featureFlag: CopilotCompletionContextFeatures,
        startTime: number, out: Logger, telemetry: CopilotCompletionContextTelemetry, token: vscode.CancellationToken):
        Promise<CopilotCompletionContextResult | undefined> {
        const documentUri = context.documentContext.uri;
        const caretOffset = context.documentContext.offset;
        let logMessage = `Copilot: getCompletionContext(${documentUri}:${caretOffset}):`;
        try {
            telemetry.addRequestMetadata(documentUri, caretOffset, context.completionId,
                context.documentContext.languageId, { featureFlag: featureFlag });
            const docUri = vscode.Uri.parse(documentUri);
            const client = clients.getClientFor(docUri);
            if (!client) { throw WellKnownErrors.clientNotFound(); }
            const getCompletionContextStartTime = performance.now();
            const copilotCompletionContext: CopilotCompletionContextResult =
                await client.getCompletionContext(docUri, caretOffset, featureFlag, token);
            telemetry.addRequestId(copilotCompletionContext.requestId);
            logMessage += ` (id:${copilotCompletionContext.requestId})`;
            if (!copilotCompletionContext.isResultMissing) {
                logMessage += `, featureFlag:${copilotCompletionContext.featureFlag},\
 ${copilotCompletionContext.translationUnitUri}:${copilotCompletionContext.caretOffset},\
 snippetsCount:${copilotCompletionContext.snippets.length}`;
                const resultMismatch = copilotCompletionContext.translationUnitUri !== docUri.toString();
                const cacheEntryId = randomUUID().toString();
                this.completionContextCache.set(copilotCompletionContext.translationUnitUri, [cacheEntryId, copilotCompletionContext]);
                const duration = CopilotCompletionContextProvider.getRoundedDuration(startTime);
                telemetry.addCacheComputedData(duration, cacheEntryId);
                if (resultMismatch) { logMessage += `, mismatch TU vs result`; }
                logMessage += `, cached ${copilotCompletionContext.snippets.length} snippets in [ms]: ${duration}`;
                telemetry.addResponseMetadata(false, copilotCompletionContext.snippets.length, copilotCompletionContext.translationUnitUri, copilotCompletionContext.caretOffset,
                    copilotCompletionContext.featureFlag);
                telemetry.addComputeContextElapsed(CopilotCompletionContextProvider.getRoundedDuration(getCompletionContextStartTime));
                return resultMismatch ? undefined : copilotCompletionContext;
            } else {
                logMessage += `, result is missing`;
                telemetry.addResponseMetadata(true);
                return undefined;
            }
        } catch (e) {
            if (e instanceof CancellationError) {
                telemetry.addInternalCanceled(CopilotCompletionContextProvider.getRoundedDuration(startTime));
                logMessage += `, (internal cancellation)`;
                throw e;
            } else if (e instanceof vscode.CancellationError || (e as Error)?.message === CancellationError.Canceled) {
                telemetry.addCopilotCanceled(CopilotCompletionContextProvider.getRoundedDuration(startTime));
                logMessage += `, (copilot cancellation)`;
                throw e;
            }

            if (e instanceof WellKnownErrors) {
                telemetry.addWellKnownError(e.message);
            }

            const err = e as Error;
            out.appendLine(`Copilot: getCompletionContextWithCancellation(${documentUri}:${caretOffset}): Error: '${err?.message}', stack '${err?.stack}`);
            telemetry.addError();
            return undefined;
        } finally {
            out.appendLine(logMessage);
            telemetry.send("cache");
        }
    }
    static readonly CppCodeSnippetsEnabledFeatures = 'CppCodeSnippetsEnabledFeatures';
    static readonly CppCodeSnippetsTimeBudgetFactor = 'CppCodeSnippetsTimeBudgetFactor';
    static readonly CppCodeSnippetsMaxDistanceToCaret = 'CppCodeSnippetsMaxDistanceToCaret';

    private async fetchTimeBudgetFactor(context: ResolveRequest): Promise<number> {
        try {
            const budgetFactor = context.activeExperiments.get(CopilotCompletionContextProvider.CppCodeSnippetsTimeBudgetFactor);
            return (budgetFactor as number) ?? CopilotCompletionContextProvider.defaultTimeBudgetFactor;
        } catch (e) {
            console.warn(`fetchTimeBudgetFactor(): error fetching ${CopilotCompletionContextProvider.CppCodeSnippetsTimeBudgetFactor}, using default: `, e);
            return CopilotCompletionContextProvider.defaultTimeBudgetFactor;
        }
    }

    private async fetchMaxDistanceToCaret(context: ResolveRequest): Promise<number> {
        try {
            const budgetFactor = context.activeExperiments.get(CopilotCompletionContextProvider.CppCodeSnippetsMaxDistanceToCaret);
            return (budgetFactor as number) ?? CopilotCompletionContextProvider.defaultMaxCaretDistance;
        } catch (e) {
            console.warn(`fetchMaxDistanceToCaret(): error fetching ${CopilotCompletionContextProvider.CppCodeSnippetsMaxDistanceToCaret}, using default: `, e);
            return CopilotCompletionContextProvider.defaultMaxCaretDistance;
        }
    }

    private async getEnabledFeatureNames(context: ResolveRequest): Promise<string[] | undefined> {
        try {
            let enabledFeatureNames = new CppSettings().cppCodeSnippetsFeatureNames;
            if (!enabledFeatureNames) { enabledFeatureNames = context.activeExperiments.get(CopilotCompletionContextProvider.CppCodeSnippetsEnabledFeatures) as string; }
            return (enabledFeatureNames?.split(',') as string[]) ?? undefined;
        } catch (e) {
            console.warn(`getEnabledFeatures(): error fetching ${CopilotCompletionContextProvider.CppCodeSnippetsEnabledFeatures}: `, e);
            return undefined;
        }
    }

    private async getEnabledFeatureFlag(context: ResolveRequest): Promise<CopilotCompletionContextFeatures | undefined> {
        let result;
        for (const featureName of await this.getEnabledFeatureNames(context) ?? []) {
            const flag = CopilotCompletionContextFeatures[featureName as keyof typeof CopilotCompletionContextFeatures];
            if (flag !== undefined) { result = (result ?? 0) + flag; }
        }
        return result;
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
        let logMessage = `Copilot: resolve(${context.documentContext.uri}:${context.documentContext.offset}): `;
        const timeBudgetFactor = await this.fetchTimeBudgetFactor(context);
        const maxCaretDistance = await this.fetchMaxDistanceToCaret(context);
        const telemetry = new CopilotCompletionContextTelemetry();
        let copilotCompletionContext: CopilotCompletionContextResult | undefined;
        let copilotCompletionContextKind: CopilotCompletionKind = CopilotCompletionKind.Unknown;
        try {
            const featureFlag: CopilotCompletionContextFeatures | undefined = await this.getEnabledFeatureFlag(context);
            telemetry.addRequestMetadata(context.documentContext.uri, context.documentContext.offset,
                context.completionId, context.documentContext.languageId, { featureFlag, timeBudgetFactor, maxCaretDistance });
            if (featureFlag === undefined) { return []; }
            this.completionContextCancellation.cancel();
            this.completionContextCancellation = new vscode.CancellationTokenSource();
            const docUri = context.documentContext.uri;
            const cacheEntry: CacheEntry | undefined = this.completionContextCache.get(docUri.toString());
            const defaultValue = cacheEntry?.[1];
            const computeSnippetsPromise = this.getCompletionContextWithCancellation(context, featureFlag,
                resolveStartTime, out, telemetry.fork(), this.completionContextCancellation.token);
            [copilotCompletionContext, copilotCompletionContextKind] = await this.waitForCompletionWithTimeoutAndCancellation(
                computeSnippetsPromise, defaultValue, context.timeBudget * timeBudgetFactor, copilotCancel);
            // Fix up copilotCompletionContextKind accounting for stale-cache-hits.
            if (copilotCompletionContextKind === CopilotCompletionKind.GotFromCache &&
                copilotCompletionContext && cacheEntry) {
                telemetry.addCacheHitEntryGuid(cacheEntry[0]);
                const cachedData = cacheEntry[1];
                if (Math.abs(cachedData.caretOffset - context.documentContext.offset) > maxCaretDistance) {
                    copilotCompletionContextKind = CopilotCompletionKind.StaleCacheHit;
                    copilotCompletionContext.snippets = [];
                }
            }
            telemetry.addCompletionContextKind(copilotCompletionContextKind);
            // Handle cancellation.
            if (copilotCompletionContextKind === CopilotCompletionKind.Canceled) {
                const duration: number = CopilotCompletionContextProvider.getRoundedDuration(resolveStartTime);
                telemetry.addInternalCanceled(duration);
                throw new CancellationError();
            }
            telemetry.addCompletionContextKind(copilotCompletionContextKind);
            telemetry.addResponseMetadata(copilotCompletionContext?.isResultMissing ?? true,
                copilotCompletionContext?.snippets?.length, copilotCompletionContext?.translationUnitUri,
                copilotCompletionContext?.caretOffset, copilotCompletionContext?.featureFlag);
            return copilotCompletionContext?.snippets ?? [];
        } catch (e: any) {
            if (e instanceof CancellationError) { throw e; }

            // For any other exception's type, it is an error.
            telemetry.addError();
            throw e;
        } finally {
            const duration: number = CopilotCompletionContextProvider.getRoundedDuration(resolveStartTime);
            if (copilotCompletionContext === undefined || copilotCompletionContext.isResultMissing) {
                logMessage += `no snippets provided (${copilotCompletionContextKind.toString()}), result=${!copilotCompletionContext?.isResultMissing ? "missing" : "undefined"}, elapsed time(ms): ${duration}`;
            } else {
                const uri = copilotCompletionContext.translationUnitUri ?? "<undefined-uri>";
                logMessage += `for ${uri} provided ${copilotCompletionContext.snippets?.length} snippets (${copilotCompletionContextKind.toString()}), elapsed time(ms): ${duration}`;
            }
            telemetry.addResolvedElapsed(duration);
            telemetry.addCacheSize(this.completionContextCache.size);
            telemetry.send();
            out.appendLine(logMessage);
        }
    }

    public async registerCopilotContextProvider(): Promise<void> {
        const properties: Record<string, string> = {};
        const registerCopilotContextProvider = 'registerCopilotContextProvider';
        try {
            const copilotApi = await getCopilotApi();
            if (!copilotApi) { throw new CopilotContextProviderException("getCopilotApi() returned null."); }
            const contextAPI = await copilotApi.getContextProviderAPI("v1");
            if (!contextAPI) { throw new CopilotContextProviderException("getContextProviderAPI(v1) returned null."); }
            this.contextProviderDisposable = contextAPI.registerContextProvider({
                id: CopilotCompletionContextProvider.providerId,
                selector: CopilotCompletionContextProvider.defaultCppDocumentSelector,
                resolver: this
            });
            properties["cppCodeSnippetsProviderRegistered"] = "true";
        } catch (e) {
            console.warn("Failed to register the Copilot Context Provider.");
            properties["error"] = "Failed to register the Copilot Context Provider";
            if (e instanceof CopilotContextProviderException) {
                properties["error"] += `: ${e.message}`;
            }
        } finally {
            telemetry.logCopilotEvent(registerCopilotContextProvider, { ...properties });
        }
    }
}
