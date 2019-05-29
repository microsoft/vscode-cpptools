/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

const elementId: { [key: string]: string } = {
    configName: "configName",
    compilerPath: "compilerPath",
    intelliSenseMode: "intelliSenseMode", 
    includePath: "includePath",
    defines: "defines",
    cStandard: "cStandard",
    cppStandard: "cppStandard",
    compilerPathInvalid: "compilerPathInvalid",
    intelliSenseModeInvalid: "intelliSenseModeInvalid",
    includePathInvalid: "includePathInvalid",
    knownCompilers: "knownCompilers"
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

        document.getElementById(elementId.configName).addEventListener("change", this.onChanged.bind(this, elementId.configName));
        
        document.getElementById(elementId.compilerPath).addEventListener("change", this.onChanged.bind(this, elementId.compilerPath));
        document.getElementById(elementId.intelliSenseMode).addEventListener("change", this.onChanged.bind(this, elementId.intelliSenseMode));

        document.getElementById(elementId.includePath).addEventListener("change", this.onChanged.bind(this, elementId.includePath));
        document.getElementById(elementId.defines).addEventListener("change", this.onChanged.bind(this, elementId.defines));

        document.getElementById(elementId.cStandard).addEventListener("change", this.onChanged.bind(this, elementId.cStandard));
        document.getElementById(elementId.cppStandard).addEventListener("change", this.onChanged.bind(this, elementId.cppStandard));

        document.getElementById(elementId.knownCompilers).addEventListener("change", this.onKnownCompilerSelect.bind(this));
    }

    private onKnownCompilerSelect(): void {
        const x: HTMLInputElement = <HTMLInputElement>document.getElementById(elementId.knownCompilers);
        (<HTMLInputElement>document.getElementById(elementId.compilerPath)).value = x.value;
        this.onChanged(elementId.compilerPath);
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
            case 'setKnownCompilers':
                this.setKnownCompilers(message.compilers);
                break;
        }
    }

    private updateConfig(config: any): void {
        this.updating = true;
        try {
            (<HTMLInputElement>document.getElementById(elementId.configName)).value = config.name;

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
            this.showErrorWithInfo(elementId.intelliSenseModeInvalid, errors.intelliSenseMode);
            this.showErrorWithInfo(elementId.compilerPathInvalid, errors.compilerPath);
            this.showErrorWithInfo(elementId.includePathInvalid, errors.includePath);
        } finally {
            this.updating = false;
        }
    }

    private showErrorWithInfo(elementID: string, errorInfo: string): void {
         document.getElementById(elementID).style.visibility = errorInfo ? "visible" : "hidden";
         document.getElementById(elementID).innerHTML = errorInfo ? errorInfo : "";
    }

    private setKnownCompilers(compilers: string[]): void {
        let list: HTMLElement = document.getElementById(elementId.knownCompilers);

        // No need to add items unless webview is reloaded, in which case it will not have any elements.
        // Otherwise, add items again.
        if (list.firstChild) {
           return;
        }

        if (compilers.length === 0) {
            const noCompilers: string = "(No compiler paths detected)";
            let option: HTMLOptionElement = document.createElement("option");
            option.text = noCompilers;
            option.value = noCompilers;
            list.append(option);
            
            // Set the selection to this one item so that no selection change event will be fired
            (<HTMLInputElement>list).value = noCompilers;
            return;
        }

        for (let path of compilers) {
            let option: HTMLOptionElement = document.createElement("option");
            option.text = path;
            option.value = path;
            list.append(option);
        }

        // Initialize list with no selected item
        (<HTMLInputElement>list).value = "";
    }
}

let app: SettingsApp = new SettingsApp();
