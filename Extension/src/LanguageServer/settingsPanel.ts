/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as util from '../common';
import * as config from './configurations';

// TODO: share ElementId between SettingsPanel and SettingsApp. Investigate why SettingsApp used for HTML cannot import/export
const ElementId = {
    ActiveConfig: "activeConfig",
    CompilerPath: "compilerPath",
    IntelliSenseMode: "intelliSenseMode", 
    IncludePath: "includePath",
    Defines: "defines",
    cStandard: "cStandard",
    cppStandard: "cppStandard"
}

export interface ViewStateEvent {
    isActive: boolean;
}

export class SettingsPanel {

    private configValues: config.Configuration;
    private configDirty: boolean = false;
    private settingsPanelViewStateChanged = new vscode.EventEmitter<ViewStateEvent>(); 
    private panel: vscode.WebviewPanel;
    private disposable: vscode.Disposable = undefined;
    private disposablesPanel: vscode.Disposable = undefined;

    constructor() {
        this.configValues = { name: undefined };
        this.disposable = vscode.Disposable.from(this.settingsPanelViewStateChanged);
    }

    public CreateOrShow(activeConfiguration: config.Configuration): void {
        const column = vscode.window.activeTextEditor
                ? vscode.window.activeTextEditor.viewColumn
                : undefined;

        // Show existing panel
        if (this.panel) {
            this.panel.reveal(column, false);
            return;
        }

        // Create new panel
        this.panel = vscode.window.createWebviewPanel(
            "settings",
            'C/C++ Configurations',
            column || vscode.ViewColumn.One,
            {
                enableCommandUris: true,
                enableScripts: true,

                // And restrict the webview to only loading content from our extension's `ui` and 'out/ui' directories.
                localResourceRoots: [
                    vscode.Uri.file(path.join(util.extensionContext.extensionPath, 'ui')), 
                    vscode.Uri.file(path.join(util.extensionContext.extensionPath, 'out', 'ui'))]
            }
        );

        this.panel.iconPath = vscode.Uri.file(util.getExtensionFilePath("ui/LanguageCCPP_color_128x.png"));

        this.disposablesPanel = vscode.Disposable.from(
            this.panel,
            this.panel.onDidDispose(this.onPanelDisposed, this),
            this.panel.onDidChangeViewState(this.onViewStateChanged, this),
            this.panel.webview.onDidReceiveMessage(this.onMessageReceived, this)
        );

        this.panel.webview.html = this.getHtml();

        this.updateWebview(activeConfiguration);
    }

    public get SettingsPanelViewStateChanged(): vscode.Event<ViewStateEvent> { 
        return this.settingsPanelViewStateChanged.event;
    }

    public GetLastValuesFromConfigUI(): config.Configuration {
        return this.configValues;
    }

    public UpdateConfigUI(configuration: config.Configuration) {
        if (this.panel) {
            this.updateWebview(configuration);
        }
    }

    //TODO: validate input paths
    // public validatePaths(invalid: boolean) {
    //     if (this.panel) {
    //         this.panel.webview.postMessage({ command: 'validatecompilerPath', invalid: invalid });
    //      }
    // }

    public dispose(): void {
        // Clean up resources
        this.panel.dispose();

        this.disposable && this.disposable.dispose();
        this.disposablesPanel && this.disposablesPanel.dispose();
    }

    private onPanelDisposed() {
        // Notify listener config panel is not active
        if (this.configDirty) {
            let viewState: ViewStateEvent = { isActive: false };
            this.settingsPanelViewStateChanged.fire(viewState);
            this.configDirty = false;
        }

        this.disposablesPanel && this.disposablesPanel.dispose();
        this.panel = undefined;
    }

    private updateWebview(configuration: config.Configuration) {
        this.configValues = configuration;
        // Send a message to the webview webview to update the settings from json.
        if (this.panel) {
           this.panel.webview.postMessage({ command: 'update', config: configuration });
        }
    }

    private onViewStateChanged(e: vscode.WebviewPanelOnDidChangeViewStateEvent)
    {
        let viewState: ViewStateEvent = { isActive: e.webviewPanel.active };
        if (this.configDirty || e.webviewPanel.active) {
            this.settingsPanelViewStateChanged.fire(viewState);
            this.configDirty = false;
        }
    }

    private onMessageReceived(message: any) {
        if (message == null) return;

        switch (message.command) {
            case 'change':
                this.updateConfig(message);
        }
    }

    private updateConfig(message: any) {
        let entries: string[];
        this.configDirty = true;

        switch (message.key) {
            case ElementId.ActiveConfig:
                this.configValues.name = message.value;
                break;
            case ElementId.CompilerPath:
                this.configValues.compilerPath = message.value;
                break;
            case ElementId.IncludePath:
                entries = message.value.split("\n");
                this.configValues.includePath = entries;
                break;
            case ElementId.Defines:
                entries = message.value.split("\n");
                this.configValues.defines = entries;
                break;
            case ElementId.IntelliSenseMode:
                this.configValues.intelliSenseMode = message.value;
                break;
            case ElementId.cStandard:
                this.configValues.cStandard = message.value;
                break;
            case ElementId.cppStandard:
                this.configValues.cppStandard = message.value;
                break;
        }
    }

    private getHtml(): string {
        let content: string | undefined;
        content = fs.readFileSync(util.getExtensionFilePath("ui/settings.html")).toString();

        content = content.replace(
            /{{root}}/g, 
            vscode.Uri.file(util.extensionContext.extensionPath)
            .with({ scheme: 'vscode-resource' })
            .toString());

        content = content.replace(
            /{{nonce}}/g, 
            this.getNouce());

        return content;
    }

    private getNouce(): string {
        let nouce: string;
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            nouce += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return nouce;
    }
}

