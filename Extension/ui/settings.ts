/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
//import { ElementId } from '../src/LanguageServer/settingsPanel';
//import * as config from '../src/LanguageServer/configurations';

const ElementId = {
    ActiveConfig: "activeConfig",
    CompilerPath: "compilerPath",
    IntelliSenseMode: "intelliSenseMode", 
    IncludePath: "includePath",
    Defines: "defines",
    cStandard: "cStandard",
    cppStandard: "cppStandard"
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
    }

    private onChanged(id: string) {
        var x = document.getElementById(id);
        this.vsCodeApi.postMessage({
            command: "change",
            key: id,
            value: x.value
        });
        document.getElementById(ElementId.ActiveConfig).value = "setDefault";
    }

    private onMessageReceived(e: MessageEvent) {
        const message = e.data; // The json data that the extension sent
        switch (message.command) {
            case 'update':
                this.updateValues(message);
                break;
        }
    }

    private updateValues(values: any) {
        document.getElementById("defines").innerHTML = "setDefault";
        document.getElementById("includePath").innerHTML = "setDefault";
        document.getElementById("compilerPath").value = "setDefault";
        document.getElementById(ElementId.ActiveConfig).value = "name";
    }
}

new SettingsApp();