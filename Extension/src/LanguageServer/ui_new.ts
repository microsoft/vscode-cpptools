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
import * as telemetry from '../telemetry';
import * as util from '../common';

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
    private currentClient: Client | undefined;
    private configStatusBarItem: vscode.StatusBarItem;
    private browseEngineStatusItem: vscode.LanguageStatusItem;
    private intelliSenseStatusItem: vscode.LanguageStatusItem;
    private configureIntelliSenseStatusItem: vscode.StatusBarItem;
    private referencesStatusBarItem: vscode.StatusBarItem;
    private codeAnalysisStatusItem: vscode.LanguageStatusItem;
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
    private readonly parsingFilesTooltip: string = localize("c.cpp.parsing.open.files.tooltip", "Parsing Open Files");
    private readonly referencesPreviewTooltip: string = ` (${localize("click.to.preview", "click to preview results")})`;
    private readonly updatingIntelliSenseText: string = localize("updating.intellisense.text", "IntelliSense: Updating");
    private readonly idleIntelliSenseText: string = localize("idle.intellisense.text", "IntelliSense: Ready");
    private readonly missingIntelliSenseText: string = localize("absent.intellisense.text", "IntelliSense: Not configured");
    private readonly codeAnalysisRunningText: string = localize("running.analysis.text", "Code Analysis: Running");
    private readonly codeAnalysisPausedText: string = localize("paused.analysis.text", "Code Analysis: Paused");
    private readonly codeAnalysisModePrefix: string = localize("mode.analysis.prefix", "Code Analysis Mode: ");
    private codeAnalysProgress: string = "";
    // Prevent icons from appearing too often and for too short of a time.
    private readonly iconDelayTime: number = 1000;
    get isNewUI(): boolean { return true; };
    private readonly configureIntelliSenseText: string = localize("c.cpp.configureIntelliSenseStatus.text", "Configure IntelliSense");
    private readonly cppConfigureIntelliSenseText: string = localize("c.cpp.configureIntelliSenseStatus.cppText", "C/C++ Configure IntelliSense");

    constructor() {
        const configTooltip: string = localize("c.cpp.configuration.tooltip", "C/C++ Configuration");
        this.configStatusBarItem = vscode.window.createStatusBarItem("c.cpp.configuration.tooltip", vscode.StatusBarAlignment.Right, 0);
        this.configStatusBarItem.name = configTooltip;
        this.configStatusBarItem.command = {
            command: "C_Cpp.ConfigurationSelect",
            title: configTooltip,
            arguments: commandArguments
        };
        this.configStatusBarItem.tooltip = configTooltip;
        this.ShowConfiguration = true;

        this.referencesStatusBarItem = vscode.window.createStatusBarItem(`c.cpp.references.statusbar`, vscode.StatusBarAlignment.Right, 901);
        this.referencesStatusBarItem.name = localize("c.cpp.references.statusbar", "C/C++ References Status");
        this.referencesStatusBarItem.tooltip = "";
        this.referencesStatusBarItem.command = {
            command: "C_Cpp.ShowReferencesProgress",
            title: this.referencesStatusBarItem.name,
            arguments: commandArguments
        };
        this.ShowReferencesIcon = false;

        this.configureIntelliSenseStatusItem = vscode.window.createStatusBarItem(`c.cpp.configureIntelliSenseStatus.statusbar`, vscode.StatusBarAlignment.Right, 0);
        this.configureIntelliSenseStatusItem.name = this.cppConfigureIntelliSenseText;
        this.configureIntelliSenseStatusItem.tooltip = this.cppConfigureIntelliSenseText;
        this.configureIntelliSenseStatusItem.text = `$(warning) ${this.configureIntelliSenseText}`;
        this.configureIntelliSenseStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.configureIntelliSenseStatusItem.command = {
            command: "C_Cpp.SelectIntelliSenseConfiguration",
            title: this.configureIntelliSenseStatusItem.name,
            arguments: ['statusBar']
        };
        this.ShowConfigureIntelliSenseButton(false, this.currentClient);

        this.intelliSenseStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.Mid}.intellisense`, util.documentSelector);
        this.intelliSenseStatusItem.name = localize("cpptools.status.intellisense", "C/C++ IntelliSense Status");
        this.intelliSenseStatusItem.text = this.idleIntelliSenseText;

        this.browseEngineStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.Mid}.tagparser`, util.documentSelector);
        this.browseEngineStatusItem.name = localize("cpptools.status.tagparser", "C/C++ Tag Parser Status");
        this.browseEngineStatusItem.detail = localize("cpptools.detail.tagparser", "Initializing...");
        this.browseEngineStatusItem.text = "$(database)";
        this.browseEngineStatusItem.command = {
            command: "C_Cpp.RescanWorkspace",
            title: this.workspaceRescanText,
            arguments: commandArguments
        };
        this.workspaceParsingStatus = this.workspaceParsingRunningText;

        this.codeAnalysisStatusItem = vscode.languages.createLanguageStatusItem(`cpptools.status.${LanguageStatusPriority.Low}.codeanalysis`, util.documentSelector);
        this.codeAnalysisStatusItem.name = localize("cpptools.status.codeanalysis", "C/C++ Code Analysis Status");
        this.codeAnalysisStatusItem.text = this.codeAnalysisModePrefix + this.codeAnalysisCurrentMode();
        this.codeAnalysisStatusItem.command = {
            command: "C_Cpp.ShowIdleCodeAnalysisCommands",
            title: localize("c.cpp.codeanalysis.statusbar.runNow", "Run Now"),
            arguments: commandArguments
        };

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

    private set ActiveConfig(label: string) {
        this.configStatusBarItem.text = label;
    }

    private dbTimeout?: NodeJS.Timeout;
    private setIsParsingWorkspace(val: boolean): void {
        this.isParsingWorkspace = val;
        const showIcon: boolean = val || this.isParsingFiles;

        // Leave this outside for more real-time response
        this.browseEngineStatusItem.busy = showIcon;

        if (showIcon) {
            this.browseEngineStatusItem.text = "$(database)";
            this.browseEngineStatusItem.detail = this.tagParseText();

            if (this.dbTimeout) {
                clearTimeout(this.dbTimeout);
                this.dbTimeout = undefined;
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
                title: localize("tagparser.pause.text", "Pause"),
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

    private set ShowConfiguration(show: boolean) {
        if (show) {
            this.configStatusBarItem.show();
        } else {
            this.configStatusBarItem.hide();
        }
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

        // Leave this outside for more real-time response
        this.browseEngineStatusItem.busy = val || (!this.isParsingWorkspacePaused && this.isParsingWorkspace);

        if (showIcon) {
            this.browseEngineStatusItem.text = "$(database)";
            this.browseEngineStatusItem.detail = this.tagParseText();

            if (this.dbTimeout) {
                clearTimeout(this.dbTimeout);
                this.dbTimeout = undefined;
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

        // TODO: Integrate with Tarik's feature to determine if compiler/bare-IntelliSense is configured
        if (settings.intelliSenseEngine === "disabled") {
            this.intelliSenseStatusItem.text = this.missingIntelliSenseText;
            this.intelliSenseStatusItem.command = {
                command: "C_Cpp.SelectDefaultCompiler",
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
            this.flameTimeout = undefined;
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
            ? localize("mode.codeanalysis.status.automatic", "Automatic")
            : localize("mode.codeanalysis.status.manual", "Manual");
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
        this.codeAnalysProgress = localize("running.analysis.processed.tooltip", "Running: {0} / {1} ({2}%)",
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

    private showConfigureIntelliSenseButton: boolean = false;
    private configureIntelliSenseTimeout?: NodeJS.Timeout;

    public async ShowConfigureIntelliSenseButton(show: boolean, client?: Client): Promise<void> {
        if (!await telemetry.showStatusBarIntelliSenseButton() || client !== this.currentClient) {
            return;
        }
        this.showConfigureIntelliSenseButton = show;
        if (client) {
            client.setShowConfigureIntelliSenseButton(show);
        }
        if (show) {
            const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
            telemetry.logLanguageServerEvent('configureIntelliSenseStatusBar');
            if (activeEditor && util.isCppOrRelated(activeEditor.document)) {
                this.configureIntelliSenseStatusItem.show();
                if (!this.configureIntelliSenseTimeout) {
                    this.configureIntelliSenseTimeout = setTimeout(() => {
                        this.configureIntelliSenseStatusItem.text = "$(warning)";
                    }, 15000);
                }
            }
        } else {
            this.configureIntelliSenseStatusItem.hide();
            if (this.configureIntelliSenseTimeout) {
                clearTimeout(this.configureIntelliSenseTimeout);
                this.configureIntelliSenseStatusItem.text = `$(warning) ${this.configureIntelliSenseText}`;
                this.configureIntelliSenseTimeout = undefined;
            }
        }
    }

    public activeDocumentChanged(): void {
        const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!activeEditor) {
            this.ShowConfiguration = false;
            if (this.showConfigureIntelliSenseButton) {
                this.configureIntelliSenseStatusItem.hide();
            }
        } else {
            const isCppPropertiesJson: boolean = util.isCppPropertiesJson(activeEditor.document);
            if (isCppPropertiesJson) {
                vscode.languages.setTextDocumentLanguage(activeEditor.document, "jsonc");
            }
            const isCppOrRelated: boolean = isCppPropertiesJson || util.isCppOrRelated(activeEditor.document);

            // It's sometimes desirable to see the config and icons when making changes to files with C/C++-related content.
            // TODO: Check some "AlwaysShow" setting here.
            this.ShowConfiguration = isCppOrRelated || (util.getWorkspaceIsCpp() &&
                (activeEditor.document.fileName.endsWith("tasks.json") ||
                    activeEditor.document.fileName.endsWith("launch.json")));

            if (this.showConfigureIntelliSenseButton) {
                if (isCppOrRelated && !!this.currentClient && this.currentClient.getShowConfigureIntelliSenseButton()) {
                    this.configureIntelliSenseStatusItem.show();
                    if (!this.configureIntelliSenseTimeout) {
                        this.configureIntelliSenseTimeout = setTimeout(() => {
                            this.configureIntelliSenseStatusItem.text = "$(warning)";
                        }, 15000);
                    }
                } else {
                    this.configureIntelliSenseStatusItem.hide();
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
        client.ActiveConfigChanged(value => {
            this.ActiveConfig = value;
            this.currentClient = client;
            this.ShowConfigureIntelliSenseButton(client.getShowConfigureIntelliSenseButton(), client);
        });
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

        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
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
            items.push({ label: paths[i], description: "", index: i });
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
    private readonly selectACodeAnalysisCommandString: string = localize("select.code.analysis.command", "Select a code analysis command...");

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
        options.placeHolder = this.selectACodeAnalysisCommandString;

        const items: IndexableQuickPickItem[] = [];
        items.push({ label: localize("cancel.analysis", "Cancel"), description: "", index: 0 });

        if (this.isCodeAnalysisPaused) {
            items.push({ label: localize("resume.analysis", "Resume"), description: "", index: 2 });
        } else {
            items.push({ label: localize("pause.analysis", "Pause"), description: "", index: 1 });
        }
        items.push({ label: localize("another.analysis", "Start Another..."), description: "", index: 3 });
        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return (selection) ? selection.index : -1;
    }

    public async showIdleCodeAnalysisCommands(): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = this.selectACommandString;

        const items: IndexableQuickPickItem[] = [];
        items.push({ label: localize("active.analysis", "Run Code Analysis on Active File"), description: "", index: 0 });
        items.push({ label: localize("all.analysis", "Run Code Analysis on All Files"), description: "", index: 1 });
        items.push({ label: localize("open.analysis", "Run Code Analysis on Open Files"), description: "", index: 2 });
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
        this.browseEngineStatusItem.dispose();
        this.intelliSenseStatusItem.dispose();
        this.referencesStatusBarItem.dispose();
        this.codeAnalysisStatusItem.dispose();
    }
}

