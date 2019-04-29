/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

const elementId: { [key: string]: string } = {
    activeConfig: "activeConfig",
    compilerPath: "compilerPath",
    intelliSenseMode: "intelliSenseMode", 
    includePath: "includePath",
    defines: "defines",
    cStandard: "cStandard",
    cppStandard: "cppStandard",
    compilerPathInvalid: "compilerPathInvalid",
    intelliSenseModeInvalid: "intelliSenseModeInvalid",
    includePathInvalid: "includePathInvalid"
};

interface VsCodeApi {
    postMessage(msg: {}): void;
    setState(state: {}): void;
    getState(): {};
}

declare function acquireVsCodeApi(): VsCodeApi;

class SettingsApp {
    private readonly vsCodeApi: VsCodeApi;
    private updating: boolean = false;

    constructor() {
        this.vsCodeApi = acquireVsCodeApi();

        window.addEventListener('message', this.onMessageReceived.bind(this));

        document.getElementById(elementId.activeConfig).addEventListener("change", this.onChanged.bind(this, elementId.activeConfig));
        
        document.getElementById(elementId.compilerPath).addEventListener("change", this.onChanged.bind(this, elementId.compilerPath));
        document.getElementById(elementId.intelliSenseMode).addEventListener("change", this.onChanged.bind(this, elementId.intelliSenseMode));

        document.getElementById(elementId.includePath).addEventListener("change", this.onChanged.bind(this, elementId.includePath));
        document.getElementById(elementId.defines).addEventListener("change", this.onChanged.bind(this, elementId.defines));

        document.getElementById(elementId.cStandard).addEventListener("change", this.onChanged.bind(this, elementId.cStandard));
        document.getElementById(elementId.cppStandard).addEventListener("change", this.onChanged.bind(this, elementId.cppStandard));
    }

    private onChanged(id: string): void {
        if (this.updating) {
            return; 
        }

        const x: HTMLInputElement = <HTMLInputElement>document.getElementById(id);
        this.vsCodeApi.postMessage({
            command: "change",
            key: id,
            value: x.value
        });
    }

    private onMessageReceived(e: MessageEvent): void {
        const message: any = e.data; // The json data that the extension sent
        switch (message.command) {
            case 'updateConfig':
                this.updateConfig(message.config);
                break;
            case 'updateErrors':
                 this.updateErrors(message.errors);
                 break;
        }
    }

    private updateConfig(config: any): void {
        this.updating = true;
        try {
            (<HTMLInputElement>document.getElementById(elementId.activeConfig)).value = config.name;

            (<HTMLInputElement>document.getElementById(elementId.compilerPath)).value = config.compilerPath ? config.compilerPath : "";
            (<HTMLInputElement>document.getElementById(elementId.intelliSenseMode)).value = config.intelliSenseMode ? config.intelliSenseMode : "${default}";

            (<HTMLInputElement>document.getElementById(elementId.includePath)).value = 
                (config.includePath && config.includePath.length > 0) ? config.includePath.join("\n") : "";

            (<HTMLInputElement>document.getElementById(elementId.defines)).value = 
                (config.defines && config.defines.length > 0 ) ? config.defines.join("\n") : "";

            (<HTMLInputElement>document.getElementById(elementId.cStandard)).value = config.cStandard;
            (<HTMLInputElement>document.getElementById(elementId.cppStandard)).value = config.cppStandard;
        } finally {
            this.updating = false;
        }
    }

    private updateErrors(errors: any): void {
        this.updating = true;
        try {
            this.showErrorWithInfo(elementId.intelliSenseModeInvalid, 
                    errors.intelliSenseMode ? true : false, 
                    errors.intelliSenseMode);

            this.showErrorWithInfo(elementId.compilerPathInvalid, 
                    errors.compilerPath ? true : false, 
                    errors.compilerPath);

            this.showErrorWithInfo(elementId.includePathInvalid, 
                    errors.includePath ? true : false, 
                    errors.includePath);
        }
        finally {
            this.updating = false;
        }
    }

    private showErrorWithInfo(elementID: string, show: boolean, errorInfo: string): void {
         document.getElementById(elementID).style.visibility = show ? "visible" : "hidden";
         document.getElementById(elementID).innerHTML = errorInfo ? errorInfo : "";
    }
}

let app: SettingsApp = new SettingsApp();
