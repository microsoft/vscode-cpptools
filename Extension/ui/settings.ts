/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

const ElementId = {
    ActiveConfig: "activeConfig",
    CompilerPath: "compilerPath",
    IntelliSenseMode: "intelliSenseMode", 
    IncludePath: "includePath",
    Defines: "defines",
    cStandard: "cStandard",
    cppStandard: "cppStandard"
    // compilerPathInvalid: "compilerPathInvalid",
    // includePathInvalid: "includePathInvalid"
}

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

        document.getElementById(ElementId.ActiveConfig).addEventListener("change", this.onChanged.bind(this, ElementId.ActiveConfig));
        
        document.getElementById(ElementId.CompilerPath).addEventListener("change", this.onChanged.bind(this, ElementId.CompilerPath));
        document.getElementById(ElementId.IntelliSenseMode).addEventListener("change", this.onChanged.bind(this, ElementId.IntelliSenseMode));

        document.getElementById(ElementId.IncludePath).addEventListener("change", this.onChanged.bind(this, ElementId.IncludePath));
        document.getElementById(ElementId.Defines).addEventListener("change", this.onChanged.bind(this, ElementId.Defines));

        document.getElementById(ElementId.cStandard).addEventListener("change", this.onChanged.bind(this, ElementId.cStandard));
        document.getElementById(ElementId.cppStandard).addEventListener("change", this.onChanged.bind(this, ElementId.cppStandard));

        // document.getElementById(ElementId.compilerPathInvalid).style.visibility = "hidden";
        // document.getElementById(ElementId.includePathInvalid).style.visibility = "hidden";
    }

    private onChanged(id: string) {
        if (this.updating) return;

        var x = document.getElementById(id);
        this.vsCodeApi.postMessage({
            command: "change",
            key: id,
            value: x.value
        });
    }

    private onMessageReceived(e: MessageEvent) {
        const message = e.data; // The json data that the extension sent
        switch (message.command) {
            case 'update':
                this.update(message.config);
                break;
            //TODO: validate input paths
            // case 'validatecompilerPath':
            //     this.validateInput(ElementId.compilerPathInvalid, message.invalid);
            //     break;
            // case 'validateincludePath':
            //     this.validateInput(ElementId.includePathInvalid, message.invalid);
            //     break;
        }
    }

    private update(config: any) {
        this.updating = true;
        try {
            document.getElementById(ElementId.ActiveConfig).innerHTML = config.name;

            (<HTMLInputElement>document.getElementById(ElementId.CompilerPath)).value = config.compilerPath;
            (<HTMLInputElement>document.getElementById(ElementId.IntelliSenseMode)).value = config.intelliSenseMode;

            document.getElementById(ElementId.IncludePath).innerHTML = (config.includePath.length > 0) ? config.includePath.join("\n") : "";
            document.getElementById(ElementId.Defines).innerHTML = (config.defines.length > 0 ) ? config.defines.join("\n") : "";

            (<HTMLInputElement>document.getElementById(ElementId.cStandard)).value = config.cStandard;
            (<HTMLInputElement>document.getElementById(ElementId.cppStandard)).value = config.cppStandard;
        }
        finally {
            this.updating = false;
        }
    }

    // private validateInput(elementID: string, invalid: boolean) {
    //     document.getElementById(elementID).style.visibility = invalid ? "visible" : "hidden";
    // }
}

new SettingsApp();
