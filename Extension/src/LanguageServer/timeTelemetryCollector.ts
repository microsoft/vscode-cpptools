/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as telemetry from '../telemetry';
import * as util from '../common';
import * as vscode from 'vscode';

interface TimeStampSequence {
    firstFile: number | undefined; // when the extension is activated by realActivation. Defined only for "cold" start cases.
    didOpen: number; // when the file appears in the editor. Defined for both "warm" start cases.
    setup: number; // when the Intellisense_client constructor is completed
    updateRange: number; // when publishDiagnostics & provideSemanticTokens is completed
}

export class TimeTelemetryCollector {

    private cachedTimeStamps: Map<string, any> = new Map<string, any>(); // a map of uri's string to TimeStampSequence

    public setFirstFile(uri: vscode.Uri) {
        if (util.fileIsCOrCppSource(uri.path)) {
            let curTimeStamps: TimeStampSequence = this.getTimeStamp(uri.path);
            curTimeStamps.firstFile = new Date().getTime();
            this.cachedTimeStamps.set(uri.path, curTimeStamps);
        }
    }

    public setDidOpenTime(uri: vscode.Uri) {
        let curTimeStamps: TimeStampSequence = this.getTimeStamp(uri.path);
        curTimeStamps.didOpen = new Date().getTime();
        this.cachedTimeStamps.set(uri.path, curTimeStamps);
    }

    public setSetupTime(uri: string) {
        let curTimeStamps: TimeStampSequence = this.getTimeStamp(uri);
        curTimeStamps.setup = new Date().getTime();
        this.cachedTimeStamps.set(uri, curTimeStamps);
        if (curTimeStamps.didOpen && curTimeStamps.updateRange){
            this.logTelemetry(uri, curTimeStamps);
        }
    }

    public setUpdateRangeTime(uri: vscode.Uri) {
        let curTimeStamps: TimeStampSequence = this.getTimeStamp(uri.path);
        if (!curTimeStamps.updateRange) {
            curTimeStamps.updateRange = new Date().getTime();
            this.cachedTimeStamps.set(uri.path, curTimeStamps);
        }
        if (curTimeStamps.didOpen && curTimeStamps.setup){
            this.logTelemetry(uri.path, curTimeStamps);
        }
    }

    public clear() {
        console.log("clearing timestamp log");
        this.cachedTimeStamps.clear();
    }

    private getTimeStamp(uri: string) {
        return this.cachedTimeStamps.get(uri) ? this.cachedTimeStamps.get(uri) :
            { firstFile: 0, didOpen: 0, setup: 0, updateRange: 0 };
    }

    private removeTimeStamp(uri: string) {
        this.cachedTimeStamps.delete(uri);
    }

    private logTelemetry(uri: string, timeStamps: TimeStampSequence) {
        const startTime: number = timeStamps.firstFile ? timeStamps.firstFile : timeStamps.didOpen;
        telemetry.logLanguageServerEvent("timeStamps",
            timeStamps.firstFile ? { "coldstart": "true" } : {}, {
            "activationTime": (timeStamps.didOpen - startTime),
            "setupTime": (timeStamps.setup - startTime),
            "updateRangeTime": (timeStamps.updateRange - timeStamps.setup),
            "totalTime": (timeStamps.updateRange - startTime)
        });
        this.removeTimeStamp(uri);
    }
}
