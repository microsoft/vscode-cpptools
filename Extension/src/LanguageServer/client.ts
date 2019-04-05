/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient, LanguageClientOptions, ServerOptions, NotificationType, TextDocumentIdentifier,
    RequestType, ErrorAction, CloseAction, DidOpenTextDocumentParams, Range
} from 'vscode-languageclient';
import { SourceFileConfigurationItem, WorkspaceBrowseConfiguration, SourceFileConfiguration, Version } from 'vscode-cpptools';
import { Status } from 'vscode-cpptools/out/testApi';
import * as util from '../common';
import * as configs from './configurations';
import { CppSettings, OtherSettings } from './settings';
import * as telemetry from '../telemetry';
import { PersistentState, PersistentFolderState } from './persistentState';
import { UI, getUI } from './ui';
import { ClientCollection } from './clientCollection';
import { createProtocolFilter } from './protocolFilter';
import { DataBinding } from './dataBinding';
import minimatch = require("minimatch");
import * as logger from '../logger';
import { updateLanguageConfigurations, registerCommands } from './extension';
import { CancellationTokenSource } from 'vscode';
import { SettingsTracker, getTracker } from './settingsTracker';
import { getTestHook, TestHook } from '../testHook';
import { getCustomConfigProviders, CustomConfigurationProviderCollection, CustomConfigurationProvider1 } from '../LanguageServer/customProviders';
import { ABTestSettings, getABTestSettings } from '../abTesting';
import * as fs from 'fs';
import * as os from 'os';

let ui: UI;
const configProviderTimeout: number = 2000;

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

// Need to convert vscode.Uri to a string before sending it to the language server.
interface SourceFileConfigurationItemAdapter {
    uri: string;
    configuration: SourceFileConfiguration;
}

interface CustomConfigurationParams {
    configurationItems: SourceFileConfigurationItemAdapter[];
}

interface CustomBrowseConfigurationParams {
    browseConfiguration: WorkspaceBrowseConfiguration;
}

interface CompileCommandsPaths {
    paths: string[];
}

interface QueryTranslationUnitSourceParams {
    uri: string;
}

export enum QueryTranslationUnitSourceConfigDisposition {

    /**
     * No custom config needed for this file
     */
    ConfigNotNeeded = 0,

    /**
     * Custom config is needed for this file
     */
    ConfigNeeded = 1,

    /**
     * Custom config is needed for the ancestor file returned in uri
     */
    AncestorConfigNeeded = 2
}

interface QueryTranslationUnitSourceResult {
    uri: string;
    configDisposition: QueryTranslationUnitSourceConfigDisposition;
}

// Requests
const NavigationListRequest: RequestType<TextDocumentIdentifier, string, void, void> = new RequestType<TextDocumentIdentifier, string, void, void>('cpptools/requestNavigationList');
const GoToDeclarationRequest: RequestType<void, void, void, void> = new RequestType<void, void, void, void>('cpptools/goToDeclaration');
const QueryCompilerDefaultsRequest: RequestType<QueryCompilerDefaultsParams, configs.CompilerDefaults, void, void> = new RequestType<QueryCompilerDefaultsParams, configs.CompilerDefaults, void, void>('cpptools/queryCompilerDefaults');
const QueryTranslationUnitSourceRequest: RequestType<QueryTranslationUnitSourceParams, QueryTranslationUnitSourceResult, void, void> = new RequestType<QueryTranslationUnitSourceParams, QueryTranslationUnitSourceResult, void, void>('cpptools/queryTranslationUnitSource');
const SwitchHeaderSourceRequest: RequestType<SwitchHeaderSourceParams, string, void, void> = new RequestType<SwitchHeaderSourceParams, string, void, void>('cpptools/didSwitchHeaderSource');

// Notifications to the server
const DidOpenNotification: NotificationType<DidOpenTextDocumentParams, void> = new NotificationType<DidOpenTextDocumentParams, void>('textDocument/didOpen');
const FileCreatedNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/fileCreated');
const FileDeletedNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/fileDeleted');
const ResetDatabaseNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/resetDatabase');
const PauseParsingNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/pauseParsing');
const ResumeParsingNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/resumeParsing');
const ActiveDocumentChangeNotification: NotificationType<TextDocumentIdentifier, void> = new NotificationType<TextDocumentIdentifier, void>('cpptools/activeDocumentChange');
const TextEditorSelectionChangeNotification: NotificationType<Range, void> = new NotificationType<Range, void>('cpptools/textEditorSelectionChange');
const ChangeFolderSettingsNotification: NotificationType<FolderSettingsParams, void> = new NotificationType<FolderSettingsParams, void>('cpptools/didChangeFolderSettings');
const ChangeCompileCommandsNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/didChangeCompileCommands');
const ChangeSelectedSettingNotification: NotificationType<FolderSelectedSettingParams, void> = new NotificationType<FolderSelectedSettingParams, void>('cpptools/didChangeSelectedSetting');
const IntervalTimerNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/onIntervalTimer');
const CustomConfigurationNotification: NotificationType<CustomConfigurationParams, void> = new NotificationType<CustomConfigurationParams, void>('cpptools/didChangeCustomConfiguration');
const CustomBrowseConfigurationNotification: NotificationType<CustomBrowseConfigurationParams, void> = new NotificationType<CustomBrowseConfigurationParams, void>('cpptools/didChangeCustomBrowseConfiguration');
const ClearCustomConfigurationsNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/clearCustomConfigurations');

