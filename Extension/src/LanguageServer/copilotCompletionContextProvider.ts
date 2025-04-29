/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { ContextResolver, ResolveRequest, SupportedContextItem } from '@github/copilot-language-server';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { DocumentSelector } from 'vscode-languageserver-protocol';
import { isBoolean, isNumber, isString } from '../common';
import { getOutputChannelLogger, Logger } from '../logger';
import * as telemetry from '../telemetry';
import { CopilotCompletionContextResult } from './client';
import { CopilotCompletionContextTelemetry } from './copilotCompletionContextTelemetry';
import { getCopilotApi } from './copilotProviders';
import { clients } from './extension';
import { CppSettings } from './settings';

class DefaultValueFallback extends Error {
    static readonly DefaultValue = "DefaultValue";
    constructor() { super(DefaultValueFallback.DefaultValue); }
}

class CancellationError extends Error {
    static readonly Canceled = "Canceled";
    constructor() {
        super(CancellationError.Canceled);
        this.name = this.message;
    }
}

class InternalCancellationError extends CancellationError {
}

class CopilotCancellationError extends CancellationError {
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

// A bit mask for enabling features in the completion context.
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

export class CopilotCompletionContextProvider implements ContextResolver<SupportedContextItem> {
    private static readonly providerId = 'ms-vscode.cpptools';
    private readonly completionContextCache: Map<string, CacheEntry> = new Map();
    private static readonly defaultCppDocumentSelector: DocumentSelector = [{ language: 'cpp' }, { language: 'c' }, { language: 'cuda-cpp' }];
    // The default time budget for providing a value from resolve().
    private static readonly defaultTimeBudgetMs: number = 7;
    // Assume the cache is stale when the distance to the current caret is greater than this value.
    private static readonly defaultMaxCaretDistance = 8192;
    private static readonly defaultMaxSnippetCount = 15;
    private static readonly defaultMaxSnippetLength = 10 * 1024; // 10KB
    private static readonly defaultDoAggregateSnippets = true;
    private completionContextCancellation = new vscode.CancellationTokenSource();
    private contextProviderDisposable: vscode.Disposable | undefined;
    static readonly CppContextProviderEnabledFeatures = 'enabledFeatures';
    static readonly CppContextProviderTimeBudgetMs = 'timeBudgetMs';
    static readonly CppContextProviderMaxSnippetCount = 'maxSnippetCount';
    static readonly CppContextProviderMaxSnippetLength = 'maxSnippetLength';
    static readonly CppContextProviderMaxDistanceToCaret = 'maxDistanceToCaret';
    static readonly CppContextProviderDoAggregateSnippets = 'doAggregateSnippets';

    constructor(private readonly logger: Logger) {
    }

