/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { documentSelector } from '../common';
import { Client } from './client';
import { ReferencesCommandMode, referencesCommandModeToString } from './references';
import { getCustomConfigProviders, CustomConfigurationProviderCollection, isSameProviderExtensionId } from './customProviders';
import * as nls from 'vscode-nls';
import { setTimeout } from 'timers';
import { CppSettings } from './settings';
import { UI } from './ui';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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

enum LanguageStatusPriority {
    First = 0,
    High = 1,
    Mid = 2,
    Low = 3
}

const commandArguments: string[] = ['newUI']; // We report the sender of the command

export class NewUI implements UI {
    private configStatusItem: vscode.LanguageStatusItem;
    private browseEngineStatusItem: vscode.LanguageStatusItem;
    private intelliSenseStatusItem: vscode.LanguageStatusItem;
    private referencesStatusBarItem: vscode.StatusBarItem;
    private codeAnalysisStatusItem: vscode.LanguageStatusItem;
    private configDocumentSelector: vscode.DocumentFilter[] = [
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'cpp' },
        { scheme: 'file', language: 'cuda-cpp' },
        { scheme: 'file', language: 'jsonc', pattern: '**/.vscode/*.json'},
        { scheme: 'file', language: 'jsonc', pattern: '**/*.code-workspace'},
        { scheme: 'output'}
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
    private readonly workspaceParsingRunningText: string = localize("running.tagparser.text", "Parsing Workspace");
    private readonly workspaceParsingPausedText: string = localize("paused.tagparser.text", "Parsing Workspace: Paused");
    private readonly workspaceParsingDoneText: string = localize("complete.tagparser.text", "Parsing Complete");
    private readonly workspaceParsingInitializing: string = localize("initializing.tagparser.text", "Initializing Workspace");
    private readonly workspaceParsingIndexing: string = localize("indexing.tagparser.text", "Indexing Workspace");
    private workspaceParsingStatus: string = "";
    private workspaceParsingProgress: string = "";
    private readonly workspaceRescanText = localize("rescan.tagparse.text", "Rescan Workspace");
    private codeAnalysisProgram: string = "";
    private readonly parsingFilesTooltip: string = localize("c.cpp.parsing.open.files.tooltip", "Parsing Open Files");
    private readonly referencesPreviewTooltip: string = ` (${localize("click.to.preview", "click to preview results")})`;
    private readonly updatingIntelliSenseText: string = localize("updating.intellisense.text", "IntelliSense: Updating");
    private readonly idleIntelliSenseText: string = localize("idle.intellisense.text", "IntelliSense: Ready");
    private readonly missingIntelliSenseText: string = localize("absent.intellisense.text", "IntelliSense: Not configured");
    private readonly codeAnalysisTranslationHint: string = "{0} is a program name, such as clang-tidy";
    private readonly codeAnalysisRunningText: string = localize("running.analysis.text", "Code Analysis: Running");
    private readonly codeAnalysisPausedText: string = localize("paused.analysis.text", "Code Analysis: Paused");
    private readonly codeAnalysisModePrefix: string = localize("mode.analysis.prefix", "Code Analysis Mode: ");
    private codeAnalysProgress: string = "";
    // Prevent icons from appearing too often and for too short of a time.
    private readonly iconDelayTime: number = 1000;
    get isNewUI(): boolean { return true; };

