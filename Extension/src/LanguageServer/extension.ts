/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as util from '../common';
import * as telemetry from '../telemetry';
import { TreeNode, NodeType } from './referencesModel';
import { UI, getUI } from './ui';
import { Client, openFileVersions } from './client';
import { ClientCollection } from './clientCollection';
import { CppSettings, OtherSettings } from './settings';
import { PersistentState } from './persistentState';
import { getLanguageConfig } from './languageConfig';
import { getCustomConfigProviders } from './customProviders';
import { Range } from 'vscode-languageclient';
import * as rd from 'readline';
import * as yauzl from 'yauzl';
import { Readable } from 'stream';
import * as nls from 'vscode-nls';
import { CppBuildTaskProvider } from './cppBuildTaskProvider';
import { UpdateInsidersAccess } from '../main';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
export const cppBuildTaskProvider: CppBuildTaskProvider = new CppBuildTaskProvider();

let prevCrashFile: string;
let clients: ClientCollection;
let activeDocument: string;
let ui: UI;
const disposables: vscode.Disposable[] = [];
let languageConfigurations: vscode.Disposable[] = [];
let intervalTimer: NodeJS.Timer;
let taskProvider: vscode.Disposable;
let codeActionProvider: vscode.Disposable;
export const intelliSenseDisabledError: string = "Do not activate the extension when IntelliSense is disabled.";

