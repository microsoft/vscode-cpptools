/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { Client } from './client';
import { ReferencesCommandMode, referencesCommandModeToString } from './references';
import { getCustomConfigProviders, CustomConfigurationProviderCollection, isSameProviderExtensionId } from './customProviders';
import * as nls from 'vscode-nls';
import { setTimeout } from 'timers';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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

interface ConfigurationStatus {
    configured: boolean;
    priority: ConfigurationPriority;
}

export class UI {
    private configStatusBarItem: vscode.StatusBarItem;
    private browseEngineStatusBarItem: vscode.StatusBarItem;
    private intelliSenseStatusBarItem: vscode.StatusBarItem;
    private referencesStatusBarItem: vscode.StatusBarItem;
    private curConfigurationStatus?: Promise<ConfigurationStatus>;
    private isParsingWorkspace: boolean = false;
    private isParsingWorkspacePaused: boolean = false;
    private isParsingFiles: boolean = false;
    private isUpdatingIntelliSense: boolean = false;
    private isRunningCodeAnalysis: boolean = false;
    private isCodeAnalysisPaused: boolean = false;
    private codeAnalysisProcessed: number = 0;
    private codeAnalysisTotal: number = 0;
    private workspaceParsingStatus: string = "";
    private codeAnalysisProgram: string = "";
    private readonly parsingFilesTooltip: string = localize("c.cpp.parsing.open.files.tooltip", "Parsing open files");
    private readonly referencesPreviewTooltip: string = ` (${localize("click.to.preview", "click to preview results")})`;
    private readonly updatingIntelliSenseTooltip: string = localize("updating.intellisense.tooltip", "Updating IntelliSense");
    private readonly codeAnalysisTranslationHint: string = "{0} is a program name, such as clang-tidy";
    private runningCodeAnalysisTooltip: string = "";
    private codeAnalysisPausedTooltip: string = "";

    constructor() {
        const configTooltip: string = localize("c.cpp.configuration.tooltip", "C/C++ Configuration");
        this.configStatusBarItem = vscode.window.createStatusBarItem("c.cpp.configuration.tooltip", vscode.StatusBarAlignment.Right, 0);
        this.configStatusBarItem.name = configTooltip;
        this.configStatusBarItem.command = "C_Cpp.ConfigurationSelect";
        this.configStatusBarItem.tooltip = configTooltip;
        this.ShowConfiguration = true;

        this.referencesStatusBarItem = vscode.window.createStatusBarItem("c.cpp.references.statusbar", vscode.StatusBarAlignment.Right, 901);
        this.referencesStatusBarItem.name = localize("c.cpp.references.statusbar", "C/C++ References Status");
        this.referencesStatusBarItem.tooltip = "";
        this.referencesStatusBarItem.command = "C_Cpp.ShowReferencesProgress";
        this.ShowReferencesIcon = false;

        this.intelliSenseStatusBarItem = vscode.window.createStatusBarItem("c.cpp.intellisense.statusbar", vscode.StatusBarAlignment.Right, 903);
        this.intelliSenseStatusBarItem.name = localize("c.cpp.intellisense.statusbar", "C/C++ IntelliSense Status");
        this.intelliSenseStatusBarItem.tooltip = this.updatingIntelliSenseTooltip;
        this.ShowFlameIcon = false;

        this.browseEngineStatusBarItem = vscode.window.createStatusBarItem("c.cpp.tagparser.statusbar", vscode.StatusBarAlignment.Right, 902);
        this.browseEngineStatusBarItem.name = localize("c.cpp.tagparser.statusbar", "C/C++ Tag Parser Status");
        this.browseEngineStatusBarItem.tooltip = localize("discovering.files.tooltip", "Discovering files");
        this.ShowDBIcon = false;

        this.codeAnalysisProgram = "clang-tidy";
        this.runningCodeAnalysisTooltip = localize(
            { key: "running.analysis.tooltip", comment: [this.codeAnalysisTranslationHint] }, "Running {0}", this.codeAnalysisProgram);
        this.codeAnalysisPausedTooltip = localize(
            { key: "code.analysis.paused.tooltip", comment: [this.codeAnalysisTranslationHint] }, "{0} paused", this.codeAnalysisProgram);
    }

    private set ActiveConfig(label: string) {
        this.configStatusBarItem.text = label;
    }

    private set TagParseStatus(label: string) {
        this.workspaceParsingStatus = label;
        this.browseEngineStatusBarItem.tooltip = (this.isParsingFiles ? `${this.parsingFilesTooltip} | ` : "") + label;
    }

