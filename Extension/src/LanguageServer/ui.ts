/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { Client } from './client';
import { getCustomConfigProviders, CustomConfigurationProviderCollection } from './customProviders';

let ui: UI;

interface IndexableQuickPickItem extends vscode.QuickPickItem {
    index: number;
}
interface KeyedQuickPickItem extends vscode.QuickPickItem {
    key: string;
}

// Higher numbers mean greater priority.
enum ConfigurationPriority {
    IncludePath = 1,
    CompileCommands = 2,
    CustomProvider = 3,
}

interface ConfigurationResult {
    configured: boolean;
    priority: ConfigurationPriority;
}

export class UI {
    private navigationStatusBarItem: vscode.StatusBarItem;
    private configStatusBarItem: vscode.StatusBarItem;
    private browseEngineStatusBarItem: vscode.StatusBarItem;
    private intelliSenseStatusBarItem: vscode.StatusBarItem;
    private configurationUIPromise: Thenable<ConfigurationResult>;

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
        this.browseEngineStatusBarItem.color = new vscode.ThemeColor("statusBar.foreground");
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

    public activeDocumentChanged(): void {
        let activeEditor: vscode.TextEditor = vscode.window.activeTextEditor;
        let isCpp: boolean = (activeEditor && (activeEditor.document.languageId === "cpp" || activeEditor.document.languageId === "c"));

        // It's sometimes desirable to see the config and icons when making settings changes.
        let isSettingsJson: boolean = (activeEditor && (activeEditor.document.fileName.endsWith("c_cpp_properties.json") || activeEditor.document.fileName.endsWith("settings.json")));

        this.ShowConfiguration = isCpp || isSettingsJson;
        this.ShowDBIcon = isCpp || isSettingsJson;
        this.ShowFlameIcon = isCpp || isSettingsJson;
        this.ShowNavigation = isCpp;
    }

    public bind(client: Client): void {
        client.TagParsingChanged(value => { this.IsTagParsing = value; });
        client.IntelliSenseParsingChanged(value => { this.IsUpdatingIntelliSense = value; });
        client.NavigationLocationChanged(value => { this.NavigationLocation = value; });
        client.TagParserStatusChanged(value => { this.TagParseStatus = value; });
        client.ActiveConfigChanged(value => { this.ActiveConfig = value; });
    }

    public showNavigationOptions(navigationList: string): void {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select where to navigate to";

        let items: IndexableQuickPickItem[] = [];
        let navlist: string[] = navigationList.split(";");
        for (let i: number = 0; i < navlist.length - 1; i += 2) {
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
        for (let i: number = 0; i < configurationNames.length; i++) {
            items.push({ label: configurationNames[i], description: "", index: i });
        }
        items.push({ label: "Edit Configurations...", description: "", index: configurationNames.length });

        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.index : -1);
    }

    public showConfigurationProviders(currentProvider: string|null): Thenable<string|undefined> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a Configuration Provider...";
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();

        let items: KeyedQuickPickItem[] = [];
        providers.forEach(provider => {
            let label: string = provider.name;
            if (provider.extensionId === currentProvider) {
                label += " (active)";
            }
            items.push({ label: label, description: "", key: provider.extensionId });
        });
        items.push({ label: "(none)", description: "Disable the active configuration provider, if applicable.", key: "" });

        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.key : undefined);
    }

    public showCompileCommands(paths: string[]): Thenable<number> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a compile_commands.json...";

        let items: IndexableQuickPickItem[] = [];
        for (let i: number = 0; i < paths.length; i++) {
            items.push({label: paths[i], description: "", index: i});
        }

        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.index : -1);
    }

    public showWorkspaces(workspaceNames: { name: string; key: string }[]): Thenable<string> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a Workspace...";

        let items: KeyedQuickPickItem[] = [];
        workspaceNames.forEach(name => items.push({ label: name.name, description: "", key: name.key }));

        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.key : "");
    }

    public showParsingCommands(): Thenable<number> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = "Select a parsing command...";

        let items: IndexableQuickPickItem[];
        items = [];
        if (this.browseEngineStatusBarItem.tooltip === "Parsing paused") {
            items.push({ label: "Resume Parsing", description: "", index: 1 });
        } else {
            items.push({ label: "Pause Parsing", description: "", index: 0 });
        }
        
        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.index : -1);
    }

    public showConfigureIncludePathMessage(prompt: () => Thenable<boolean>, onSkip: () => void): void {
        setTimeout(() => {
            this.showConfigurationPrompt(ConfigurationPriority.IncludePath, prompt, onSkip);
        }, 10000);
    }

    public showConfigureCompileCommandsMessage(prompt: () => Thenable<boolean>, onSkip: () => void): void {
        setTimeout(() => {
            this.showConfigurationPrompt(ConfigurationPriority.CompileCommands, prompt, onSkip);
        }, 5000);
    }

    public showConfigureCustomProviderMessage(prompt: () => Thenable<boolean>, onSkip: () => void): void {
        this.showConfigurationPrompt(ConfigurationPriority.CustomProvider, prompt, onSkip);
    }

    private showConfigurationPrompt(priority: ConfigurationPriority, prompt: () => Thenable<boolean>, onSkip: () => void): void {
        let showPrompt: () => Thenable<ConfigurationResult> = async () => {
            let configured: boolean = await prompt();
            return Promise.resolve({
                priority: priority,
                configured: configured
            });
        };

        if (this.configurationUIPromise) {
            this.configurationUIPromise = this.configurationUIPromise.then(result => {
                if (priority > result.priority) {
                    return showPrompt();
                } else if (!result.configured) {
                    return showPrompt();
                }
                onSkip();
                return Promise.resolve({
                    priority: result.priority,
                    configured: true
                });
            });
        } else {
            this.configurationUIPromise = showPrompt();
        }
    }

    public dispose(): void {
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