// Notifications from the server
const ReloadWindowNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/reloadWindow');
const LogTelemetryNotification: NotificationType<TelemetryPayload, void> = new NotificationType<TelemetryPayload, void>('cpptools/logTelemetry');
const ReportNavigationNotification: NotificationType<NavigationPayload, void> = new NotificationType<NavigationPayload, void>('cpptools/reportNavigation');
const ReportTagParseStatusNotification: NotificationType<ReportStatusNotificationBody, void> = new NotificationType<ReportStatusNotificationBody, void>('cpptools/reportTagParseStatus');
const ReportStatusNotification: NotificationType<ReportStatusNotificationBody, void> = new NotificationType<ReportStatusNotificationBody, void>('cpptools/reportStatus');
const DebugProtocolNotification: NotificationType<OutputNotificationBody, void> = new NotificationType<OutputNotificationBody, void>('cpptools/debugProtocol');
const DebugLogNotification:  NotificationType<OutputNotificationBody, void> = new NotificationType<OutputNotificationBody, void>('cpptools/debugLog');
const InactiveRegionNotification:  NotificationType<InactiveRegionParams, void> = new NotificationType<InactiveRegionParams, void>('cpptools/inactiveRegions');
const CompileCommandsPathsNotification:  NotificationType<CompileCommandsPaths, void> = new NotificationType<CompileCommandsPaths, void>('cpptools/compileCommandsPaths');
const UpdateClangFormatPathNotification: NotificationType<string, void> = new NotificationType<string, void>('cpptools/updateClangFormatPath');
const UpdateIntelliSenseCachePathNotification: NotificationType<string, void> = new NotificationType<string, void>('cpptools/updateIntelliSenseCachePath');

class BlockingTask<T> {
    private dependency: BlockingTask<any>;
    private done: boolean = false;
    private promise: Promise<T>;

    constructor(task: () => T, dependency?: BlockingTask<any>) {
        this.promise = new Promise<T>(async (resolve, reject) => {
            try {
                let result: T = await task();
                resolve(result);
                this.done = true;
            } catch (err) {
                reject(err);
                this.done = true;
            }
        });
        this.dependency = dependency;
    }

    public get Done(): boolean {
        return this.done && (!this.dependency || this.dependency.Done);
    }

    public then(onSucceeded: (value: T) => any, onRejected: (err) => any): Promise<any> {
        return this.promise.then(onSucceeded, onRejected);
    }
}

