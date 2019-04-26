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

// TODO: share ElementId between SettingsPanel and SettingsApp. Investigate why SettingsApp cannot import/export
const elementId: { [key: string]: string } = {
    activeConfig: "activeConfig",
    compilerPath: "compilerPath",
    intelliSenseMode: "intelliSenseMode", 
    includePath: "includePath",
    defines: "defines",
    cStandard: "cStandard",
    cppStandard: "cppStandard"
};

export class SettingsPanel {
    private configValues: config.Configuration;
    private isIntelliSenseModeDefined: boolean = false;
    private settingsPanelActivated = new vscode.EventEmitter<void>();
    private configValuesChanged = new vscode.EventEmitter<void>();
    private panel: vscode.WebviewPanel;
    private disposable: vscode.Disposable = undefined;
    private disposablesPanel: vscode.Disposable = undefined;
    private static readonly viewType: string = 'settingsPanel';
    private static readonly title: string = 'C/C++ Configurations';

    constructor() {
        this.configValues = { name: undefined };
        this.disposable = vscode.Disposable.from(
            this.settingsPanelActivated,
            this.configValuesChanged,
            vscode.window.onDidChangeWindowState(this.onWindowStateChanged, this)
        );
    }

    public createOrShow(activeConfiguration: config.Configuration): void {
        const column: vscode.ViewColumn = vscode.window.activeTextEditor
                ? vscode.window.activeTextEditor.viewColumn
                : undefined;

        // Show existing panel
        if (this.panel) {
            this.panel.reveal(column, false);
            return;
        }

        // Create new panel
        this.panel = vscode.window.createWebviewPanel(
            SettingsPanel.viewType,
            SettingsPanel.title,
            column || vscode.ViewColumn.One,
            {
                enableCommandUris: true,
                enableScripts: true,

                // Restrict the webview to only loading content from these directories
                localResourceRoots: [
                    vscode.Uri.file(util.extensionContext.extensionPath), 
                    vscode.Uri.file(path.join(util.extensionContext.extensionPath, 'ui')), 
                    vscode.Uri.file(path.join(util.extensionContext.extensionPath, 'out', 'ui'))]
            }
        );

        this.panel.iconPath = vscode.Uri.file(util.getExtensionFilePath("LanguageCCPP_color_128x.png"));

        this.disposablesPanel = vscode.Disposable.from(
            this.panel,
            this.panel.onDidDispose(this.onPanelDisposed, this),
            this.panel.onDidChangeViewState(this.onViewStateChanged, this),
            this.panel.webview.onDidReceiveMessage(this.onMessageReceived, this)
        );

        this.panel.webview.html = this.getHtml();

        this.updateWebview(activeConfiguration);
    }

    public get SettingsPanelActivated(): vscode.Event<void> { 
        return this.settingsPanelActivated.event;
    }

    public get ConfigValuesChanged(): vscode.Event<void> { 
        return this.configValuesChanged.event;
    }

    public getLastValuesFromConfigUI(): config.Configuration {
        return this.configValues;
    }

    public updateConfigUI(configuration: config.Configuration): void {
        if (this.panel) {
            this.updateWebview(configuration);
        }
    }

    //TODO: validate input paths
    // public validatePaths(invalid: boolean) {
    //     if (this.panel) {
    //         this.panel.webview.postMessage({ command: 'validateCompilerPath', invalid: invalid });
    //      }
    // }

    public dispose(): void {
        // Clean up resources
        this.panel.dispose();

        if (this.disposable) {
            this.disposable.dispose();
        }

        if (this.disposablesPanel) { 
            this.disposablesPanel.dispose(); 
        }
    }

    private onPanelDisposed(): void {
        if (this.disposablesPanel) { 
            this.disposablesPanel.dispose(); 
            this.panel = undefined;
        }
    }

    private updateWebview(configuration: config.Configuration): void {
        this.configValues = Object.assign({}, configuration); // Copy configuration values
        this.isIntelliSenseModeDefined = (this.configValues.intelliSenseMode !== undefined);
        if (this.panel) {
            // Send a message to the webview to update the values
           this.panel.webview.postMessage({ command: 'update', config: this.configValues });
        }
    }

    private onViewStateChanged(e: vscode.WebviewPanelOnDidChangeViewStateEvent): void {
        if (e.webviewPanel.active) {
            this.settingsPanelActivated.fire();
        }
    }

    private onWindowStateChanged(e: vscode.WindowState): void {
        if (e.focused) {
            this.settingsPanelActivated.fire();
        }
    }

    private onMessageReceived(message: any): void {
        if (message === null) {
            return;
        }
        switch (message.command) {
            case 'change':
                this.updateConfig(message);
        }
    }

    private updateConfig(message: any): void {
        let entries: string[];

        switch (message.key) {
            case elementId.activeConfig:
                this.configValues.name = message.value;
                break;
            case elementId.compilerPath:
                this.configValues.compilerPath = message.value;
                break;
            case elementId.includePath:
                entries = message.value.split("\n");
                this.configValues.includePath = entries.filter(e => e);
                break;
            case elementId.defines:
                entries = message.value.split("\n");
                this.configValues.defines = entries.filter(e => e);
                break;
            case elementId.intelliSenseMode:
                if (message.value !== "${default}" || this.isIntelliSenseModeDefined) {
                    this.configValues.intelliSenseMode = message.value;
                } else {
                    this.configValues.intelliSenseMode = undefined;
                }
                break;
            case elementId.cStandard:
                this.configValues.cStandard = message.value;
                break;
            case elementId.cppStandard:
                this.configValues.cppStandard = message.value;
                break;
        }

        this.configValuesChanged.fire();
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
            this.getNonce());

        return content;
    }

    private getNonce(): string {
        let nonce: string;
        const possible: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i: number = 0; i < 32; i++) {
            nonce += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return nonce;
    }
}
