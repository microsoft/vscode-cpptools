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
import { UI } from './ui';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// let ui: UI;

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

export class NewUI implements UI {
    private configStatusBarItem: vscode.LanguageStatusItem;
    private browseEngineStatusBarItem: vscode.LanguageStatusItem;
    private intelliSenseStatusBarItem: vscode.LanguageStatusItem;
    private referencesStatusBarItem: vscode.StatusBarItem;
    private codeAnalysisStatusBarItem: vscode.LanguageStatusItem;
    // This is a duplicate of what's in client.ts
    // TODO: Confirm whether the orignal can be reused here
    private documentSelector: vscode.DocumentFilter[] = [
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'cpp' },
        { scheme: 'file', language: 'cuda-cpp' }
    ];
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
    private readonly workspaceParseingDoneText: string = localize("complete.tagparser.text", "Parsing Complete");
    private workspaceParsingStatus: string = "";
    private workspaceParsingProgress: string = "";
    private readonly workspaceRescanText = localize("rescan.tagparse.text", "Re-scan workspace");
    private codeAnalysisProgram: string = "";
    private readonly parsingFilesTooltip: string = localize("c.cpp.parsing.open.files.tooltip", "Parsing Open Files");
    private readonly referencesPreviewTooltip: string = ` (${localize("click.to.preview", "click to preview results")})`;
    private readonly updatingIntelliSenseText: string = localize("updating.intellisense.text", "IntelliSense: Updating");
    private readonly idleIntelliSenseText: string = localize("idle.intellisense.text", "IntelliSense: Ready");
    private readonly missingIntelliSenseText: string = localize("absent.intellisense.text", "IntelliSense: Not configured");
    private readonly codeAnalysisTranslationHint: string = "{0} is a program name, such as clang-tidy";
    private readonly codeAnalysisRunningText: string = localize("running.analysis.tooltip", "Analyzing code");
    private readonly codeAnalysisPausedText: string = localize("paused.analysis.tooltip", "Analyzing code: Paused");
    private codeAnalysProgress: string = "";
    // Prevent icons from appearing too often and for too short of a time.
    private readonly iconDelayTime: number = 1000;

    constructor() {
        this.configStatusBarItem = vscode.languages.createLanguageStatusItem("c.cpp.configuration.tooltip", this.configDocumentSelector);
        this.configStatusBarItem.name = localize("c.cpp.configuration.tooltip", "Select Configuration");
        // TODO: Confirm title and tooltip localization
        this.configStatusBarItem.command = {
            command: "C_Cpp.ConfigurationSelect",
            title: this.configStatusBarItem.name as string,
            tooltip: this.configStatusBarItem.name as string
        };

        this.referencesStatusBarItem = vscode.window.createStatusBarItem("c.cpp.references.statusbar", vscode.StatusBarAlignment.Right, 901);
        this.referencesStatusBarItem.name = localize("c.cpp.references.statusbar", "C/C++ References Status");
        this.referencesStatusBarItem.tooltip = "";
        this.referencesStatusBarItem.command = "C_Cpp.ShowReferencesProgress";
        this.ShowReferencesIcon = false;

        this.intelliSenseStatusBarItem = vscode.languages.createLanguageStatusItem("c.cpp.intellisense.statusbar", this.documentSelector);
        this.intelliSenseStatusBarItem.name = localize("c.cpp.intellisense.statusbar", "C/C++ IntelliSense Status");
        this.intelliSenseStatusBarItem.text = this.idleIntelliSenseText;

        this.browseEngineStatusBarItem = vscode.languages.createLanguageStatusItem("c.cpp.tagparser.statusbar", this.documentSelector);
        this.browseEngineStatusBarItem.name = localize("c.cpp.tagparser.statusbar", "C/C++ Tag Parser Status");
        this.browseEngineStatusBarItem.detail = localize("indexing.files.tooltip", "Indexing Workspace");
        this.browseEngineStatusBarItem.text = "$(database)";
        this.browseEngineStatusBarItem.command = {
            command: "C_Cpp.RescanWorkspace",
            title: this.workspaceRescanText
        };
        this.workspaceParsingStatus = this.workspaceParsingRunningText;

        this.codeAnalysisStatusBarItem = vscode.languages.createLanguageStatusItem("c.cpp.codeanalysis.statusbar", this.documentSelector);
        this.codeAnalysisStatusBarItem.name = localize("c.cpp.codeanalysis.statusbar", "C/C++ Code Analysis Status");
        this.codeAnalysisStatusBarItem.text = `Code Analysis State: ${this.codeAnalysisCurrentState()}`;
        this.codeAnalysisStatusBarItem.command = {
            command: "C_Cpp.ShowIdleCodeAnalysisCommands",
            title: localize("c.cpp.codeanalysis.statusbar.runNow", "Run Now")
        };
        this.codeAnalysisStatusBarItem.severity = vscode.LanguageStatusSeverity.Warning;

    }

    private set ActiveConfig(label: string) {
        this.configStatusBarItem.text = label ?? localize("configuration.notselected.text", "Configuration: Not selected");
        if (this.configStatusBarItem.command) {
            this.configStatusBarItem.command.title = label.length > 0 ?
                localize("configuration.edit.text", "Edit Configuration") :
                localize("configuration.selected.text", "Select Configuration");
        }
    }

    private set TagParseStatus(label: string) {
        this.workspaceParsingProgress = label;
        if (this.browseEngineStatusBarItem.command) {
            // Currently need to update entire command for tooltip to update
            this.browseEngineStatusBarItem.command = {
                command: this.browseEngineStatusBarItem.command.command,
                title: this.browseEngineStatusBarItem.command.title,
                tooltip: (this.isParsingFiles ? `${this.parsingFilesTooltip} | ` : "") + this.workspaceParsingProgress
            };
            // this.browseEngineStatusBarItem.command.tooltip = (this.isParsingFiles ? `${this.parsingFilesTooltip} | ` : "") + this.workspaceParsingProgress;
        }
    }

    private dbTimeout?: NodeJS.Timeout;
    private setIsParsingWorkspace(val: boolean): void {
        this.isParsingWorkspace = val;
        const showIcon: boolean = val || this.isParsingFiles;
        const twoStatus: boolean = val && this.isParsingFiles;

        this.browseEngineStatusBarItem.busy = showIcon;
        this.browseEngineStatusBarItem.text = showIcon ? "$(database)" : "";
        this.browseEngineStatusBarItem.detail = (this.isParsingFiles ? this.parsingFilesTooltip : "")
            + (twoStatus ? " | " : "")
            + (val ? this.workspaceParsingStatus : "");

        if (this.dbTimeout) {
            clearTimeout(this.dbTimeout);
        }

        if (!showIcon) {
            this.dbTimeout = setTimeout(() => {
                this.browseEngineStatusBarItem.text = this.workspaceParseingDoneText;
                this.browseEngineStatusBarItem.detail = "";
                this.browseEngineStatusBarItem.command = {
                    command: "C_Cpp.RescanWorkspace",
                    title: this.workspaceRescanText
                };
            }, this.iconDelayTime);
        }
    }

    private setIsParsingWorkspacePausable(val: boolean): void {
        if (val && this.isParsingWorkspace) {
            this.browseEngineStatusBarItem.command = {
                command: "C_Cpp.PauseParsing",
                title:  localize("tagparser.pause.text", "Pause Workspace")
            };
        }
    }

    private setIsParsingWorkspacePaused(val: boolean): void {
        this.isParsingWorkspacePaused = val;
        this.browseEngineStatusBarItem.busy = !val || this.isParsingFiles;
        this.workspaceParsingStatus = val ? this.workspaceParsingPausedText : this.workspaceParsingRunningText;
        this.browseEngineStatusBarItem.detail = (this.isParsingFiles ? `${this.parsingFilesTooltip} | ` : "") + this.workspaceParsingStatus;
        this.browseEngineStatusBarItem.command = val ? {
            command: "C_Cpp.ResumeParsing",
            title: localize("tagparser.resume.text", "Resume")
        } : {
            command: "C_Cpp.PauseParsing",
            title: localize("tagparser.pause.text", "Pause Workspace")
        };
    }

    private setIsCodeAnalysisPaused(val: boolean): void {
        if (!this.isRunningCodeAnalysis) {
            return;
        }

        this.isCodeAnalysisPaused = val;
        this.codeAnalysisStatusBarItem.busy = !val;
        this.codeAnalysisStatusBarItem.text = val ? this.codeAnalysisPausedText : this.codeAnalysisRunningText;
        // TODO: Figure out what this refers to
        // this.codeAnalysisStatusBarItem.detail = val ? this.codeAnalysisPausedTooltip : this.runningCodeAnalysisTooltip;
    }

    private setIsParsingFiles(val: boolean): void {

        this.isParsingFiles = val;
        const showIcon: boolean = val || (!this.isParsingWorkspacePaused && this.isParsingWorkspace);
        const twoStatus: boolean = val && this.isParsingWorkspace;

        this.browseEngineStatusBarItem.busy = showIcon;
        this.browseEngineStatusBarItem.text = "$(database)";
        this.browseEngineStatusBarItem.detail = (val ? this.parsingFilesTooltip : "")
            + (twoStatus ? " | " : "")
            + (this.isParsingWorkspace ? this.workspaceParsingStatus : "");

        if (this.dbTimeout) {
            clearTimeout(this.dbTimeout);
        }
        if (!this.isParsingWorkspace && !val) {
            this.dbTimeout = setTimeout(() => {
                this.browseEngineStatusBarItem.text = this.workspaceParseingDoneText;
                this.browseEngineStatusBarItem.detail = "";
                this.browseEngineStatusBarItem.command = {
                    command: "C_Cpp.RescanWorkspace",
                    title: this.workspaceRescanText
                };
            }, this.iconDelayTime);
        }
    }

    private flameTimeout?: NodeJS.Timeout;
    private setIsUpdatingIntelliSense(val: boolean): void {

        const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);

        // TODO: Integrate with Tarik's feature to determine if compiler/bare-intellisense is configured
        if (settings.intelliSenseEngine === "disabled") {
            this.intelliSenseStatusBarItem.text = this.missingIntelliSenseText;
            this.intelliSenseStatusBarItem.severity = vscode.LanguageStatusSeverity.Warning;
            this.intelliSenseStatusBarItem.command = {
                command: "C_Cpp.CheckForCompiler",
                title: localize("intellisense.select.text", "Select a Compiler")
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
            title: localize("rescan.intellisense.text", "Rescan"),
            tooltip: localize("rescan.intellisense.tooltip", "Rescan IntelliSense")
        };

    }

    private codeAnalysisCurrentState(): string {
        const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);
        const state: string = settings.codeAnalysisRunAutomatically && settings.clangTidyEnabled ? "Automatic" : "Manual";
        return state;
    }

    private setIsRunningCodeAnalysis(val: boolean): void {
        if (this.isRunningCodeAnalysis && !val) {
            this.codeAnalysisTotal = 0;
            this.codeAnalysisProcessed = 0;
        }
        this.isRunningCodeAnalysis = val;
        this.codeAnalysisStatusBarItem.busy = val;
        this.codeAnalysisStatusBarItem.text = val ? "Code Analysis: Running" : `Code Analysis State: ${this.codeAnalysisCurrentState()}`;
        this.codeAnalysisStatusBarItem.command = val ? {
            command: "C_Cpp.ShowActiveCodeAnalysisCommands",
            title: localize("c.cpp.codeanalysis.statusbar.showCodeAnalysisOptions", "Options")
        } : {
            command: "C_Cpp.ShowIdleCodeAnalysisCommands",
            title: localize("c.cpp.codeanalysis.statusbar.showRunNowOptions", "Run Now")
        };
        this.codeAnalysisStatusBarItem.severity = vscode.LanguageStatusSeverity.Warning;
    }

    private updateCodeAnalysisTooltip(): void {
        this.codeAnalysProgress = localize({ key: "running.analysis.processed.tooltip", comment: [this.codeAnalysisTranslationHint] }, "Running {0}: {1} / {2} ({3}%)", this.codeAnalysisProgram,
            this.codeAnalysisProcessed, Math.max(this.codeAnalysisTotal, 1), Math.floor(100 * this.codeAnalysisProcessed / Math.max(this.codeAnalysisTotal, 1)));

        if (this.codeAnalysisStatusBarItem.command) {
            this.codeAnalysisStatusBarItem.command = {
                command: this.codeAnalysisStatusBarItem.command.command,
                title: this.codeAnalysisStatusBarItem.command.title,
                tooltip: this.codeAnalysProgress
            };
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
            // const isCpp: boolean = (activeEditor.document.uri.scheme === "file" && (activeEditor.document.languageId === "c" || activeEditor.document.languageId === "cpp" || activeEditor.document.languageId === "cuda-cpp"));

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
        this.configStatusBarItem.dispose();
        this.browseEngineStatusBarItem.dispose();
        this.intelliSenseStatusBarItem.dispose();
        this.referencesStatusBarItem.dispose();
        this.codeAnalysisStatusBarItem.dispose();
    }
}