type VcpkgDatabase = { [key: string]: string[] }; // Stored as <header file entry> -> [<port name>]
let vcpkgDbPromise: Promise<VcpkgDatabase>;
function initVcpkgDatabase(): Promise<VcpkgDatabase> {
    return new Promise((resolve, reject) => {
        yauzl.open(util.getExtensionFilePath('VCPkgHeadersDatabase.zip'), { lazyEntries: true }, (err?: Error, zipfile?: yauzl.ZipFile) => {
            // Resolves with an empty database instead of rejecting on failure.
            const database: VcpkgDatabase = {};
            if (err || !zipfile) {
                resolve(database);
                return;
            }
            // Waits until the input file is closed before resolving.
            zipfile.on('close', () => {
                resolve(database);
            });
            zipfile.on('entry', entry => {
                if (entry.fileName !== 'VCPkgHeadersDatabase.txt') {
                    zipfile.readEntry();
                    return;
                }
                zipfile.openReadStream(entry, (err?: Error, stream?: Readable) => {
                    if (err || !stream) {
                        zipfile.close();
                        return;
                    }
                    const reader: rd.ReadLine = rd.createInterface(stream);
                    reader.on('line', (lineText: string) => {
                        const portFilePair: string[] = lineText.split(':');
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
                    reader.on('close', () => {
                        // We found the one file we wanted.
                        // It's OK to close instead of progressing through more files in the zip.
                        zipfile.close();
                    });
                });
            });
            zipfile.readEntry();
        });
    });
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
    const missingHeader: string = matches.groups['includeFile'].replace(/\//g, '\\');

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
    const activateEvent: { [key: string]: string } = {};
    // Don't log telemetry for machineId if it's a special value used by the dev host: someValue.machineid
    if (vscode.env.machineId !== "someValue.machineId") {
        const machineIdPersistentState: PersistentState<string | undefined> = new PersistentState<string | undefined>("CPP.machineId", undefined);
        if (!machineIdPersistentState.Value) {
            activateEvent["newMachineId"] = vscode.env.machineId;
        } else if (machineIdPersistentState.Value !== vscode.env.machineId) {
            activateEvent["newMachineId"] = vscode.env.machineId;
            activateEvent["oldMachineId"] = machineIdPersistentState.Value;
        }
        machineIdPersistentState.Value = vscode.env.machineId;
    }
    if (vscode.env.uiKind === vscode.UIKind.Web) {
        activateEvent["WebUI"] = "1";
    }
    telemetry.logLanguageServerEvent("Activate", activateEvent);
}

/**
 * activate: set up the extension for language services
 */
export async function activate(): Promise<void> {

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        for (let i: number = 0; i < vscode.workspace.workspaceFolders.length; ++i) {
            const config: string = path.join(vscode.workspace.workspaceFolders[i].uri.fsPath, ".vscode/c_cpp_properties.json");
            if (await util.checkFileExists(config)) {
                const doc: vscode.TextDocument = await vscode.workspace.openTextDocument(config);
                vscode.languages.setTextDocumentLanguage(doc, "jsonc");
            }
        }
    }

    taskProvider = vscode.tasks.registerTaskProvider(CppBuildTaskProvider.CppBuildScriptType, cppBuildTaskProvider);

    vscode.tasks.onDidStartTask(event => {
        getActiveClient().PauseCodeAnalysis();
        if (event.execution.task.definition.type === CppBuildTaskProvider.CppBuildScriptType
            || event.execution.task.name.startsWith(CppBuildTaskProvider.CppBuildSourceStr)) {
            telemetry.logLanguageServerEvent('buildTaskStarted');
        }
    });

    vscode.tasks.onDidEndTask(event => {
        getActiveClient().ResumeCodeAnalysis();
        if (event.execution.task.definition.type === CppBuildTaskProvider.CppBuildScriptType
            || event.execution.task.name.startsWith(CppBuildTaskProvider.CppBuildSourceStr)) {
            telemetry.logLanguageServerEvent('buildTaskFinished');
            if (event.execution.task.scope !== vscode.TaskScope.Global && event.execution.task.scope !== vscode.TaskScope.Workspace) {
                const folder: vscode.WorkspaceFolder | undefined = event.execution.task.scope;
                if (folder) {
                    const settings: CppSettings = new CppSettings(folder.uri);
                    if (settings.codeAnalysisRunOnBuild && settings.clangTidyEnabled) {
                        clients.getClientFor(folder.uri).handleRunCodeAnalysisOnAllFiles();
                    }
                    return;
                }
            }
            const settings: CppSettings = new CppSettings();
            if (settings.codeAnalysisRunOnBuild && settings.clangTidyEnabled) {
                clients.ActiveClient.handleRunCodeAnalysisOnAllFiles();
            }
        }
    });

    const selector: vscode.DocumentSelector = [
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'cpp' },
        { scheme: 'file', language: 'cuda-cpp' }
    ];
    codeActionProvider = vscode.languages.registerCodeActionsProvider(selector, {
        provideCodeActions: async (document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): Promise<vscode.CodeAction[]> => {
            if (!await clients.ActiveClient.getVcpkgEnabled()) {
                return [];
            }

            // Generate vcpkg install/help commands if the incoming doc/range is a missing include error
            if (!context.diagnostics.some(isMissingIncludeDiagnostic)) {
                return [];
            }

            telemetry.logLanguageServerEvent('codeActionsProvided', { "source": "vcpkg" });

            if (!await clients.ActiveClient.getVcpkgInstalled()) {
                return [getVcpkgHelpAction()];
            }

            const ports: string[] = await lookupIncludeInVcpkg(document, range.start.line);
            const actions: vscode.CodeAction[] = ports.map<vscode.CodeAction>(getVcpkgClipboardInstallAction);
            return actions;
        }
    });

    if (new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined).intelliSenseEngine === "Disabled") {
        throw new Error(intelliSenseDisabledError);
    } else {
        console.log("activating extension");
        sendActivationTelemetry();
        const checkForConflictingExtensions: PersistentState<boolean> = new PersistentState<boolean>("CPP." + util.packageJson.version + ".checkForConflictingExtensions", true);
        if (checkForConflictingExtensions.Value) {
            checkForConflictingExtensions.Value = false;
            const clangCommandAdapterActive: boolean = vscode.extensions.all.some((extension: vscode.Extension<any>, index: number, array: Readonly<vscode.Extension<any>[]>): boolean =>
                extension.isActive && extension.id === "mitaki28.vscode-clang");
            if (clangCommandAdapterActive) {
                telemetry.logLanguageServerEvent("conflictingExtension");
            }
        }
    }

    console.log("starting language server");
    clients = new ClientCollection();
    ui = getUI();

    // Log cold start.
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (activeEditor) {
        clients.timeTelemetryCollector.setFirstFile(activeEditor.document.uri);
    }

    // There may have already been registered CustomConfigurationProviders.
    // Request for configurations from those providers.
    clients.forEach(client => {
        getCustomConfigProviders().forEach(provider => client.onRegisterCustomConfigurationProvider(provider));
    });

    disposables.push(vscode.workspace.onDidChangeConfiguration(onDidChangeSettings));
    disposables.push(vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor));
    ui.activeDocumentChanged(); // Handle already active documents (for non-cpp files that we don't register didOpen).
    disposables.push(vscode.window.onDidChangeTextEditorSelection(onDidChangeTextEditorSelection));
    disposables.push(vscode.window.onDidChangeVisibleTextEditors(onDidChangeVisibleTextEditors));

    updateLanguageConfigurations();

    reportMacCrashes();

    vcpkgDbPromise = initVcpkgDatabase();

    clients.ActiveClient.notifyWhenLanguageClientReady(() => {
        intervalTimer = global.setInterval(onInterval, 2500);
    });
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
function onDidChangeSettings(event: vscode.ConfigurationChangeEvent): void {
    const activeClient: Client = clients.ActiveClient;
    const changedActiveClientSettings: { [key: string]: string } = activeClient.onDidChangeSettings(event, true);
    clients.forEach(client => {
        if (client !== activeClient) {
            client.onDidChangeSettings(event, false);
        }
    });

    const newUpdateChannel: string = changedActiveClientSettings['updateChannel'];
    if (newUpdateChannel || event.affectsConfiguration("extensions.autoUpdate")) {
        UpdateInsidersAccess();
    }
}

