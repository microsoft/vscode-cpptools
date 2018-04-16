/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient, LanguageClientOptions, ServerOptions, NotificationType, TextDocumentIdentifier,
    RequestType, ErrorAction, CloseAction, DidOpenTextDocumentParams } from 'vscode-languageclient';
import * as util from '../common';
import * as configs from './configurations';
import { CppSettings, OtherSettings } from './settings';
import * as telemetry from '../telemetry';
import { PersistentState } from './persistentState';
import { UI, getUI } from './ui';
import { ClientCollection } from './clientCollection';
import { createProtocolFilter } from './protocolFilter';
import { DataBinding } from './dataBinding';
import minimatch = require("minimatch");
import * as logger from '../logger';
import { updateLanguageConfigurations } from './extension';
import { CustomConfigurationProvider, SourceFileConfiguration } from '../api';

let ui: UI;

interface NavigationPayload {
    navigation: string;
}

interface TelemetryPayload {
    event: string;
    properties?: { [key: string]: string };
    metrics?: { [key: string]: number };
}

interface OutputNotificationBody {
    category: string;
    output: string;
}

interface ReportStatusNotificationBody {
    status: string;
}

interface QueryCompilerDefaultsParams {
}

interface FolderSettingsParams {
    currentConfiguration: number;
    configurations: any[];
}

interface FolderSelectedSettingParams {
    currentConfiguration: number;
}

interface SwitchHeaderSourceParams {
    rootPath: string;
    switchHeaderSourceFileName: string;
}

interface FileChangedParams {
    uri: string;
}

interface OutputNotificationBody {
    category: string;
    output: string;
}

interface InactiveRegionParams {
    uri: string;
    regions: InputRegion[];
}

interface InputRegion {
    startLine: number;
    endLine: number;
}

interface DecorationRangesPair {
    decoration: vscode.TextEditorDecorationType;
    ranges: vscode.Range[];
}

// Requests
const NavigationListRequest: RequestType<TextDocumentIdentifier, string, void, void> = new RequestType<TextDocumentIdentifier, string, void, void>('cpptools/requestNavigationList');
const GoToDeclarationRequest: RequestType<void, void, void, void> = new RequestType<void, void, void, void>('cpptools/goToDeclaration');
const QueryCompilerDefaultsRequest: RequestType<QueryCompilerDefaultsParams, configs.CompilerDefaults, void, void> = new RequestType<QueryCompilerDefaultsParams, configs.CompilerDefaults, void, void>('cpptools/queryCompilerDefaults');
const SwitchHeaderSourceRequest: RequestType<SwitchHeaderSourceParams, string, void, void> = new RequestType<SwitchHeaderSourceParams, string, void, void>('cpptools/didSwitchHeaderSource');

// Notifications to the server
const DidOpenNotification: NotificationType<DidOpenTextDocumentParams, void> = new NotificationType<DidOpenTextDocumentParams, void>('textDocument/didOpen');
const FileCreatedNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/fileCreated');
const FileDeletedNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/fileDeleted');
const ResetDatabaseNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/resetDatabase');
const PauseParsingNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/pauseParsing');
const ResumeParsingNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/resumeParsing');
const ActiveDocumentChangeNotification: NotificationType<TextDocumentIdentifier, void> = new NotificationType<TextDocumentIdentifier, void>('cpptools/activeDocumentChange');
const TextEditorSelectionChangeNotification: NotificationType<vscode.Position, void> = new NotificationType<vscode.Position, void>('cpptools/textEditorSelectionChange');
const ChangeFolderSettingsNotification: NotificationType<FolderSettingsParams, void> = new NotificationType<FolderSettingsParams, void>('cpptools/didChangeFolderSettings');
const ChangeCompileCommandsNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/didChangeCompileCommands');
const ChangeSelectedSettingNotification: NotificationType<FolderSelectedSettingParams, void> = new NotificationType<FolderSelectedSettingParams, void>('cpptools/didChangeSelectedSetting');
const IntervalTimerNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/onIntervalTimer');

// Notifications from the server
const ReloadWindowNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/reloadWindow');
const LogTelemetryNotification: NotificationType<TelemetryPayload, void> = new NotificationType<TelemetryPayload, void>('cpptools/logTelemetry');
const ReportNavigationNotification: NotificationType<NavigationPayload, void> = new NotificationType<NavigationPayload, void>('cpptools/reportNavigation');
const ReportTagParseStatusNotification: NotificationType<ReportStatusNotificationBody, void> = new NotificationType<ReportStatusNotificationBody, void>('cpptools/reportTagParseStatus');
const ReportStatusNotification: NotificationType<ReportStatusNotificationBody, void> = new NotificationType<ReportStatusNotificationBody, void>('cpptools/reportStatus');
const DebugProtocolNotification: NotificationType<OutputNotificationBody, void> = new NotificationType<OutputNotificationBody, void>('cpptools/debugProtocol');
const DebugLogNotification:  NotificationType<OutputNotificationBody, void> = new NotificationType<OutputNotificationBody, void>('cpptools/debugLog');
const InactiveRegionNotification:  NotificationType<InactiveRegionParams, void> = new NotificationType<InactiveRegionParams, void>('cpptools/inactiveRegions');

