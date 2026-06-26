/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as util from '../common';
import * as telemetry from '../telemetry';
import { Client } from './client';
import { CustomConfigurationProviderCollection, getCustomConfigProviders, isSameProviderExtensionId } from './customProviders';
import { ReferencesCommandMode, referencesCommandModeToString } from './references';
import { CppSettings } from './settings';

let ui: LanguageStatusUI;

interface IndexableQuickPickItem extends vscode.QuickPickItem {
    index: number;
}
interface KeyedQuickPickItem extends vscode.QuickPickItem {
    key: string;
}

enum LanguageStatusPriority {
    First = 0,
    High = 1,
    Mid = 2,
    Low = 3
}

export enum ConfigurationType {
    AutoConfigProvider = "autoConfigProvider",
    ConfigProvider = "configProvider",
    CompileCommands = "compileCommands",
    AutoCompilerPath = "autoCompilerPath",
    CompilerPath = "compilerPath",
    NotConfigured = "notConfigured"
}

const commandArguments: string[] = []; // We report the sender of the command

export class LanguageStatusUI {
    private currentClient: Client | undefined;

    // IntelliSense language status
    private intelliSenseStatusItem: vscode.LanguageStatusItem;
    private readonly updatingIntelliSenseText: string = vscode.l10n.t("IntelliSense: Updating");
    private readonly idleIntelliSenseText: string = vscode.l10n.t("IntelliSense: Ready");
    // Tag parse language status
    private tagParseStatusItem: vscode.LanguageStatusItem;
    private isParsingWorkspace: boolean = false;
    private isParsingWorkspacePaused: boolean = false;
    private isParsingFiles: boolean = false;
    private readonly dataBaseIcon: string = "$(database)";
    private readonly workspaceParsingInitializing: string = vscode.l10n.t("Initializing Workspace");
    private readonly workspaceParsingIndexing: string = vscode.l10n.t("Indexing Workspace");
    private readonly workspaceParsingRunningText: string = vscode.l10n.t("Parsing Workspace");
    private readonly workspaceParsingPausedText: string = vscode.l10n.t("Parsing Workspace: Paused");
    private readonly workspaceParsingDoneText: string = vscode.l10n.t("Parsing Complete");
    private readonly workspaceRescanText: string = vscode.l10n.t("Rescan Workspace");
    private readonly parsingFilesTooltip: string = vscode.l10n.t("Parsing Open Files");

    // Code analysis language status
    private codeAnalysisStatusItem: vscode.LanguageStatusItem;
    private isRunningCodeAnalysis: boolean = false;
    private isCodeAnalysisPaused: boolean = false;
    private codeAnalysisProcessed: number = 0;
    private codeAnalysisTotal: number = 0;
    private codeAnalysProgress: string = "";
    private readonly codeAnalysisRunningText: string = vscode.l10n.t("Code Analysis: Running");
    private readonly codeAnalysisPausedText: string = vscode.l10n.t("Code Analysis: Paused");
    private readonly codeAnalysisModePrefix: string = vscode.l10n.t("Code Analysis Mode: ");

    // References status bar
    private referencesStatusBarItem: vscode.StatusBarItem;
    private readonly referencesPreviewTooltip: string = ` (${vscode.l10n.t("click to preview results")})`;

    // Configuration status bar
    private configurationStatusBarItem: vscode.StatusBarItem;

    // Configure IntelliSense status bar
    private configureIntelliSenseStatusBarItem: vscode.StatusBarItem;
    private showConfigureIntelliSenseButton: boolean = false;
    private configureIntelliSenseTimeout?: NodeJS.Timeout;
    private readonly configureIntelliSenseText: string = vscode.l10n.t("Configure IntelliSense");

    constructor() {
        this.intelliSenseStatusItem = this.createIntelliSenseStatusItem();
        this.tagParseStatusItem = this.createTagParseStatusItem();

        // The tag parser is always busy when initializing.
        // The detail text says "Initializing..." until the tag parser is ready.
        this.tagParseStatusItem.busy = true;
        this.codeAnalysisStatusItem = this.createCodeAnalysisStatusItem();

        this.referencesStatusBarItem = this.createReferencesStatusBarItem();
        this.ShowReferencesIcon = false;

        this.configurationStatusBarItem = this.createConfigurationStatusBarItem();
        this.ShowConfiguration = true;

        this.configureIntelliSenseStatusBarItem = this.createConfigureIntelliSenseStatusBarItem();
        void this.ShowConfigureIntelliSenseButton(false, this.currentClient);
    }