export function onDidChangeActiveTextEditor(editor?: vscode.TextEditor): void {
    /* need to notify the affected client(s) */
    console.assert(clients !== undefined, "client should be available before active editor is changed");
    if (clients === undefined) {
        return;
    }

    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!editor || !activeEditor || activeEditor.document.uri.scheme !== "file" || (activeEditor.document.languageId !== "c" && activeEditor.document.languageId !== "cpp" && activeEditor.document.languageId !== "cuda-cpp")) {
        activeDocument = "";
    } else {
        activeDocument = editor.document.uri.toString();
        clients.activeDocumentChanged(editor.document);
        clients.ActiveClient.selectionChanged(Range.create(editor.selection.start, editor.selection.end));
    }
    ui.activeDocumentChanged();
}

function onDidChangeTextEditorSelection(event: vscode.TextEditorSelectionChangeEvent): void {
    /* need to notify the affected client(s) */
    if (!event.textEditor || !vscode.window.activeTextEditor || event.textEditor.document.uri !== vscode.window.activeTextEditor.document.uri ||
        event.textEditor.document.uri.scheme !== "file" ||
        (event.textEditor.document.languageId !== "cpp" && event.textEditor.document.languageId !== "c")) {
        return;
    }

    if (activeDocument !== event.textEditor.document.uri.toString()) {
        // For some unknown reason we don't reliably get onDidChangeActiveTextEditor callbacks.
        activeDocument = event.textEditor.document.uri.toString();
        clients.activeDocumentChanged(event.textEditor.document);
        ui.activeDocumentChanged();
    }
    clients.ActiveClient.selectionChanged(Range.create(event.selections[0].start, event.selections[0].end));
}

export function processDelayedDidOpen(document: vscode.TextDocument): boolean {
    const client: Client = clients.getClientFor(document.uri);
    if (client) {
        // Log warm start.
        if (clients.checkOwnership(client, document)) {
            if (!client.TrackedDocuments.has(document)) {
                // If not yet tracked, process as a newly opened file.  (didOpen is sent to server in client.takeOwnership()).
                clients.timeTelemetryCollector.setDidOpenTime(document.uri);
                client.TrackedDocuments.add(document);
                const finishDidOpen = (doc: vscode.TextDocument) => {
                    client.provideCustomConfiguration(doc.uri, undefined);
                    client.notifyWhenLanguageClientReady(() => {
                        client.takeOwnership(doc);
                        client.onDidOpenTextDocument(doc);
                    });
                };
                let languageChanged: boolean = false;
                // Work around vscode treating ".C" or ".H" as c, by adding this file name to file associations as cpp
                if ((document.uri.path.endsWith(".C") || document.uri.path.endsWith(".H")) && document.languageId === "c") {
                    const cppSettings: CppSettings = new CppSettings();
                    if (cppSettings.autoAddFileAssociations) {
                        const fileName: string = path.basename(document.uri.fsPath);
                        const mappingString: string = fileName + "@" + document.uri.fsPath;
                        client.addFileAssociations(mappingString, "cpp");
                        client.sendDidChangeSettings({ files: { associations: new OtherSettings().filesAssociations }});
                        vscode.languages.setTextDocumentLanguage(document, "cpp").then((newDoc: vscode.TextDocument) => {
                            finishDidOpen(newDoc);
                        });
                        languageChanged = true;
                    }
                }
                if (!languageChanged) {
                    finishDidOpen(document);
                }
                return true;
            }
        }
    }
    return false;
}

function onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {
    // Process delayed didOpen for any visible editors we haven't seen before
    editors.forEach(editor => {
        if ((editor.document.uri.scheme === "file") && (editor.document.languageId === "c" || editor.document.languageId === "cpp" || editor.document.languageId === "cuda-cpp")) {
            if (!processDelayedDidOpen(editor.document)) {
                const client: Client = clients.getClientFor(editor.document.uri);
                client.onDidChangeVisibleTextEditor(editor);
            }
        }
    });
}

function onInterval(): void {
    // TODO: do we need to pump messages to all clients? depends on what we do with the icons, I suppose.
    clients.ActiveClient.onInterval();
}

/**
 * registered commands
 */
let commandsRegistered: boolean = false;

export function registerCommands(): void {
    if (commandsRegistered) {
        return;
    }

    commandsRegistered = true;
    disposables.push(vscode.commands.registerCommand('C_Cpp.SwitchHeaderSource', onSwitchHeaderSource));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ResetDatabase', onResetDatabase));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationSelect', onSelectConfiguration));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationProviderSelect', onSelectConfigurationProvider));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEditJSON', onEditConfigurationJSON));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEditUI', onEditConfigurationUI));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEdit', onEditConfiguration));
    disposables.push(vscode.commands.registerCommand('C_Cpp.AddToIncludePath', onAddToIncludePath));
    disposables.push(vscode.commands.registerCommand('C_Cpp.EnableErrorSquiggles', onEnableSquiggles));
    disposables.push(vscode.commands.registerCommand('C_Cpp.DisableErrorSquiggles', onDisableSquiggles));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleIncludeFallback', onToggleIncludeFallback));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleDimInactiveRegions', onToggleDimInactiveRegions));
    disposables.push(vscode.commands.registerCommand('C_Cpp.PauseParsing', onPauseParsing));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ResumeParsing', onResumeParsing));
    disposables.push(vscode.commands.registerCommand('C_Cpp.PauseCodeAnalysis', onPauseCodeAnalysis));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ResumeCodeAnalysis', onResumeCodeAnalysis));
    disposables.push(vscode.commands.registerCommand('C_Cpp.CancelCodeAnalysis', onCancelCodeAnalysis));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowParsingCommands', onShowParsingCommands));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowCodeAnalysisCommands', onShowCodeAnalysisCommands));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowReferencesProgress', onShowReferencesProgress));
    disposables.push(vscode.commands.registerCommand('C_Cpp.TakeSurvey', onTakeSurvey));
    disposables.push(vscode.commands.registerCommand('C_Cpp.LogDiagnostics', onLogDiagnostics));
    disposables.push(vscode.commands.registerCommand('C_Cpp.RescanWorkspace', onRescanWorkspace));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowReferenceItem', onShowRefCommand));
    disposables.push(vscode.commands.registerCommand('C_Cpp.referencesViewGroupByType', onToggleRefGroupView));
    disposables.push(vscode.commands.registerCommand('C_Cpp.referencesViewUngroupByType', onToggleRefGroupView));
    disposables.push(vscode.commands.registerCommand('C_Cpp.VcpkgClipboardInstallSuggested', onVcpkgClipboardInstallSuggested));
    disposables.push(vscode.commands.registerCommand('C_Cpp.VcpkgOnlineHelpSuggested', onVcpkgOnlineHelpSuggested));
    disposables.push(vscode.commands.registerCommand('C_Cpp.GenerateEditorConfig', onGenerateEditorConfig));
    disposables.push(vscode.commands.registerCommand('C_Cpp.GoToNextDirectiveInGroup', onGoToNextDirectiveInGroup));
    disposables.push(vscode.commands.registerCommand('C_Cpp.GoToPrevDirectiveInGroup', onGoToPrevDirectiveInGroup));
    disposables.push(vscode.commands.registerCommand('C_Cpp.CheckForCompiler', onCheckForCompiler));
    disposables.push(vscode.commands.registerCommand('C_Cpp.RunCodeAnalysisOnActiveFile', onRunCodeAnalysisOnActiveFile));
    disposables.push(vscode.commands.registerCommand('C_Cpp.RunCodeAnalysisOnOpenFiles', onRunCodeAnalysisOnOpenFiles));
    disposables.push(vscode.commands.registerCommand('C_Cpp.RunCodeAnalysisOnAllFiles', onRunCodeAnalysisOnAllFiles));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ClearCodeAnalysisSquiggles', onClearCodeAnalysisSquiggles));
    disposables.push(vscode.commands.registerCommand('cpptools.activeConfigName', onGetActiveConfigName));
    disposables.push(vscode.commands.registerCommand('cpptools.activeConfigCustomVariable', onGetActiveConfigCustomVariable));
    disposables.push(vscode.commands.registerCommand('cpptools.setActiveConfigName', onSetActiveConfigName));
    disposables.push(vscode.commands.registerCommand('C_Cpp.RestartIntelliSenseForFile', onRestartIntelliSenseForFile));
}