let failureMessageShown: boolean = false;

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
    onDidChangeSettings(): { [key: string] : string };
    onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void;
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void>;
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    provideCustomConfiguration(document: vscode.TextDocument): Promise<void>;
    getCurrentConfigName(): Thenable<string>;
    getCompilerPath(): Thenable<string>;
    getKnownCompilers(): Thenable<configs.KnownCompiler[]>;
    takeOwnership(document: vscode.TextDocument): void;
    queueTask<T>(task: () => Thenable<T>): Thenable<T>;
    requestWhenReady(request: () => Thenable<any>): Thenable<any>;
    notifyWhenReady(notify: () => void): void;
    requestGoToDeclaration(): Thenable<void>;
    requestSwitchHeaderSource(rootPath: string, fileName: string): Thenable<string>;
    requestNavigationList(document: vscode.TextDocument): Thenable<string>;
    activeDocumentChanged(document: vscode.TextDocument): void;
    activate(): void;
    selectionChanged(selection: Range): void;
    resetDatabase(): void;
    deactivate(): void;
    pauseParsing(): void;
    resumeParsing(): void;
    handleConfigurationSelectCommand(): void;
    handleConfigurationProviderSelectCommand(): void;
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
    private isSupported: boolean = true;
    private inactiveRegionsDecorations = new Map<string, DecorationRangesPair>();
    private settingsTracker: SettingsTracker;
    private configurationProvider: string;

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

    private get AdditionalEnvironment(): { [key: string]: string | string[] } {
        return { workspaceFolderBasename: this.Name };
    }

    private getName(workspaceFolder?: vscode.WorkspaceFolder): string {
        return workspaceFolder ? workspaceFolder.name : "untitled";
    }

    /**
     * All public methods on this class must be guarded by the "pendingTask" promise. Requests and notifications received before the task is
     * complete are executed after this promise is resolved.
     * @see requestWhenReady<T>(request)
     * @see notifyWhenReady(notify)
     */

    private pendingTask: BlockingTask<void>;

    constructor(allClients: ClientCollection, workspaceFolder?: vscode.WorkspaceFolder) {
        try {
            let languageClient: LanguageClient = this.createLanguageClient(allClients, workspaceFolder);
            languageClient.registerProposedFeatures();
            languageClient.start();  // This returns Disposable, but doesn't need to be tracked because we call .stop() explicitly in our dispose()
            util.setProgress(util.getProgressExecutableStarted());
            this.rootFolder = workspaceFolder;
            ui = getUI();
            ui.bind(this);

            // requests/notifications are deferred until this.languageClient is set.
            this.queueBlockingTask(() => languageClient.onReady().then(
                () => {
                    this.configuration = new configs.CppProperties(this.RootUri);
                    this.configuration.ConfigurationsChanged((e) => this.onConfigurationsChanged(e));
                    this.configuration.SelectionChanged((e) => this.onSelectedConfigurationChanged(e));
                    this.configuration.CompileCommandsChanged((e) => this.onCompileCommandsChanged(e));
                    this.disposables.push(this.configuration);

                    this.languageClient = languageClient;
                    this.settingsTracker = getTracker(this.RootUri);
                    telemetry.logLanguageServerEvent("NonDefaultInitialCppSettings", this.settingsTracker.getUserModifiedSettings());
                    failureMessageShown = false;

                    // Listen for messages from the language server.
                    this.registerNotifications();
                    this.registerFileWatcher();

                    // The configurations will not be sent to the language server until the default include paths and frameworks have been set.
                    // The event handlers must be set before this happens.
                    return languageClient.sendRequest(QueryCompilerDefaultsRequest, {}).then((compilerDefaults: configs.CompilerDefaults) => {
                        this.configuration.CompilerDefaults = compilerDefaults;
                            
                        // Only register the real commands after the extension has finished initializing,
                        // e.g. prevents empty c_cpp_properties.json from generation.
                        registerCommands();
                    });
                },
                (err) => {
                    this.isSupported = false;   // Running on an OS we don't support yet.
                    if (!failureMessageShown) {
                        failureMessageShown = true;
                        vscode.window.showErrorMessage("Unable to start the C/C++ language server. IntelliSense features will be disabled. Error: " + String(err));
                    }
                }));
        } catch (err) {
            this.isSupported = false;   // Running on an OS we don't support yet.
            if (!failureMessageShown) {
                failureMessageShown = true;
                let additionalInfo: string;
                if (err.code === "EPERM") {
                    additionalInfo = `EPERM: Check permissions for '${getLanguageServerFileName()}'`;
                } else {
                    additionalInfo = String(err);
                }
                vscode.window.showErrorMessage("Unable to start the C/C++ language server. IntelliSense features will be disabled. Error: " + additionalInfo);
            }
        }
    }

    private createLanguageClient(allClients: ClientCollection, workspaceFolder?: vscode.WorkspaceFolder): LanguageClient {
        let serverModule: string = getLanguageServerFileName();
        let exeExists: boolean = fs.existsSync(serverModule);
        if (!exeExists) {
            throw String('Missing binary at ' + serverModule);
        }
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

        let abTestSettings: ABTestSettings = getABTestSettings();
        
        let intelliSenseCacheDisabled: boolean = false;
        if (os.platform() === "darwin") {
            const releaseParts: string[] = os.release().split(".");
            if (releaseParts.length >= 1) {
                // AutoPCH doesn't work for older Mac OS's.
                intelliSenseCacheDisabled = parseInt(releaseParts[0]) < 17;
            }
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
                clang_format_path: util.resolveVariables(settings.clangFormatPath, this.AdditionalEnvironment),
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
                intelliSenseCacheDisabled: intelliSenseCacheDisabled,
                intelliSenseCachePath : util.resolveVariables(settings.intelliSenseCachePath, this.AdditionalEnvironment),
                intelliSenseCacheSize : settings.intelliSenseCacheSize,
                autocomplete: settings.autoComplete,
                errorSquiggles: settings.errorSquiggles,
                dimInactiveRegions: settings.dimInactiveRegions,
                suggestSnippets: settings.suggestSnippets,
                loggingLevel: settings.loggingLevel,
                workspaceParsingPriority: settings.workspaceParsingPriority,
                workspaceSymbols: settings.workspaceSymbols,
                exclusionPolicy: settings.exclusionPolicy,
                preferredPathSeparator: settings.preferredPathSeparator,
                default: {
                    systemIncludePath: settings.defaultSystemIncludePath
                },
                vcpkg_root: util.getVcpkgRoot(),
                gotoDefIntelliSense: abTestSettings.UseGoToDefIntelliSense
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

    public onDidChangeSettings(): { [key: string] : string } {
        let changedSettings: { [key: string] : string } = this.settingsTracker.getChangedSettings();

        if (Object.keys(changedSettings).length > 0) {
            if (changedSettings["commentContinuationPatterns"]) {
                updateLanguageConfigurations();
            }
            if (changedSettings["clang_format_path"]) {
                let settings: CppSettings = new CppSettings(this.RootUri);
                this.languageClient.sendNotification(UpdateClangFormatPathNotification, util.resolveVariables(settings.clangFormatPath, this.AdditionalEnvironment));
            }
            if (changedSettings["intelliSenseCachePath"]) {
                let settings: CppSettings = new CppSettings(this.RootUri);
                this.languageClient.sendNotification(UpdateIntelliSenseCachePathNotification, util.resolveVariables(settings.intelliSenseCachePath, this.AdditionalEnvironment));
            }
            this.configuration.onDidChangeSettings();
            telemetry.logLanguageServerEvent("CppSettingsChange", changedSettings, null);
        }

        return changedSettings;
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

    public onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void> {
        let onRegistered: () => void = () => {
            // version 2 providers control the browse.path. Avoid thrashing the tag parser database by pausing parsing until
            // the provider has sent the correct browse.path value.
            if (provider.version >= Version.v2) {
                this.pauseParsing();
            }
        };
        return this.notifyWhenReady(() => {
            if (!this.RootPath) {
                return; // There is no c_cpp_properties.json to edit because there is no folder open.
            }
            let selectedProvider: string = this.configuration.CurrentConfigurationProvider;
            if (!selectedProvider) {
                let ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("Client.registerProvider", true, this.RootPath);
                if (ask.Value) {
                    ui.showConfigureCustomProviderMessage(() => {
                        let folderStr: string = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) ? "the '" + this.Name + "'" : "this";
                        const message: string = `${provider.name} would like to configure IntelliSense for ${folderStr} folder.`;
                        const allow: string = "Allow";
                        const dontAllow: string = "Don't Allow";
                        const askLater: string = "Ask Me Later";

                        return vscode.window.showInformationMessage(message, allow, dontAllow, askLater).then(result => {
                            switch (result) {
                                case allow: {
                                    this.configuration.updateCustomConfigurationProvider(provider.extensionId).then(() => {
                                        onRegistered();
                                        telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": provider.extensionId });
                                    });
                                    ask.Value = false;
                                    return true;
                                }
                                case dontAllow: {
                                    ask.Value = false;
                                    break;
                                }
                                default: {
                                    break;
                                }
                            }
                            return false;
                        });
                    },
                    () => ask.Value = false);
                }
            } else if (selectedProvider === provider.extensionId) {
                onRegistered();
                telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": provider.extensionId });
            } else if (selectedProvider === provider.name) {
                onRegistered();
                this.configuration.updateCustomConfigurationProvider(provider.extensionId); // v0 -> v1 upgrade. Update the configurationProvider in c_cpp_properties.json
            }
        });
    }

    public updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void> {
        return this.notifyWhenReady(() => {
            if (!this.configurationProvider) {
                return;
            }
            let currentProvider: CustomConfigurationProvider1 = getCustomConfigProviders().get(this.configurationProvider);
            if (!currentProvider || (requestingProvider && requestingProvider.extensionId !== currentProvider.extensionId) || this.trackedDocuments.size === 0) {
                return;
            }

            let tokenSource: CancellationTokenSource = new CancellationTokenSource();
            let documentUris: vscode.Uri[] = [];
            this.trackedDocuments.forEach(document => documentUris.push(document.uri));

            let task: () => Thenable<SourceFileConfigurationItem[]> = () => {
                return currentProvider.provideConfigurations(documentUris, tokenSource.token);
            };
            this.queueTaskWithTimeout(task, configProviderTimeout, tokenSource).then(configs => this.sendCustomConfigurations(configs), () => {});
        });
    }

    public updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void> {
        return this.notifyWhenReady(() => {
            if (!this.configurationProvider) {
                return;
            }
            console.log("updateCustomBrowseConfiguration");
            let currentProvider: CustomConfigurationProvider1 = getCustomConfigProviders().get(this.configurationProvider);
            if (!currentProvider || (requestingProvider && requestingProvider.extensionId !== currentProvider.extensionId)) {
                return;
            }

            let tokenSource: CancellationTokenSource = new CancellationTokenSource();
            let task: () => Thenable<WorkspaceBrowseConfiguration> = async () => {
                if (await currentProvider.canProvideBrowseConfiguration(tokenSource.token)) {
                    return currentProvider.provideBrowseConfiguration(tokenSource.token);
                }
                if (currentProvider.version >= Version.v2) {
                    console.warn("failed to provide browse configuration");
                }
                return Promise.reject("");
            };
            this.queueTaskWithTimeout(task, configProviderTimeout, tokenSource).then(
                async config => {
                    await this.sendCustomBrowseConfiguration(config);
                    this.resumeParsing();
                },
                () => {});
        });
    }

    public async provideCustomConfiguration(document: vscode.TextDocument): Promise<void> {
        let params: QueryTranslationUnitSourceParams = {
            uri: document.uri.toString()
        };
        let response: QueryTranslationUnitSourceResult = await this.requestWhenReady(() => this.languageClient.sendRequest(QueryTranslationUnitSourceRequest, params));
        if (response.configDisposition === QueryTranslationUnitSourceConfigDisposition.ConfigNotNeeded) {
            return Promise.resolve();
        }

        let tuUri: vscode.Uri = vscode.Uri.parse(response.uri);
        let tokenSource: CancellationTokenSource = new CancellationTokenSource();
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        if (providers.size === 0) {
            return Promise.resolve();
        }
        console.log("provideCustomConfiguration");
        let providerId: string|undefined = await this.getCustomConfigurationProviderId();
        if (!providerId) {
            return Promise.resolve();
        }

        let providerName: string = providerId;
        let configName: string = await this.getCurrentConfigName();
        const notReadyMessage: string = `${providerName} is not ready`;
        let provideConfigurationAsync: () => Thenable<SourceFileConfigurationItem[]> = async () => {
            // The config requests that we use a provider, try to get IntelliSense configuration info from that provider.
            try {
                let provider: CustomConfigurationProvider1|null = providers.get(providerId);
                if (provider) {
                    if (!provider.isReady) {
                        return Promise.reject(notReadyMessage);
                    }

                    providerName = provider.name;
                    if (await provider.canProvideConfiguration(tuUri, tokenSource.token)) {
                        return provider.provideConfigurations([tuUri], tokenSource.token);
                    }
                }
            } catch (err) {
            }
            console.warn("failed to provide configuration");
            return Promise.reject("");
        };

        return this.queueTaskWithTimeout(provideConfigurationAsync, configProviderTimeout, tokenSource).then(
            (configs: SourceFileConfigurationItem[]) => {
                if (configs && configs.length > 0) {
                    this.sendCustomConfigurations(configs, true);
                    if (response.configDisposition === QueryTranslationUnitSourceConfigDisposition.AncestorConfigNeeded) {
                        // replacing uri with original uri
                        let newConfig: SourceFileConfigurationItem =  { uri: document.uri, configuration: configs[0].configuration };
                        this.sendCustomConfigurations([newConfig], true);
                    }
                }
            },
            (err) => {
                if (err === notReadyMessage) {
                    return;
                }
                let settings: CppSettings = new CppSettings(this.RootUri);
                if (settings.configurationWarnings === "Enabled" && !this.isExternalHeader(document.uri) && !vscode.debug.activeDebugSession) {
                    const dismiss: string = "Dismiss";
                    const disable: string = "Disable Warnings";
                    let message: string = `'${providerName}' is unable to provide IntelliSense configuration information for '${document.uri.fsPath}'. ` +
                        `Settings from the '${configName}' configuration will be used instead.`;
                    if (err) {
                        message += ` (${err})`;
                    }

                    vscode.window.showInformationMessage(message, dismiss, disable).then(response => {
                            switch (response) {
                                case disable: {
                                    settings.toggleSetting("configurationWarnings", "Enabled", "Disabled");
                                    break;
                                }
                            }
                        });
                }
            });
    }

    private isExternalHeader(uri: vscode.Uri): boolean {
        return util.isHeader(uri) && !uri.toString().startsWith(this.RootUri.toString());
    }

    private getCustomConfigurationProviderId(): Thenable<string|undefined> {
        return this.queueTask(() => Promise.resolve(this.configuration.CurrentConfigurationProvider));
    }

    public getCurrentConfigName(): Thenable<string> {
        return this.queueTask(() => Promise.resolve(this.configuration.CurrentConfiguration.name));
    }

    public getCompilerPath(): Thenable<string> {
        return this.queueTask(() => Promise.resolve(this.configuration.CompilerPath));
    }

    public getKnownCompilers(): Thenable<configs.KnownCompiler[]> {
        return this.queueTask(() => Promise.resolve(this.configuration.KnownCompiler));
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

    /*************************************************************************************
     * wait until the all pendingTasks are complete (e.g. language client is ready for use)
     * before attempting to send messages or operate on the client.
     *************************************************************************************/

    public queueTask(task: () => Thenable<any>): Thenable<any> {
        if (this.isSupported) {
            let nextTask: () => Thenable<any> = async () => {
                try {
                    return await task();
                } catch (err) {
                    console.error(err);
                    throw err;
                }
            };
            
            if (this.pendingTask && !this.pendingTask.Done) {
                // We don't want the queue to stall because of a rejected promise.
                return this.pendingTask.then(nextTask, nextTask);
            } else {
                this.pendingTask = undefined;
                return nextTask();
            }
        } else {
            return Promise.reject("Unsupported client");
        }
    }

    /**
     * Queue a task that blocks all future tasks until it completes. This is currently only intended to be used
     * during language client startup and for custom configuration providers.
     * @param task The task that blocks all future tasks
     */
    private queueBlockingTask(task: () => Thenable<void>): Thenable<void> {
        if (this.isSupported) {
            this.pendingTask = new BlockingTask<void>(task, this.pendingTask);
        } else {
            return Promise.reject("Unsupported client");
        }
    }

    private queueTaskWithTimeout(task: () => Thenable<any>, ms: number, cancelToken?: CancellationTokenSource): Thenable<any> {
        let timer: NodeJS.Timer;
        // Create a promise that rejects in <ms> milliseconds
        let timeout: () => Promise<any> = () => new Promise((resolve, reject) => {
            timer = setTimeout(() => {
                clearTimeout(timer);
                if (cancelToken) {
                    cancelToken.cancel();
                }
                reject("Timed out in " + ms + "ms.");
            }, ms);
        });

        // Returns a race between our timeout and the passed in promise
        return this.queueTask(() => {
            return Promise.race([task(), timeout()]).then(
                (result: any) => {
                    clearTimeout(timer);
                    return result;
                },
                (error: any) => {
                    clearTimeout(timer);
                    throw error;
                });
        });
    }

    public requestWhenReady(request: () => Thenable<any>): Thenable<any> {
        return this.queueTask(request);
    }

    public notifyWhenReady(notify: () => void, blockingTask?: boolean): Thenable<void> {
        let task: () => Thenable<void> = () => new Promise(resolve => {
            notify();
            resolve();
        });
        if (blockingTask) {
            return this.queueBlockingTask(task);
        } else {
            return this.queueTask(task);
        }
    }

    /**
     * listen for notifications from the language server.
     */
    private registerNotifications(): void {
        console.assert(this.languageClient !== undefined, "This method must not be called until this.languageClient is set in \"onReady\"");

        this.languageClient.onNotification(ReloadWindowNotification, () => util.promptForReloadWindowDueToSettingsChange());
        this.languageClient.onNotification(LogTelemetryNotification, (e) => this.logTelemetry(e));
        this.languageClient.onNotification(ReportNavigationNotification, (e) => this.navigate(e));
        this.languageClient.onNotification(ReportStatusNotification, (e) => this.updateStatus(e));
        this.languageClient.onNotification(ReportTagParseStatusNotification, (e) => this.updateTagParseStatus(e));
        this.languageClient.onNotification(InactiveRegionNotification, (e) => this.updateInactiveRegions(e));
        this.languageClient.onNotification(CompileCommandsPathsNotification, (e) => this.promptCompileCommands(e));
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
                "**/*",
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
        let testHook: TestHook = getTestHook();
        if (message.endsWith("Indexing...")) {
            this.model.isTagParsing.Value = true;
            testHook.updateStatus(Status.TagParsingBegun);
        } else if (message.endsWith("Updating IntelliSense...")) {
            this.model.isUpdatingIntelliSense.Value = true;
            testHook.updateStatus(Status.IntelliSenseCompiling);
        } else if (message.endsWith("IntelliSense Ready")) {
            this.model.isUpdatingIntelliSense.Value = false;
            testHook.updateStatus(Status.IntelliSenseReady);
        } else if (message.endsWith("Ready")) { // Tag Parser Ready
            this.model.isTagParsing.Value = false;
            testHook.updateStatus(Status.TagParsingDone);
            util.setProgress(util.getProgressParseRootSuccess());
        } else if (message.endsWith("No Squiggles")) {
            util.setIntelliSenseProgress(util.getProgressIntelliSenseNoSquiggles());
        } else if (message.endsWith("IntelliSense Fallback")) {
            let showIntelliSenseFallbackMessage: PersistentState<boolean> = new PersistentState<boolean>("CPP.showIntelliSenseFallbackMessage", true);
            if (showIntelliSenseFallbackMessage.Value) {
                ui.showConfigureIncludePathMessage(() => {
                    let learnMorePanel: string = "Configuration Help";
                    let dontShowAgain: string = "Don't Show Again";
                    let fallbackMsg: string = this.configuration.VcpkgInstalled ?
                        "Update your IntelliSense settings or use Vcpkg to install libraries to help find missing headers." :
                        "Configure your IntelliSense settings to help find missing headers.";
                    return vscode.window.showInformationMessage(fallbackMsg, learnMorePanel, dontShowAgain).then((value) => {
                        switch (value) {
                            case learnMorePanel:
                                let uri: vscode.Uri = vscode.Uri.parse(`https://go.microsoft.com/fwlink/?linkid=864631`);
                                vscode.commands.executeCommand('vscode.open', uri);
                                vscode.commands.getCommands(true).then((commands: string[]) => {
                                    if (commands.indexOf("workbench.action.problems.focus") >= 0) {
                                        vscode.commands.executeCommand("workbench.action.problems.focus");
                                    }
                                });
                                this.handleConfigurationEditCommand();
                                break;
                            case dontShowAgain:
                                showIntelliSenseFallbackMessage.Value = false;
                                break;
                        }
                        return true;
                    });
                },
                () => showIntelliSenseFallbackMessage.Value = false);
            }
        }
    }

    private updateTagParseStatus(notificationBody: ReportStatusNotificationBody): void {
        this.model.tagParserStatus.Value = notificationBody.status;
    }

    private updateInactiveRegions(params: InactiveRegionParams): void {
        let settings: CppSettings = new CppSettings(this.RootUri);

        let decoration: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
            opacity: settings.inactiveRegionOpacity.toString(),
            backgroundColor: settings.inactiveRegionBackgroundColor,
            color: settings.inactiveRegionForegroundColor,
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
        });

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

        if (settings.dimInactiveRegions) {
            // Apply the decorations to all *visible* text editors
            let editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === params.uri);
            for (let e of editors) {
                e.setDecorations(decoration, ranges);
            }
        }
    }

    private promptCompileCommands(params: CompileCommandsPaths) : void {
        if (this.configuration.CurrentConfiguration.compileCommands !== undefined) {
            return;
        }

        let ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("CPP.showCompileCommandsSelection", true, this.RootPath);
        if (!ask.Value) {
            return;
        }

        let compileCommandStr: string = params.paths.length > 1 ? "a compile_commands.json file" : params.paths[0];
        let folderStr: string = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) ? "the '" + this.Name + "'" : "this";
        const message: string = `Would you like to use ${compileCommandStr} to auto-configure IntelliSense for ${folderStr} folder?`;

        ui.showConfigureCompileCommandsMessage(() => {
            const yes: string = "Yes";
            const no: string = "No";
            const askLater: string = "Ask Me Later";
            return vscode.window.showInformationMessage(message, yes, no, askLater).then(async (value) => {
                switch (value) {
                    case yes:
                        if (params.paths.length > 1) {
                            let index: number = await ui.showCompileCommands(params.paths);
                            if (index < 0) {
                                return false;
                            }
                            this.configuration.setCompileCommands(params.paths[index]);
                        } else {
                            this.configuration.setCompileCommands(params.paths[0]);
                        }
                        return true;
                    case askLater:
                        break;
                    case no:
                        ask.Value = false;
                        break;
                }
                return false;
            });
        },
        () => ask.Value = false);
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

    public selectionChanged(selection: Range): void {
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
            currentConfiguration: this.configuration.CurrentConfigurationIndex
        };
        this.notifyWhenReady(() => {
            this.languageClient.sendNotification(ChangeFolderSettingsNotification, params);
            this.model.activeConfigName.Value = configurations[params.currentConfiguration].name;
        }).then(() => {
            let newProvider: string = this.configuration.CurrentConfigurationProvider;
            if (this.configurationProvider !== newProvider) {
                if (this.configurationProvider) {
                    this.clearCustomConfigurations();
                }
                this.configurationProvider = newProvider;
                this.updateCustomConfigurations();
                this.updateCustomBrowseConfiguration();
            }
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

    private isSourceFileConfigurationItem(input: any): input is SourceFileConfigurationItem {
        return (input && (util.isString(input.uri) || util.isUri(input.uri)) &&
            input.configuration && util.isArrayOfString(input.configuration.includePath) && util.isArrayOfString(input.configuration.defines) &&
            util.isString(input.configuration.intelliSenseMode) && util.isString(input.configuration.standard) && util.isOptionalString(input.configuration.compilerPath) &&
            util.isOptionalArrayOfString(input.configuration.forcedInclude));
    }

    private sendCustomConfigurations(configs: any, blockingTask?: boolean): void {
        // configs is marked as 'any' because it is untrusted data coming from a 3rd-party. We need to sanitize it before sending it to the language server.
        if (!configs || !(configs instanceof Array)) {
            console.warn("discarding invalid SourceFileConfigurationItems[]: " + configs);
            return;
        }

        let settings: CppSettings = new CppSettings(this.RootUri);
        let out: logger.Logger = logger.getOutputChannelLogger();
        if (settings.loggingLevel === "Debug") {
            out.appendLine("Custom configurations received:");
        }
        let sanitized: SourceFileConfigurationItemAdapter[] = [];
        configs.forEach(item => {
            if (this.isSourceFileConfigurationItem(item)) {
                sanitized.push({
                    uri: item.uri.toString(),
                    configuration: item.configuration
                });
                if (settings.loggingLevel === "Debug") {
                    out.appendLine(`  uri: ${item.uri.toString()}`);
                    out.appendLine(`  config: ${JSON.stringify(item.configuration, null, 2)}`);
                }
                if (item.configuration.includePath.some(path => path.endsWith('**'))) {
                    console.warn("custom include paths should not use recursive includes ('**')");
                }
            } else {
                console.warn("discarding invalid SourceFileConfigurationItem: " + item);
            }
        });

        if (sanitized.length === 0) {
            return;
        }

        let params: CustomConfigurationParams = {
            configurationItems: sanitized
        };
        this.notifyWhenReady(() => this.languageClient.sendNotification(CustomConfigurationNotification, params), blockingTask);
    }

    private sendCustomBrowseConfiguration(config: any): Thenable<void> {
        // config is marked as 'any' because it is untrusted data coming from a 3rd-party. We need to sanitize it before sending it to the language server.
        if (!config || config instanceof Array) {
            console.warn("discarding invalid WorkspaceBrowseConfiguration: " + config);
            return Promise.resolve();
        }
        let sanitized: WorkspaceBrowseConfiguration = <WorkspaceBrowseConfiguration>config;
        if (!util.isArrayOfString(sanitized.browsePath) || !util.isOptionalString(sanitized.compilerPath) ||
            !util.isOptionalString(sanitized.standard) || !util.isOptionalString(sanitized.windowsSdkVersion)) {
            console.warn("discarding invalid WorkspaceBrowseConfiguration: " + config);
            return Promise.resolve();
        }

        let settings: CppSettings = new CppSettings(this.RootUri);
        let out: logger.Logger = logger.getOutputChannelLogger();
        if (settings.loggingLevel === "Debug") {
            out.appendLine(`Custom browse configuration received: ${JSON.stringify(sanitized, null, 2)}`);
        }

        let params: CustomBrowseConfigurationParams = {
            browseConfiguration: sanitized
        };
        return this.notifyWhenReady(() => this.languageClient.sendNotification(CustomBrowseConfigurationNotification, params));
    }

    private clearCustomConfigurations(): void {
        this.notifyWhenReady(() => this.languageClient.sendNotification(ClearCustomConfigurationsNotification));
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

    public handleConfigurationProviderSelectCommand(): void {
        this.notifyWhenReady(() => {
            ui.showConfigurationProviders(this.configuration.CurrentConfigurationProvider)
                .then(extensionId => {
                    if (extensionId === undefined) {
                        // operation was cancelled.
                        return;
                    }
                    this.configuration.updateCustomConfigurationProvider(extensionId)
                        .then(() => {
                            if (extensionId) {
                                let provider: CustomConfigurationProvider1 = getCustomConfigProviders().get(extensionId);
                                this.updateCustomConfigurations(provider);
                                this.updateCustomBrowseConfiguration(provider);
                                telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": extensionId });
                            } else {
                                this.clearCustomConfigurations();
                            }
                        });
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
    onDidChangeSettings(): { [key: string] : string } { return {}; }
    onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {}
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    provideCustomConfiguration(document: vscode.TextDocument): Promise<void> { return Promise.resolve(); }
    getCurrentConfigName(): Thenable<string> { return Promise.resolve(""); }
    getCompilerPath(): Thenable<string> { return Promise.resolve(""); }
    getKnownCompilers(): Thenable<configs.KnownCompiler[]> { return Promise.resolve([]); }
    takeOwnership(document: vscode.TextDocument): void {}
    queueTask<T>(task: () => Thenable<T>): Thenable<T> { return task(); }
    requestWhenReady(request: () => Thenable<any>): Thenable<any> { return; }
    notifyWhenReady(notify: () => void): void {}
    requestGoToDeclaration(): Thenable<void> { return Promise.resolve(); }
    requestSwitchHeaderSource(rootPath: string, fileName: string): Thenable<string> { return Promise.resolve(""); }
    requestNavigationList(document: vscode.TextDocument): Thenable<string> { return Promise.resolve(""); }
    activeDocumentChanged(document: vscode.TextDocument): void {}
    activate(): void {}
    selectionChanged(selection: Range): void {}
    resetDatabase(): void {}
    deactivate(): void {}
    pauseParsing(): void {}
    resumeParsing(): void {}
    handleConfigurationSelectCommand(): void {}
    handleConfigurationProviderSelectCommand(): void {}
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
