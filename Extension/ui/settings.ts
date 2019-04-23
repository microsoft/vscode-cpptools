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
    cppStandard: "cppStandard"
    //TODO: validate input paths
    // compilerPathInvalid: "compilerPathInvalid",
    // includePathInvalid: "includePathInvalid"
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

        //TODO: validate input paths
        // document.getElementById(ElementId.compilerPathInvalid).style.visibility = "hidden";
        // document.getElementById(ElementId.includePathInvalid).style.visibility = "hidden";
    }

    private onChanged(id: string): void {
        if (this.updating) {
            return; 
        }

        var x = <HTMLInputElement>document.getElementById(id);
        this.vsCodeApi.postMessage({
            command: "change",
            key: id,
            value: x.value
        });
    }

    private onMessageReceived(e: MessageEvent): void {
        const message = e.data; // The json data that the extension sent
        switch (message.command) {
            case 'update':
                this.update(message.config);
                break;
            //TODO: validate input paths
            // case 'validateCompilerPath':
            //     this.validateInput(ElementId.compilerPathInvalid, message.invalid);
            //     break;
            // case 'validateIncludePath':
            //     this.validateInput(ElementId.includePathInvalid, message.invalid);
            //     break;
        }
    }

    private update(config: any): void {
        this.updating = true;
        try {
            (<HTMLInputElement>document.getElementById(elementId.activeConfig)).value = config.name;

            (<HTMLInputElement>document.getElementById(elementId.compilerPath)).value = config.compilerPath ? config.compilerPath : "";
            (<HTMLInputElement>document.getElementById(elementId.intelliSenseMode)).value = config.intelliSenseMode;

            (<HTMLInputElement>document.getElementById(elementId.includePath)).value = 
                (config.includePath && config.includePath.length > 0) ? config.includePath.join("\n") : "";

            (<HTMLInputElement>document.getElementById(elementId.defines)).value = 
                (config.defines && config.defines.length > 0 ) ? config.defines.join("\n") : "";

            (<HTMLInputElement>document.getElementById(elementId.cStandard)).value = config.cStandard;
            (<HTMLInputElement>document.getElementById(elementId.cppStandard)).value = config.cppStandard;
        }
        finally {
            this.updating = false;
        }
    }

    //TODO: validate input paths
    // private validateInput(elementID: string, invalid: boolean): void {
    //     document.getElementById(elementID).style.visibility = invalid ? "visible" : "hidden";
    // }
}

let app: SettingsApp = new SettingsApp();