function onRestartIntelliSenseForFile(): void {
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!activeEditor || !activeEditor.document || activeEditor.document.uri.scheme !== "file" ||
        (activeEditor.document.languageId !== "c" && activeEditor.document.languageId !== "cpp" && activeEditor.document.languageId !== "cuda-cpp")) {
        return;
    }
    clients.ActiveClient.restartIntelliSenseForFile(activeEditor.document);
}

async function onSwitchHeaderSource(): Promise<void> {
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!activeEditor || !activeEditor.document) {
        return;
    }

    if (activeEditor.document.languageId !== "c" && activeEditor.document.languageId !== "cpp" && activeEditor.document.languageId !== "cuda-cpp") {
        return;
    }

    let rootPath: string = clients.ActiveClient.RootPath;
    const fileName: string = activeEditor.document.fileName;

    if (!rootPath) {
        rootPath = path.dirname(fileName); // When switching without a folder open.
    }

    let targetFileName: string = await clients.ActiveClient.requestSwitchHeaderSource(rootPath, fileName);
    // If the targetFileName has a path that is a symlink target of a workspace folder,
    // then replace the RootRealPath with the RootPath (the symlink path).
    let targetFileNameReplaced: boolean = false;
    clients.forEach(client => {
        if (!targetFileNameReplaced && client.RootRealPath && client.RootPath !== client.RootRealPath
            && targetFileName.indexOf(client.RootRealPath) === 0) {
            targetFileName = client.RootPath + targetFileName.substr(client.RootRealPath.length);
            targetFileNameReplaced = true;
        }
    });
    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(targetFileName);
    let foundEditor: boolean = false;
    // If the document is already visible in another column, open it there.
    vscode.window.visibleTextEditors.forEach((editor, index, array) => {
        if (editor.document === document && !foundEditor) {
            foundEditor = true;
            vscode.window.showTextDocument(document, editor.viewColumn);
        }
    });
    if (!foundEditor) {
        vscode.window.showTextDocument(document);
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
        const key: string = await ui.showWorkspaces(clients.Names);
        if (key !== "") {
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

function onResetDatabase(): void {
    clients.ActiveClient.resetDatabase();
}

function onSelectConfiguration(): void {
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize("configuration.select.first", 'Open a folder first to select a configuration'));
    } else {
        // This only applies to the active client. You cannot change the configuration for
        // a client that is not active since that client's UI will not be visible.
        clients.ActiveClient.handleConfigurationSelectCommand();
    }
}

function onSelectConfigurationProvider(): void {
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize("configuration.provider.select.first", 'Open a folder first to select a configuration provider'));
    } else {
        selectClient().then(client => client.handleConfigurationProviderSelectCommand(), rejected => {});
    }
}

function onEditConfigurationJSON(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): void {
    telemetry.logLanguageServerEvent("SettingsCommand", { "palette": "json" }, undefined);
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize('edit.configurations.open.first', 'Open a folder first to edit configurations'));
    } else {
        selectClient().then(client => client.handleConfigurationEditJSONCommand(viewColumn), rejected => {});
    }
}

function onEditConfigurationUI(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): void {
    telemetry.logLanguageServerEvent("SettingsCommand", { "palette": "ui" }, undefined);
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize('edit.configurations.open.first', 'Open a folder first to edit configurations'));
    } else {
        selectClient().then(client => client.handleConfigurationEditUICommand(viewColumn), rejected => {});
    }
}

function onEditConfiguration(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): void {
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize('edit.configurations.open.first', 'Open a folder first to edit configurations'));
    } else {
        selectClient().then(client => client.handleConfigurationEditCommand(viewColumn), rejected => {});
    }
}