    private setIsParsingWorkspace(val: boolean): void {
        this.isParsingWorkspace = val;
        const showIcon: boolean = val || this.isParsingFiles;
        const twoStatus: boolean = val && this.isParsingFiles;
        this.ShowDBIcon = showIcon;
        this.browseEngineStatusBarItem.text = showIcon ? "$(database)" : "";
        this.browseEngineStatusBarItem.tooltip = (this.isParsingFiles ? this.parsingFilesTooltip : "")
            + (twoStatus ? " | " : "")
            + (val ? this.workspaceParsingStatus : "");
    }

    private setIsParsingWorkspacePausable(val: boolean): void {
        if (val) {
            this.browseEngineStatusBarItem.command = "C_Cpp.ShowParsingCommands";
        } else {
            this.browseEngineStatusBarItem.command = undefined;
        }
    }

    private setIsParsingWorkspacePaused(val: boolean): void {
        this.isParsingWorkspacePaused = val;
    }

    private setIsCodeAnalysisPaused(val: boolean): void {
        if (!this.isRunningCodeAnalysis) {
            return;
        }
        this.isCodeAnalysisPaused = val;
        const twoStatus: boolean = val && this.isUpdatingIntelliSense;
        this.intelliSenseStatusBarItem.tooltip = (this.isUpdatingIntelliSense ? this.updatingIntelliSenseTooltip : "")
            + (twoStatus ? " | " : "")
            + (val ? this.codeAnalysisPausedTooltip : this.runningCodeAnalysisTooltip);
    }

    private setIsParsingFiles(val: boolean): void {
        this.isParsingFiles = val;
        const showIcon: boolean = val || this.isParsingWorkspace;
        const twoStatus: boolean = val && this.isParsingWorkspace;
        this.ShowDBIcon = showIcon;
        this.browseEngineStatusBarItem.text = showIcon ? "$(database)" : "";
        this.browseEngineStatusBarItem.tooltip = (val ? this.parsingFilesTooltip : "")
            + (twoStatus ? " | " : "")
            + (this.isParsingWorkspace ? this.workspaceParsingStatus : "");
    }

    private setIsUpdatingIntelliSense(val: boolean): void {
        this.isUpdatingIntelliSense = val;
        const showIcon: boolean = val || this.isRunningCodeAnalysis;
        const twoStatus: boolean = val && this.isRunningCodeAnalysis;
        this.ShowFlameIcon = showIcon;
        this.intelliSenseStatusBarItem.text = showIcon ? "$(flame)" : "";
        this.intelliSenseStatusBarItem.tooltip = (val ? this.updatingIntelliSenseTooltip : "")
            + (twoStatus ? " | " : "")
            + (this.isRunningCodeAnalysis ? this.runningCodeAnalysisTooltip : "");
    }

    private setIsRunningCodeAnalysis(val: boolean): void {
        if (this.isRunningCodeAnalysis && !val) {
            this.codeAnalysisTotal = 0;
            this.codeAnalysisProcessed = 0;
        }
        this.isRunningCodeAnalysis = val;
        const showIcon: boolean = val || this.isUpdatingIntelliSense;
        const twoStatus: boolean = val && this.isUpdatingIntelliSense;
        this.ShowFlameIcon = showIcon;
        this.intelliSenseStatusBarItem.text = showIcon ? "$(flame)" : "";
        this.intelliSenseStatusBarItem.tooltip = (this.isUpdatingIntelliSense ? this.updatingIntelliSenseTooltip : "")
            + (twoStatus ? " | " : "")
            + (val ? this.runningCodeAnalysisTooltip : "");
        this.intelliSenseStatusBarItem.command = val ? "C_Cpp.ShowCodeAnalysisCommands" : undefined;
    }

