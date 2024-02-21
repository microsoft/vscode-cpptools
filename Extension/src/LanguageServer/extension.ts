/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as fs from 'fs';
// Node.js 18 fetch isn't available until VS 1.82.
import fetch from 'node-fetch';
import * as StreamZip from 'node-stream-zip';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Range } from 'vscode-languageclient';
import * as nls from 'vscode-nls';
import { TargetPopulation } from 'vscode-tas-client';
import * as which from 'which';
import { logAndReturn } from '../Utility/Async/returns';
import * as util from '../common';
import { PlatformInformation } from '../platform';
import * as telemetry from '../telemetry';
import { Client, DefaultClient, DoxygenCodeActionCommandArguments, openFileVersions } from './client';
import { ClientCollection } from './clientCollection';
import { CodeActionDiagnosticInfo, CodeAnalysisDiagnosticIdentifiersAndUri, codeAnalysisAllFixes, codeAnalysisCodeToFixes, codeAnalysisFileToCodeActions } from './codeAnalysis';
import { CppBuildTaskProvider } from './cppBuildTaskProvider';
import { getCustomConfigProviders } from './customProviders';
import { getLanguageConfig } from './languageConfig';
import { PersistentState } from './persistentState';
import { NodeType, TreeNode } from './referencesModel';
import { CppSettings } from './settings';
import { LanguageStatusUI, getUI } from './ui';
import { makeLspRange, rangeEquals, showInstallCompilerWalkthrough } from './utils';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
export const CppSourceStr: string = "C/C++";
export const configPrefix: string = "C/C++: ";

let prevCrashFile: string;
export let clients: ClientCollection;
let activeDocument: vscode.TextDocument | undefined;
let ui: LanguageStatusUI;
const disposables: vscode.Disposable[] = [];
const commandDisposables: vscode.Disposable[] = [];
let languageConfigurations: vscode.Disposable[] = [];
let intervalTimer: NodeJS.Timeout;
let codeActionProvider: vscode.Disposable;
export const intelliSenseDisabledError: string = "Do not activate the extension when IntelliSense is disabled.";

type VcpkgDatabase = Record<string, string[]>; // Stored as <header file entry> -> [<port name>]
let vcpkgDbPromise: Promise<VcpkgDatabase>;
async function initVcpkgDatabase(): Promise<VcpkgDatabase> {
    const database: VcpkgDatabase = {};
    try {
        const zip = new StreamZip.async({ file: util.getExtensionFilePath('VCPkgHeadersDatabase.zip') });
        try {
            const data = await zip.entryData('VCPkgHeadersDatabase.txt');
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                const portFilePair: string[] = line.split(':');
                if (portFilePair.length !== 2) {
                    return;
                }

                const portName: string = portFilePair[0];
                const relativeHeader: string = portFilePair[1];

                if (!database[relativeHeader]) {
                    database[relativeHeader] = [];
                }

                database[relativeHeader].push(portName);
            });
        } catch {
            console.log("Unable to parse vcpkg database file.");
        }
        await zip.close();
    } catch {
        console.log("Unable to open vcpkg database file.");
    }
    return database;
}

function getVcpkgHelpAction(): vscode.CodeAction {
    const dummy: any[] = [{}]; // To distinguish between entry from CodeActions and the command palette
    return {
        command: { title: 'vcpkgOnlineHelpSuggested', command: 'C_Cpp.VcpkgOnlineHelpSuggested', arguments: dummy },
        title: localize("learn.how.to.install.a.library", "Learn how to install a library for this header with vcpkg"),
        kind: vscode.CodeActionKind.QuickFix
    };
}

function getVcpkgClipboardInstallAction(port: string): vscode.CodeAction {
    return {
        command: { title: 'vcpkgClipboardInstallSuggested', command: 'C_Cpp.VcpkgClipboardInstallSuggested', arguments: [[port]] },
        title: localize("copy.vcpkg.command", "Copy vcpkg command to install '{0}' to the clipboard", port),
        kind: vscode.CodeActionKind.QuickFix
    };
}