function onGenerateEditorConfig(): void {
    if (!isFolderOpen()) {
        const settings: CppSettings = new CppSettings();
        settings.generateEditorConfig();
    } else {
        selectClient().then(client => {
            const settings: CppSettings = new CppSettings(client.RootUri);
            settings.generateEditorConfig();
        });
    }
}

function onGoToNextDirectiveInGroup(): void {
    const client: Client = getActiveClient();
    client.handleGoToDirectiveInGroup(true);
}

function onGoToPrevDirectiveInGroup(): void {
    const client: Client = getActiveClient();
    client.handleGoToDirectiveInGroup(false);
}

function onCheckForCompiler(): void {
    const client: Client = getActiveClient();
    client.handleCheckForCompiler();
}

async function onRunCodeAnalysisOnActiveFile(): Promise<void> {
    if (activeDocument !== "") {
        await vscode.commands.executeCommand("workbench.action.files.saveAll");
        getActiveClient().handleRunCodeAnalysisOnActiveFile();
    }
}

async function onRunCodeAnalysisOnOpenFiles(): Promise<void> {
    if (openFileVersions.size > 0) {
        await vscode.commands.executeCommand("workbench.action.files.saveAll");
        getActiveClient().handleRunCodeAnalysisOnOpenFiles();
    }
}

async function onRunCodeAnalysisOnAllFiles(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.files.saveAll");
    getActiveClient().handleRunCodeAnalysisOnAllFiles();
}

async function onClearCodeAnalysisSquiggles(): Promise<void> {
    getActiveClient().handleClearCodeAnalysisSquiggles();
}

function onAddToIncludePath(path: string): void {
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize('add.includepath.open.first', 'Open a folder first to add to {0}', "includePath"));
    } else {
        // This only applies to the active client. It would not make sense to add the include path
        // suggestion to a different workspace.
        clients.ActiveClient.handleAddToIncludePathCommand(path);
    }
}

function onEnableSquiggles(): void {
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.update<string>("errorSquiggles", "Enabled");
}

function onDisableSquiggles(): void {
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.update<string>("errorSquiggles", "Disabled");
}

function onToggleIncludeFallback(): void {
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.toggleSetting("intelliSenseEngineFallback", "Enabled", "Disabled");
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

function onShowParsingCommands(): void {
    clients.ActiveClient.handleShowParsingCommands();
}

function onShowCodeAnalysisCommands(): void {
    clients.ActiveClient.handleShowCodeAnalysisCommands();
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
    vscode.commands.executeCommand('vscode.open', uri);
}

function onVcpkgOnlineHelpSuggested(dummy?: any): void {
    telemetry.logLanguageServerEvent('vcpkgAction', { 'source': dummy ? 'CodeAction' : 'CommandPalette', 'action': 'vcpkgOnlineHelpSuggested' });
    const uri: vscode.Uri = vscode.Uri.parse(`https://aka.ms/vcpkg`);
    vscode.commands.executeCommand('vscode.open', uri);
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
            docAndLineNumbers[1].forEach(async line => {
                portsPromises.push(lookupIncludeInVcpkg(docAndLineNumbers[0], line));
            });
        });
        ports = ([] as string[]).concat(...(await Promise.all(portsPromises)));
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

function onSetActiveConfigName(configurationName: string): Thenable<void> {
    return clients.ActiveClient.setCurrentConfigName(configurationName);
}

function onGetActiveConfigName(): Thenable<string | undefined> {
    return clients.ActiveClient.getCurrentConfigName();
}

function onGetActiveConfigCustomVariable(variableName: string): Thenable<string> {
    return clients.ActiveClient.getCurrentConfigCustomVariable(variableName);
}

function onLogDiagnostics(): void {
    clients.ActiveClient.logDiagnostics();
}

function onRescanWorkspace(): void {
    clients.ActiveClient.rescanFolder();
}

function onShowRefCommand(arg?: TreeNode): void {
    if (!arg) {
        return;
    }
    const { node } = arg;
    if (node === NodeType.reference) {
        const { referenceLocation } = arg;
        if (referenceLocation) {
            vscode.window.showTextDocument(referenceLocation.uri, {
                selection: referenceLocation.range.with({ start: referenceLocation.range.start, end: referenceLocation.range.end })
            });
        }
    } else if (node === NodeType.fileWithPendingRef) {
        const { fileUri } = arg;
        if (fileUri) {
            vscode.window.showTextDocument(fileUri);
        }
    }
}

