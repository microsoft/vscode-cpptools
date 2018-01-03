/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { Client } from './client';

let ui: UI;

interface IndexableQuickPickItem extends vscode.QuickPickItem {
    index: number;
}
interface KeyedQuickPickItem extends vscode.QuickPickItem {
    key: string;
}

export class UI {
    private navigationStatusBarItem: vscode.StatusBarItem;
    private configStatusBarItem: vscode.StatusBarItem;
    private browseEngineStatusBarItem: vscode.StatusBarItem;
    private intelliSenseStatusBarItem: vscode.StatusBarItem;

    constructor() {
        // 1000 = priority, it needs to be high enough to be on the left of the Ln/Col.
        this.navigationStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
        this.navigationStatusBarItem.tooltip = "C/C++ Navigation";
        this.navigationStatusBarItem.command = "C_Cpp.Navigate";
        this.ShowNavigation = true;

        this.configStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 2);
        this.configStatusBarItem.command = "C_Cpp.ConfigurationSelect";
        this.configStatusBarItem.tooltip = "C/C++ Configuration";
        this.ShowConfiguration = true;

        this.intelliSenseStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
        this.intelliSenseStatusBarItem.text = "";
        this.intelliSenseStatusBarItem.tooltip = "Updating IntelliSense...";
        this.intelliSenseStatusBarItem.color = "Red";
        this.ShowFlameIcon = true;

        this.browseEngineStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
        this.browseEngineStatusBarItem.text = "";
        this.browseEngineStatusBarItem.tooltip = "Discovering files...";
        this.browseEngineStatusBarItem.color = "White";
        this.browseEngineStatusBarItem.command = "C_Cpp.ShowParsingCommands";
        this.ShowDBIcon = true;
    }

    private set NavigationLocation(location: string) {
        this.navigationStatusBarItem.text = location;
    }

    private set ActiveConfig(label: string) {
        this.configStatusBarItem.text = label;
    }

    private set TagParseStatus(label: string) {
        this.browseEngineStatusBarItem.tooltip = label;
    }

    private get IsTagParsing(): boolean {
        return this.browseEngineStatusBarItem.text !== "";
    }
    private set IsTagParsing(val: boolean) {
        this.browseEngineStatusBarItem.text = val ? "$(database)" : "";
        this.ShowDBIcon = val;
    }

    private get IsUpdatingIntelliSense(): boolean {
        return this.intelliSenseStatusBarItem.text !== "";
    }
    private set IsUpdatingIntelliSense(val: boolean) {
        this.intelliSenseStatusBarItem.text = val ? "$(flame)" : "";
        this.ShowFlameIcon = val;
    }

    private set ShowNavigation(show: boolean) {
        if (show) {
            this.navigationStatusBarItem.show();
        } else {
            this.navigationStatusBarItem.hide();
        }
    }

    private set ShowDBIcon(show: boolean) {
        if (show && this.IsTagParsing) {
            this.browseEngineStatusBarItem.show();
        } else {
            this.browseEngineStatusBarItem.hide();
        }
    }

    private set ShowFlameIcon(show: boolean) {
        if (show && this.IsUpdatingIntelliSense) {
            this.intelliSenseStatusBarItem.show();
        } else {
            this.intelliSenseStatusBarItem.hide();
        }
    }

    private set ShowConfiguration(show: boolean) {
        if (show) {
            this.configStatusBarItem.show();
        } else {
            this.configStatusBarItem.hide();
        }
    }

    public activeDocumentChanged() {
        let activeEditor = vscode.window.activeTextEditor;
        let show = (activeEditor && (activeEditor.document.languageId === "cpp" || activeEditor.document.languageId === "c"));

        this.ShowConfiguration = show;
        this.ShowDBIcon = show;
        this.ShowFlameIcon = show;
        this.ShowNavigation = show;
    }

    public bind(client: Client) {
        client.TagParsingChanged(value => { this.IsTagParsing = value; });
        client.IntelliSenseParsingChanged(value => { this.IsUpdatingIntelliSense = value; });
        client.NavigationLocationChanged(value => { this.NavigationLocation = value; });
        client.TagParserStatusChanged(value => { this.TagParseStatus = value; });
        client.ActiveConfigChanged(value => { this.ActiveConfig = value; });
    }

    public showNavigationOptions(navigationList: string) {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select where to navigate to";

        let items: IndexableQuickPickItem[] = [];
        let navlist = navigationList.split(";");
        for (let i = 0; i < navlist.length - 1; i += 2) {
            items.push({ label: navlist[i], description: "", index: Number(navlist[i + 1]) });
        }

        vscode.window.showQuickPick(items, options)
            .then(selection => {
                if (!selection) {
                    return;
                }
                vscode.window.activeTextEditor.revealRange(new vscode.Range(selection.index, 0, selection.index, 0), vscode.TextEditorRevealType.InCenter);
                vscode.window.activeTextEditor.selection = new vscode.Selection(new vscode.Position(selection.index, 0), new vscode.Position(selection.index, 0));
            });
    }

    public showConfigurations(configurationNames: string[]): Thenable<number> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a Configuration...";

        let items: IndexableQuickPickItem[] = [];
        for (let i = 0; i < configurationNames.length; i++) {
            items.push({ label: configurationNames[i], description: "", index: i });
        }
        items.push({ label: "Edit Configurations...", description: "", index: configurationNames.length });

        return vscode.window.showQuickPick(items, options)
            .then(selection => {
                if (!selection) {
                    return -1;
                }
                return selection.index;
            });
    }

    public showWorkspaces(workspaceNames: { name: string, key: string }[]): Thenable<string> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a Workspace...";

        let items: KeyedQuickPickItem[] = [];
        workspaceNames.forEach(name => items.push({ label: name.name, description: "", key: name.key }));

        return vscode.window.showQuickPick(items, options)
            .then(selection => {
                if (!selection) {
                    return "";
                }
                return selection.key;
            });
    }

    public showParsingCommands() {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a parsing command...";

        let items: IndexableQuickPickItem[];
        items = [];
        if (this.browseEngineStatusBarItem.tooltip == "Parsing paused") {
            items.push({ label: "Resume Parsing", description: "", index: 1 });
        } else {
            items.push({ label: "Pause Parsing", description: "", index: 0 });
        }
        
        return vscode.window.showQuickPick(items, options)
            .then(selection => {
                if (!selection) {
                    return -1;
                }
                return selection.index;
            });
    }

    public dispose() {
        this.configStatusBarItem.dispose();
        this.browseEngineStatusBarItem.dispose();
        this.intelliSenseStatusBarItem.dispose();
        this.navigationStatusBarItem.dispose();
    }
}

export function getUI(): UI {
    if (ui === undefined) {
        ui = new UI();
    }
    return ui;
}