const maxSettingLengthForTelemetry: number = 50;
let previousCppSettings: { [key: string]: any } = {};

/**
 * track settings changes for telemetry
 */
function collectSettingsForTelemetry(filter: (key: string, val: string, settings: vscode.WorkspaceConfiguration) => boolean, resource: vscode.Uri): { [key: string]: string } {
    let settings: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", resource);
    let result: { [key: string]: string } = {};

    for (let key in settings) {
        if (settings.inspect(key).defaultValue === undefined) {
            continue; // ignore methods and settings that don't exist
        }
        let val: any = settings.get(key);
        if (val instanceof Object) {
            val = JSON.stringify(val, null, 2);
        }

        // Skip values that don't match the setting's enum.
        let curSetting: any = util.packageJson.contributes.configuration.properties["C_Cpp." + key];
        if (curSetting) {
            let curEnum: any[] = curSetting["enum"];
            if (curEnum && curEnum.indexOf(val) === -1) {
                continue;
            }
        }

        if (filter(key, val, settings)) {
            previousCppSettings[key] = val;
            switch (String(key).toLowerCase()) {
                case "clang_format_path": {
                    continue;
                }
                case "clang_format_style":
                case "clang_format_fallbackstyle": {
                    let newKey: string = String(key) + "2";
                    if (val) {
                        switch (String(val).toLowerCase()) {
                            case "visual studio":
                            case "llvm":
                            case "google":
                            case "chromium":
                            case "mozilla":
                            case "webkit":
                            case "file":
                            case "none": {
                                result[newKey] = String(previousCppSettings[key]);
                                break;
                            }
                            default: {
                                result[newKey] = "...";
                                break;
                            }
                        }
                    } else {
                        result[newKey] = "null";
                    }
                    key = newKey;
                    break;
                }
                default: {
                    result[key] = String(previousCppSettings[key]);
                    break;
                }
            }
            if (result[key].length > maxSettingLengthForTelemetry) {
                result[key] = result[key].substr(0, maxSettingLengthForTelemetry) + "...";
            }
        }
    }

    return result;
}

function initializeSettingsCache(resource: vscode.Uri): void {
    collectSettingsForTelemetry(() => true, resource);
}

function getNonDefaultSettings(resource: vscode.Uri): { [key: string]: string } {
    let filter: (key: string, val: string, settings: vscode.WorkspaceConfiguration) => boolean = (key: string, val: string, settings: vscode.WorkspaceConfiguration) => {
        return val !== settings.inspect(key).defaultValue;
    };
    initializeSettingsCache(resource);
    return collectSettingsForTelemetry(filter, resource);
}

interface ClientModel {
    isTagParsing: DataBinding<boolean>;
    isUpdatingIntelliSense: DataBinding<boolean>;
    navigationLocation: DataBinding<string>;
    tagParserStatus: DataBinding<string>;
    activeConfigName: DataBinding<string>;
}

export interface Client {
    TagParsingChanged: vscode.Event<boolean>;
    IntelliSenseParsingChanged: vscode.Event<boolean>;
    NavigationLocationChanged: vscode.Event<string>;
    TagParserStatusChanged: vscode.Event<string>;
    ActiveConfigChanged: vscode.Event<string>;
    RootPath: string;
    RootUri: vscode.Uri;
    Name: string;
    TrackedDocuments: Set<vscode.TextDocument>;
    CustomConfigurationProvider: CustomConfigurationProvider;
    onDidChangeSettings(): void;
    onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void;
    takeOwnership(document: vscode.TextDocument): void;
    requestGoToDeclaration(): Thenable<void>;
    requestSwitchHeaderSource(rootPath: string, fileName: string): Thenable<string>;
    requestNavigationList(document: vscode.TextDocument): Thenable<string>;
    activeDocumentChanged(document: vscode.TextDocument): void;
    activate(): void;
    selectionChanged(selection: vscode.Position): void;
    sendCustomConfiguration(document: vscode.TextDocument, config: SourceFileConfiguration): void;
    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void;
    resetDatabase(): void;
    deactivate(): void;
    pauseParsing(): void;
    resumeParsing(): void;
    handleConfigurationSelectCommand(): void;
    handleShowParsingCommands(): void;
    handleConfigurationEditCommand(): void;
    handleAddToIncludePathCommand(path: string): void;
    onInterval(): void;
    dispose(): Thenable<void>;
}