    private updateCodeAnalysisTooltip(): void {
        this.runningCodeAnalysisTooltip = localize({ key: "running.analysis.processed.tooltip", comment: [this.codeAnalysisTranslationHint] }, "Running {0}: {1} / {2} ({3}%)", this.codeAnalysisProgram,
            this.codeAnalysisProcessed, Math.max(this.codeAnalysisTotal, 1), Math.floor(100 * this.codeAnalysisProcessed / Math.max(this.codeAnalysisTotal, 1)));
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

    private get ReferencesCommand(): ReferencesCommandMode {
        return this.referencesStatusBarItem.tooltip === "" ? ReferencesCommandMode.None :
            (this.referencesStatusBarItem.tooltip === referencesCommandModeToString(ReferencesCommandMode.Find) ? ReferencesCommandMode.Find :
                (this.referencesStatusBarItem.tooltip === referencesCommandModeToString(ReferencesCommandMode.Rename) ? ReferencesCommandMode.Rename :
                    ReferencesCommandMode.Peek));
    }

    private set ReferencesCommand(val: ReferencesCommandMode) {
        if (val === ReferencesCommandMode.None) {
            this.referencesStatusBarItem.text = "";
            this.ShowReferencesIcon = false;
        } else {
            this.referencesStatusBarItem.text = "$(search)";
            this.referencesStatusBarItem.tooltip =  referencesCommandModeToString(val) + (val !== ReferencesCommandMode.Find ? "" : this.referencesPreviewTooltip);
            this.ShowReferencesIcon = true;
        }
    }

    // Prevent icons from appearing too often and for too short of a time.
    private readonly iconDelayTime: number = 1000;

    private dbTimeout?: NodeJS.Timeout;
    private set ShowDBIcon(show: boolean) {
        if (this.dbTimeout) {
            clearTimeout(this.dbTimeout);
        }
        if (show && (this.isParsingWorkspace || this.isParsingFiles)) {
            this.dbTimeout = setTimeout(() => { this.browseEngineStatusBarItem.show(); }, this.iconDelayTime);
        } else {
            this.dbTimeout = setTimeout(() => { this.browseEngineStatusBarItem.hide(); }, this.iconDelayTime);
        }
    }

    private flameTimeout?: NodeJS.Timeout;
    private set ShowFlameIcon(show: boolean) {
        if (this.flameTimeout) {
            clearTimeout(this.flameTimeout);
        }
        if (show && (this.isUpdatingIntelliSense || this.isRunningCodeAnalysis)) {
            this.flameTimeout = setTimeout(() => { this.intelliSenseStatusBarItem.show(); }, this.iconDelayTime);
        } else {
            this.flameTimeout = setTimeout(() => { this.intelliSenseStatusBarItem.hide(); }, this.iconDelayTime);
        }
    }

    private set ShowReferencesIcon(show: boolean) {
        if (show && this.ReferencesCommand !== ReferencesCommandMode.None) {
            this.referencesStatusBarItem.show();
        } else {
            this.referencesStatusBarItem.hide();
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
        const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!activeEditor) {
            this.ShowConfiguration = false;
        } else {
            const isCpp: boolean = (activeEditor.document.uri.scheme === "file" && (activeEditor.document.languageId === "c" || activeEditor.document.languageId === "cpp" || activeEditor.document.languageId === "cuda-cpp"));

            let isCppPropertiesJson: boolean = false;
            if (activeEditor.document.languageId === "json" || activeEditor.document.languageId === "jsonc") {
                isCppPropertiesJson = activeEditor.document.fileName.endsWith("c_cpp_properties.json");
                if (isCppPropertiesJson) {
                    vscode.languages.setTextDocumentLanguage(activeEditor.document, "jsonc");
                }
            }

            // It's sometimes desirable to see the config and icons when making changes to files with C/C++-related content.
            // TODO: Check some "AlwaysShow" setting here.
            this.ShowConfiguration = isCpp || isCppPropertiesJson ||
                activeEditor.document.uri.scheme === "output" ||
                activeEditor.document.fileName.endsWith("settings.json") ||
                activeEditor.document.fileName.endsWith("tasks.json") ||
                activeEditor.document.fileName.endsWith("launch.json") ||
                activeEditor.document.fileName.endsWith(".code-workspace");
        }
    }

    public bind(client: Client): void {
        client.ParsingWorkspaceChanged(value => { this.setIsParsingWorkspace(value); });
        client.ParsingWorkspacePausableChanged(value => { this.setIsParsingWorkspacePausable(value); });
        client.ParsingWorkspacePausedChanged(value => { this.setIsParsingWorkspacePaused(value); });
        client.ParsingFilesChanged(value => { this.setIsParsingFiles(value); });
        client.IntelliSenseParsingChanged(value => { this.setIsUpdatingIntelliSense(value); });
        client.RunningCodeAnalysisChanged(value => { this.setIsRunningCodeAnalysis(value); });
        client.CodeAnalysisPausedChanged(value => { this.setIsCodeAnalysisPaused(value); });
        client.CodeAnalysisProcessedChanged(value => { this.setCodeAnalysisProcessed(value); });
        client.CodeAnalysisTotalChanged(value => { this.setCodeAnalysisTotal(value); });
        client.ReferencesCommandModeChanged(value => { this.ReferencesCommand = value; });
        client.TagParserStatusChanged(value => { this.TagParseStatus = value; });
        client.ActiveConfigChanged(value => { this.ActiveConfig = value; });
    }

    public async showConfigurations(configurationNames: string[]): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.a.configuration", "Select a Configuration...");

        const items: IndexableQuickPickItem[] = [];
        for (let i: number = 0; i < configurationNames.length; i++) {
            items.push({ label: configurationNames[i], description: "", index: i });
        }
        items.push({ label: localize("edit.configuration.ui", "Edit Configurations (UI)"), description: "", index: configurationNames.length });
        items.push({ label: localize("edit.configuration.json", "Edit Configurations (JSON)"), description: "", index: configurationNames.length + 1 });

        const selection: IndexableQuickPickItem | undefined  = await vscode.window.showQuickPick(items, options);
        return (selection) ? selection.index : -1;
    }

