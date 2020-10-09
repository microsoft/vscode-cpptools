
import * as telemetry from '../telemetry';

interface TimeStampSequence {
    didOpenTime: number; // when the file appears in the editor. Defined for both "cold/warm" start cases.
    setupTime: number; // when the Intellisense_client constructor is completed
    updateRangeTime: number; // when publishDiagnostics & provideSemanticTokens is completed
    totalTime: number;
}

export class TimeTelemetryCollector {

    private cachedTimeStamps: Map<string, any> = new Map<string, any>(); // a map of uri's string to TimeStampSequence
    private extensionStartTime: number; // when the extension starts to activate.
    private firstFile: number; // when the extension is activated. Defined only for "cold" start cases.

    private getTimeStamp(uri: string) {
        return this.cachedTimeStamps.get(uri) ? this.cachedTimeStamps.get(uri) :
            { didOpenTime: 0, setupTime: 0, updateRangeTime: 0, totalTime: 0 };
    }

    public clear() {
        console.log("clearing timestamp log");
        this.cachedTimeStamps.clear();
    }

    constructor() {
        this.extensionStartTime = new Date().getTime();
        this.firstFile = 0;
    }

    public setFirstFile() {
        if (!this.firstFile){
            this.firstFile = new Date().getTime();
        }
        telemetry.logLanguageServerEvent("firstFile", {}, { "firstFile": (this.firstFile - this.extensionStartTime) });
    }

    public setDidOpenTime(uri: string) {
        let curTimeStamps: TimeStampSequence = this.getTimeStamp(uri);
        curTimeStamps.didOpenTime = new Date().getTime();
        this.cachedTimeStamps.set(uri, curTimeStamps);
    }

    public setSetupTime(uri: string) {
        let curTimeStamps: TimeStampSequence = this.getTimeStamp(uri);
        curTimeStamps.setupTime = new Date().getTime();
        this.cachedTimeStamps.set(uri, curTimeStamps);
    }

    public setUpdateRangeTime(uri: string) {
        let curTimeStamps: TimeStampSequence = this.getTimeStamp(uri);
        if (!curTimeStamps.updateRangeTime) {
            curTimeStamps.updateRangeTime = new Date().getTime();
            this.cachedTimeStamps.set(uri, curTimeStamps);
        }
        if (!curTimeStamps.totalTime && curTimeStamps.didOpenTime && curTimeStamps.setupTime){
            curTimeStamps.totalTime = curTimeStamps.updateRangeTime - curTimeStamps.didOpenTime;
            telemetry.logLanguageServerEvent("timeStamps", {}, {
                "didOpenTime": (curTimeStamps.didOpenTime),
                "setupTime": (curTimeStamps.setupTime - curTimeStamps.didOpenTime),
                "updateRangeTime": (curTimeStamps.updateRangeTime - curTimeStamps.setupTime),
                "totalTime": (curTimeStamps.totalTime)
            });
        }
    }
}