export function createClient(allClients: ClientCollection, workspaceFolder?: vscode.WorkspaceFolder): Client {
    return new DefaultClient(allClients, workspaceFolder);
}

export function createNullClient(): Client {
    return new NullClient();
}

class DefaultClient implements Client {
    private languageClient: LanguageClient; // The "client" that launches and communicates with our language "server" process.
    private disposables: vscode.Disposable[] = [];
    private configuration: configs.CppProperties;
    private rootPathFileWatcher: vscode.FileSystemWatcher;
    private rootFolder: vscode.WorkspaceFolder | undefined;
    private trackedDocuments = new Set<vscode.TextDocument>();
    private outputChannel: vscode.OutputChannel;
    private debugChannel: vscode.OutputChannel;
    private crashTimes: number[] = [];
    private failureMessageShown = new PersistentState<boolean>("DefaultClient.failureMessageShown", false);
    private isSupported: boolean = true;
    private inactiveRegionsDecorations = new Map<string, DecorationRangesPair>();
    private customConfigurationProvider: CustomConfigurationProvider;

    // The "model" that is displayed via the UI (status bar).
    private model: ClientModel = {
        isTagParsing: new DataBinding<boolean>(false),
        isUpdatingIntelliSense: new DataBinding<boolean>(false),
        navigationLocation: new DataBinding<string>(""),
        tagParserStatus: new DataBinding<string>(""),
        activeConfigName: new DataBinding<string>("")
    };

    public get TagParsingChanged(): vscode.Event<boolean> { return this.model.isTagParsing.ValueChanged; }
    public get IntelliSenseParsingChanged(): vscode.Event<boolean> { return this.model.isUpdatingIntelliSense.ValueChanged; }
    public get NavigationLocationChanged(): vscode.Event<string> { return this.model.navigationLocation.ValueChanged; }
    public get TagParserStatusChanged(): vscode.Event<string> { return this.model.tagParserStatus.ValueChanged; }
    public get ActiveConfigChanged(): vscode.Event<string> { return this.model.activeConfigName.ValueChanged; }

    /**
     * don't use this.rootFolder directly since it can be undefined
     */
    public get RootPath(): string {
        return (this.rootFolder) ? this.rootFolder.uri.fsPath : "";
    }
    public get RootUri(): vscode.Uri {
        return (this.rootFolder) ? this.rootFolder.uri : null;
    }
    public get Name(): string {
        return this.getName(this.rootFolder);
    }
    public get TrackedDocuments(): Set<vscode.TextDocument> {
        return this.trackedDocuments;
    }
    public get CustomConfigurationProvider(): CustomConfigurationProvider | undefined {
        return this.customConfigurationProvider;
    }

    private getName(workspaceFolder?: vscode.WorkspaceFolder): string {
        return workspaceFolder ? workspaceFolder.name : "untitled";
    }

    /**
     * All public methods on this class must be guarded by the "onReady" promise. Requests and notifications received before the client is
     * ready are executed after this promise is resolved.
     * @see requestWhenReady<T>(request)
     * @see notifyWhenReady(notify)
     */
    private onReadyPromise: Thenable<void>;

    constructor(allClients: ClientCollection, workspaceFolder?: vscode.WorkspaceFolder) {
        try {
            let languageClient: LanguageClient = this.createLanguageClient(allClients, workspaceFolder);
            languageClient.registerProposedFeatures();
            languageClient.start();  // This returns Disposable, but doesn't need to be tracked because we call .stop() explicitly in our dispose()
            util.setProgress(util.getProgressExecutableStarted());
            this.rootFolder = workspaceFolder;
            ui = getUI();
            ui.bind(this);

            this.onReadyPromise = languageClient.onReady().then(() => {
                this.configuration = new configs.CppProperties(this.RootPath);
                this.configuration.ConfigurationsChanged((e) => this.onConfigurationsChanged(e));
                this.configuration.SelectionChanged((e) => this.onSelectedConfigurationChanged(e));
                this.configuration.CompileCommandsChanged((e) => this.onCompileCommandsChanged(e));
                this.disposables.push(this.configuration);

                // The configurations will not be sent to the language server until the default include paths and frameworks have been set.
                // The event handlers must be set before this happens.
                languageClient.sendRequest(QueryCompilerDefaultsRequest, {}).then((compilerDefaults: configs.CompilerDefaults) => {
                    this.configuration.CompilerDefaults = compilerDefaults;
                });

                // Once this is set, we don't defer any more callbacks.
                this.languageClient = languageClient;
                telemetry.logLanguageServerEvent("NonDefaultInitialCppSettings", getNonDefaultSettings(this.RootUri));
                this.failureMessageShown.Value = false;

                // Listen for messages from the language server.
                this.registerNotifications();
                this.registerFileWatcher();
            }, () => {
                this.isSupported = false;   // Running on an OS we don't support yet.
                if (!this.failureMessageShown.Value) {
                    this.failureMessageShown.Value = true;
                    vscode.window.showErrorMessage("Unable to start the C/C++ language server. IntelliSense features will be disabled.");
                }
            });
        } catch {
            this.isSupported = false;   // Running on an OS we don't support yet.
            if (!this.failureMessageShown.Value) {
                this.failureMessageShown.Value = true;
                vscode.window.showErrorMessage("Unable to start the C/C++ language server. IntelliSense features will be disabled.");
            }
        }
    }