async function lookupIncludeInVcpkg(document: vscode.TextDocument, line: number): Promise<string[]> {
    const matches: RegExpMatchArray | null = document.lineAt(line).text.match(/#include\s*[<"](?<includeFile>[^>"]*)[>"]/);
    if (!matches || !matches.length || !matches.groups) {
        return [];
    }
    const missingHeader: string = matches.groups.includeFile.replace(/\//g, '\\');

    let portsWithHeader: string[] | undefined;
    const vcpkgDb: VcpkgDatabase = await vcpkgDbPromise;
    if (vcpkgDb) {
        portsWithHeader = vcpkgDb[missingHeader];
    }
    return portsWithHeader ? portsWithHeader : [];
}

function isMissingIncludeDiagnostic(diagnostic: vscode.Diagnostic): boolean {
    const missingIncludeCode: number = 1696;
    if (diagnostic.code === null || diagnostic.code === undefined || !diagnostic.source) {
        return false;
    }
    return diagnostic.code === missingIncludeCode && diagnostic.source === 'C/C++';
}

function sendActivationTelemetry(): void {
    const activateEvent: Record<string, string> = {};
    // Don't log telemetry for machineId if it's a special value used by the dev host: someValue.machineid
    if (vscode.env.machineId !== "someValue.machineId") {
        const machineIdPersistentState: PersistentState<string | undefined> = new PersistentState<string | undefined>("CPP.machineId", undefined);
        if (!machineIdPersistentState.Value) {
            activateEvent.newMachineId = vscode.env.machineId;
        } else if (machineIdPersistentState.Value !== vscode.env.machineId) {
            activateEvent.newMachineId = vscode.env.machineId;
            activateEvent.oldMachineId = machineIdPersistentState.Value;
        }
        machineIdPersistentState.Value = vscode.env.machineId;
    }
    if (vscode.env.uiKind === vscode.UIKind.Web) {
        activateEvent.WebUI = "1";
    }
    telemetry.logLanguageServerEvent("Activate", activateEvent);
}

/**
 * activate: set up the extension for language services
 */
export async function activate(): Promise<void> {

    sendActivationTelemetry();
    const checkForConflictingExtensions: PersistentState<boolean> = new PersistentState<boolean>("CPP." + util.packageJson.version + ".checkForConflictingExtensions", true);
    if (checkForConflictingExtensions.Value) {
        checkForConflictingExtensions.Value = false;
        const clangCommandAdapterActive: boolean = vscode.extensions.all.some((extension: vscode.Extension<any>): boolean =>
            extension.isActive && extension.id === "mitaki28.vscode-clang");
        if (clangCommandAdapterActive) {
            telemetry.logLanguageServerEvent("conflictingExtension");
        }
    }

    clients = new ClientCollection();
    ui = getUI();

    // There may have already been registered CustomConfigurationProviders.
    // Request for configurations from those providers.
    clients.forEach(client => {
        getCustomConfigProviders().forEach(provider => void client.onRegisterCustomConfigurationProvider(provider));
    });

    disposables.push(vscode.workspace.onDidChangeConfiguration(onDidChangeSettings));
    disposables.push(vscode.window.onDidChangeTextEditorVisibleRanges((e) => clients.ActiveClient.enqueue(async () => onDidChangeTextEditorVisibleRanges(e))));
    disposables.push(vscode.window.onDidChangeActiveTextEditor((e) => clients.ActiveClient.enqueue(async () => onDidChangeActiveTextEditor(e))));
    ui.didChangeActiveEditor(); // Handle already active documents (for non-cpp files that we don't register didOpen).
    disposables.push(vscode.window.onDidChangeTextEditorSelection((e) => clients.ActiveClient.enqueue(async () => onDidChangeTextEditorSelection(e))));
    disposables.push(vscode.window.onDidChangeVisibleTextEditors((e) => clients.ActiveClient.enqueue(async () => onDidChangeVisibleTextEditors(e))));

    updateLanguageConfigurations();

    reportMacCrashes();

    vcpkgDbPromise = initVcpkgDatabase();

    void clients.ActiveClient.ready.then(() => intervalTimer = global.setInterval(onInterval, 2500));

    registerCommands(true);

    vscode.tasks.onDidStartTask(() => getActiveClient().PauseCodeAnalysis());

    vscode.tasks.onDidEndTask(event => {
        getActiveClient().ResumeCodeAnalysis();
        if (event.execution.task.definition.type === CppBuildTaskProvider.CppBuildScriptType
            || event.execution.task.name.startsWith(configPrefix)) {
            if (event.execution.task.scope !== vscode.TaskScope.Global && event.execution.task.scope !== vscode.TaskScope.Workspace) {
                const folder: vscode.WorkspaceFolder | undefined = event.execution.task.scope;
                if (folder) {
                    const settings: CppSettings = new CppSettings(folder.uri);
                    if (settings.codeAnalysisRunOnBuild && settings.clangTidyEnabled) {
                        void clients.getClientFor(folder.uri).handleRunCodeAnalysisOnAllFiles().catch(logAndReturn.undefined);
                    }
                    return;
                }
            }
            const settings: CppSettings = new CppSettings();
            if (settings.codeAnalysisRunOnBuild && settings.clangTidyEnabled) {
                void clients.ActiveClient.handleRunCodeAnalysisOnAllFiles().catch(logAndReturn.undefined);
            }
        }
    });

    const selector: vscode.DocumentSelector = [
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'cpp' },
        { scheme: 'file', language: 'cuda-cpp' }
    ];
    codeActionProvider = vscode.languages.registerCodeActionsProvider(selector, {
        provideCodeActions: async (document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext): Promise<vscode.CodeAction[]> => {

            if (!await clients.ActiveClient.getVcpkgEnabled()) {
                return [];
            }

            // Generate vcpkg install/help commands if the incoming doc/range is a missing include error
            if (!context.diagnostics.some(isMissingIncludeDiagnostic)) {
                return [];
            }

            const ports: string[] = await lookupIncludeInVcpkg(document, range.start.line);
            if (ports.length <= 0) {
                return [];
            }

            telemetry.logLanguageServerEvent('codeActionsProvided', { "source": "vcpkg" });

            if (!await clients.ActiveClient.getVcpkgInstalled()) {
                return [getVcpkgHelpAction()];
            }

            const actions: vscode.CodeAction[] = ports.map<vscode.CodeAction>(getVcpkgClipboardInstallAction);
            return actions;
        }
    });

    await vscode.commands.executeCommand('setContext', 'cpptools.msvcEnvironmentFound', util.hasMsvcEnvironment());

    // Log cold start.
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (activeEditor) {
        clients.timeTelemetryCollector.setFirstFile(activeEditor.document.uri);
        activeDocument = activeEditor.document;
    }
}

export function updateLanguageConfigurations(): void {
    languageConfigurations.forEach(d => d.dispose());
    languageConfigurations = [];

    languageConfigurations.push(vscode.languages.setLanguageConfiguration('c', getLanguageConfig('c')));
    languageConfigurations.push(vscode.languages.setLanguageConfiguration('cpp', getLanguageConfig('cpp')));
    languageConfigurations.push(vscode.languages.setLanguageConfiguration('cuda-cpp', getLanguageConfig('cuda-cpp')));
}

/**
 * workspace events
 */
async function onDidChangeSettings(event: vscode.ConfigurationChangeEvent): Promise<void> {
    const client: Client = clients.getDefaultClient();
    if (client instanceof DefaultClient) {
        const defaultClient: DefaultClient = client as DefaultClient;
        const changedDefaultClientSettings: Record<string, string> = await defaultClient.onDidChangeSettings(event);
        clients.forEach(client => {
            if (client !== defaultClient) {
                void client.onDidChangeSettings(event).catch(logAndReturn.undefined);
            }
        });
        const newUpdateChannel: string = changedDefaultClientSettings.updateChannel;
        if (newUpdateChannel || event.affectsConfiguration("extensions.autoUpdate")) {
            UpdateInsidersAccess();
        }
    }
}

let noActiveEditorTimeout: NodeJS.Timeout | undefined;

async function onDidChangeTextEditorVisibleRanges(event: vscode.TextEditorVisibleRangesChangeEvent): Promise<void> {
    if (util.isCpp(event.textEditor.document)) {
        await clients.getDefaultClient().onDidChangeTextEditorVisibleRanges(event.textEditor.document.uri);
    }
}

function onDidChangeActiveTextEditor(editor?: vscode.TextEditor): void {
    /* need to notify the affected client(s) */
    console.assert(clients !== undefined, "client should be available before active editor is changed");
    if (clients === undefined) {
        return;
    }

    if (noActiveEditorTimeout) {
        clearTimeout(noActiveEditorTimeout);
        noActiveEditorTimeout = undefined;
    }
    if (!editor) {
        // When switching between documents, VS Code is setting the active editor to undefined
        // temporarily, so this prevents the C++-related status bar items from flickering off/on.
        noActiveEditorTimeout = setTimeout(() => {
            activeDocument = undefined;
            ui.didChangeActiveEditor();
            noActiveEditorTimeout = undefined;
        }, 100);
        void clients.didChangeActiveEditor(undefined).catch(logAndReturn.undefined);
    } else {
        ui.didChangeActiveEditor();
        if (util.isCppOrRelated(editor.document)) {
            if (util.isCpp(editor.document)) {
                activeDocument = editor.document;
                void clients.didChangeActiveEditor(editor).catch(logAndReturn.undefined);
            } else {
                activeDocument = undefined;
                void clients.didChangeActiveEditor(undefined).catch(logAndReturn.undefined);
            }
            //clients.ActiveClient.selectionChanged(makeLspRange(editor.selection));
        } else {
            activeDocument = undefined;
        }
    }
}

function onDidChangeTextEditorSelection(event: vscode.TextEditorSelectionChangeEvent): void {
    if (!util.isCpp(event.textEditor.document)) {
        return;
    }
    clients.ActiveClient.selectionChanged(makeLspRange(event.selections[0]));
}

async function onDidChangeVisibleTextEditors(editors: readonly vscode.TextEditor[]): Promise<void> {
    const cppEditors: vscode.TextEditor[] = editors.filter(e => util.isCpp(e.document));
    await clients.getDefaultClient().onDidChangeVisibleTextEditors(cppEditors);
}

function onInterval(): void {
    // TODO: do we need to pump messages to all clients? depends on what we do with the icons, I suppose.
    clients.ActiveClient.onInterval();
}

/**
 * registered commands
 */
export function registerCommands(enabled: boolean): void {
    commandDisposables.forEach(d => d.dispose());
    commandDisposables.length = 0;
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.SwitchHeaderSource', enabled ? onSwitchHeaderSource : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ResetDatabase', enabled ? onResetDatabase : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.SelectIntelliSenseConfiguration', enabled ? selectIntelliSenseConfiguration : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.InstallCompiler', enabled ? installCompiler : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationSelect', enabled ? onSelectConfiguration : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationProviderSelect', enabled ? onSelectConfigurationProvider : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEditJSON', enabled ? onEditConfigurationJSON : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEditUI', enabled ? onEditConfigurationUI : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEdit', enabled ? onEditConfiguration : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.AddToIncludePath', enabled ? onAddToIncludePath : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.EnableErrorSquiggles', enabled ? onEnableSquiggles : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.DisableErrorSquiggles', enabled ? onDisableSquiggles : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ToggleIncludeFallback', enabled ? onToggleIncludeFallback : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ToggleDimInactiveRegions', enabled ? onToggleDimInactiveRegions : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.PauseParsing', enabled ? onPauseParsing : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ResumeParsing', enabled ? onResumeParsing : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.PauseCodeAnalysis', enabled ? onPauseCodeAnalysis : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ResumeCodeAnalysis', enabled ? onResumeCodeAnalysis : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.CancelCodeAnalysis', enabled ? onCancelCodeAnalysis : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ShowActiveCodeAnalysisCommands', enabled ? onShowActiveCodeAnalysisCommands : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ShowIdleCodeAnalysisCommands', enabled ? onShowIdleCodeAnalysisCommands : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ShowReferencesProgress', enabled ? onShowReferencesProgress : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.TakeSurvey', enabled ? onTakeSurvey : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.LogDiagnostics', enabled ? onLogDiagnostics : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.RescanWorkspace', enabled ? onRescanWorkspace : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ShowReferenceItem', enabled ? onShowRefCommand : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.referencesViewGroupByType', enabled ? onToggleRefGroupView : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.referencesViewUngroupByType', enabled ? onToggleRefGroupView : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.VcpkgClipboardInstallSuggested', enabled ? onVcpkgClipboardInstallSuggested : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.VcpkgOnlineHelpSuggested', enabled ? onVcpkgOnlineHelpSuggested : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.GenerateEditorConfig', enabled ? onGenerateEditorConfig : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.GoToNextDirectiveInGroup', enabled ? onGoToNextDirectiveInGroup : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.GoToPrevDirectiveInGroup', enabled ? onGoToPrevDirectiveInGroup : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.RunCodeAnalysisOnActiveFile', enabled ? onRunCodeAnalysisOnActiveFile : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.RunCodeAnalysisOnOpenFiles', enabled ? onRunCodeAnalysisOnOpenFiles : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.RunCodeAnalysisOnAllFiles', enabled ? onRunCodeAnalysisOnAllFiles : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.RemoveCodeAnalysisProblems', enabled ? onRemoveCodeAnalysisProblems : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.RemoveAllCodeAnalysisProblems', enabled ? onRemoveAllCodeAnalysisProblems : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.FixThisCodeAnalysisProblem', enabled ? onFixThisCodeAnalysisProblem : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.FixAllTypeCodeAnalysisProblems', enabled ? onFixAllTypeCodeAnalysisProblems : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.FixAllCodeAnalysisProblems', enabled ? onFixAllCodeAnalysisProblems : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.DisableAllTypeCodeAnalysisProblems', enabled ? onDisableAllTypeCodeAnalysisProblems : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ShowCodeAnalysisDocumentation', enabled ? (uri) => vscode.env.openExternal(uri) : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('cpptools.activeConfigName', enabled ? onGetActiveConfigName : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('cpptools.activeConfigCustomVariable', enabled ? onGetActiveConfigCustomVariable : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('cpptools.setActiveConfigName', enabled ? onSetActiveConfigName : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.RestartIntelliSenseForFile', enabled ? onRestartIntelliSenseForFile : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.GenerateDoxygenComment', enabled ? onGenerateDoxygenComment : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.CreateDeclarationOrDefinition', enabled ? onCreateDeclarationOrDefinition : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.CopyDeclarationOrDefinition', enabled ? onCopyDeclarationOrDefinition : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.RescanCompilers', enabled ? onRescanCompilers : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.AddMissingInclude', enabled ? onAddMissingInclude : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ExtractToFunction', enabled ? () => onExtractToFunction(false, false) : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ExtractToFreeFunction', enabled ? () => onExtractToFunction(true, false) : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ExtractToMemberFunction', enabled ? () => onExtractToFunction(false, true) : onDisabledCommand));
    commandDisposables.push(vscode.commands.registerCommand('C_Cpp.ExpandSelection', enabled ? (r: Range) => onExpandSelection(r) : onDisabledCommand));
}