    //#region IntelliSense language status
    private createIntelliSenseStatusItem(): vscode.LanguageStatusItem {
        const item: vscode.LanguageStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.High}.intellisense`, util.documentSelector);
        item.name = vscode.l10n.t("C/C++ IntelliSense Status");
        item.text = this.idleIntelliSenseText;
        return item;
    }

    private setIsUpdatingIntelliSense(val: boolean): void {
        this.intelliSenseStatusItem.busy = val;

        if (val) {
            this.intelliSenseStatusItem.text = "$(flame)";
            this.intelliSenseStatusItem.detail = this.updatingIntelliSenseText;
        } else {
            this.intelliSenseStatusItem.text = this.idleIntelliSenseText;
            this.intelliSenseStatusItem.detail = "";
        }
        this.intelliSenseStatusItem.command = {
            command: "C_Cpp.RestartIntelliSenseForFile",
            title: vscode.l10n.t("Rescan"),
            tooltip: vscode.l10n.t("Rescan IntelliSense"),
            arguments: commandArguments
        };
    }
    //#endregion End - IntelliSense language status

    //#region Tag parse language status
    private createTagParseStatusItem(): vscode.LanguageStatusItem {
        const item: vscode.LanguageStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.Mid}.tagparser`, util.documentSelector);
        item.name = vscode.l10n.t("C/C++ Tag Parser Status");
        item.detail = vscode.l10n.t("Initializing...");
        item.text = this.dataBaseIcon;
        item.command = {
            command: "C_Cpp.RescanWorkspace",
            title: this.workspaceRescanText,
            arguments: commandArguments
        };
        return item;
    }

    private set TagParseStatus(label: string) {
        if ((this.isParsingWorkspace || this.isParsingFiles) && this.tagParseStatusItem.command) {
            // Create a new command object to force update on tooltip
            const updatedCommand: vscode.Command = this.tagParseStatusItem.command;
            updatedCommand.tooltip = (this.isParsingFiles ? `${this.parsingFilesTooltip} | ` : "") + label;
            this.tagParseStatusItem.command = updatedCommand;
        }
    }

    private setIsInitializingWorkspace(val: boolean): void {
        if (val) {
            this.tagParseStatusItem.text = this.dataBaseIcon;
            this.tagParseStatusItem.detail = this.workspaceParsingInitializing;
        }
    }

    private setIsIndexingWorkspace(val: boolean): void {
        if (val) {
            this.tagParseStatusItem.text = this.dataBaseIcon;
            this.tagParseStatusItem.detail = this.workspaceParsingIndexing;
            this.tagParseStatusItem.busy = true;
        }
    }

    private setIsParsingWorkspace(val: boolean): void {
        this.isParsingWorkspace = val;
        if (!val && this.isParsingWorkspacePaused) {
            // Unpause before handling the no longer parsing state.
            this.isParsingWorkspacePaused = false;
        }
        this.setTagParseStatus();
    }

    private setIsParsingFiles(val: boolean): void {
        this.isParsingFiles = val;
        this.setTagParseStatus();
    }

    private setIsParsingWorkspacePaused(val: boolean): void {
        this.isParsingWorkspacePaused = val;
        if (this.isParsingWorkspace || this.isParsingFiles) {
            this.setTagParseStatus();
        }
    }

    private getTagParsingDetail(): string {
        if (!this.isParsingWorkspace && !this.isParsingFiles) {
            return "";
        }
        if (this.isParsingWorkspacePaused) {
            const displayTwoStatus: boolean = this.isParsingFiles && this.isParsingWorkspace;
            return (this.isParsingFiles ? this.parsingFilesTooltip : "")
                + (displayTwoStatus ? " | " : "")
                + (this.isParsingWorkspace ? this.workspaceParsingPausedText : "");
        } else {
            return this.isParsingWorkspace ? this.workspaceParsingRunningText : this.parsingFilesTooltip;
        }
    }

    private setTagParseStatus(): void {
        // Set busy icon outside of timer for more real-time response
        this.tagParseStatusItem.busy = (this.isParsingWorkspace && !this.isParsingWorkspacePaused) || this.isParsingFiles;

        if (this.isParsingWorkspace || this.isParsingFiles) {
            this.tagParseStatusItem.text = this.dataBaseIcon;
            this.tagParseStatusItem.detail = this.getTagParsingDetail();
            if (this.isParsingWorkspace) {
                // Pausing/resuming is only applicable to parsing workspace.
                this.tagParseStatusItem.command = this.isParsingWorkspacePaused ? {
                    command: "C_Cpp.ResumeParsing",
                    title: vscode.l10n.t("Resume"),
                    arguments: commandArguments,
                    tooltip: this.tagParseStatusItem.command?.tooltip ?? undefined
                } : {
                    command: "C_Cpp.PauseParsing",
                    title: vscode.l10n.t("Pause"),
                    arguments: commandArguments,
                    tooltip: this.tagParseStatusItem.command?.tooltip ?? undefined
                };
            } else {
                this.tagParseStatusItem.command = {
                    command: "C_Cpp.RescanWorkspace",
                    title: this.workspaceRescanText,
                    arguments: commandArguments,
                    tooltip: this.tagParseStatusItem.command?.tooltip ?? undefined
                };
            }
        } else {
            // Parsing completed.
            this.tagParseStatusItem.text = this.workspaceParsingDoneText;
            this.tagParseStatusItem.detail = "";
            this.tagParseStatusItem.command = {
                command: "C_Cpp.RescanWorkspace",
                title: this.workspaceRescanText,
                arguments: commandArguments
            };
        }
    }
    //#endregion Tag parse language status

    //#region Code analysis language status
    private createCodeAnalysisStatusItem(): vscode.LanguageStatusItem {
        const item: vscode.LanguageStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.Low}.codeanalysis`, util.documentSelector);
        item.name = vscode.l10n.t("C/C++ Code Analysis Status");
        item.text = this.codeAnalysisModePrefix + this.codeAnalysisCurrentMode();
        item.command = {
            command: "C_Cpp.ShowIdleCodeAnalysisCommands",
            title: vscode.l10n.t("Run Now"),
            arguments: commandArguments
        };
        return item;
    }

    public refreshCodeAnalysisText(isRunningCodeAnalysis: boolean) {
        const activeText: string = this.isCodeAnalysisPaused ? this.codeAnalysisPausedText : this.codeAnalysisRunningText;
        const idleText: string = this.codeAnalysisModePrefix + this.codeAnalysisCurrentMode();
        this.codeAnalysisStatusItem.text = isRunningCodeAnalysis ? activeText : idleText;
    }

    private setIsCodeAnalysisPaused(val: boolean): void {
        if (!this.isRunningCodeAnalysis) {
            return;
        }

        this.isCodeAnalysisPaused = val;
        this.codeAnalysisStatusItem.busy = !val;
        this.codeAnalysisStatusItem.text = val ? this.codeAnalysisPausedText : this.codeAnalysisRunningText;
    }

    private codeAnalysisCurrentMode(): string {
        const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);
        const state: string = (settings.codeAnalysisRunAutomatically && settings.clangTidyEnabled)
            ? vscode.l10n.t("Automatic")
            : vscode.l10n.t("Manual");
        return state;
    }

    private setIsRunningCodeAnalysis(val: boolean): void {
        if (this.isRunningCodeAnalysis && !val) {
            this.codeAnalysisTotal = 0;
            this.codeAnalysisProcessed = 0;
            this.isCodeAnalysisPaused = false;
        }
        this.isRunningCodeAnalysis = val;
        this.codeAnalysisStatusItem.busy = val;
        this.refreshCodeAnalysisText(val);
        this.codeAnalysisStatusItem.command = val ? {
            command: "C_Cpp.ShowActiveCodeAnalysisCommands",
            title: vscode.l10n.t("Options"),
            // Make sure not to overwrite current progress
            tooltip: this.codeAnalysisStatusItem.command?.tooltip ?? vscode.l10n.t("Starting..."),
            arguments: commandArguments
        } : {
            command: "C_Cpp.ShowIdleCodeAnalysisCommands",
            title: vscode.l10n.t("Run Now"),
            arguments: commandArguments
        };
    }

    private updateCodeAnalysisTooltip(): void {
        this.codeAnalysProgress = vscode.l10n.t("Running: {0} / {1} ({2}%)", this.codeAnalysisProcessed, Math.max(this.codeAnalysisTotal, 1), Math.floor(100 * this.codeAnalysisProcessed / Math.max(this.codeAnalysisTotal, 1)));

        if (this.codeAnalysisStatusItem.command) {
            this.codeAnalysisStatusItem.command.tooltip = this.codeAnalysProgress;

        }
        this.setIsRunningCodeAnalysis(true);
    }

    private setCodeAnalysisProcessed(processed: number): void {
        if (!this.isRunningCodeAnalysis) {
            return; // Occurs when a multi-root workspace is activated.
        }
        this.codeAnalysisProcessed = processed;
        if (this.codeAnalysisProcessed > this.codeAnalysisTotal) {
            this.codeAnalysisTotal = this.codeAnalysisProcessed + 1;
        }
        this.updateCodeAnalysisTooltip();
    }

    private setCodeAnalysisTotal(total: number): void {
        if (!this.isRunningCodeAnalysis) {
            return; // Occurs when a multi-root workspace is activated.
        }
        this.codeAnalysisTotal = total;
        this.updateCodeAnalysisTooltip();
    }

    public async showActiveCodeAnalysisCommands(): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = vscode.l10n.t("Select a code analysis command...");

        const items: IndexableQuickPickItem[] = [];
        items.push({ label: vscode.l10n.t("Cancel"), description: "", index: 0 });

        if (this.isCodeAnalysisPaused) {
            items.push({ label: vscode.l10n.t("Resume"), description: "", index: 2 });
        } else {
            items.push({ label: vscode.l10n.t("Pause"), description: "", index: 1 });
        }
        items.push({ label: vscode.l10n.t("Start Another..."), description: "", index: 3 });
        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return selection ? selection.index : -1;
    }

    public async showIdleCodeAnalysisCommands(): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = vscode.l10n.t("Select a command...");

        const items: IndexableQuickPickItem[] = [];
        items.push({ label: vscode.l10n.t("Run Code Analysis on Active File"), description: "", index: 0 });
        items.push({ label: vscode.l10n.t("Run Code Analysis on All Files"), description: "", index: 1 });
        items.push({ label: vscode.l10n.t("Run Code Analysis on Open Files"), description: "", index: 2 });
        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return selection ? selection.index : -1;
    }
    //#endregion Code analysis language status

    //#region References status
    private createReferencesStatusBarItem(): vscode.StatusBarItem {
        const item: vscode.StatusBarItem = vscode.window.createStatusBarItem(`c.cpp.references.statusbar`, vscode.StatusBarAlignment.Right, 901);
        item.name = vscode.l10n.t("C/C++ References Status");
        item.tooltip = "";
        item.command = {
            command: "C_Cpp.ShowReferencesProgress",
            title: item.name,
            arguments: commandArguments
        };
        return item;
    }

    private get ReferencesCommand(): ReferencesCommandMode {
        return this.referencesStatusBarItem.tooltip === "" ? ReferencesCommandMode.None :
            this.referencesStatusBarItem.tooltip === referencesCommandModeToString(ReferencesCommandMode.Find) ? ReferencesCommandMode.Find :
                this.referencesStatusBarItem.tooltip === referencesCommandModeToString(ReferencesCommandMode.Rename) ? ReferencesCommandMode.Rename :
                    ReferencesCommandMode.Peek;
    }

    private set ReferencesCommand(val: ReferencesCommandMode) {
        if (val === ReferencesCommandMode.None) {
            this.referencesStatusBarItem.text = "";
            this.ShowReferencesIcon = false;
        } else {
            this.referencesStatusBarItem.text = "$(search)";
            this.referencesStatusBarItem.tooltip = referencesCommandModeToString(val) + (val !== ReferencesCommandMode.Find ? "" : this.referencesPreviewTooltip);
            this.ShowReferencesIcon = true;
        }
    }

    private set ShowReferencesIcon(show: boolean) {
        if (show && this.ReferencesCommand !== ReferencesCommandMode.None) {
            this.referencesStatusBarItem.show();
        } else {
            this.referencesStatusBarItem.hide();
        }
    }
    //#endregion End - References status

    //#region Configuration status bar
    private createConfigurationStatusBarItem(): vscode.StatusBarItem {
        const configTooltip: string = vscode.l10n.t("C/C++ Configuration");
        const item: vscode.StatusBarItem = vscode.window.createStatusBarItem("c.cpp.configuration.tooltip", vscode.StatusBarAlignment.Right, 0);
        item.name = configTooltip;
        item.tooltip = configTooltip;
        item.command = {
            command: "C_Cpp.ConfigurationSelect",
            title: configTooltip,
            arguments: commandArguments
        };
        return item;
    }

    private set ActiveConfig(label: string) {
        this.configurationStatusBarItem.text = label;
    }

    private set ShowConfiguration(show: boolean) {
        if (show) {
            this.configurationStatusBarItem.show();
        } else {
            this.configurationStatusBarItem.hide();
        }
    }
    //#endregion End - Configuration status bar

    //#region Configure IntelliSense status bar
    private createConfigureIntelliSenseStatusBarItem(): vscode.StatusBarItem {
        const cppConfigureIntelliSenseText: string = vscode.l10n.t("C/C++ Configure IntelliSense");
        const item: vscode.StatusBarItem = vscode.window.createStatusBarItem(`c.cpp.configureIntelliSenseStatus.statusbar`, vscode.StatusBarAlignment.Right, 0);
        item.name = cppConfigureIntelliSenseText;
        item.tooltip = cppConfigureIntelliSenseText;
        item.text = `$(warning) ${this.configureIntelliSenseText}`;
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        item.command = {
            command: "C_Cpp.SelectIntelliSenseConfiguration",
            title: cppConfigureIntelliSenseText,
            arguments: ['statusBar']
        };
        return item;
    }

    public async ShowConfigureIntelliSenseButton(show: boolean, client?: Client, configurationType?: ConfigurationType, sender?: string): Promise<void> {
        if (client !== this.currentClient) {
            return;
        }
        if (configurationType !== undefined && sender !== undefined) {
            const showButton: string = show ? 'true' : 'false';
            telemetry.logLanguageServerEvent('showConfigureIntelliSenseButton', { configurationType, sender, showButton });
        }

        this.showConfigureIntelliSenseButton = show;
        if (client !== undefined) {
            client.setShowConfigureIntelliSenseButton(show);
        }
        if (show) {
            const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
            telemetry.logLanguageServerEvent('configureIntelliSenseStatusBar');
            if (activeEditor && util.isCppOrRelated(activeEditor.document)) {
                this.configureIntelliSenseStatusBarItem.show();
                if (!this.configureIntelliSenseTimeout) {
                    this.configureIntelliSenseTimeout = setTimeout(() => {
                        this.configureIntelliSenseStatusBarItem.text = "$(warning)";
                    }, 15000);
                }
            }
        } else {
            this.configureIntelliSenseStatusBarItem.hide();
            if (this.configureIntelliSenseTimeout) {
                clearTimeout(this.configureIntelliSenseTimeout);
                this.configureIntelliSenseStatusBarItem.text = `$(warning) ${this.configureIntelliSenseText}`;
                this.configureIntelliSenseTimeout = undefined;
            }
        }
    }

    public didChangeActiveEditor(): void {
        const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!activeEditor) {
            this.ShowConfiguration = false;
            if (this.showConfigureIntelliSenseButton) {
                this.configureIntelliSenseStatusBarItem.hide();
            }
        } else {
            const isCppPropertiesJson: boolean = util.isCppPropertiesJson(activeEditor.document);
            if (isCppPropertiesJson) {
                void vscode.languages.setTextDocumentLanguage(activeEditor.document, "jsonc");
            }
            const isCppOrRelated: boolean = isCppPropertiesJson || util.isCppOrRelated(activeEditor.document);

            // It's sometimes desirable to see the config and icons when making changes to files with C/C++-related content.
            // TODO: Check some "AlwaysShow" setting here.
            this.ShowConfiguration = isCppOrRelated || (util.getWorkspaceIsCpp() &&
                (activeEditor.document.fileName.endsWith("tasks.json") ||
                    activeEditor.document.fileName.endsWith("launch.json")));

            if (this.showConfigureIntelliSenseButton) {
                if (isCppOrRelated && !!this.currentClient && this.currentClient.getShowConfigureIntelliSenseButton()) {
                    this.configureIntelliSenseStatusBarItem.show();
                    if (!this.configureIntelliSenseTimeout) {
                        this.configureIntelliSenseTimeout = setTimeout(() => {
                            this.configureIntelliSenseStatusBarItem.text = "$(warning)";
                        }, 15000);
                    }
                } else {
                    this.configureIntelliSenseStatusBarItem.hide();
                }
            }
        }
    }
    //#endregion End - Configure IntelliSense status bar

    public async showConfigurations(configurationNames: string[]): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = vscode.l10n.t("Select a Configuration...");

        const items: IndexableQuickPickItem[] = [];
        for (let i: number = 0; i < configurationNames.length; i++) {
            items.push({ label: configurationNames[i], description: "", index: i });
        }
        items.push({ label: vscode.l10n.t("Edit Configurations (UI)"), description: "", index: configurationNames.length });
        items.push({ label: vscode.l10n.t("Edit Configurations (JSON)"), description: "", index: configurationNames.length + 1 });

        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return selection ? selection.index : -1;
    }

    public async showConfigurationProviders(currentProvider?: string): Promise<string | undefined> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = vscode.l10n.t("Select a Configuration Provider...");
        const providers: CustomConfigurationProviderCollection = getCustomConfigProviders();

        const items: KeyedQuickPickItem[] = [];
        providers.forEach(provider => {
            let label: string = provider.name;
            if (isSameProviderExtensionId(currentProvider, provider.extensionId)) {
                label += ` (${vscode.l10n.t("active")})`;
            }
            items.push({ label: label, description: "", key: provider.extensionId });
        });
        items.push({ label: `(${vscode.l10n.t("none")})`, description: vscode.l10n.t("Disable the active configuration provider, if applicable."), key: "" });

        const selection: KeyedQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return selection ? selection.key : undefined;
    }

    public async showWorkspaces(workspaceNames: { name: string; key: string }[]): Promise<string> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = vscode.l10n.t("Select a workspace folder...");

        const items: KeyedQuickPickItem[] = [];
        workspaceNames.forEach(name => items.push({ label: name.name, description: "", key: name.key }));

        const selection: KeyedQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return selection ? selection.key : "";
    }

    public bind(client: Client): void {
        client.InitializingWorkspaceChanged(value => { this.setIsInitializingWorkspace(value); });
        client.IndexingWorkspaceChanged(value => { this.setIsIndexingWorkspace(value); });
        client.ParsingWorkspaceChanged(value => { this.setIsParsingWorkspace(value); });
        client.ParsingWorkspacePausedChanged(value => { this.setIsParsingWorkspacePaused(value); });
        client.ParsingFilesChanged(value => { this.setIsParsingFiles(value); });
        client.IntelliSenseParsingChanged(value => { this.setIsUpdatingIntelliSense(value); });
        client.RunningCodeAnalysisChanged(value => { this.setIsRunningCodeAnalysis(value); });
        client.CodeAnalysisPausedChanged(value => { this.setIsCodeAnalysisPaused(value); });
        client.CodeAnalysisProcessedChanged(value => { this.setCodeAnalysisProcessed(value); });
        client.CodeAnalysisTotalChanged(value => { this.setCodeAnalysisTotal(value); });
        client.ReferencesCommandModeChanged(value => { this.ReferencesCommand = value; });
        client.TagParserStatusChanged(value => { this.TagParseStatus = value; });
        client.ActiveConfigChanged(value => {
            this.ActiveConfig = value;
            this.currentClient = client;
            void this.ShowConfigureIntelliSenseButton(client.getShowConfigureIntelliSenseButton(), client);
        });
    }

    public dispose(): void {
        this.intelliSenseStatusItem.dispose();
        this.tagParseStatusItem.dispose();
        this.codeAnalysisStatusItem.dispose();
        this.referencesStatusBarItem.dispose();
        this.configurationStatusBarItem.dispose();
        this.configureIntelliSenseStatusBarItem.dispose();
    }
}

export function getUI(): LanguageStatusUI {
    if (!ui) {
        ui = new LanguageStatusUI();
    }
    return ui;
}