    private createLanguageClient(allClients: ClientCollection, workspaceFolder?: vscode.WorkspaceFolder): LanguageClient {
        let serverModule: string = getLanguageServerFileName();
        let serverName: string = this.getName(workspaceFolder);

        let serverOptions: ServerOptions = {
            run: { command: serverModule },
            debug: { command: serverModule, args: [ serverName ] }
        };
        let settings: CppSettings = new CppSettings(workspaceFolder ? workspaceFolder.uri : null);
        let other: OtherSettings = new OtherSettings(workspaceFolder ? workspaceFolder.uri : null);

        let storagePath: string = util.extensionContext.storagePath;
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
            storagePath = path.join(storagePath, serverName);
        }

        let clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'cpp' },
                { scheme: 'file', language: 'c' }
            ],
            synchronize: {
                // Synchronize the setting section to the server
                configurationSection: ['C_Cpp', 'files', 'search']
            },
            workspaceFolder: workspaceFolder,
            initializationOptions: {
                clang_format_path: settings.clangFormatPath,
                clang_format_style: settings.clangFormatStyle,
                clang_format_fallbackStyle: settings.clangFormatFallbackStyle,
                clang_format_sortIncludes: settings.clangFormatSortIncludes,
                formatting: settings.formatting,
                extension_path: util.extensionContext.extensionPath,
                exclude_files: other.filesExclude,
                exclude_search: other.searchExclude,
                storage_path: storagePath,
                tab_size: other.editorTabSize,
                intelliSenseEngine: settings.intelliSenseEngine,
                intelliSenseEngineFallback: settings.intelliSenseEngineFallback,
                autocomplete: settings.autoComplete,
                errorSquiggles: settings.errorSquiggles,
                dimInactiveRegions: settings.dimInactiveRegions,
                loggingLevel: settings.loggingLevel,
                workspaceParsingPriority: settings.workspaceParsingPriority,
                exclusionPolicy: settings.exclusionPolicy
            },
            middleware: createProtocolFilter(this, allClients),  // Only send messages directed at this client.
            errorHandler: {
                error: () => ErrorAction.Continue,
                closed: () => {
                        this.crashTimes.push(Date.now());
                        if (this.crashTimes.length < 5) {
                            let newClient: DefaultClient = <DefaultClient>allClients.replace(this, true);
                            newClient.crashTimes = this.crashTimes;
                        } else {
                            let elapsed: number = this.crashTimes[this.crashTimes.length - 1] - this.crashTimes[0];
                            if (elapsed <= 3 * 60 * 1000) {
                                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
                                    vscode.window.showErrorMessage(`The language server for '${serverName}' crashed 5 times in the last 3 minutes. It will not be restarted.`);
                                } else {
                                    vscode.window.showErrorMessage(`The language server crashed 5 times in the last 3 minutes. It will not be restarted.`);
                                }
                                allClients.replace(this, false);
                            } else {
                                this.crashTimes.shift();
                                let newClient: DefaultClient = <DefaultClient>allClients.replace(this, true);
                                newClient.crashTimes = this.crashTimes;
                            }
                        }
                        return CloseAction.DoNotRestart;
                    }
            }

            // TODO: should I set the output channel?  Does this sort output between servers?
        };

        // Create the language client
        return new LanguageClient(`cpptools: ${serverName}`, serverOptions, clientOptions);
    }

    public onDidChangeSettings(): void {
        // This relies on getNonDefaultSettings being called first.
        console.assert(Object.keys(previousCppSettings).length > 0);

        let filter: (key: string, val: string) => boolean = (key: string, val: string) => {
            return !(key in previousCppSettings) || val !== previousCppSettings[key];
        };
        let changedSettings: { [key: string] : string} = collectSettingsForTelemetry(filter, this.RootUri);

        if (Object.keys(changedSettings).length > 0) {
            if (changedSettings["commentContinuationPatterns"]) {
                updateLanguageConfigurations();
            }
            telemetry.logLanguageServerEvent("CppSettingsChange", changedSettings, null);
        }
    }

    public onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {
        let settings: CppSettings = new CppSettings(this.RootUri);
        if (settings.dimInactiveRegions) {
            //Apply text decorations to inactive regions
            for (let e of editors) {
                let valuePair: DecorationRangesPair = this.inactiveRegionsDecorations.get(e.document.uri.toString());
                if (valuePair) {
                    e.setDecorations(valuePair.decoration, valuePair.ranges); // VSCode clears the decorations when the text editor becomes invisible
                }
            }
        }
    }

    /**
     * Take ownership of a document that was previously serviced by another client.
     * This process involves sending a textDocument/didOpen message to the server so
     * that it knows about the file, as well as adding it to this client's set of
     * tracked documents.
     */
    public takeOwnership(document: vscode.TextDocument): void {
        let params: DidOpenTextDocumentParams = {
            textDocument: {
                uri: document.uri.toString(),
                languageId: document.languageId,
                version: document.version,
                text: document.getText()
            }
        };
        this.notifyWhenReady(() => this.languageClient.sendNotification(DidOpenNotification, params));
        this.trackedDocuments.add(document);
    }

    public sendCustomConfiguration(document: vscode.TextDocument, config: SourceFileConfiguration): void {
        // TODO: Implement this
        console.log(config.includePath);
        console.log(config.defines);
    }

    public registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        this.customConfigurationProvider = provider;
    }

    /*************************************************************************************
     * wait until the language client is ready for use before attempting to send messages
     *************************************************************************************/

    private requestWhenReady<T>(request: () => Thenable<T>): Thenable<T> {
        if (this.languageClient) {
            return request();
        } else if (this.isSupported && this.onReadyPromise) {
            return this.onReadyPromise.then(() => request());
        } else {
            return Promise.reject<T>("Unsupported client");
        }
    }

    private notifyWhenReady(notify: () => void): void {
        if (this.languageClient) {
            notify();
        } else if (this.isSupported && this.onReadyPromise) {
            this.onReadyPromise.then(() => notify());
        }
    }

    /**
     * listen for notifications from the language server.
     */
    private registerNotifications(): void {
        console.assert(this.languageClient !== undefined, "This method must not be called until this.languageClient is set in \"onReady\"");

        this.languageClient.onNotification(ReloadWindowNotification, () => this.reloadWindow());
        this.languageClient.onNotification(LogTelemetryNotification, (e) => this.logTelemetry(e));
        this.languageClient.onNotification(ReportNavigationNotification, (e) => this.navigate(e));
        this.languageClient.onNotification(ReportStatusNotification, (e) => this.updateStatus(e));
        this.languageClient.onNotification(ReportTagParseStatusNotification, (e) => this.updateTagParseStatus(e));
        this.languageClient.onNotification(InactiveRegionNotification, (e) => this.updateInactiveRegions(e));
        this.setupOutputHandlers();
    }

    /**
     * listen for file created/deleted events under the ${workspaceFolder} folder
     */
    private registerFileWatcher(): void {
        console.assert(this.languageClient !== undefined, "This method must not be called until this.languageClient is set in \"onReady\"");

        if (this.rootFolder) {
            // WARNING: The default limit on Linux is 8k, so for big directories, this can cause file watching to fail.
            this.rootPathFileWatcher = vscode.workspace.createFileSystemWatcher(
                path.join(this.RootPath, "*"),
                false /*ignoreCreateEvents*/,
                true /*ignoreChangeEvents*/,
                false /*ignoreDeleteEvents*/);

            this.rootPathFileWatcher.onDidCreate((uri) => {
                this.languageClient.sendNotification(FileCreatedNotification, { uri: uri.toString() });
            });

            this.rootPathFileWatcher.onDidDelete((uri) => {
                this.languageClient.sendNotification(FileDeletedNotification, { uri: uri.toString() });
            });

            this.disposables.push(this.rootPathFileWatcher);
        } else {
            this.rootPathFileWatcher = undefined;
        }
    }

    /**
     * listen for logging messages from the language server and print them to the Output window
     */
    private setupOutputHandlers(): void {
        console.assert(this.languageClient !== undefined, "This method must not be called until this.languageClient is set in \"onReady\"");

        this.languageClient.onNotification(DebugProtocolNotification, (output) => {
            if (!this.debugChannel) {
                this.debugChannel = vscode.window.createOutputChannel(`C/C++ Debug Protocol: ${this.Name}`);
                this.disposables.push(this.debugChannel);
            }
            this.debugChannel.appendLine("");
            this.debugChannel.appendLine("************************************************************************************************************************");
            this.debugChannel.append(`${output}`);
        });

        this.languageClient.onNotification(DebugLogNotification, (output) => {
            if (!this.outputChannel) {
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
                    this.outputChannel = vscode.window.createOutputChannel(`C/C++: ${this.Name}`);
                } else {
                    this.outputChannel = logger.getOutputChannel();
                }
                this.disposables.push(this.outputChannel);
            }
            this.outputChannel.appendLine(`${output}`);
        });
    }

    /*******************************************************
     * handle notifications coming from the language server
     *******************************************************/

    private reloadWindow(): void {
        let reload: string = "Reload";
        vscode.window.showInformationMessage("Reload the workspace for the settings change to take effect.", reload).then((value: string) => {
            if (value === reload) {
                vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
        });
    }

    private logTelemetry(notificationBody: TelemetryPayload): void {
        telemetry.logLanguageServerEvent(notificationBody.event, notificationBody.properties, notificationBody.metrics);
    }

    private navigate(payload: NavigationPayload): void {
        let cppSettings: CppSettings = new CppSettings(this.RootUri);

        // TODO: Move this code to a different place?
        if (cppSettings.autoAddFileAssociations && payload.navigation.startsWith("<def")) {
            this.addFileAssociations(payload.navigation.substr(4));
            return;
        }

        // If it's too big, it doesn't appear.
        // The space available depends on the user's resolution and space taken up by other UI.
        let currentNavigation: string = payload.navigation;
        let maxLength: number = cppSettings.navigationLength;
        if (currentNavigation.length > maxLength) {
            currentNavigation = currentNavigation.substring(0, maxLength - 3).concat("...");
        }
        this.model.navigationLocation.Value = currentNavigation;
    }

    private addFileAssociations(fileAssociations: string): void {
        let settings: OtherSettings = new OtherSettings(this.RootUri);
        let assocs: any = settings.filesAssociations;
        let is_c: boolean = fileAssociations.startsWith("c");

        // Skip over rest of header: c>; or >;
        fileAssociations = fileAssociations.substr(is_c ? 3 : 2);
        let filesAndPaths: string[] = fileAssociations.split(";");
        let foundNewAssociation: boolean = false;
        for (let i: number = 0; i < filesAndPaths.length - 1; ++i) {
            let fileAndPath: string[] = filesAndPaths[i].split("@");
            let file: string = fileAndPath[0];
            let filePath: string = fileAndPath[1];
            if ((file in assocs) || (("**/" + file) in assocs)) {
                continue; // File already has an association.
            }
            let j: number = file.lastIndexOf('.');
            if (j !== -1) {
                let ext: string = file.substr(j);
                if ((("*" + ext) in assocs) || (("**/*" + ext) in assocs)) {
                    continue; // Extension already has an association.
                }
            }
            let foundGlobMatch: boolean = false;
            for (let assoc in assocs) {
                if (minimatch(filePath, assoc)) {
                    foundGlobMatch = true;
                    break; // Assoc matched a glob pattern.
                }
            }
            if (foundGlobMatch) {
                continue;
            }
            assocs[file] = is_c ? "c" : "cpp";
            foundNewAssociation = true;
        }
        if (foundNewAssociation) {
            settings.filesAssociations = assocs;
        }
    }

    private updateStatus(notificationBody: ReportStatusNotificationBody): void {
        let message: string = notificationBody.status;
        util.setProgress(util.getProgressExecutableSuccess());
        if (message.endsWith("Indexing...")) {
            this.model.isTagParsing.Value = true;
        } else if (message.endsWith("Updating IntelliSense...")) {
            this.model.isUpdatingIntelliSense.Value = true;
        } else if (message.endsWith("IntelliSense Ready")) {
            this.model.isUpdatingIntelliSense.Value = false;
        } else if (message.endsWith("Ready")) { // Tag Parser Ready
            this.model.isTagParsing.Value = false;
            util.setProgress(util.getProgressParseRootSuccess());
        } else if (message.endsWith("No Squiggles")) {
            util.setIntelliSenseProgress(util.getProgressIntelliSenseNoSquiggles());
        } else if (message.endsWith("IntelliSense Fallback")) {
            let showIntelliSenseFallbackMessage: PersistentState<boolean> = new PersistentState<boolean>("CPP.showIntelliSenseFallbackMessage", true);
            if (showIntelliSenseFallbackMessage.Value) {
                let learnMorePanel: string = "Learn More";
                let dontShowAgain: string = "Don't Show Again";
                vscode.window.showInformationMessage("Configure includePath for better IntelliSense results.", learnMorePanel, dontShowAgain).then((value) => {
                    switch (value) {
                        case learnMorePanel:
                            let uri: vscode.Uri = vscode.Uri.parse(`https://go.microsoft.com/fwlink/?linkid=864631`);
                            vscode.commands.executeCommand('vscode.open', uri);
                            vscode.commands.getCommands(true).then((commands: string[]) => {
                                if (commands.indexOf("workbench.action.problems.focus") >= 0) {
                                    vscode.commands.executeCommand("workbench.action.problems.focus");
                                }
                            });
                            break;
                        case dontShowAgain:
                            showIntelliSenseFallbackMessage.Value = false;
                            break;
                    }
                });
            }
        }
    }

    private updateTagParseStatus(notificationBody: ReportStatusNotificationBody): void {
        this.model.tagParserStatus.Value = notificationBody.status;
    }

    private updateInactiveRegions(params: InactiveRegionParams): void {
        let renderOptions: vscode.DecorationRenderOptions = {
            light: { color: "rgba(175,175,175,1.0)" },
            dark: { color: "rgba(155,155,155,1.0)" },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
        };
        let decoration: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType(renderOptions);

        // We must convert to vscode.Ranges in order to make use of the API's
        let ranges: vscode.Range[] = [];
        params.regions.forEach(element => {
            let newRange : vscode.Range = new vscode.Range(element.startLine, 0, element.endLine, 0);
            ranges.push(newRange);
        });

        // Find entry for cached file and act accordingly
        let valuePair: DecorationRangesPair = this.inactiveRegionsDecorations.get(params.uri);
        if (valuePair) {
            // Disposing of and resetting the decoration will undo previously applied text decorations
            valuePair.decoration.dispose();
            valuePair.decoration = decoration;

            // As vscode.TextEditor.setDecorations only applies to visible editors, we must cache the range for when another editor becomes visible
            valuePair.ranges = ranges;
        } else { // The entry does not exist. Make a new one
            let toInsert: DecorationRangesPair = {
                decoration: decoration,
                ranges: ranges
            };
            this.inactiveRegionsDecorations.set(params.uri, toInsert);
        }

        let settings: CppSettings = new CppSettings(this.RootUri);
        if (settings.dimInactiveRegions) {
            // Apply the decorations to all *visible* text editors
            let editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === params.uri);
            for (let e of editors) {
                e.setDecorations(decoration, ranges);
            }
        }
    }

    /*********************************************
     * requests to the language server
     *********************************************/

    public requestGoToDeclaration(): Thenable<void> {
        return this.requestWhenReady(() => this.languageClient.sendRequest(GoToDeclarationRequest, null));
    }

    public requestSwitchHeaderSource(rootPath: string, fileName: string): Thenable<string> {
        let params: SwitchHeaderSourceParams = {
            rootPath: rootPath,
            switchHeaderSourceFileName: fileName
        };
        return this.requestWhenReady(() => this.languageClient.sendRequest(SwitchHeaderSourceRequest, params));
    }

    public requestNavigationList(document: vscode.TextDocument): Thenable<string> {
        return this.requestWhenReady(() => {
            return this.languageClient.sendRequest(NavigationListRequest, this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document));
        });
    }

    /*********************************************
     * notifications to the language server
     *********************************************/

    public activeDocumentChanged(document: vscode.TextDocument): void {
        this.notifyWhenReady(() => {
            this.languageClient.sendNotification(ActiveDocumentChangeNotification, this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document));
        });
    }

    /**
     * enable UI updates from this client and resume tag parsing on the server.
     */
    public activate(): void {
        for (let key in this.model) {
            if (this.model.hasOwnProperty(key)) {
                this.model[key].activate();
            }
        }
        this.resumeParsing();
    }

    public selectionChanged(selection: vscode.Position): void {
        this.notifyWhenReady(() => this.languageClient.sendNotification(TextEditorSelectionChangeNotification, selection));
    }

    public resetDatabase(): void {
        this.notifyWhenReady(() => this.languageClient.sendNotification(ResetDatabaseNotification));
    }

    /**
     * disable UI updates from this client and pause tag parsing on the server.
     */
    public deactivate(): void {
        for (let key in this.model) {
            if (this.model.hasOwnProperty(key)) {
                this.model[key].deactivate();
            }
        }
        this.pauseParsing();
    }

    public pauseParsing(): void {
        this.notifyWhenReady(() => this.languageClient.sendNotification(PauseParsingNotification));
    }

    public resumeParsing(): void {
        this.notifyWhenReady(() => this.languageClient.sendNotification(ResumeParsingNotification));
    }

    private onConfigurationsChanged(configurations: configs.Configuration[]): void {
        let params: FolderSettingsParams = {
            configurations: configurations,
            currentConfiguration: this.configuration.CurrentConfiguration
        };
        this.notifyWhenReady(() => {
            this.languageClient.sendNotification(ChangeFolderSettingsNotification, params);
            this.model.activeConfigName.Value = configurations[params.currentConfiguration].name;
        });
    }

    private onSelectedConfigurationChanged(index: number): void {
        let params: FolderSelectedSettingParams = {
            currentConfiguration: index
        };
        this.notifyWhenReady(() => {
            this.languageClient.sendNotification(ChangeSelectedSettingNotification, params);
            this.model.activeConfigName.Value = this.configuration.ConfigurationNames[index];
        });
    }

    private onCompileCommandsChanged(path: string): void {
        let params: FileChangedParams = {
            uri: path
        };
        this.notifyWhenReady(() => this.languageClient.sendNotification(ChangeCompileCommandsNotification, params));
    }

    /*********************************************
     * command handlers
     *********************************************/
    public handleConfigurationSelectCommand(): void {
        this.notifyWhenReady(() => {
            ui.showConfigurations(this.configuration.ConfigurationNames)
                .then((index: number) => {
                    if (index < 0) {
                        return;
                    }
                    this.configuration.select(index);
                });
        });
    }

    public handleShowParsingCommands(): void {
        this.notifyWhenReady(() => {
            ui.showParsingCommands()
                .then((index: number) => {
                    if (index === 0) {
                        this.pauseParsing();
                    } else if (index === 1) {
                        this.resumeParsing();
                    }
                });
        });
    }

    public handleConfigurationEditCommand(): void {
        this.notifyWhenReady(() => this.configuration.handleConfigurationEditCommand(vscode.window.showTextDocument));
    }

    public handleAddToIncludePathCommand(path: string): void {
        this.notifyWhenReady(() => this.configuration.addToIncludePathCommand(path));
    }

    public onInterval(): void {
        // These events can be discarded until the language client is ready.
        // Don't queue them up with this.notifyWhenReady calls.
        if (this.languageClient !== undefined && this.configuration !== undefined) {
            this.languageClient.sendNotification(IntervalTimerNotification);
            this.configuration.checkCppProperties();
        }
    }

    public dispose(): Thenable<void> {
        let promise: Thenable<void> = (this.languageClient) ? this.languageClient.stop() : Promise.resolve();
        return promise.then(() => {
            this.disposables.forEach((d) => d.dispose());
            this.disposables = [];

            for (let key in this.model) {
                if (this.model.hasOwnProperty(key)) {
                    this.model[key].dispose();
                }
            }
        });
    }
}