function onDisabledCommand() {
    const message: string = localize(
        {
            key: "on.disabled.command",
            comment: [
                "Markdown text between `` should not be translated or localized (they represent literal text) and the capitalization, spacing, and punctuation (including the ``) should not be altered."
            ]
        },
        "IntelliSense-related commands cannot be executed when `C_Cpp.intelliSenseEngine` is set to `disabled`.");
    return vscode.window.showWarningMessage(message);
}

async function onRestartIntelliSenseForFile() {
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!activeEditor || !util.isCpp(activeEditor.document)) {
        return;
    }
    return clients.ActiveClient.restartIntelliSenseForFile(activeEditor.document);
}

async function onSwitchHeaderSource(): Promise<void> {
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!activeEditor || !util.isCpp(activeEditor.document)) {
        return;
    }

    let rootUri: vscode.Uri | undefined = clients.ActiveClient.RootUri;
    const fileName: string = activeEditor.document.fileName;

    if (!rootUri) {
        rootUri = vscode.Uri.file(path.dirname(fileName)); // When switching without a folder open.
    }

    let targetFileName: string = await clients.ActiveClient.requestSwitchHeaderSource(rootUri, fileName);
    // If the targetFileName has a path that is a symlink target of a workspace folder,
    // then replace the RootRealPath with the RootPath (the symlink path).
    let targetFileNameReplaced: boolean = false;
    clients.forEach(client => {
        if (!targetFileNameReplaced && client.RootRealPath && client.RootPath !== client.RootRealPath
            && targetFileName.startsWith(client.RootRealPath)) {
            targetFileName = client.RootPath + targetFileName.substring(client.RootRealPath.length);
            targetFileNameReplaced = true;
        }
    });
    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(targetFileName);
    const workbenchConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("workbench");
    let foundEditor: boolean = false;
    if (workbenchConfig.get("editor.revealIfOpen")) {
        // If the document is already visible in another column, open it there.
        vscode.window.visibleTextEditors.forEach(editor => {
            if (editor.document === document && !foundEditor) {
                foundEditor = true;
                void vscode.window.showTextDocument(document, editor.viewColumn).then(undefined, logAndReturn.undefined);
            }
        });
    }

    if (!foundEditor) {
        void vscode.window.showTextDocument(document).then(undefined, logAndReturn.undefined);
    }
}