    private async waitForCompletionWithTimeoutAndCancellation<T>(promise: Promise<T>, defaultValue: T | undefined,
        timeout: number, copilotToken: vscode.CancellationToken): Promise<[T | undefined, CopilotCompletionKind]> {
        const defaultValuePromise = new Promise<T>((_resolve, reject) => setTimeout(() => {
            if (copilotToken.isCancellationRequested) {
                reject(new CancellationError());
            } else {
                reject(new DefaultValueFallback());
            }
        }, timeout));
        const cancellationPromise = new Promise<T>((_, reject) => {
            copilotToken.onCancellationRequested(() => {
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

    private static normalizeFeatureFlag(featureFlag: CopilotCompletionContextFeatures): CopilotCompletionContextFeatures {
        // eslint-disable-next-line no-bitwise
        if ((featureFlag & CopilotCompletionContextFeatures.Instant) === CopilotCompletionContextFeatures.Instant) { return CopilotCompletionContextFeatures.Instant; }
        // eslint-disable-next-line no-bitwise
        if ((featureFlag & CopilotCompletionContextFeatures.Deferred) === CopilotCompletionContextFeatures.Deferred) { return CopilotCompletionContextFeatures.Deferred; }
        return CopilotCompletionContextFeatures.None;
    }

    // Get the completion context with a timeout and a cancellation token.
    // The cancellationToken indicates that the value should not be returned nor cached.
    private async getCompletionContextWithCancellation(context: ResolveRequest, featureFlag: CopilotCompletionContextFeatures,
        maxSnippetCount: number, maxSnippetLength: number, doAggregateSnippets: boolean, startTime: number, telemetry: CopilotCompletionContextTelemetry,
        internalToken: vscode.CancellationToken):
        Promise<CopilotCompletionContextResult | undefined> {
        const documentUri = context.documentContext.uri;
        const caretOffset = context.documentContext.offset;
        let logMessage = `Copilot: getCompletionContext(${documentUri}:${caretOffset}):`;
        try {
            const snippetsFeatureFlag = CopilotCompletionContextProvider.normalizeFeatureFlag(featureFlag);
            telemetry.addRequestMetadata(documentUri, caretOffset, context.completionId,
                context.documentContext.languageId, { featureFlag: snippetsFeatureFlag });
            const docUri = vscode.Uri.parse(documentUri);
            const getClientForTime = performance.now();
            const client = clients.getClientFor(docUri);
            const getClientForDuration = CopilotCompletionContextProvider.getRoundedDuration(getClientForTime);
            telemetry.addGetClientForElapsed(getClientForDuration);
            if (!client) { throw WellKnownErrors.clientNotFound(); }
            const getCompletionContextStartTime = performance.now();

            const copilotCompletionContext: CopilotCompletionContextResult =
                await client.getCompletionContext(docUri, caretOffset, snippetsFeatureFlag, maxSnippetCount, maxSnippetLength, doAggregateSnippets, internalToken);
            telemetry.addRequestId(copilotCompletionContext.requestId);
            logMessage += `(id:${copilotCompletionContext.requestId}) (getClientFor elapsed:${getClientForDuration}ms)`;
            if (!copilotCompletionContext.areSnippetsMissing) {
                const resultMismatch = copilotCompletionContext.sourceFileUri !== docUri.toString();
                if (resultMismatch) { logMessage += ` (mismatch TU vs result)`; }
            }
            const cacheEntryId = randomUUID().toString();
            this.completionContextCache.set(copilotCompletionContext.sourceFileUri, [cacheEntryId, copilotCompletionContext]);
            const duration = CopilotCompletionContextProvider.getRoundedDuration(startTime);
            telemetry.addCacheComputedData(duration, cacheEntryId);
            logMessage += ` cached in ${duration}ms ${copilotCompletionContext.traits.length} trait(s)`;
            if (copilotCompletionContext.areSnippetsMissing) { logMessage += ` (missing code snippets) `; }
            else {
                logMessage += ` and ${copilotCompletionContext.snippets.length} snippet(s)`;
                logMessage += `, response.featureFlag:${copilotCompletionContext.featureFlag}, \
response.uri:${copilotCompletionContext.sourceFileUri || "<not-set>"}:${copilotCompletionContext.caretOffset} `;
            }

            telemetry.addResponseMetadata(copilotCompletionContext.areSnippetsMissing, copilotCompletionContext.snippets.length,
                copilotCompletionContext.traits.length, copilotCompletionContext.caretOffset, copilotCompletionContext.featureFlag);
            telemetry.addComputeContextElapsed(CopilotCompletionContextProvider.getRoundedDuration(getCompletionContextStartTime));

            return copilotCompletionContext;
        } catch (e: any) {
            if (e instanceof vscode.CancellationError || e.message === CancellationError.Canceled) {
                telemetry.addInternalCanceled(CopilotCompletionContextProvider.getRoundedDuration(startTime));
                logMessage += ` (internal cancellation) `;
                throw InternalCancellationError;
            }

            if (e instanceof WellKnownErrors) {
                telemetry.addWellKnownError(e.message);
            }

            telemetry.addError();
            this.logger.appendLineAtLevel(7, `Copilot: getCompletionContextWithCancellation(${documentUri}: ${caretOffset}): Error: '${e}'`);
            return undefined;
        } finally {
            this.logger.
                appendLineAtLevel(7, `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] ${logMessage}`);
            telemetry.send("cache");
        }
    }

    static readonly paramsCache: Record<string, string | number | boolean> = {};
    static paramsCacheCreated = false;
    private getContextProviderParam<T>(paramName: string): T | undefined {
        try {
            if (!CopilotCompletionContextProvider.paramsCacheCreated) {
                CopilotCompletionContextProvider.paramsCacheCreated = true;
                const paramsJson = new CppSettings().cppContextProviderParams;
                if (isString(paramsJson)) {
                    try {
                        const params = JSON.parse(paramsJson.replaceAll(/'/g, '"'));
                        for (const key in params) {
                            CopilotCompletionContextProvider.paramsCache[key] = params[key];
                        }
                    } catch (e) {
                        console.warn(`getContextProviderParam(): error parsing getContextProviderParam: `, e);
                    }
                }
            }
            return CopilotCompletionContextProvider.paramsCache[paramName] as T;
        } catch (e) {
            console.warn(`getContextProviderParam(): error fetching getContextProviderParam: `, e);
            return undefined;
        }
    }

    private async fetchTimeBudgetMs(context: ResolveRequest): Promise<number> {
        try {
            const timeBudgetMs = this.getContextProviderParam(CopilotCompletionContextProvider.CppContextProviderTimeBudgetMs) ??
                context.activeExperiments.get(CopilotCompletionContextProvider.CppContextProviderTimeBudgetMs);
            return isNumber(timeBudgetMs) ? timeBudgetMs : CopilotCompletionContextProvider.defaultTimeBudgetMs;
        } catch (e) {
            console.warn(`fetchTimeBudgetMs(): error fetching ${CopilotCompletionContextProvider.CppContextProviderTimeBudgetMs}, using default: `, e);
            return CopilotCompletionContextProvider.defaultTimeBudgetMs;
        }
    }

    private async fetchMaxDistanceToCaret(context: ResolveRequest): Promise<number> {
        try {
            const maxDistance = this.getContextProviderParam(CopilotCompletionContextProvider.CppContextProviderMaxDistanceToCaret) ??
                context.activeExperiments.get(CopilotCompletionContextProvider.CppContextProviderMaxDistanceToCaret);
            return isNumber(maxDistance) ? maxDistance : CopilotCompletionContextProvider.defaultMaxCaretDistance;
        } catch (e) {
            console.warn(`fetchMaxDistanceToCaret(): error fetching ${CopilotCompletionContextProvider.CppContextProviderMaxDistanceToCaret}, using default: `, e);
            return CopilotCompletionContextProvider.defaultMaxCaretDistance;
        }
    }

    private async fetchMaxSnippetCount(context: ResolveRequest): Promise<number> {
        try {
            const maxSnippetCount = this.getContextProviderParam(CopilotCompletionContextProvider.CppContextProviderMaxSnippetCount) ??
                context.activeExperiments.get(CopilotCompletionContextProvider.CppContextProviderMaxSnippetCount);
            return isNumber(maxSnippetCount) ? maxSnippetCount : CopilotCompletionContextProvider.defaultMaxSnippetCount;
        } catch (e) {
            console.warn(`fetchMaxSnippetCount(): error fetching ${CopilotCompletionContextProvider.defaultMaxSnippetCount}, using default: `, e);
            return CopilotCompletionContextProvider.defaultMaxSnippetCount;
        }
    }

    private async fetchMaxSnippetLength(context: ResolveRequest): Promise<number> {
        try {
            const maxSnippetLength = this.getContextProviderParam(CopilotCompletionContextProvider.CppContextProviderMaxSnippetLength) ??
                context.activeExperiments.get(CopilotCompletionContextProvider.CppContextProviderMaxSnippetLength);
            return isNumber(maxSnippetLength) ? maxSnippetLength : CopilotCompletionContextProvider.defaultMaxSnippetLength;
        } catch (e) {
            console.warn(`fetchMaxSnippetLength(): error fetching ${CopilotCompletionContextProvider.defaultMaxSnippetLength}, using default: `, e);
            return CopilotCompletionContextProvider.defaultMaxSnippetLength;
        }
    }

    private async fetchDoAggregateSnippets(context: ResolveRequest): Promise<boolean> {
        try {
            const doAggregateSnippets = this.getContextProviderParam(CopilotCompletionContextProvider.CppContextProviderDoAggregateSnippets) ??
                context.activeExperiments.get(CopilotCompletionContextProvider.CppContextProviderDoAggregateSnippets);
            return isBoolean(doAggregateSnippets) ? doAggregateSnippets : CopilotCompletionContextProvider.defaultDoAggregateSnippets;
        } catch (e) {
            console.warn(`fetchDoAggregateSnippets(): error fetching ${CopilotCompletionContextProvider.defaultDoAggregateSnippets}, using default: `, e);
            return CopilotCompletionContextProvider.defaultDoAggregateSnippets;
        }
    }

    private async getEnabledFeatureNames(context: ResolveRequest): Promise<string[] | undefined> {
        try {
            const enabledFeatureNames = this.getContextProviderParam(CopilotCompletionContextProvider.CppContextProviderEnabledFeatures) ??
                context.activeExperiments.get(CopilotCompletionContextProvider.CppContextProviderEnabledFeatures);
            if (isString(enabledFeatureNames)) {
                return enabledFeatureNames.split(',').map(s => s.trim());
            }
        } catch (e) {
            console.warn(`getEnabledFeatureNames(): error fetching ${CopilotCompletionContextProvider.CppContextProviderEnabledFeatures}: `, e);
        }
        return undefined;
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
        const copilotCompletionProvider = new CopilotCompletionContextProvider(getOutputChannelLogger());
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

    private computeSnippetsResolved: boolean = true;

    private async resolveResultAndKind(context: ResolveRequest, featureFlag: CopilotCompletionContextFeatures,
        telemetry: CopilotCompletionContextTelemetry, defaultValue: CopilotCompletionContextResult | undefined,
        resolveStartTime: number, timeBudgetMs: number, maxSnippetCount: number, maxSnippetLength: number, doAggregateSnippets: boolean,
        copilotCancel: vscode.CancellationToken): Promise<[CopilotCompletionContextResult | undefined, CopilotCompletionKind]> {
        if (this.computeSnippetsResolved) {
            this.computeSnippetsResolved = false;
            const computeSnippetsPromise = this.getCompletionContextWithCancellation(context, featureFlag,
                maxSnippetCount, maxSnippetLength, doAggregateSnippets, resolveStartTime, telemetry.fork(), this.completionContextCancellation.token).finally(
                    () => this.computeSnippetsResolved = true
                );
            const res = await this.waitForCompletionWithTimeoutAndCancellation(
                computeSnippetsPromise, defaultValue, timeBudgetMs, copilotCancel);
            return res;
        } else { return [defaultValue, defaultValue ? CopilotCompletionKind.GotFromCache : CopilotCompletionKind.MissingCacheMiss]; }
    }

    public async resolve(context: ResolveRequest, copilotCancel: vscode.CancellationToken): Promise<SupportedContextItem[]> {
        const resolveStartTime = performance.now();
        let logMessage = `Copilot: resolve(${context.documentContext.uri}: ${context.documentContext.offset}):`;
        const cppTimeBudgetMs = await this.fetchTimeBudgetMs(context);
        const maxCaretDistance = await this.fetchMaxDistanceToCaret(context);
        const maxSnippetCount = await this.fetchMaxSnippetCount(context);
        const maxSnippetLength = await this.fetchMaxSnippetLength(context);
        const doAggregateSnippets = await this.fetchDoAggregateSnippets(context);
        const telemetry = new CopilotCompletionContextTelemetry();
        let copilotCompletionContext: CopilotCompletionContextResult | undefined;
        let copilotCompletionContextKind: CopilotCompletionKind = CopilotCompletionKind.Unknown;
        let featureFlag: CopilotCompletionContextFeatures | undefined;
        const docUri = context.documentContext.uri;
        const docOffset = context.documentContext.offset;
        try {
            featureFlag = await this.getEnabledFeatureFlag(context);
            telemetry.addRequestMetadata(context.documentContext.uri, context.documentContext.offset,
                context.completionId, context.documentContext.languageId, {
                featureFlag, timeBudgetMs: cppTimeBudgetMs, maxCaretDistance,
                maxSnippetCount, maxSnippetLength, doAggregateSnippets
            });
            if (featureFlag === undefined) { return []; }
            const cacheEntry: CacheEntry | undefined = this.completionContextCache.get(docUri.toString());
            const defaultValue = cacheEntry?.[1];
            [copilotCompletionContext, copilotCompletionContextKind] = await this.resolveResultAndKind(context, featureFlag,
                telemetry.fork(), defaultValue, resolveStartTime, cppTimeBudgetMs, maxSnippetCount, maxSnippetLength, doAggregateSnippets, copilotCancel);
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
                telemetry.addCopilotCanceled(duration);
                throw new CopilotCancellationError();
            }
            logMessage += ` (id: ${copilotCompletionContext?.requestId})`;
            return [...copilotCompletionContext?.snippets ?? [], ...copilotCompletionContext?.traits ?? []] as SupportedContextItem[];
        } catch (e: any) {
            if (e instanceof CopilotCancellationError) {
                telemetry.addCopilotCanceled(CopilotCompletionContextProvider.getRoundedDuration(resolveStartTime));
                logMessage += ` (copilot cancellation)`;
                throw e;
            }
            if (e instanceof InternalCancellationError) {
                telemetry.addInternalCanceled(CopilotCompletionContextProvider.getRoundedDuration(resolveStartTime));
                logMessage += ` (internal cancellation) `;
                throw e;
            }
            if (e instanceof CancellationError) { throw e; }

            // For any other exception's type, it is an error.
            telemetry.addError();
            throw e;
        } finally {
            const duration: number = CopilotCompletionContextProvider.getRoundedDuration(resolveStartTime);
            logMessage += `featureFlag:${featureFlag?.toString()}, `;
            if (copilotCompletionContext === undefined) {
                logMessage += `result is undefined and no code snippets provided(${copilotCompletionContextKind.toString()}), elapsed time:${duration} ms`;
            } else {
                logMessage += `for ${docUri}:${docOffset} provided ${copilotCompletionContext.snippets.length} code snippet(s)(${copilotCompletionContextKind.toString()}\
 ${copilotCompletionContext?.areSnippetsMissing ? ", missing code snippets" : ""}) and ${copilotCompletionContext.traits.length} trait(s), elapsed time:${duration} ms`;
            }
            telemetry.addResponseMetadata(copilotCompletionContext?.areSnippetsMissing ?? true,
                copilotCompletionContext?.snippets.length, copilotCompletionContext?.traits.length,
                copilotCompletionContext?.caretOffset, copilotCompletionContext?.featureFlag);
            telemetry.addResolvedElapsed(duration);
            telemetry.addCacheSize(this.completionContextCache.size);
            telemetry.send();
            this.logger.appendLineAtLevel(7, `[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] ${logMessage}`);
        }
    }

    public async registerCopilotContextProvider(): Promise<void> {
        const properties: Record<string, string> = {};
        const registerCopilotContextProvider = 'registerCopilotContextProvider';
        try {
            const copilotApi = await getCopilotApi();
            if (!copilotApi) { throw new CopilotContextProviderException("getCopilotApi() returned null, Copilot is missing or inactive."); }
            const hasGetContextProviderAPI = "getContextProviderAPI" in copilotApi;
            if (!hasGetContextProviderAPI) { throw new CopilotContextProviderException("getContextProviderAPI() is not available."); }
            const contextAPI = await copilotApi.getContextProviderAPI("v1");
            if (!contextAPI) { throw new CopilotContextProviderException("getContextProviderAPI(v1) returned null."); }
            this.contextProviderDisposable = contextAPI.registerContextProvider({
                id: CopilotCompletionContextProvider.providerId,
                selector: CopilotCompletionContextProvider.defaultCppDocumentSelector,
                resolver: this
            });
            properties["cppCodeSnippetsProviderRegistered"] = "true";
        } catch (e) {
            console.debug("Failed to register the Copilot Context Provider.");
            properties["error"] = "Failed to register the Copilot Context Provider";
            if (e instanceof CopilotContextProviderException) {
                properties["error"] += `: ${e.message} `;
            }
        } finally {
            telemetry.logCopilotEvent(registerCopilotContextProvider, { ...properties });
        }
    }
}

