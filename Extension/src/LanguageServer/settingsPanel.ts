/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as util from '../common';
import * as config from './configurations';
//import { ElementId } from '../../ui/settings';

// TODO: import or export. share between SettingsPanel and SettingsApp
const ElementId = {
    ActiveConfig: "activeConfig",
    CompilerPath: "compilerPath",
    IntelliSenseMode: "intelliSenseMode", 
    IncludePath: "includePath",
    Defines: "defines",
    cStandard: "cStandard",
    cppStandard: "cppStandard"
}

export class SettingsPanel {

    public static currentPanel: SettingsPanel | undefined;
    private configValues: config.Configuration;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    
    public static CreateOrShow(): void {
        const column = vscode.window.activeTextEditor
                ? vscode.window.activeTextEditor.viewColumn
                : undefined;

        // Show existing panel
        if (SettingsPanel.currentPanel)
        {
            SettingsPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            "settings",
            'C/C++ Configurations',
            column || vscode.ViewColumn.One,
            {
                // Enable javascript in the webview
                enableScripts: true,

                // And restrict the webview to only loading content from our extension's `ui` and 'out/ui' directories.
                localResourceRoots: [
                    vscode.Uri.file(path.join(util.extensionContext.extensionPath, 'ui')), 
                    vscode.Uri.file(path.join(util.extensionContext.extensionPath, 'out', 'ui'))]
            }
        );

        // SettingsPanel.currentPanel.ShowPanel();
        SettingsPanel.currentPanel = new SettingsPanel(panel);
    }

    public dispose(): void {
        SettingsPanel.currentPanel = undefined;

        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    public updateWebview() {
        // Send a message to the webview webview to update the settings from json.
        // configuration will either send whatever values are set in json
        if (SettingsPanel.currentPanel)
        {
            SettingsPanel.currentPanel._panel.webview.postMessage({ command: 'update' });
        }
    }

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this.setContentAsync();
        this.configValues = { name: undefined };

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            e => {},
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'change':
                        this.updateConfigs(message);
                        vscode.window.showErrorMessage(message.key + ": " + message.value);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private updateConfigs(message: any) {
        let entries: string[];

        switch (message.key) {
            case ElementId.ActiveConfig:
                this.configValues.name = message.value;
                return;
            case ElementId.CompilerPath:
                this.configValues.compilerPath = message.value;
                return;
            case ElementId.IncludePath:
                entries = message.value.split("\n");
                this.configValues.includePath = entries;
                return;
            case ElementId.Defines:
                entries = message.value.split("\n");
                this.configValues.defines = entries;
                return;
            case ElementId.IntelliSenseMode:
                this.configValues.intelliSenseMode = message.value;
                return;
            case ElementId.cStandard:
                this.configValues.cStandard = message.value;
                return;
            case ElementId.cppStandard:
                this.configValues.cppStandard = message.value;
        }
    }

    private async setContentAsync(): Promise<void> {
        let content: string | undefined;
        content = await util.readFileText(util.getExtensionFilePath("ui/settings.html"));

        content = content.replace(
            /{{root}}/g, 
            vscode.Uri.file(util.extensionContext.extensionPath)
            .with({ scheme: 'vscode-resource' })
            .toString());

        content = content.replace(
            /{{nonce}}/g, 
            this.getNouce());

        this._panel.webview.html = content;
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

