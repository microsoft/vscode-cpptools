/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { createHash, randomUUID } from 'crypto';
import * as telemetry from '../telemetry';
import { CopilotCompletionContextFeatureFlag, CopilotCompletionKind } from './copilotCompletionContextProvider';

export class CopilotCompletionContextTelemetry {
    private static readonly correlationIdKey = 'correlationId';
    private static readonly copilotEventName = 'copilotContextProvider';
    private readonly metrics: Record<string, number> = {};
    private readonly properties: Record<string, string> = {};
    private readonly id: string;

    constructor(correlationId?: string) {
        this.id = correlationId ?? randomUUID().toString();
    }

    private static readonly fileHashes: Map<string, string> =
        new Map<string, string>();

    private static hashFilePath(filePath: string | undefined): string | undefined {
        try {
            if (!filePath) {
                return undefined;
            }
            const cachedHash =
                CopilotCompletionContextTelemetry.fileHashes.get(filePath);
            if (cachedHash) {
                return cachedHash;
            }
            const hash = createHash('sha256').update(filePath).digest('hex');
            CopilotCompletionContextTelemetry.fileHashes.set(filePath, hash);
            return hash;
        } catch (error) {
            return undefined;
        }
    }

    private addMetric(key: string, value: number): void {
        this.metrics[key] = value;
    }

    private addProperty(key: string, value: string): void {
        this.properties[key] = value;
    }

    public addInternalCanceled(duration?: number): void {
        this.addProperty('internalCanceled', 'true');
        this.addMetric('canceledElapsedMs', duration ?? -1);
    }

    public addCopilotCanceled(duration?: number): void {
        this.addProperty('copilotCanceled', 'true');
        this.addMetric('canceledElapsedMs', duration ?? -1);
    }

    public addError(): void {
        this.addProperty('error', 'true');
    }

    public addWellKnownError(message: string): void {
        this.addProperty('wellKnownError', message);
    }

    public addCompletionContextKind(completionKind: CopilotCompletionKind): void {
        this.addProperty('completionContextKind', completionKind.toString());
    }

    public addCacheHitEntryGuid(cacheEntryGuid: string): void {
        this.addProperty('usedCacheEntryId', cacheEntryGuid);
    }

    public addResolvedElapsed(duration: number): void {
        this.addMetric('overallResolveElapsedMs', duration);
    }

    public addCacheSize(size: number): void {
        this.addMetric('cacheSize', size);
    }

    public addCacheComputedData(duration: number, id: string): void {
        this.addMetric('cacheComputedElapsedMs', duration);
        this.addProperty('createdCacheEntryId', id);
    }

    public addRequestId(id: number): void {
        this.addProperty('requestId', id.toString());
    }

    public addComputeContextElapsed(duration: number): void {
        this.addMetric('computeContextElapsedMs', duration);
    }

    public addResponseMetadata(isResultMissing: boolean, snippetCount?: number, uri?: string, caretOffset?: number,
        featureFlag?: CopilotCompletionContextFeatureFlag): void {
        this.addProperty('response.isResultMissing', isResultMissing.toString());
        // Args can be undefined, in which case the value is set to a
        // special value (e.g. -1) to indicate data is not available.
        this.addMetric('response.snippetsCount', snippetCount ?? -1);
        this.addProperty('response.fileHash',
            CopilotCompletionContextTelemetry.hashFilePath(uri) ?? '<not-available>');
        this.addMetric('response.caretOffset', caretOffset ?? -1);
        this.addProperty('response.featureFlag', featureFlag?.toString() ?? '<not-available>');
    }

    public addRequestMetadata(uri: string, caretOffset: number, completionId: string,
        languageId: string, { featureFlag, timeBudgetFactor }: { featureFlag?: CopilotCompletionContextFeatureFlag; timeBudgetFactor?: number } = {}): void {
        this.addProperty('request.fileHash',
            CopilotCompletionContextTelemetry.hashFilePath(uri) ?? '<not-available>');
        this.addProperty('request.completionId', completionId);
        this.addProperty('request.languageId', languageId);
        this.addMetric('request.caretOffset', caretOffset);
        if (featureFlag) { this.addProperty('request.featureFlag', featureFlag.toString()); }
        if (timeBudgetFactor) { this.addMetric('request.timeBudgetFactor', timeBudgetFactor); }
    }

    public send(postfix?: string): void {
        try {
            const eventName = CopilotCompletionContextTelemetry.copilotEventName + (postfix ? `/${postfix}` : '');
            this.properties[CopilotCompletionContextTelemetry.correlationIdKey] = this.id;
            telemetry.logCopilotEvent(eventName, this.properties, this.metrics);
        } catch (error) {
            console.error('Error logging copilot telemetry event', error);
        }
    }

    public fork(): CopilotCompletionContextTelemetry {
        return new CopilotCompletionContextTelemetry(this.id);
    }
}