function reportMacCrashes(): void {
    if (process.platform === "darwin") {
        prevCrashFile = "";
        const home: string = os.homedir();
        const crashFolder: string = path.resolve(home, "Library/Logs/DiagnosticReports");
        fs.stat(crashFolder, (err, stats) => {
            const crashObject: { [key: string]: string } = {};
            if (err?.code) {
                // If the directory isn't there, we have a problem...
                crashObject["fs.stat: err.code"] = err.code;
                telemetry.logLanguageServerEvent("MacCrash", crashObject, undefined);
                return;
            }

            // vscode.workspace.createFileSystemWatcher only works in workspace folders.
            try {
                fs.watch(crashFolder, (event, filename) => {
                    if (event !== "rename") {
                        return;
                    }
                    if (filename === prevCrashFile) {
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

let previousMacCrashData: string;
let previousMacCrashCount: number = 0;

function logMacCrashTelemetry(data: string): void {
    const crashObject: { [key: string]: string } = {};
    const crashCountObject: { [key: string]: number } = {};
    crashObject["CrashingThreadCallStack"] = data;
    previousMacCrashCount = data === previousMacCrashData ? previousMacCrashCount + 1 : 0;
    previousMacCrashData = data;
    crashCountObject["CrashCount"] = previousMacCrashCount;
    telemetry.logLanguageServerEvent("MacCrash", crashObject, crashCountObject);
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
        data = data.substr(startVersion);
        const binaryVersionMatches: string[] | null = data.match(/^Version:\s*(\d*\.\d*\.\d*\.\d*|\d)/);
        binaryVersion = binaryVersionMatches && binaryVersionMatches.length > 1 ? binaryVersionMatches[1] : "";
    }

    // Extract the crashing thread's call stack.
    const crashStart: string = " Crashed:";
    let startCrash: number = data.indexOf(crashStart);
    if (startCrash < 0) {
        return logMacCrashTelemetry("No crash start");
    }
    startCrash += crashStart.length + 1; // Skip past crashStart.
    let endCrash: number = data.indexOf("Thread ", startCrash);
    if (endCrash < 0) {
        endCrash = data.length - 1; // Not expected, but just in case.
    }
    if (endCrash <= startCrash) {
        return logMacCrashTelemetry("No crash end");
    }
    data = data.substr(startCrash, endCrash - startCrash);

    // Get rid of the memory addresses (which breaks being able get a hit count for each crash call stack).
    data = data.replace(/0x................ /g, "");
    data = data.replace(/0x1........ \+ 0/g, "");

    // Get rid of the process names on each line and just add it to the start.
    const process1: string = "cpptools-srv";
    const process2: string = "cpptools";
    if (data.includes(process1)) {
        data = data.replace(new RegExp(process1 + "\\s+", "g"), "");
        data = `${process1}\t${binaryVersion}\n${data}`;
    } else if (data.includes(process2)) {
        data = data.replace(new RegExp(process2 + "\\s+", "g"), "");
        data = `${process2}\t${binaryVersion}\n${data}`;
    } else {
        // Not expected, but just in case.
        data = `cpptools?\t${binaryVersion}\n${data}`;
    }

    // Remove runtime lines because they can be different on different machines.
    const lines: string[] = data.split("\n");
    data = "";
    lines.forEach((line: string) => {
        if (!line.includes(".dylib") && !line.includes("???")) {
            line = line.replace(/^\d+\s+/, ""); // Remove <numbers><spaces> from the start of the line.
            line = line.replace(/std::__1::/g, "std::");  // __1:: is not helpful.
            data += (line + "\n");
        }
    });
    data = data.trimRight();

    if (data.length > 8192) { // The API has an 8k limit.
        data = data.substr(0, 8189) + "...";
    }

    logMacCrashTelemetry(data);
}

export function deactivate(): Thenable<void> {
    clients.timeTelemetryCollector.clear();
    console.log("deactivating extension");
    telemetry.logLanguageServerEvent("LanguageServerShutdown");
    clearInterval(intervalTimer);
    disposables.forEach(d => d.dispose());
    languageConfigurations.forEach(d => d.dispose());
    ui.dispose();
    if (taskProvider) {
        taskProvider.dispose();
    }
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
