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

    private getTimeStamp(uri: string) {
        return this.cachedTimeStamps.get(uri) ? this.cachedTimeStamps.get(uri) :
            { didOpenTime: 0, setupTime: 0, updateRangeTime: 0, totalTime: 0 };
    }

    public clear() {
        console.log("clearing timestamp log");
        this.cachedTimeStamps.clear();
    }

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
    }

    public setUpdateRangeTime(uri: vscode.Uri) {
        let curTimeStamps: TimeStampSequence = this.getTimeStamp(uri.path);
        if (!curTimeStamps.updateRange) {
            curTimeStamps.updateRange = new Date().getTime();
            this.cachedTimeStamps.set(uri.path, curTimeStamps);
        }
        if (curTimeStamps.didOpen && curTimeStamps.setup){
            const startTime: number = curTimeStamps.firstFile ? curTimeStamps.firstFile : curTimeStamps.didOpen;
            telemetry.logLanguageServerEvent("timeStamps",
                curTimeStamps.firstFile ? { "coldstart": "true" } : {}, {
                "activationTime": (curTimeStamps.didOpen - startTime),
                "setupTime": (curTimeStamps.setup - startTime),
                "updateRangeTime": (curTimeStamps.updateRange - curTimeStamps.setup),
                "totalTime": (curTimeStamps.updateRange - startTime)
            });
        }
    }
}