function getLanguageServerFileName(): string {
    let extensionProcessName: string = 'Microsoft.VSCode.CPP.Extension';
    let plat: NodeJS.Platform = process.platform;
    if (plat === 'linux') {
        extensionProcessName += '.linux';
    } else if (plat === 'darwin') {
        extensionProcessName += '.darwin';
    } else if (plat === 'win32') {
        extensionProcessName += '.exe';
    } else {
        throw "Invalid Platform";
    }
    return path.resolve(util.getExtensionFilePath("bin"), extensionProcessName);
}

class NullClient implements Client {
    private booleanEvent = new vscode.EventEmitter<boolean>();
    private stringEvent = new vscode.EventEmitter<string>();

    public get TagParsingChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get IntelliSenseParsingChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get NavigationLocationChanged(): vscode.Event<string> { return this.stringEvent.event; }
    public get TagParserStatusChanged(): vscode.Event<string> { return this.stringEvent.event; }
    public get ActiveConfigChanged(): vscode.Event<string> { return this.stringEvent.event; }
    RootPath: string = "/";
    RootUri: vscode.Uri = vscode.Uri.file("/");
    Name: string = "(empty)";
    TrackedDocuments = new Set<vscode.TextDocument>();
    CustomConfigurationProvider: CustomConfigurationProvider;
    onDidChangeSettings(): void {}
    onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {}
    takeOwnership(document: vscode.TextDocument): void {}
    sendCustomConfiguration(document: vscode.TextDocument, config: SourceFileConfiguration): void {}
    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {}
    requestGoToDeclaration(): Thenable<void> { return Promise.resolve(); }
    requestSwitchHeaderSource(rootPath: string, fileName: string): Thenable<string> { return Promise.resolve(""); }
    requestNavigationList(document: vscode.TextDocument): Thenable<string> { return Promise.resolve(""); }
    activeDocumentChanged(document: vscode.TextDocument): void {}
    activate(): void {}
    selectionChanged(selection: vscode.Position): void {}
    resetDatabase(): void {}
    deactivate(): void {}
    pauseParsing(): void {}
    resumeParsing(): void {}
    handleConfigurationSelectCommand(): void {}
    handleShowParsingCommands(): void {}
    handleConfigurationEditCommand(): void {}
    handleAddToIncludePathCommand(path: string): void {}
    onInterval(): void {}
    dispose(): Thenable<void> {
        this.booleanEvent.dispose();
        this.stringEvent.dispose();
        return Promise.resolve();
    }
}