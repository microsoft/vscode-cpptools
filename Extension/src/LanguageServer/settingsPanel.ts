/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as util from '../common';

export class SettingsPanel {

    public static currentPanel: SettingsPanel | undefined;

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

                // And restrict the webview to only loading content from our extension's `UI` directory.
                localResourceRoots: [vscode.Uri.file(path.join(util.extensionContext.extensionPath, 'ui'))]
            }
        );
        SettingsPanel.currentPanel = new SettingsPanel(panel);
    }

    public dispose(): void {
        SettingsPanel.currentPanel._panel.webview.postMessage({ command: 'values' });

        SettingsPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    public static setDefault(): void {
        // Send a message to the webview webview.
        if (SettingsPanel.currentPanel)
        {
            SettingsPanel.currentPanel._panel.webview.postMessage({ command: 'setDefault' });
        }
    }

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;

        this.setContentAsync();

        //this.setDefault();

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
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                    case 'values':
                    vscode.window.showErrorMessage(message.includePath + " " + message.cStandard);
                    return;
                }
            },
            null,
            this._disposables
        );
    }

    private async setContentAsync(): Promise<void> {
        let content: string | undefined;
        content = await util.readFileText(util.getExtensionFilePath("UI/settings.html"));

        let c = content.replace(
            /{{root}}/g, 
            vscode.Uri.file(util.extensionContext.extensionPath)
            .with({ scheme: 'vscode-resource' })
            .toString());

            // let text = '';
            // const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            // for (let i = 0; i < 32; i++) {
            //     text += possible.charAt(Math.floor(Math.random() * possible.length));
            // }

        // this._panel.webview.html = c.replace(
        //     /{{nonce}}/g, 
        //     text);

        this._panel.webview.html = c;
    }
}

