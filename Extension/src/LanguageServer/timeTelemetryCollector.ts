
import * as telemetry from '../telemetry';

interface TimeStampSequence {
    activationTime: number; // when the file appears in the editor. Defined for both "cold/warm" start cases.
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
            { activationTime: 0, setupTime: 0, updateRangeTime: 0, totalTime: 0 };
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
        telemetry.logLanguageServerEvent("firstFile", { "firstFile": (this.firstFile - this.extensionStartTime).toString() });
    }

    public setActivationTime(uri: string) {
        let curTimeStamps: TimeStampSequence = this.getTimeStamp(uri);
        curTimeStamps.activationTime = new Date().getTime();
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
        if (!curTimeStamps.totalTime && curTimeStamps.activationTime && curTimeStamps.setupTime){
            curTimeStamps.totalTime = curTimeStamps.updateRangeTime - curTimeStamps.activationTime;
            telemetry.logLanguageServerEvent("timeStamps", {
                "activationTime": (curTimeStamps.activationTime).toString(),
                "setupTime": curTimeStamps.setupTime.toString(),
                "updateRangeTime": curTimeStamps.updateRangeTime.toString(),
                "totalTime": (curTimeStamps.totalTime).toString()
            });
        }
    }
}
