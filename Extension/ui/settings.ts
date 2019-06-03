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
    knownCompilers: "knownCompilers",
    configSelection: "configSelection",
    addConfigDiv: "addConfigDiv",
    addConfigBtn: "addConfigBtn",
    addConfigInputDiv: "addConfigInputDiv",
    addConfigOk: "addConfigOk",
    addConfigCancel: "addConfigCancel",
    addConfigName: "addConfigName"
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

        document.getElementById(elementId.configName).addEventListener("change", this.onConfigNameChanged.bind(this));
        document.getElementById(elementId.configSelection).addEventListener("change", this.onConfigSelect.bind(this));

        document.getElementById(elementId.compilerPath).addEventListener("change", this.onChanged.bind(this, elementId.compilerPath));
        document.getElementById(elementId.intelliSenseMode).addEventListener("change", this.onChanged.bind(this, elementId.intelliSenseMode));

        document.getElementById(elementId.includePath).addEventListener("change", this.onChanged.bind(this, elementId.includePath));
        document.getElementById(elementId.defines).addEventListener("change", this.onChanged.bind(this, elementId.defines));

        document.getElementById(elementId.cStandard).addEventListener("change", this.onChanged.bind(this, elementId.cStandard));
        document.getElementById(elementId.cppStandard).addEventListener("change", this.onChanged.bind(this, elementId.cppStandard));

        document.getElementById(elementId.knownCompilers).addEventListener("change", this.onKnownCompilerSelect.bind(this));

        document.getElementById(elementId.addConfigBtn).addEventListener("click", this.onAddConfigBtn.bind(this));
        document.getElementById(elementId.addConfigOk).addEventListener("click", this.OnAddConfigConfirm.bind(this, true));
        document.getElementById(elementId.addConfigCancel).addEventListener("click", this.OnAddConfigConfirm.bind(this, false));
    }

    private onKnownCompilerSelect(): void {
        if (this.updating) {
            return; 
        }

        const x: HTMLInputElement = <HTMLInputElement>document.getElementById(elementId.knownCompilers);
        (<HTMLInputElement>document.getElementById(elementId.compilerPath)).value = x.value;
        this.onChanged(elementId.compilerPath);
    }

    private onAddConfigBtn(): void {
        // Hide "Add Configuration" button
        document.getElementById(elementId.addConfigDiv).style.visibility =  "hidden";
        // Show input field and buttons
        document.getElementById(elementId.addConfigInputDiv).style.visibility =  "visible";
    }

    private OnAddConfigConfirm(request: boolean): void {
        // Hide input field and buttons
        document.getElementById(elementId.addConfigInputDiv).style.visibility =  "hidden";
        // Show "Add Configuration" button
        document.getElementById(elementId.addConfigDiv).style.visibility =  "visible";

        // If request is yes, send message to create new config 
        if (request) {
            const x: HTMLInputElement = <HTMLInputElement>document.getElementById(elementId.addConfigName);
            if (x.value !== undefined && x.value !== "") {
                this.vsCodeApi.postMessage({
                    command: "addConfig",
                    name: x.value
                });
            }
        }
    }

    private onConfigNameChanged(): void {
        if (this.updating) {
            return; 
        }

        const configName: HTMLInputElement = <HTMLInputElement>document.getElementById(elementId.configName);
        let list: HTMLSelectElement = <HTMLSelectElement>document.getElementById(elementId.configSelection);

        if (configName.value === "") {
            (<HTMLInputElement>document.getElementById(elementId.configName)).value = list.options[list.selectedIndex].value;
            return;
        }

        // Update name on selection
        list.options[list.selectedIndex].value = configName.value;
        list.options[list.selectedIndex].text = configName.value;

        this.onChanged(elementId.configName);
    }

    private onConfigSelect(): void {
        if (this.updating) {
            return; 
        }

        const x: HTMLSelectElement = <HTMLSelectElement>document.getElementById(elementId.configSelection);
        (<HTMLInputElement>document.getElementById(elementId.configName)).value = x.value;

        this.vsCodeApi.postMessage({
            command: "configSelect",
            index: x.selectedIndex
        });
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
            case 'updateConfigSelection':
                this.updateConfigSelection(message);
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

    private updateConfigSelection(message: any): void {
        this.updating = true;
        try {
            let list: HTMLElement = document.getElementById(elementId.configSelection);

            // Clear list before updating
            (<HTMLSelectElement>list).options.length = 0;
    
            for (let name of message.selections) {
                let option: HTMLOptionElement = document.createElement("option");
                option.text = name;
                option.value = name;
                list.append(option);
            }

            (<HTMLSelectElement>list).selectedIndex = message.selectedIndex;
        } finally {
            this.updating = false;
        }
    }

    private setKnownCompilers(compilers: string[]): void {
        this.updating = true;
        try {
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
        } finally {
            this.updating = false;
        }
    }
}

let app: SettingsApp = new SettingsApp();
