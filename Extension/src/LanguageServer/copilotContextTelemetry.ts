/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { randomUUID } from 'crypto';
import * as telemetry from '../telemetry';

export class CopilotContextTelemetry {
    private static readonly correlationIdKey = 'correlationId';
    private static readonly copilotEventName = 'copilotContextProvider';
    private readonly metrics: Record<string, number> = {};
    private readonly properties: Record<string, string> = {};
    private readonly id: string;
    constructor(correlationId?: string) {
        this.id = correlationId ?? randomUUID().toString();
    }

    private addMetric(key: string, value: number): void {
        this.metrics[key] = value;
    }

    private addProperty(key: string, value: string): void {
        this.properties[key] = value;
    }

    public addCancelled(): void {
        this.addProperty('cancelled', 'true');
    }

    public addCancellationElapsed(duration: number): void {
        this.addMetric('cancellationElapsedMs', duration);
    }

    public addCancelledLate(): void {
        this.addProperty('cancelledLate', 'true');
    }

    public addError(): void {
        this.addProperty('error', 'true');
    }

    public addKind(snippetsKind: string): void {
        this.addProperty('kind', snippetsKind.toString());
    }

    public addResolvedElapsed(duration: number): void {
        this.addMetric('overallResolveElapsedMs', duration);
    }

    public addCacheSize(size: number): void {
        this.addMetric('cacheSize', size);
    }

    public addCacheComputedElapsed(duration: number): void {
        this.addMetric('cacheComputedElapsedMs', duration);
    }

    // count can be undefined, in which case the count is set to -1 to indicate
    // snippets are not available (different than having 0 snippets).
    public addSnippetCount(count?: number) {
        this.addMetric('snippetsCount', count ?? -1);
    }

    public file(): void {
        this.properties[CopilotContextTelemetry.correlationIdKey] = this.id;
        telemetry.logCopilotEvent(CopilotContextTelemetry.copilotEventName, this.properties, this.metrics);
    }

    public fork(): CopilotContextTelemetry {
        return new CopilotContextTelemetry(this.id);
    }
}