    constructor() {
        this.configStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.First}.configuration`, this.configDocumentSelector);
        this.configStatusItem.name = localize("cpptools.status.configuration", "Select Configuration");
        this.configStatusItem.text = "Loading configuration...";
        this.configStatusItem.command = {
            command: "C_Cpp.ConfigurationSelect",
            title: this.configStatusItem.name,
            tooltip: this.configStatusItem.name,
            arguments: commandArguments
        };

        this.referencesStatusBarItem = vscode.window.createStatusBarItem(`c.cpp.references.statusbar`, vscode.StatusBarAlignment.Right, 901);
        this.referencesStatusBarItem.name = localize("c.cpp.references.statusbar", "C/C++ References Status");
        this.referencesStatusBarItem.tooltip = "";
        this.referencesStatusBarItem.command = {
            command: "C_Cpp.ShowReferencesProgress",
            title: this.referencesStatusBarItem.name,
            arguments: commandArguments
        };
        this.ShowReferencesIcon = false;

        this.intelliSenseStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.Mid}.intellisense`, documentSelector);
        this.intelliSenseStatusItem.name = localize("cpptools.status.intellisense", "C/C++ IntelliSense Status");
        this.intelliSenseStatusItem.text = this.idleIntelliSenseText;

        this.browseEngineStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.Mid}.tagparser`, documentSelector);
        this.browseEngineStatusItem.name = localize("cpptools.status.tagparser", "C/C++ Tag Parser Status");
        this.browseEngineStatusItem.detail = localize("cpptools.detail.tagparser", "Initializing...");
        this.browseEngineStatusItem.text = "$(database)";
        this.browseEngineStatusItem.command = {
            command: "C_Cpp.RescanWorkspace",
            title: this.workspaceRescanText,
            arguments: commandArguments
        };
        this.workspaceParsingStatus = this.workspaceParsingRunningText;

        this.codeAnalysisStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.Low}.codeanalysis`, documentSelector);
        this.codeAnalysisStatusItem.name = localize("cpptools.status.codeanalysis", "C/C++ Code Analysis Status");
        this.codeAnalysisStatusItem.text = `Code Analysis Mode: ${this.codeAnalysisCurrentMode()}`;
        this.codeAnalysisStatusItem.command = {
            command: "C_Cpp.ShowIdleCodeAnalysisCommands",
            title: localize("c.cpp.codeanalysis.statusbar.runNow", "Run Now"),
            arguments: commandArguments
        };

    }

    private set ActiveConfig(label: string) {
        this.configStatusItem.text = label ?? localize("configuration.notselected.text", "Configuration: Not selected");
        if (this.configStatusItem.command) {
            this.configStatusItem.command.title = localize("configuration.selected.text", "Select Configuration");
        }
    }

    private set TagParseStatus(label: string) {
        this.workspaceParsingProgress = label;
        if (this.browseEngineStatusItem.command) {
            // Currently needed in order to update hover tooltip
            this.browseEngineStatusItem.command.tooltip = (this.isParsingFiles ? `${this.parsingFilesTooltip} | ` : "") + this.workspaceParsingProgress;
            this.browseEngineStatusItem.text = this.browseEngineStatusItem.text;
        }
    }

    private setIsInitializingWorkspace(val: boolean): void {
        if (val) {
            this.browseEngineStatusItem.text = "$(database)";
            this.browseEngineStatusItem.detail = this.workspaceParsingInitializing;
        }
    }
    private setIsIndexingWorkspace(val: boolean): void {
        if (val) {
            this.browseEngineStatusItem.text = "$(database)";
            this.browseEngineStatusItem.detail = this.workspaceParsingIndexing;
            this.browseEngineStatusItem.busy = true;
        }
    }

    private dbTimeout?: NodeJS.Timeout;
    private setIsParsingWorkspace(val: boolean): void {
        this.isParsingWorkspace = val;
        const showIcon: boolean = val || this.isParsingFiles;

        // Leave this outside for more realtime respone
        this.browseEngineStatusItem.busy = showIcon;

        if (showIcon) {
            this.browseEngineStatusItem.text = "$(database)";
            this.browseEngineStatusItem.detail = this.tagParseText();

            if (this.dbTimeout) {
                clearTimeout(this.dbTimeout);
            }
        } else {
            this.dbTimeout = setTimeout(() => {
                this.browseEngineStatusItem.text = this.workspaceParsingDoneText;
                this.browseEngineStatusItem.detail = "";
                this.browseEngineStatusItem.command = {
                    command: "C_Cpp.RescanWorkspace",
                    title: this.workspaceRescanText,
                    arguments: commandArguments
                };
            }, this.iconDelayTime);
        }
    }

    private tagParseText(): string {
        if (this.isParsingWorkspacePaused) {
            const twoStatus: boolean = this.isParsingFiles && this.isParsingWorkspace;
            return (this.isParsingFiles ? this.parsingFilesTooltip : "")
                + (twoStatus ? " | " : "")
                + (this.isParsingWorkspace ? this.workspaceParsingStatus : "");
        } else {
            return this.isParsingWorkspace ? this.workspaceParsingStatus : this.parsingFilesTooltip;
        }
    }

    private setIsParsingWorkspacePausable(val: boolean): void {
        if (val && this.isParsingWorkspace) {
            this.browseEngineStatusItem.command = {
                command: "C_Cpp.PauseParsing",
                title:  localize("tagparser.pause.text", "Pause"),
                arguments: commandArguments
            };
        }
    }

    private setIsParsingWorkspacePaused(val: boolean): void {
        if (!this.isParsingFiles && !this.isParsingWorkspace) {
            // Ignore a pause change if no parsing is actually happening.
            return;
        }
        this.isParsingWorkspacePaused = val;
        this.browseEngineStatusItem.busy = !val || this.isParsingFiles;
        this.browseEngineStatusItem.text = "$(database)";
        this.workspaceParsingStatus = val ? this.workspaceParsingPausedText : this.workspaceParsingRunningText;
        this.browseEngineStatusItem.detail = this.tagParseText();
        this.browseEngineStatusItem.command = val ? {
            command: "C_Cpp.ResumeParsing",
            title: localize("tagparser.resume.text", "Resume"),
            arguments: commandArguments
        } : {
            command: "C_Cpp.PauseParsing",
            title: localize("tagparser.pause.text", "Pause"),
            arguments: commandArguments
        };
    }

    private setIsCodeAnalysisPaused(val: boolean): void {
        if (!this.isRunningCodeAnalysis) {
            return;
        }

        this.isCodeAnalysisPaused = val;
        this.codeAnalysisStatusItem.busy = !val;
        this.codeAnalysisStatusItem.text = val ? this.codeAnalysisPausedText : this.codeAnalysisRunningText;
    }

    private setIsParsingFiles(val: boolean): void {
        this.isParsingFiles = val;
        const showIcon: boolean = val || this.isParsingWorkspace;

        // Leave this outside for more realtime respone
        this.browseEngineStatusItem.busy = val || (!this.isParsingWorkspacePaused && this.isParsingWorkspace);

        if (showIcon) {
            this.browseEngineStatusItem.text = "$(database)";
            this.browseEngineStatusItem.detail = this.tagParseText();

            if (this.dbTimeout) {
                clearTimeout(this.dbTimeout);
            }
        } else {
            this.dbTimeout = setTimeout(() => {
                this.browseEngineStatusItem.text = this.workspaceParsingDoneText;
                this.browseEngineStatusItem.detail = "";
                this.browseEngineStatusItem.command = {
                    command: "C_Cpp.RescanWorkspace",
                    title: this.workspaceRescanText,
                    arguments: commandArguments
                };
            }, this.iconDelayTime);
        }
    }

    private flameTimeout?: NodeJS.Timeout;
    private setIsUpdatingIntelliSense(val: boolean): void {
        const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);

        // TODO: Integrate with Tarik's feature to determine if compiler/bare-intellisense is configured
        if (settings.intelliSenseEngine === "disabled") {
            this.intelliSenseStatusItem.text = this.missingIntelliSenseText;
            this.intelliSenseStatusItem.command = {
                command: "C_Cpp.OpenCompilerQuickpick",
                title: localize("intellisense.select.text", "Select a Compiler"),
                arguments: commandArguments
            };
            return;
        }

        this.intelliSenseStatusItem.busy = val;

        if (this.flameTimeout) {
            clearTimeout(this.flameTimeout);
        }

        if (val) {
            this.intelliSenseStatusItem.text = "$(flame)";
            this.intelliSenseStatusItem.detail = this.updatingIntelliSenseText;
        } else {
            this.flameTimeout = setTimeout(() => {
                if (this.intelliSenseStatusItem) {
                    this.intelliSenseStatusItem.text = this.idleIntelliSenseText;
                    this.intelliSenseStatusItem.detail = "";
                }
            }, this.iconDelayTime);
        }
        this.intelliSenseStatusItem.command = {
            command: "C_Cpp.RestartIntelliSenseForFile",
            title: localize("rescan.intellisense.text", "Rescan"),
            tooltip: localize("rescan.intellisense.tooltip", "Rescan IntelliSense"),
            arguments: commandArguments
        };
    }

    private codeAnalysisCurrentMode(): string {
        const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);
        const state: string = (settings.codeAnalysisRunAutomatically && settings.clangTidyEnabled)
            ? localize("mode.codeanalysis.status", "Automatic")
            : localize("mode.codeanalysis.status", "Manual");
        return state;
    }

    private setIsRunningCodeAnalysis(val: boolean): void {
        if (this.isRunningCodeAnalysis && !val) {
            this.codeAnalysisTotal = 0;
            this.codeAnalysisProcessed = 0;
        }
        this.isRunningCodeAnalysis = val;
        this.codeAnalysisStatusItem.busy = val;
        const activeText: string = this.isCodeAnalysisPaused ? this.codeAnalysisPausedText : this.codeAnalysisRunningText;
        const idleText: string = this.codeAnalysisModePrefix + this.codeAnalysisCurrentMode();
        this.codeAnalysisStatusItem.text = val ? activeText : idleText;
        this.codeAnalysisStatusItem.command = val ? {
            command: "C_Cpp.ShowActiveCodeAnalysisCommands",
            title: localize("c.cpp.codeanalysis.statusbar.showCodeAnalysisOptions", "Options"),
            // Make sure not to overwrite current progress
            tooltip: this.codeAnalysisStatusItem.command?.tooltip ?? localize("startup.codeanalysis.status", "Starting..."),
            arguments: commandArguments
        } : {
            command: "C_Cpp.ShowIdleCodeAnalysisCommands",
            title: localize("c.cpp.codeanalysis.statusbar.showRunNowOptions", "Run Now"),
            arguments: commandArguments
        };
    }

    private updateCodeAnalysisTooltip(): void {
        this.codeAnalysProgress = localize({ key: "running.analysis.processed.tooltip", comment: [this.codeAnalysisTranslationHint] }, "Running {0}: {1} / {2} ({3}%)", this.codeAnalysisProgram,
            this.codeAnalysisProcessed, Math.max(this.codeAnalysisTotal, 1), Math.floor(100 * this.codeAnalysisProcessed / Math.max(this.codeAnalysisTotal, 1)));

        if (this.codeAnalysisStatusItem.command) {
            this.codeAnalysisStatusItem.command.tooltip = this.codeAnalysProgress;
            this.codeAnalysisStatusItem.text = this.codeAnalysisStatusItem.text;

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

    private set ShowReferencesIcon(show: boolean) {
        if (show && this.ReferencesCommand !== ReferencesCommandMode.None) {
            this.referencesStatusBarItem.show();
        } else {
            this.referencesStatusBarItem.hide();
        }
    }

    public activeDocumentChanged(): void {
        const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (activeEditor) {
            let isCppPropertiesJson: boolean = false;
            if (activeEditor.document.languageId === "json" || activeEditor.document.languageId === "jsonc") {
                isCppPropertiesJson = activeEditor.document.fileName.endsWith("c_cpp_properties.json");
                if (isCppPropertiesJson) {
                    vscode.languages.setTextDocumentLanguage(activeEditor.document, "jsonc");
                }
            }
        }
    }

    public bind(client: Client): void {
        client.InitializingWorkspaceChanged(value => { this.setIsInitializingWorkspace(value); });
        client.IndexingWorkspaceChanged(value => { this.setIsIndexingWorkspace(value); });
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

    public async showActiveCodeAnalysisCommands(): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = this.selectACommandString;

        const items: IndexableQuickPickItem[] = [];
        items.push({ label: localize({ key: "cancel.analysis", comment: [this.codeAnalysisTranslationHint]}, "Cancel {0}", this.codeAnalysisProgram), description: "", index: 0 });

        if (this.isCodeAnalysisPaused) {
            items.push({ label: localize({ key: "resume.analysis", comment: [this.codeAnalysisTranslationHint]}, "Resume {0}", this.codeAnalysisProgram), description: "", index: 2 });
        } else {
            items.push({ label: localize({ key: "pause.analysis", comment: [this.codeAnalysisTranslationHint]}, "Pause {0}", this.codeAnalysisProgram), description: "", index: 1 });
        }
        items.push({ label: localize({ key: "another.analysis", comment: [this.codeAnalysisTranslationHint]}, "Start Another {0}...", this.codeAnalysisProgram), description: "", index: 3 });
        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return (selection) ? selection.index : -1;
    }

    public async showIdleCodeAnalysisCommands(): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = this.selectACommandString;

        const items: IndexableQuickPickItem[] = [];
        items.push({ label: localize({ key: "active.analysis", comment: [this.codeAnalysisTranslationHint]}, "Run Code Analysis on Active File", this.codeAnalysisProgram), description: "", index: 0 });
        items.push({ label: localize({ key: "all.analysis", comment: [this.codeAnalysisTranslationHint]}, "Run Code Analysis on All Files", this.codeAnalysisProgram), description: "", index: 1 });
        items.push({ label: localize({ key: "open.analysis", comment: [this.codeAnalysisTranslationHint]}, "Run Code Analysis on Open Files", this.codeAnalysisProgram), description: "", index: 2 });
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
        this.configStatusItem.dispose();
        this.browseEngineStatusItem.dispose();
        this.intelliSenseStatusItem.dispose();
        this.referencesStatusBarItem.dispose();
        this.codeAnalysisStatusItem.dispose();
    }
}