/**
 * Allow the user to select a workspace when multiple workspaces exist and get the corresponding Client back.
 * The resulting client is used to handle some command that was previously invoked.
 */
async function selectClient(): Promise<Client> {
    if (clients.Count === 1) {
        return clients.ActiveClient;
    } else {
        const key: string | undefined = await ui.showWorkspaces(clients.Names);
        if (key !== undefined && key !== "") {
            const client: Client | undefined = clients.get(key);
            if (client) {
                return client;
            } else {
                console.assert("client not found");
            }
        }
        throw new Error(localize("client.not.found", "client not found"));
    }
}

async function onResetDatabase(): Promise<void> {
    await clients.ActiveClient.ready;
    clients.ActiveClient.resetDatabase();
}

async function onRescanCompilers(sender?: any): Promise<void> {
    await clients.ActiveClient.ready;
    return clients.ActiveClient.rescanCompilers(sender);
}

async function onAddMissingInclude(): Promise<void> {
    telemetry.logLanguageServerEvent('AddMissingInclude');
}

async function selectIntelliSenseConfiguration(sender?: any): Promise<void> {
    await clients.ActiveClient.ready;
    return clients.ActiveClient.promptSelectIntelliSenseConfiguration(sender);
}

async function installCompiler(sender?: any): Promise<void> {
    const telemetryProperties = { sender: util.getSenderType(sender), platform: os.platform(), ranCommand: 'false' };
    const ok = localize('ok', 'OK');
    switch (os.platform()) {
        case "win32":
            showInstallCompilerWalkthrough();
            break;
        case "darwin": {
            const title = localize('install.compiler.mac.title', 'The clang compiler will now be installed');
            const detail = localize('install.compiler.mac.detail', 'You may be prompted to type your password in the VS Code terminal window to authorize the installation.');
            const response = await vscode.window.showInformationMessage(title, { modal: true, detail }, ok);
            if (response === ok) {
                const terminal = vscode.window.createTerminal('Install C++ Compiler');
                terminal.sendText('sudo xcode-select --install');
                terminal.show();
                telemetryProperties.ranCommand = 'true';
            }
            break;
        }
        default: {
            const info = await PlatformInformation.GetPlatformInformation();
            const installCommand = (() => {
                switch (info.distribution?.name) {
                    case 'ubuntu':
                    case 'linuxmint':
                    case 'debian': {
                        return 'sudo sh -c \'apt update ; apt install -y build-essential\'';
                    }
                    case 'centos':
                    case 'fedora':
                    case 'rhel': {
                        return 'sudo sh -c \'yum install -y gcc-c++ gdb\'';
                    }
                    case 'opensuse':
                    case 'opensuse-leap':
                    case 'opensuse-tumbleweed': {
                        return 'sudo sh -c \'zypper refresh ; zypper install gcc-c++ gdb\'';
                    }
                }
                return undefined;
            })();
            if (installCommand) {
                const title = localize('install.compiler.linux.title', 'The gcc compiler will now be installed');
                const detail = localize('install.compiler.linux.detail', 'You may be prompted to type your password in the VS Code terminal window to authorize the installation.');
                const response = await vscode.window.showInformationMessage(title, { modal: true, detail }, ok);
                if (response === ok) {
                    const terminal = vscode.window.createTerminal('Install C++ Compiler');
                    terminal.sendText(installCommand);
                    terminal.show(true);
                    telemetryProperties.ranCommand = 'true';
                }
            }
        }
    }
    telemetry.logLanguageServerEvent('installCompiler', telemetryProperties);
}

async function onSelectConfiguration(): Promise<void> {
    if (!isFolderOpen()) {
        void vscode.window.showInformationMessage(localize("configuration.select.first", 'Open a folder first to select a configuration.'));
    } else {
        // This only applies to the active client. You cannot change the configuration for
        // a client that is not active since that client's UI will not be visible.
        return clients.ActiveClient.handleConfigurationSelectCommand();
    }
}

function onSelectConfigurationProvider(): void {
    if (!isFolderOpen()) {
        void vscode.window.showInformationMessage(localize("configuration.provider.select.first", 'Open a folder first to select a configuration provider.'));
    } else {
        void selectClient().then(client => client.handleConfigurationProviderSelectCommand(), logAndReturn.undefined);
    }
}

function onEditConfigurationJSON(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): void {
    telemetry.logLanguageServerEvent("SettingsCommand", { "palette": "json" }, undefined);
    if (!isFolderOpen()) {
        void vscode.window.showInformationMessage(localize('edit.configurations.open.first', 'Open a folder first to edit configurations'));
    } else {
        void selectClient().then(client => client.handleConfigurationEditJSONCommand(viewColumn), logAndReturn.undefined);
    }
}

function onEditConfigurationUI(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): void {
    telemetry.logLanguageServerEvent("SettingsCommand", { "palette": "ui" }, undefined);
    if (!isFolderOpen()) {
        void vscode.window.showInformationMessage(localize('edit.configurations.open.first', 'Open a folder first to edit configurations'));
    } else {
        void selectClient().then(client => client.handleConfigurationEditUICommand(viewColumn), logAndReturn.undefined);
    }
}

function onEditConfiguration(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): void {
    if (!isFolderOpen()) {
        void vscode.window.showInformationMessage(localize('edit.configurations.open.first', 'Open a folder first to edit configurations'));
    } else {
        void selectClient().then(client => client.handleConfigurationEditCommand(viewColumn), logAndReturn.undefined);
    }
}

function onGenerateEditorConfig(): void {
    if (!isFolderOpen()) {
        const settings: CppSettings = new CppSettings();
        void settings.generateEditorConfig();
    } else {
        void selectClient().then(client => {
            const settings: CppSettings = new CppSettings(client.RootUri);
            void settings.generateEditorConfig();
        }).catch(logAndReturn.undefined);
    }
}