    public async showConfigurationProviders(currentProvider?: string): Promise<string | undefined> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.configuration.provider", "Select a Configuration Provider...");
        const providers: CustomConfigurationProviderCollection = getCustomConfigProviders();

        const items: KeyedQuickPickItem[] = [];
        providers.forEach(provider => {
            let label: string = provider.name;
            if (isSameProviderExtensionId(currentProvider, provider.extensionId)) {
                label += ` (${localize("active", "active")})`;
            }
            items.push({ label: label, description: "", key: provider.extensionId });
        });
        items.push({ label: `(${localize("none", "none")})`, description: localize("disable.configuration.provider", "Disable the active configuration provider, if applicable."), key: "" });

        const selection: KeyedQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return (selection) ? selection.key : undefined;
    }

    public async showCompileCommands(paths: string[]): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.compile.commands", "Select a compile_commands.json...");

        const items: IndexableQuickPickItem[] = [];
        for (let i: number = 0; i < paths.length; i++) {
            items.push({label: paths[i], description: "", index: i});
        }

        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return (selection) ? selection.index : -1;
    }

    public async showWorkspaces(workspaceNames: { name: string; key: string }[]): Promise<string> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.workspace", "Select a workspace folder...");

        const items: KeyedQuickPickItem[] = [];
        workspaceNames.forEach(name => items.push({ label: name.name, description: "", key: name.key }));

        const selection: KeyedQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return (selection) ? selection.key : "";
    }

    private readonly selectACommandString: string = localize("select.command", "Select a command...");

    public async showParsingCommands(): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = this.selectACommandString;

        const items: IndexableQuickPickItem[] = [];
        if (this.isParsingWorkspacePaused) {
            items.push({ label: localize("resume.parsing", "Resume Workspace Parsing"), description: "", index: 1 });
        } else {
            items.push({ label: localize("pause.parsing", "Pause Workspace Parsing"), description: "", index: 0 });
        }
        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return (selection) ? selection.index : -1;
    }

    public async showCodeAnalysisCommands(): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = this.selectACommandString;

        const items: IndexableQuickPickItem[] = [];
        items.push({ label: localize({ key: "cancel.analysis", comment: [this.codeAnalysisTranslationHint]}, "Cancel {0}", this.codeAnalysisProgram), description: "", index: 0 });

        if (this.isCodeAnalysisPaused) {
            items.push({ label: localize({ key: "resume.analysis", comment: [this.codeAnalysisTranslationHint]}, "Resume {0}", this.codeAnalysisProgram), description: "", index: 2 });
        } else {
            items.push({ label: localize({ key: "pause.analysis", comment: [this.codeAnalysisTranslationHint]}, "Pause {0}", this.codeAnalysisProgram), description: "", index: 1 });
        }
        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return (selection) ? selection.index : -1;
    }

    public showConfigureIncludePathMessage(prompt: () => Promise<boolean>, onSkip: () => void): void {
        setTimeout(() => {
            this.showConfigurationPrompt(ConfigurationPriority.IncludePath, prompt, onSkip);
        }, 10000);
    }

    public showConfigureCompileCommandsMessage(prompt: () => Promise<boolean>, onSkip: () => void): void {
        setTimeout(() => {
            this.showConfigurationPrompt(ConfigurationPriority.CompileCommands, prompt, onSkip);
        }, 5000);
    }

    public showConfigureCustomProviderMessage(prompt: () => Promise<boolean>, onSkip: () => void): void {
        this.showConfigurationPrompt(ConfigurationPriority.CustomProvider, prompt, onSkip);
    }

    private showConfigurationPrompt(priority: ConfigurationPriority, prompt: () => Thenable<boolean>, onSkip: () => void): void {
        const showPrompt: () => Promise<ConfigurationStatus> = async () => {
            const configured: boolean = await prompt();
            return Promise.resolve({
                priority: priority,
                configured: configured
            });
        };

        if (this.curConfigurationStatus) {
            this.curConfigurationStatus = this.curConfigurationStatus.then(result => {
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
            this.curConfigurationStatus = showPrompt();
        }
    }

    public dispose(): void {
        this.configStatusBarItem.dispose();
        this.browseEngineStatusBarItem.dispose();
        this.intelliSenseStatusBarItem.dispose();
        this.referencesStatusBarItem.dispose();
    }
}

export function getUI(): UI {
    if (!ui) {
        ui = new UI();
    }
    return ui;
}
