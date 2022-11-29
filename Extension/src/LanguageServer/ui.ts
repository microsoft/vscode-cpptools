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
import { CppSettings } from './settings';
import { basename } from 'path';

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
    private configStatusBarItem: vscode.LanguageStatusItem;
    private browseEngineStatusBarItem?: vscode.LanguageStatusItem;
    private intelliSenseStatusBarItem: vscode.LanguageStatusItem;
    private referencesStatusBarItem?: vscode.LanguageStatusItem;
    private compilerStatusBarItem: vscode.LanguageStatusItem;
    private codeAnalysisStatusBarItem: vscode.LanguageStatusItem;
    // This is a duplicate of what's in client.ts
    // TODO: Confirm whether the orignal can be reused here
    private documentSelector: vscode.DocumentFilter[] = [
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'cpp' },
        { scheme: 'file', language: 'cuda-cpp' }
    ];
    /** **************************************************** */
    private curConfigurationStatus?: Promise<ConfigurationStatus>;
    private isParsingWorkspace: boolean = false;
    private isParsingWorkspacePaused: boolean = false;
    private isParsingFiles: boolean = false;
    private isRunningCodeAnalysis: boolean = false;
    private isCodeAnalysisPaused: boolean = false;
    private codeAnalysisProcessed: number = 0;
    private codeAnalysisTotal: number = 0;
    private workspaceParsingStatus: string = "";
    private codeAnalysisProgram: string = "";
    private readonly parsingFilesTooltip: string = localize("c.cpp.parsing.open.files.tooltip", "Parsing open files");
    private readonly referencesPreviewTooltip: string = ` (${localize("click.to.preview", "click to preview results")})`;
    private readonly updatingIntelliSenseText: string = localize("updating.intellisense.text", "IntelliSense: Updating");
    private readonly idleIntelliSenseText: string = localize("idle.intellisense.text", "IntelliSense: Ready");
    private readonly missingIntelliSenseText: string = localize("absent.intellisense.text", "IntelliSense: Not configured");
    private readonly codeAnalysisTranslationHint: string = "{0} is a program name, such as clang-tidy";
    private runningCodeAnalysisTooltip: string = "";
    private codeAnalysisPausedTooltip: string = "";

    constructor() {
        this.configStatusBarItem = vscode.languages.createLanguageStatusItem("c.cpp.configuration.tooltip", this.documentSelector);
        this.configStatusBarItem.name = localize("c.cpp.configuration.tooltip", "Select a Configuration");
        // TODO: Confirm title and tooltip localization
        this.configStatusBarItem.command = {
            command: "C_Cpp.ConfigurationSelect",
            title: this.configStatusBarItem.name as string,
            tooltip: this.configStatusBarItem.name as string
        };
        this.ShowConfiguration = true;

        this.ensureReferencesStatusItem();
        this.ShowReferencesIcon = false;

        this.intelliSenseStatusBarItem = vscode.languages.createLanguageStatusItem("c.cpp.intellisense.statusbar", this.documentSelector);
        this.intelliSenseStatusBarItem.name = localize("c.cpp.intellisense.statusbar", "C/C++ IntelliSense Status");
        this.intelliSenseStatusBarItem.detail = this.updatingIntelliSenseText;
        // this.ShowFlameIcon = false;

        this.ensureBrowseEnginerStatus();
        this.ShowDBIcon = false;

        this.compilerStatusBarItem = vscode.languages.createLanguageStatusItem("c.cpp.compiler.statusbar", this.documentSelector);
        this.compilerStatusBarItem.name = localize("c.cpp.compiler.statusbar", "C/C++ Compiler Status");

        this.codeAnalysisStatusBarItem = vscode.languages.createLanguageStatusItem("c.cpp.codeanalysis.statusbar", this.documentSelector);
        this.codeAnalysisStatusBarItem.name = localize("c.cpp.codeanalysis.statusbar", "C/C++ Code Analysis Status");

        this.codeAnalysisProgram = "clang-tidy";
        this.runningCodeAnalysisTooltip = localize(
            { key: "running.analysis.tooltip", comment: [this.codeAnalysisTranslationHint] }, "Running {0}", this.codeAnalysisProgram);
        this.codeAnalysisPausedTooltip = localize(
            { key: "code.analysis.paused.tooltip", comment: [this.codeAnalysisTranslationHint] }, "{0} paused", this.codeAnalysisProgram);
    }

    private ensureReferencesStatusItem(): void {
        if (this.referencesStatusBarItem) {
            return;
        }

        this.referencesStatusBarItem  = vscode.languages.createLanguageStatusItem("c.cpp.references.statusbar", this.documentSelector);
        this.referencesStatusBarItem.name  = localize("c.cpp.references.statusbar", "C/C++ References Status");
        this.referencesStatusBarItem.command = {
            command: "C_Cpp.ShowReferencesProgress",
            title: "",
            tooltip: ""
        };
    }

    private ensureBrowseEnginerStatus(): void {
        if (this.browseEngineStatusBarItem) {
            return;
        }

        this.browseEngineStatusBarItem = vscode.languages.createLanguageStatusItem("c.cpp.tagparser.statusbar", this.documentSelector);
        this.browseEngineStatusBarItem.name = localize("c.cpp.tagparser.statusbar", "C/C++ Tag Parser Status");
        this.browseEngineStatusBarItem.detail = localize("discovering.files.tooltip", "Discovering files");
    }

    private set ActiveConfig(label: string) {
        this.configStatusBarItem.text = label ?? "Configuation: Not selected";
        if (this.configStatusBarItem.command) {
            this.configStatusBarItem.command.title = label.length > 0 ? "Edit Configuration" : "Select Configuration";
        }
    }

    private set CurrentCompiler(label: string) {
        const text: string = label.length > 0 ? basename(label) : "Not Selected";
        this.compilerStatusBarItem.text = `Compiler: ${text}`;

        this.compilerStatusBarItem.command = {
            title: label.length > 0 ? "Manage compiler" : "Select a Compiler",
            command: "C_Cpp.CheckForCompiler"
        };
    }

    private set TagParseStatus(label: string) {
        this.workspaceParsingStatus = label;

        this.ensureBrowseEnginerStatus();
        if (this.browseEngineStatusBarItem) {
            this.browseEngineStatusBarItem.detail = (this.isParsingFiles ? `${this.parsingFilesTooltip} | ` : "") + label;
        }
    }

    private setIsParsingWorkspace(val: boolean): void {
        this.ensureBrowseEnginerStatus();
        this.isParsingWorkspace = val;
        const showIcon: boolean = val || this.isParsingFiles;
        const twoStatus: boolean = val && this.isParsingFiles;
        this.ShowDBIcon = showIcon;

        if (this.browseEngineStatusBarItem) {
            this.browseEngineStatusBarItem.text = showIcon ? "$(database)" : "";
            this.browseEngineStatusBarItem.detail = (this.isParsingFiles ? this.parsingFilesTooltip : "")
                + (twoStatus ? " | " : "")
                + (val ? this.workspaceParsingStatus : "");
        }
    }

    private setIsParsingWorkspacePausable(val: boolean): void {
        this.ensureBrowseEnginerStatus();
        if (this.browseEngineStatusBarItem) {
            if (val) {
                this.browseEngineStatusBarItem.command = {
                    command: "C_Cpp.ShowParsingCommands",
                    title: "Show Parsing Commands",
                    tooltip: "Show Parsing Commands"
                };
            } else {
                // this.browseEngineStatusBarItem.command = undefined;
                this.browseEngineStatusBarItem.command = {
                    command: "C_Cpp.RescanWorkspace",
                    title: "Rescan workspace",
                    tooltip: "Rescan workspace"
                };
            }
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
        // TODO: Figure out what this refers to
        this.codeAnalysisStatusBarItem.detail = val ? this.codeAnalysisPausedTooltip : this.runningCodeAnalysisTooltip;
    }

    private setIsParsingFiles(val: boolean): void {

        this.ensureBrowseEnginerStatus();
        this.isParsingFiles = val;
        const showIcon: boolean = val || this.isParsingWorkspace;
        const twoStatus: boolean = val && this.isParsingWorkspace;
        this.ShowDBIcon = showIcon;
        if (this.browseEngineStatusBarItem) {
            this.browseEngineStatusBarItem.text = showIcon ? "$(database)" : "";
            this.browseEngineStatusBarItem.detail = (val ? this.parsingFilesTooltip : "")
                + (twoStatus ? " | " : "")
                + (this.isParsingWorkspace ? this.workspaceParsingStatus : "");
        }
    }

    private flameTimeout?: NodeJS.Timeout;
    private setIsUpdatingIntelliSense(val: boolean): void {

        const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);

        // TODO: Redo this. Need to determine the critera for intellisense not being configured
        // ALSO: Need to figure out what the compiler select quickpick is
        if (settings.intelliSenseEngine === "disabled") {
            this.intelliSenseStatusBarItem.text = this.missingIntelliSenseText;
            this.intelliSenseStatusBarItem.severity = vscode.LanguageStatusSeverity.Warning;
            this.intelliSenseStatusBarItem.command = {
                command: "C_Cpp.CheckForCompiler",
                title: "Select a Compiler"
            };
            return;
        }

        this.intelliSenseStatusBarItem.busy = val;

        if (this.flameTimeout) {
            clearTimeout(this.flameTimeout);
        }

        if (val) {
            this.intelliSenseStatusBarItem.text = "$(flame)";
            this.intelliSenseStatusBarItem.detail = this.updatingIntelliSenseText;
            this.intelliSenseStatusBarItem.severity = vscode.LanguageStatusSeverity.Warning;
        } else {
            this.flameTimeout = setTimeout(() => {
                if (this.intelliSenseStatusBarItem) {
                    this.intelliSenseStatusBarItem.text = this.idleIntelliSenseText;
                    this.intelliSenseStatusBarItem.detail = "";
                    this.intelliSenseStatusBarItem.severity = vscode.LanguageStatusSeverity.Warning;
                }
            }, this.iconDelayTime);
        }
        this.intelliSenseStatusBarItem.command = {
            command: "C_Cpp.RestartIntelliSenseForFile",
            title: "Rescan",
            tooltip: "Rescan IntelliSense"
        };

    }

    private setIsRunningCodeAnalysis(val: boolean): void {
        if (this.isRunningCodeAnalysis && !val) {
            this.codeAnalysisTotal = 0;
            this.codeAnalysisProcessed = 0;
        }
        const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);

        this.isRunningCodeAnalysis = val;
        const state: string = `Code Analysis State: ${settings.codeAnalysisRunAutomatically ? "Automatic" : "Manual"}`;
        this.codeAnalysisStatusBarItem.text = val ? "Code Analysis: Running" : state;
        this.codeAnalysisStatusBarItem.command = val ? {
            command: "C_Cpp.ShowCodeAnalysisCommands",
            title: localize("c.cpp.codeanalysis.statusbar.showCodeAnalysis", "Show Code Analysis")
        } : {
            command: "C_Cpp.RunCodeAnalysisOnActiveFile",
            title: localize("c.cpp.codeanalysis.statusbar.runNow", "Run Now")
        };
        this.codeAnalysisStatusBarItem.severity = vscode.LanguageStatusSeverity.Warning;
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
        this.ensureReferencesStatusItem();
        let tooltip: string|undefined;
        if (this.referencesStatusBarItem) {
            tooltip = this.referencesStatusBarItem.command?.tooltip;
            this.referencesStatusBarItem.severity = vscode.LanguageStatusSeverity.Warning;
        }
        return tooltip === "" ? ReferencesCommandMode.None :
            (tooltip === referencesCommandModeToString(ReferencesCommandMode.Find) ? ReferencesCommandMode.Find :
                (tooltip === referencesCommandModeToString(ReferencesCommandMode.Rename) ? ReferencesCommandMode.Rename :
                    ReferencesCommandMode.Peek));
    }

    private set ReferencesCommand(val: ReferencesCommandMode) {
        this.ensureReferencesStatusItem();
        if (this.referencesStatusBarItem) {
            if (val === ReferencesCommandMode.None) {
                this.referencesStatusBarItem.text = "";
                if (this.referencesStatusBarItem.command) {
                    this.referencesStatusBarItem.command.title = "";
                    this.referencesStatusBarItem.command.tooltip = "";
                }
                this.ShowReferencesIcon = false;
            } else {
                this.referencesStatusBarItem.text = "$(search)";
                if (this.referencesStatusBarItem.command) {
                    this.referencesStatusBarItem.command.title = localize("c.cpp.references.statusbar.results", "Results");
                    this.referencesStatusBarItem.command.tooltip =  referencesCommandModeToString(val) + (val !== ReferencesCommandMode.Find ? "" : this.referencesPreviewTooltip);
                    this.referencesStatusBarItem.severity = vscode.LanguageStatusSeverity.Warning;
                }
                this.ShowReferencesIcon = true;
            }
        }
    }

    // Prevent icons from appearing too often and for too short of a time.
    private readonly iconDelayTime: number = 1000;

    private dbTimeout?: NodeJS.Timeout;
    private set ShowDBIcon(show: boolean) {

        if (this.dbTimeout) {
            clearTimeout(this.dbTimeout);
        }
        if (this.browseEngineStatusBarItem) {
            this.browseEngineStatusBarItem.busy = show && (this.isParsingWorkspace || this.isParsingFiles);
            if (!this.browseEngineStatusBarItem.busy) {
                this.dbTimeout = setTimeout(() => {
                    if (this.browseEngineStatusBarItem) {
                        this.browseEngineStatusBarItem.dispose();
                        this.browseEngineStatusBarItem = undefined;
                    }
                }, this.iconDelayTime);
            }
        }
    }

    private set ShowReferencesIcon(show: boolean) {
        if (this.referencesStatusBarItem) {
            this.referencesStatusBarItem.busy = show;
            if (!show) {
                this.referencesStatusBarItem.dispose();
                this.referencesStatusBarItem = undefined;
            }
        }
    }

    private set ShowConfiguration(show: boolean) {
        // Not needed. Goes away when not needed due to documentFilters
        // if (this.configStatusBarItem) {
        //     this.configStatusBarItem.busy = show;
        // }
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
        client.CurrentCompilerChanged(value => { this.CurrentCompiler = value; });
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
        if (this.browseEngineStatusBarItem) {this.browseEngineStatusBarItem.dispose(); }
        this.intelliSenseStatusBarItem.dispose();
        if (this.referencesStatusBarItem) {this.referencesStatusBarItem.dispose(); }
        this.compilerStatusBarItem.dispose();
        this.codeAnalysisStatusBarItem.dispose();
    }
}

export function getUI(): UI {
    if (!ui) {
        ui = new UI();
    }
    return ui;
}
