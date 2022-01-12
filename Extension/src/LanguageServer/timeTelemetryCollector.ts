/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as telemetry from '../telemetry';
import * as util from '../common';
import * as vscode from 'vscode';

interface TimeStampSequence {
    firstFile?: number; // when the extension is activated. Defined only for "cold" start cases.
    didOpen: number; // when the file appears in the editor. Defined for "warm" start cases.
    setup: number; // when the Intellisense_client constructor is completed
    updateRange: number; // when publishDiagnostics & provideSemanticTokens is completed
}

export class TimeTelemetryCollector {

    private cachedTimeStamps: Map<string, any> = new Map<string, any>(); // a map of uri's string to TimeStampSequence

    public setFirstFile(uri: vscode.Uri): void {
        if (util.fileIsCOrCppSource(uri.path)) {
            const curTimeStamps: TimeStampSequence = this.getTimeStamp(uri.path);
            curTimeStamps.firstFile = new Date().getTime();
            this.cachedTimeStamps.set(uri.path, curTimeStamps);
        }
    }

    public setDidOpenTime(uri: vscode.Uri): void {
        const curTimeStamps: TimeStampSequence = this.getTimeStamp(uri.path);
        curTimeStamps.didOpen = new Date().getTime();
        this.cachedTimeStamps.set(uri.path, curTimeStamps);
    }

    public setSetupTime(uri: vscode.Uri): void {
        const curTimeStamps: TimeStampSequence = this.getTimeStamp(uri.path);
        curTimeStamps.setup = new Date().getTime();
        this.cachedTimeStamps.set(uri.path, curTimeStamps);
        if (curTimeStamps.didOpen && curTimeStamps.updateRange) {
            this.logTelemetry(uri.path, curTimeStamps);
        }
    }

    public setUpdateRangeTime(uri: vscode.Uri): void {
        const curTimeStamps: TimeStampSequence = this.getTimeStamp(uri.path);
        if (!curTimeStamps.updateRange) {
            curTimeStamps.updateRange = new Date().getTime();
            this.cachedTimeStamps.set(uri.path, curTimeStamps);
        }
        if (curTimeStamps.didOpen && curTimeStamps.setup) {
            this.logTelemetry(uri.path, curTimeStamps);
        }
    }

    public clear(): void {
        console.log("clearing timestamp log");
        this.cachedTimeStamps.clear();
    }

    private getTimeStamp(uri: string): TimeStampSequence {
        return this.cachedTimeStamps.get(uri) ? this.cachedTimeStamps.get(uri) :
            { firstFile: 0, didOpen: 0, setup: 0, updateRange: 0 };
    }

    private removeTimeStamp(uri: string): void {
        this.cachedTimeStamps.delete(uri);
    }

    private logTelemetry(uri: string, timeStamps: TimeStampSequence): void {
        const startTime: number = timeStamps.firstFile ? timeStamps.firstFile : timeStamps.didOpen;
        let properties: any = {};
        let metrics: any = {
            "setupTime": (timeStamps.setup - timeStamps.didOpen),
            "updateRangeTime": (timeStamps.updateRange - timeStamps.setup),
            "totalTime": (timeStamps.updateRange - startTime)
        };
        if (timeStamps.firstFile) {
            properties = { "coldstart": "true" };
            metrics = { "activationTime": (timeStamps.didOpen - startTime), ...metrics };
        }
        telemetry.logLanguageServerEvent("timeStamps", properties, metrics);

        this.removeTimeStamp(uri);
    }
}