async function onGoToNextDirectiveInGroup(): Promise<void> {
    return getActiveClient().handleGoToDirectiveInGroup(true);
}

async function onGoToPrevDirectiveInGroup(): Promise<void> {
    return getActiveClient().handleGoToDirectiveInGroup(false);
}

async function onRunCodeAnalysisOnActiveFile(): Promise<void> {
    if (activeDocument) {
        await vscode.commands.executeCommand("workbench.action.files.saveAll");
        return getActiveClient().handleRunCodeAnalysisOnActiveFile();
    }
}

async function onRunCodeAnalysisOnOpenFiles(): Promise<void> {
    if (openFileVersions.size > 0) {
        await vscode.commands.executeCommand("workbench.action.files.saveAll");
        return getActiveClient().handleRunCodeAnalysisOnOpenFiles();
    }
}

async function onRunCodeAnalysisOnAllFiles(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.files.saveAll");
    return getActiveClient().handleRunCodeAnalysisOnAllFiles();
}

async function onRemoveAllCodeAnalysisProblems(): Promise<void> {
    return getActiveClient().handleRemoveAllCodeAnalysisProblems();
}

async function onRemoveCodeAnalysisProblems(refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> {
    return getActiveClient().handleRemoveCodeAnalysisProblems(refreshSquigglesOnSave, identifiersAndUris);
}

// Needed due to https://github.com/microsoft/vscode/issues/148723 .
const codeActionAbortedString: string = localize('code.action.aborted', "The code analysis fix could not be applied because the document has changed.");

async function onFixThisCodeAnalysisProblem(version: number, workspaceEdit: vscode.WorkspaceEdit, refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> {
    if (identifiersAndUris.length < 1) {
        return;
    }
    const codeActions: CodeActionDiagnosticInfo[] | undefined = codeAnalysisFileToCodeActions.get(identifiersAndUris[0].uri);
    if (codeActions === undefined) {
        return;
    }
    for (const codeAction of codeActions) {
        if (codeAction.code === identifiersAndUris[0].identifiers[0].code && rangeEquals(codeAction.range, identifiersAndUris[0].identifiers[0].range)) {
            if (version !== codeAction.version) {
                void vscode.window.showErrorMessage(codeActionAbortedString);
                return;
            }
            break;
        }
    }
    return getActiveClient().handleFixCodeAnalysisProblems(workspaceEdit, refreshSquigglesOnSave, identifiersAndUris);
}

async function onFixAllTypeCodeAnalysisProblems(type: string, version: number, workspaceEdit: vscode.WorkspaceEdit, refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> {
    if (version === codeAnalysisCodeToFixes.get(type)?.version) {
        return getActiveClient().handleFixCodeAnalysisProblems(workspaceEdit, refreshSquigglesOnSave, identifiersAndUris);
    }
    void vscode.window.showErrorMessage(codeActionAbortedString);
}

async function onFixAllCodeAnalysisProblems(version: number, workspaceEdit: vscode.WorkspaceEdit, refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> {
    if (version === codeAnalysisAllFixes.version) {
        return getActiveClient().handleFixCodeAnalysisProblems(workspaceEdit, refreshSquigglesOnSave, identifiersAndUris);
    }
    void vscode.window.showErrorMessage(codeActionAbortedString);
}

async function onDisableAllTypeCodeAnalysisProblems(code: string, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> {
    return getActiveClient().handleDisableAllTypeCodeAnalysisProblems(code, identifiersAndUris);
}

async function onCopyDeclarationOrDefinition(args?: any): Promise<void> {
    const sender: any | undefined = util.isString(args?.sender) ? args.sender : args;
    const properties: Record<string, string> = {
        sender: util.getSenderType(sender)
    };
    telemetry.logLanguageServerEvent('CopyDeclDefn', properties);
    return getActiveClient().handleCreateDeclarationOrDefinition(true, args?.range);
}

async function onCreateDeclarationOrDefinition(args?: any): Promise<void> {
    const sender: any | undefined = util.isString(args?.sender) ? args.sender : args;
    const properties: Record<string, string> = {
        sender: util.getSenderType(sender)
    };
    telemetry.logLanguageServerEvent('CreateDeclDefn', properties);
    return getActiveClient().handleCreateDeclarationOrDefinition(false, args?.range);
}

async function onExtractToFunction(extractAsGlobal: boolean, extractAsMemberFunction: boolean): Promise<void> {
    if (extractAsGlobal) {
        telemetry.logLanguageServerEvent('ExtractToFreeFunction');
    } else if (extractAsMemberFunction) {
        telemetry.logLanguageServerEvent('ExtractToMemberFunction');
    } else {
        telemetry.logLanguageServerEvent('ExtractToFunction');
    }
    return getActiveClient().handleExtractToFunction(extractAsGlobal);
}

function onExpandSelection(r: Range) {
    const activeTextEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (activeTextEditor) {
        activeTextEditor.selection = new vscode.Selection(new vscode.Position(r.start.line, r.start.character), new vscode.Position(r.end.line, r.end.character));
        telemetry.logLanguageServerEvent('ExpandSelection');
    }
}

function onAddToIncludePath(path: string): void {
    if (isFolderOpen()) {
        // This only applies to the active client. It would not make sense to add the include path
        // suggestion to a different workspace.
        return clients.ActiveClient.handleAddToIncludePathCommand(path);
    }
}

function onEnableSquiggles(): void {
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.update<string>("errorSquiggles", "enabled");
}

function onDisableSquiggles(): void {
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.update<string>("errorSquiggles", "disabled");
}

function onToggleIncludeFallback(): void {
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.toggleSetting("intelliSenseEngineFallback", "enabled", "disabled");
}

function onToggleDimInactiveRegions(): void {
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.update<boolean>("dimInactiveRegions", !settings.dimInactiveRegions);
}

function onPauseParsing(): void {
    clients.ActiveClient.pauseParsing();
}

function onResumeParsing(): void {
    clients.ActiveClient.resumeParsing();
}

function onPauseCodeAnalysis(): void {
    clients.ActiveClient.PauseCodeAnalysis();
}

function onResumeCodeAnalysis(): void {
    clients.ActiveClient.ResumeCodeAnalysis();
}

function onCancelCodeAnalysis(): void {
    clients.ActiveClient.CancelCodeAnalysis();
}

function onShowActiveCodeAnalysisCommands(): Promise<void> {
    return clients.ActiveClient.handleShowActiveCodeAnalysisCommands();
}

function onShowIdleCodeAnalysisCommands(): Promise<void> {
    return clients.ActiveClient.handleShowIdleCodeAnalysisCommands();
}

function onShowReferencesProgress(): void {
    clients.ActiveClient.handleReferencesIcon();
}

function onToggleRefGroupView(): void {
    // Set context to switch icons
    const client: Client = getActiveClient();
    client.toggleReferenceResultsView();
}

function onTakeSurvey(): void {
    telemetry.logLanguageServerEvent("onTakeSurvey");
    const uri: vscode.Uri = vscode.Uri.parse(`https://www.research.net/r/VBVV6C6?o=${os.platform()}&m=${vscode.env.machineId}`);
    void vscode.commands.executeCommand('vscode.open', uri);
}

function onVcpkgOnlineHelpSuggested(dummy?: any): void {
    telemetry.logLanguageServerEvent('vcpkgAction', { 'source': dummy ? 'CodeAction' : 'CommandPalette', 'action': 'vcpkgOnlineHelpSuggested' });
    const uri: vscode.Uri = vscode.Uri.parse(`https://aka.ms/vcpkg`);
    void vscode.commands.executeCommand('vscode.open', uri);
}

async function onVcpkgClipboardInstallSuggested(ports?: string[]): Promise<void> {
    let source: string;
    if (ports && ports.length) {
        source = 'CodeAction';
    } else {
        source = 'CommandPalette';
        // Glob up all existing diagnostics for missing includes and look them up in the vcpkg database
        const missingIncludeLocations: [vscode.TextDocument, number[]][] = [];
        vscode.languages.getDiagnostics().forEach(uriAndDiagnostics => {
            // Extract textDocument
            const textDocument: vscode.TextDocument | undefined = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === uriAndDiagnostics[0].fsPath);
            if (!textDocument) {
                return;
            }

            // Extract lines numbers for missing include diagnostics
            let lines: number[] = uriAndDiagnostics[1].filter(isMissingIncludeDiagnostic).map<number>(d => d.range.start.line);
            if (!lines.length) {
                return;
            }

            // Filter duplicate lines
            lines = lines.filter((line: number, index: number) => {
                const foundIndex: number = lines.indexOf(line);
                return foundIndex === index;
            });

            missingIncludeLocations.push([textDocument, lines]);
        });
        if (!missingIncludeLocations.length) {
            return;
        }

        // Queue look ups in the vcpkg database for missing ports; filter out duplicate results
        const portsPromises: Promise<string[]>[] = [];
        missingIncludeLocations.forEach(docAndLineNumbers => {
            docAndLineNumbers[1].forEach(line => {
                portsPromises.push(lookupIncludeInVcpkg(docAndLineNumbers[0], line));
            });
        });
        ports = ([] as string[]).concat(...await Promise.all(portsPromises));
        if (!ports.length) {
            return;
        }
        const ports2: string[] = ports;
        ports = ports2.filter((port: string, index: number) => ports2.indexOf(port) === index);
    }

    let installCommand: string = 'vcpkg install';
    ports.forEach(port => installCommand += ` ${port}`);
    telemetry.logLanguageServerEvent('vcpkgAction', { 'source': source, 'action': 'vcpkgClipboardInstallSuggested', 'ports': ports.toString() });

    await vscode.env.clipboard.writeText(installCommand);
}

function onGenerateDoxygenComment(arg: DoxygenCodeActionCommandArguments): Promise<void> {
    return getActiveClient().handleGenerateDoxygenComment(arg);
}

function onSetActiveConfigName(configurationName: string): Thenable<void> {
    return clients.ActiveClient.setCurrentConfigName(configurationName);
}

function onGetActiveConfigName(): Thenable<string | undefined> {
    return clients.ActiveClient.getCurrentConfigName();
}

function onGetActiveConfigCustomVariable(variableName: string): Thenable<string> {
    return clients.ActiveClient.getCurrentConfigCustomVariable(variableName);
}

function onLogDiagnostics(): Promise<void> {
    return clients.ActiveClient.logDiagnostics();
}

function onRescanWorkspace(): Promise<void> {
    return clients.ActiveClient.rescanFolder();
}

function onShowRefCommand(arg?: TreeNode): void {
    if (!arg) {
        return;
    }
    const { node } = arg;
    if (node === NodeType.reference) {
        const { referenceLocation } = arg;
        if (referenceLocation) {
            void vscode.window.showTextDocument(referenceLocation.uri, {
                selection: referenceLocation.range.with({ start: referenceLocation.range.start, end: referenceLocation.range.end })
            }).then(undefined, logAndReturn.undefined);
        }
    } else if (node === NodeType.fileWithPendingRef) {
        const { fileUri } = arg;
        if (fileUri) {
            void vscode.window.showTextDocument(fileUri).then(undefined, logAndReturn.undefined);
        }
    }
}

function reportMacCrashes(): void {
    if (process.platform === "darwin") {
        prevCrashFile = "";
        const home: string = os.homedir();
        const crashFolder: string = path.resolve(home, "Library/Logs/DiagnosticReports");
        fs.stat(crashFolder, (err) => {
            const crashObject: Record<string, string> = {};
            if (err?.code) {
                // If the directory isn't there, we have a problem...
                crashObject["errCode"] = err.code;
                telemetry.logLanguageServerEvent("MacCrash", crashObject);
                return;
            }

            // vscode.workspace.createFileSystemWatcher only works in workspace folders.
            try {
                fs.watch(crashFolder, (event, filename) => {
                    if (event !== "rename") {
                        return;
                    }
                    if (!filename || filename === prevCrashFile) {
                        return;
                    }
                    prevCrashFile = filename;
                    if (!filename.startsWith("cpptools")) {
                        return;
                    }
                    // Wait 5 seconds to allow time for the crash log to finish being written.
                    setTimeout(() => {
                        fs.readFile(path.resolve(crashFolder, filename), 'utf8', (err, data) => {
                            if (err) {
                                // Try again?
                                fs.readFile(path.resolve(crashFolder, filename), 'utf8', handleMacCrashFileRead);
                                return;
                            }
                            handleMacCrashFileRead(err, data);
                        });
                    }, 5000);
                });
            } catch (e) {
                // The file watcher limit is hit (may not be possible on Mac, but just in case).
            }
        });
    }
}

export function watchForCrashes(crashDirectory: string): void {
    if (process.platform !== "win32") {
        prevCrashFile = "";
        fs.stat(crashDirectory, (err) => {
            const crashObject: Record<string, string> = {};
            if (err?.code) {
                // If the directory isn't there, we have a problem...
                crashObject["errCode"] = err.code;
                telemetry.logLanguageServerEvent("CppCrash", crashObject);
                return;
            }

            // vscode.workspace.createFileSystemWatcher only works in workspace folders.
            try {
                fs.watch(crashDirectory, (event, filename) => {
                    if (event !== "rename") {
                        return;
                    }
                    if (!filename || filename === prevCrashFile) {
                        return;
                    }
                    prevCrashFile = filename;
                    if (!filename.startsWith("cpptools")) {
                        return;
                    }
                    // Wait 5 seconds to allow time for the crash log to finish being written.
                    setTimeout(() => {
                        fs.readFile(path.resolve(crashDirectory, filename), 'utf8', (err, data) => {
                            void handleCrashFileRead(crashDirectory, filename, err, data);
                        });
                    }, 5000);
                });
            } catch (e) {
                // The file watcher limit is hit (may not be possible on Mac, but just in case).
            }
        });
    }
}

let previousCrashData: string;
let previousCrashCount: number = 0;

function logCrashTelemetry(data: string, type: string, offsetData?: string): void {
    const crashObject: Record<string, string> = {};
    const crashCountObject: Record<string, number> = {};
    crashObject.CrashingThreadCallStack = data;
    if (offsetData !== undefined) {
        crashObject.CrashingThreadCallStackOffsets = offsetData;
    }
    previousCrashCount = data === previousCrashData ? previousCrashCount + 1 : 0;
    previousCrashData = data;
    crashCountObject.CrashCount = previousCrashCount + 1;
    telemetry.logLanguageServerEvent(type, crashObject, crashCountObject);
}

function logMacCrashTelemetry(data: string): void {
    logCrashTelemetry(data, "MacCrash");
}

function logCppCrashTelemetry(data: string, offsetData?: string): void {
    logCrashTelemetry(data, "CppCrash", offsetData);
}

function handleMacCrashFileRead(err: NodeJS.ErrnoException | undefined | null, data: string): void {
    if (err) {
        return logMacCrashTelemetry("readFile: " + err.code);
    }

    // Extract the crashing process version, because the version might not match
    // if multiple VS Codes are running with different extension versions.
    let binaryVersion: string = "";
    const startVersion: number = data.indexOf("Version:");
    if (startVersion >= 0) {
        data = data.substring(startVersion);
        const binaryVersionMatches: string[] | null = data.match(/^Version:\s*(\d*\.\d*\.\d*\.\d*|\d)/);
        binaryVersion = binaryVersionMatches && binaryVersionMatches.length > 1 ? binaryVersionMatches[1] : "";
    }

    // Extract any message indicating missing dynamically loaded symbols.
    let dynamicLoadError: string = "";
    const dynamicLoadErrorStart: string = "Dyld Error Message:";
    const startDynamicLoadError: number = data.indexOf(dynamicLoadErrorStart);
    if (startDynamicLoadError >= 0) {
        // Scan until the next blank line.
        const dynamicLoadErrorEnd: string = "\n\n";
        const endDynamicLoadError: number = data.indexOf(dynamicLoadErrorEnd, startDynamicLoadError);
        if (endDynamicLoadError >= 0) {
            dynamicLoadError = data.substring(startDynamicLoadError, endDynamicLoadError) + "\n\n";
        }
    }

    // Extract the crashing thread's call stack.
    const crashStart: string = " Crashed:";
    let startCrash: number = data.indexOf(crashStart);
    if (startCrash < 0) {
        return logMacCrashTelemetry(dynamicLoadError + "No crash start");
    }
    startCrash += crashStart.length + 1; // Skip past crashStart.
    let endCrash: number = data.indexOf("Thread ", startCrash);
    if (endCrash < 0) {
        endCrash = data.length - 1; // Not expected, but just in case.
    }
    if (endCrash <= startCrash) {
        return logMacCrashTelemetry(dynamicLoadError + "No crash end");
    }
    data = data.substring(startCrash, endCrash);

    // Get rid of the memory addresses (which breaks being able get a hit count for each crash call stack).
    data = data.replace(/0x................ /g, "");
    data = data.replace(/0x1........ \+ 0/g, "");

    // Get rid of the process names on each line and just add it to the start.
    const processNames: string[] = ["cpptools-srv", "cpptools-wordexp", "cpptools",
        // Since only crash logs that start with "cpptools" are reported, the cases below would only occur
        // if the crash were to happen before the new process had fully started and renamed itself.
        "clang-tidy", "clang-format", "clang", "gcc"];
    let processNameFound: boolean = false;
    for (const processName of processNames) {
        if (data.includes(processName)) {
            data = data.replace(new RegExp(processName + "\\s+", "g"), "");
            data = `${processName}\t${binaryVersion}\n${data}`;
            processNameFound = true;
            break;
        }
    }
    if (!processNameFound) {
        // Not expected, but just in case a new binary gets added.
        // Warning: Don't use ??? because that is checked below.
        data = `cpptools??\t${binaryVersion}\n${data}`;
    }

    // Remove runtime lines because they can be different on different machines.
    const lines: string[] = data.split("\n");
    data = "";
    lines.forEach((line: string) => {
        if (!line.includes(".dylib") && !line.includes("???")) {
            line = line.replace(/^\d+\s+/, ""); // Remove <numbers><spaces> from the start of the line.
            line = line.replace(/std::__1::/g, "std::"); // __1:: is not helpful.
            data += line + "\n";
        }
    });
    data = data.trimRight();

    // Prepend the dynamic load error.
    data = dynamicLoadError + data;

    if (data.length > 8192) { // The API has an 8k limit.
        data = data.substring(0, 8189) + "...";
    }

    logMacCrashTelemetry(data);
}

async function handleCrashFileRead(crashDirectory: string, crashFile: string, err: NodeJS.ErrnoException | undefined | null, data: string): Promise<void> {
    if (err) {
        if (err.code === "ENOENT") {
            return; // ignore known issue
        }
        return logCppCrashTelemetry("readFile: " + err.code);
    }

    const lines: string[] = data.split("\n");
    let addressData: string = ".\n.";
    data = crashFile + "\n";
    const filtPath: string | null = which.sync("c++filt", { nothrow: true });
    const isMac: boolean = process.platform === "darwin";
    const startStr: string = isMac ? " _" : "(";
    const offsetStr: string = isMac ? " + " : "+0x";
    const endOffsetStr: string = isMac ? " " : ")";
    const dotStr: string = "…";
    data += lines[0]; // signal type
    for (let lineNum: number = 2; lineNum < lines.length - 3; ++lineNum) { // skip first/last lines
        if (lineNum > 1) {
            data += "\n";
            addressData += "\n";
        }
        const line: string = lines[lineNum];
        const startPos: number = line.indexOf(startStr);
        if (startPos === -1 || line[startPos + 1] === "+") {
            data += dotStr;
            const startAddressPos: number = line.indexOf("0x");
            const endAddressPos: number = line.indexOf(endOffsetStr, startAddressPos + 2);
            if (startAddressPos === -1 || endAddressPos === -1 || startAddressPos >= endAddressPos) {
                addressData += "Unexpected offset";
            } else {
                addressData += line.substring(startAddressPos, endAddressPos);
            }
            continue;
        }
        const offsetPos: number = line.indexOf(offsetStr, startPos + startStr.length);
        if (offsetPos === -1) {
            data += "Missing offsetStr";
            continue; // unexpected
        }
        const startPos2: number = startPos + 1;
        let funcStr: string = line.substring(startPos2, offsetPos);
        if (filtPath) {
            const ret: util.ProcessReturnType | undefined = await util.spawnChildProcess(filtPath, [funcStr], undefined, true).catch(logAndReturn.undefined);
            if (ret !== undefined) {
                funcStr = ret.output;
                funcStr = funcStr.replace(/std::(?:__1|__cxx11)/g, "std"); // simplify std namespaces.
                funcStr = funcStr.replace(/std::basic_/g, "std::");
                funcStr = funcStr.replace(/ >/g, ">");
                funcStr = funcStr.replace(/, std::(?:allocator|char_traits)<char>/g, "");
                funcStr = funcStr.replace(/<char>/g, "");
                funcStr = funcStr.replace(/, std::allocator<std::string>/g, "");
            }
        }
        data += funcStr + offsetStr;
        const offsetPos2: number = offsetPos + offsetStr.length;
        if (isMac) {
            data += line.substring(offsetPos2);
            const startAddressPos: number = line.indexOf("0x");
            if (startAddressPos === -1 || startAddressPos >= startPos) {
                // unexpected
                data += "<Missing 0x>";
                continue;
            }
            addressData += `${line.substring(startAddressPos, startPos)}`;
        } else {
            const endPos: number = line.indexOf(")", offsetPos2);
            if (endPos === -1) {
                data += "<Missing )>";
                continue; // unexpected
            }
            data += line.substring(offsetPos2, endPos);
        }
    }

    if (data.length > 8192) { // The API has an 8k limit.
        data = data.substring(0, 8191) + "…";
    }

    console.log(`Crash call stack:\n${data}`);
    logCppCrashTelemetry(data, addressData);

    await util.deleteFile(path.resolve(crashDirectory, crashFile)).catch(logAndReturn.undefined);
    void util.deleteDirectory(crashDirectory).catch(logAndReturn.undefined);
}

export function deactivate(): Thenable<void> {
    clients.timeTelemetryCollector.clear();
    telemetry.logLanguageServerEvent("LanguageServerShutdown");
    clearInterval(intervalTimer);
    commandDisposables.forEach(d => d.dispose());
    disposables.forEach(d => d.dispose());
    languageConfigurations.forEach(d => d.dispose());
    ui.dispose();
    if (codeActionProvider) {
        codeActionProvider.dispose();
    }
    return clients.dispose();
}

export function isFolderOpen(): boolean {
    return vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length > 0;
}

export function getClients(): ClientCollection {
    return clients;
}

export function getActiveClient(): Client {
    return clients.ActiveClient;
}

export function UpdateInsidersAccess(): void {
    let installPrerelease: boolean = false;

    // Only move them to the new prerelease mechanism if using updateChannel of Insiders.
    const settings: CppSettings = new CppSettings();
    const migratedInsiders: PersistentState<boolean> = new PersistentState<boolean>("CPP.migratedInsiders", false);
    if (settings.updateChannel === "Insiders") {
        // Don't do anything while the user has autoUpdate disabled, so we do not cause the extension to be updated.
        if (!migratedInsiders.Value && vscode.workspace.getConfiguration("extensions", null).get<boolean>("autoUpdate")) {
            installPrerelease = true;
            migratedInsiders.Value = true;
        }
    } else {
        // Reset persistent value, so we register again if they switch to "Insiders" again.
        if (migratedInsiders.Value) {
            migratedInsiders.Value = false;
        }
    }

    // Mitigate an issue with VS Code not recognizing a programmatically installed VSIX as Prerelease.
    // If using VS Code Insiders, and updateChannel is not explicitly set, default to Prerelease.
    // Only do this once. If the user manually switches to Release, we don't want to switch them back to Prerelease again.
    if (util.isVsCodeInsiders()) {
        const insidersMitigationDone: PersistentState<boolean> = new PersistentState<boolean>("CPP.insidersMitigationDone", false);
        if (!insidersMitigationDone.Value) {
            if (vscode.workspace.getConfiguration("extensions", null).get<boolean>("autoUpdate")) {
                if (settings.getWithUndefinedDefault<string>("updateChannel") === undefined) {
                    installPrerelease = true;
                }
            }
            insidersMitigationDone.Value = true;
        }
    }

    if (installPrerelease) {
        void vscode.commands.executeCommand("workbench.extensions.installExtension", "ms-vscode.cpptools", { installPreReleaseVersion: true }).then(undefined, logAndReturn.undefined);
    }
}

export async function preReleaseCheck(): Promise<void> {
    const displayedPreReleasePrompt: PersistentState<boolean> = new PersistentState<boolean>("CPP.displayedPreReleasePrompt", false);
    const isOnPreRelease: PersistentState<boolean> = new PersistentState<boolean>("CPP.isOnPreRelease", false);

    if (util.getCppToolsTargetPopulation() === TargetPopulation.Insiders) {
        isOnPreRelease.Value = true;
        return;
    }

    // First we need to make sure the user isn't already on a pre-release version and hasn't dismissed this prompt before.
    if (!isOnPreRelease.Value && !displayedPreReleasePrompt.Value && util.getCppToolsTargetPopulation() === TargetPopulation.Public) {
        // Get the info on the latest version from the marketplace to check if there is a pre-release version available.
        const response = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
            method: 'POST',
            headers: {
                Accept: 'application/json; api-version=3.0-preview',
                'Content-Type': 'application/json',
                'User-Agent': 'vscode-cpptools'
            },
            body: '{"filters": [{"criteria": [{"filterType": 7, "value": "ms-vscode.cpptools"}]}], "flags": 529}'
        }).catch(logAndReturn.undefined);

        telemetry.logLanguageServerEvent("marketplaceFetch", undefined, { status: response?.status ?? 0 });

        const data: any = await response?.json().catch(logAndReturn.undefined);

        const preReleaseAvailable = data?.results[0].extensions[0].versions[0].properties.some((e: object) => Object.values(e).includes("Microsoft.VisualStudio.Code.PreRelease"));

        // If the user isn't on the pre-release version, but one is available, prompt them to install it.
        if (preReleaseAvailable) {
            displayedPreReleasePrompt.Value = true;
            const message: string = localize("prerelease.message", "A pre-release version of the C/C++ extension is available. Would you like to switch to it?");
            const yes: string = localize("yes.button", "Yes");
            const no: string = localize("no.button", "No");
            void vscode.window.showInformationMessage(message, yes, no).then((selection) => {
                if (selection === yes) {
                    void vscode.commands.executeCommand("workbench.extensions.installExtension", "ms-vscode.cpptools", { installPreReleaseVersion: true }).then(undefined, logAndReturn.undefined);
                }
            });
        }
    }
}
