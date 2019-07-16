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
import { SettingsTracker, getTracker } from './settingsTracker';
import { getTestHook, TestHook } from '../testHook';
import { getCustomConfigProviders, CustomConfigurationProviderCollection, CustomConfigurationProvider1 } from '../LanguageServer/customProviders';
import { ABTestSettings, getABTestSettings } from '../abTesting';
import * as fs from 'fs';
import * as os from 'os';
import { TokenKind, ColorizationSettings, ColorizationState } from './colorization';

let ui: UI;
let timeStamp: number = 0;
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

interface SemanticColorizationRegionsParams {
    uri: string;
    regions: InputColorizationRegion[];
    inactiveRegions: InputRegion[];
    editVersion: number;
}

interface InputRegion {
    startLine: number;
    endLine: number;
}

interface InputColorizationRegion {
    range: Range;
    kind: number;
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

interface GetDiagnosticsResult {
    diagnostics: string;
}

interface DidChangeVisibleRangesParams {
    uri: string;
    ranges: Range[];
}

interface SemanticColorizationRegionsReceiptParams {
    uri: string;
}

interface ColorThemeChangedParams {
    name: string;
}

enum ReferenceType {
    Confirmed,
    ConfirmationInProgress,
    ConfirmationCanceled,
    Comment,
    String,
    Inactive,
    CannotConfirm,
    NotAReference
}

interface ReferenceInfo {
    file: string;
    position: vscode.Position;
    text: string;
    type: ReferenceType;
}

interface ReferencesResult {
    referenceInfos: ReferenceInfo[];
    isInitialResult: boolean;
    isFinalResult: boolean;
}

interface ReferencesResultMessage {
    referencesResult: ReferencesResult;
}

enum ReferencesProgress {
    Started,
    ProcessingSource,
    ProcessingTargets,
    Finished
}

enum TargetReferencesProgress {
    WaitingToLex,
    Lexing,
    WaitingToParse,
    Parsing,
    ConfirmingReferences,
    FinishedWithoutConfirming,
    FinishedConfirming
}

interface ReportReferencesProgressNotification {
    referencesProgress: ReferencesProgress;
    targetReferencesProgress: TargetReferencesProgress[];
}

// Requests
const NavigationListRequest: RequestType<TextDocumentIdentifier, string, void, void> = new RequestType<TextDocumentIdentifier, string, void, void>('cpptools/requestNavigationList');
const GoToDeclarationRequest: RequestType<void, void, void, void> = new RequestType<void, void, void, void>('cpptools/goToDeclaration');
const QueryCompilerDefaultsRequest: RequestType<QueryCompilerDefaultsParams, configs.CompilerDefaults, void, void> = new RequestType<QueryCompilerDefaultsParams, configs.CompilerDefaults, void, void>('cpptools/queryCompilerDefaults');
const QueryTranslationUnitSourceRequest: RequestType<QueryTranslationUnitSourceParams, QueryTranslationUnitSourceResult, void, void> = new RequestType<QueryTranslationUnitSourceParams, QueryTranslationUnitSourceResult, void, void>('cpptools/queryTranslationUnitSource');
const SwitchHeaderSourceRequest: RequestType<SwitchHeaderSourceParams, string, void, void> = new RequestType<SwitchHeaderSourceParams, string, void, void>('cpptools/didSwitchHeaderSource');
const GetDiagnosticsRequest: RequestType<void, GetDiagnosticsResult, void, void> = new RequestType<void, GetDiagnosticsResult, void, void>('cpptools/getDiagnostics');

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
const RescanFolderNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/rescanFolder');
const DidChangeVisibleRangesNotification: NotificationType<DidChangeVisibleRangesParams, void> = new NotificationType<DidChangeVisibleRangesParams, void>('cpptools/didChangeVisibleRanges');
const SemanticColorizationRegionsReceiptNotification: NotificationType<SemanticColorizationRegionsReceiptParams, void> = new NotificationType<SemanticColorizationRegionsReceiptParams, void>('cpptools/semanticColorizationRegionsReceipt');
const ColorThemeChangedNotification: NotificationType<ColorThemeChangedParams, void> = new NotificationType<ColorThemeChangedParams, void>('cpptools/colorThemeChanged');
const DidOpenForReferenceConfirmationNotification: NotificationType<string, void> = new NotificationType<string, void>('cpptools/didOpenForReferenceConfirmation');
const PreviewReferencesNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/previewReferences');
const CancelReferencesNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/cancelReferences');

// Notifications from the server
const ReloadWindowNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/reloadWindow');
const LogTelemetryNotification: NotificationType<TelemetryPayload, void> = new NotificationType<TelemetryPayload, void>('cpptools/logTelemetry');
const ReportNavigationNotification: NotificationType<NavigationPayload, void> = new NotificationType<NavigationPayload, void>('cpptools/reportNavigation');
const ReportTagParseStatusNotification: NotificationType<ReportStatusNotificationBody, void> = new NotificationType<ReportStatusNotificationBody, void>('cpptools/reportTagParseStatus');
const ReportStatusNotification: NotificationType<ReportStatusNotificationBody, void> = new NotificationType<ReportStatusNotificationBody, void>('cpptools/reportStatus');
const DebugProtocolNotification: NotificationType<OutputNotificationBody, void> = new NotificationType<OutputNotificationBody, void>('cpptools/debugProtocol');
const DebugLogNotification:  NotificationType<OutputNotificationBody, void> = new NotificationType<OutputNotificationBody, void>('cpptools/debugLog');
const SemanticColorizationRegionsNotification:  NotificationType<SemanticColorizationRegionsParams, void> = new NotificationType<SemanticColorizationRegionsParams, void>('cpptools/semanticColorizationRegions');
const CompileCommandsPathsNotification:  NotificationType<CompileCommandsPaths, void> = new NotificationType<CompileCommandsPaths, void>('cpptools/compileCommandsPaths');
const UpdateClangFormatPathNotification: NotificationType<string, void> = new NotificationType<string, void>('cpptools/updateClangFormatPath');
const UpdateIntelliSenseCachePathNotification: NotificationType<string, void> = new NotificationType<string, void>('cpptools/updateIntelliSenseCachePath');
const ReferencesNotification: NotificationType<ReferencesResultMessage, void> = new NotificationType<ReferencesResultMessage, void>('cpptools/references');
const ReportReferencesProgressNotification: NotificationType<ReportReferencesProgressNotification, void> = new NotificationType<ReportReferencesProgressNotification, void>('cpptools/reportReferencesProgress');

let failureMessageShown: boolean = false;

interface ClientModel {
    isTagParsing: DataBinding<boolean>;
    isUpdatingIntelliSense: DataBinding<boolean>;
    isFindingReferences: DataBinding<boolean>;
    navigationLocation: DataBinding<string>;
    tagParserStatus: DataBinding<string>;
    activeConfigName: DataBinding<string>;
}

export interface Client {
    TagParsingChanged: vscode.Event<boolean>;
    IntelliSenseParsingChanged: vscode.Event<boolean>;
    FindingReferencesChanged: vscode.Event<boolean>;
    NavigationLocationChanged: vscode.Event<string>;
    TagParserStatusChanged: vscode.Event<string>;
    ActiveConfigChanged: vscode.Event<string>;
    RootPath: string;
    RootUri: vscode.Uri;
    Name: string;
    TrackedDocuments: Set<vscode.TextDocument>;
    onDidChangeSettings(event: vscode.ConfigurationChangeEvent): { [key: string] : string };
    onDidOpenTextDocument(document: vscode.TextDocument): void;
    onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void;
    onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void;
    onDidChangeTextEditorVisibleRanges(textEditorVisibleRangesChangeEvent: vscode.TextEditorVisibleRangesChangeEvent): void;
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void>;
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    provideCustomConfiguration(document: vscode.TextDocument): Promise<void>;
    logDiagnostics(): Promise<void>;
    rescanFolder(): Promise<void>;
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
    handleReferencesIcon(): void;
    handleConfigurationEditCommand(): void;
    handleConfigurationEditJSONCommand(): void;
    handleConfigurationEditUICommand(): void;
    handleAddToIncludePathCommand(path: string): void;
    onInterval(): void;
    dispose(): Thenable<void>;
    addFileAssociations(fileAssociations: string, is_c: boolean): void;
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
    private storagePath: string;
    private trackedDocuments = new Set<vscode.TextDocument>();
    private outputChannel: vscode.OutputChannel;
    private debugChannel: vscode.OutputChannel;
    private diagnosticsChannel: vscode.OutputChannel;
    private referencesChannel: vscode.OutputChannel;
    private crashTimes: number[] = [];
    private isSupported: boolean = true;
    private colorizationSettings: ColorizationSettings;
    private colorizationState = new Map<string, ColorizationState>();
    private visibleRanges = new Map<string, Range[]>();
    private settingsTracker: SettingsTracker;
    private configurationProvider: string;

    // The "model" that is displayed via the UI (status bar).
    private model: ClientModel = {
        isTagParsing: new DataBinding<boolean>(false),
        isUpdatingIntelliSense: new DataBinding<boolean>(false),
        isFindingReferences: new DataBinding<boolean>(false),
        navigationLocation: new DataBinding<string>(""),
        tagParserStatus: new DataBinding<string>(""),
        activeConfigName: new DataBinding<string>("")
    };

    public get TagParsingChanged(): vscode.Event<boolean> { return this.model.isTagParsing.ValueChanged; }
    public get IntelliSenseParsingChanged(): vscode.Event<boolean> { return this.model.isUpdatingIntelliSense.ValueChanged; }
    public get FindingReferencesChanged(): vscode.Event<boolean> { return this.model.isFindingReferences.ValueChanged; }
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
        return { workspaceFolderBasename: this.Name, workspaceStorage: this.storagePath };
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

    private pendingTask: util.BlockingTask<any>;

    private getUniqueWorkspaceStorageName(workspaceFolder?: vscode.WorkspaceFolder) : string {
        let workspaceFolderName: string = this.getName(workspaceFolder);
        if (!workspaceFolder || workspaceFolder.index < 1) {
            return workspaceFolderName; // No duplicate names to search for.
        }
        for (let i: number = 0; i < workspaceFolder.index; ++i) {
            if (vscode.workspace.workspaceFolders[i].name === workspaceFolderName) {
                return path.join(workspaceFolderName, String(workspaceFolder.index)); // Use the index as a subfolder.
            }
        }
        return workspaceFolderName; // No duplicate names found.
    }

    constructor(allClients: ClientCollection, workspaceFolder?: vscode.WorkspaceFolder) {
        this.rootFolder = workspaceFolder;
        this.storagePath = util.extensionContext ? util.extensionContext.storagePath :
            path.join((this.rootFolder ? this.rootFolder.uri.fsPath : ""), "/.vscode");
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
            this.storagePath = path.join(this.storagePath, this.getUniqueWorkspaceStorageName(this.rootFolder));
        }
        try {
            let languageClient: LanguageClient = this.createLanguageClient(allClients);
            languageClient.registerProposedFeatures();
            languageClient.start();  // This returns Disposable, but doesn't need to be tracked because we call .stop() explicitly in our dispose()
            util.setProgress(util.getProgressExecutableStarted());
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

        this.colorizationSettings = new ColorizationSettings(this.RootUri);
    }

    private createLanguageClient(allClients: ClientCollection): LanguageClient {
        let serverModule: string = getLanguageServerFileName();
        let exeExists: boolean = fs.existsSync(serverModule);
        if (!exeExists) {
            telemetry.logLanguageServerEvent("missingLanguageServerBinary");
            throw String('Missing binary at ' + serverModule);
        }
        let serverName: string = this.getName(this.rootFolder);
        let serverOptions: ServerOptions = {
            run: { command: serverModule },
            debug: { command: serverModule, args: [ serverName ] }
        };
        let settings: CppSettings = new CppSettings(this.rootFolder ? this.rootFolder.uri : null);
        let other: OtherSettings = new OtherSettings(this.rootFolder ? this.rootFolder.uri : null);
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
            workspaceFolder: this.rootFolder,
            initializationOptions: {
                clang_format_path: util.resolveVariables(settings.clangFormatPath, this.AdditionalEnvironment),
                clang_format_style: settings.clangFormatStyle,
                clang_format_fallbackStyle: settings.clangFormatFallbackStyle,
                clang_format_sortIncludes: settings.clangFormatSortIncludes,
                formatting: settings.formatting,
                extension_path: util.extensionPath,
                exclude_files: other.filesExclude,
                exclude_search: other.searchExclude,
                storage_path: this.storagePath,
                tab_size: other.editorTabSize,
                intelliSenseEngine: settings.intelliSenseEngine,
                intelliSenseEngineFallback: settings.intelliSenseEngineFallback,
                intelliSenseCacheDisabled: intelliSenseCacheDisabled,
                intelliSenseCachePath : util.resolveCachePath(settings.intelliSenseCachePath, this.AdditionalEnvironment),
                intelliSenseCacheSize : settings.intelliSenseCacheSize,
                autocomplete: settings.autoComplete,
                errorSquiggles: settings.errorSquiggles,
                dimInactiveRegions: settings.dimInactiveRegions,
                enhancedColorization: settings.enhancedColorization,
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
                gotoDefIntelliSense: abTestSettings.UseGoToDefIntelliSense,
                experimentalFeatures: settings.experimentalFeatures
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

    public onDidChangeSettings(event: vscode.ConfigurationChangeEvent): { [key: string] : string } {
        let colorizationNeedsReload: boolean = event.affectsConfiguration("workbench.colorTheme")
            || event.affectsConfiguration("editor.tokenColorCustomizations");

        let colorizationNeedsRefresh: boolean = colorizationNeedsReload
            || event.affectsConfiguration("C_Cpp.enhancedColorization", this.RootUri)
            || event.affectsConfiguration("C_Cpp.dimInactiveRegions", this.RootUri)
            || event.affectsConfiguration("C_Cpp.inactiveRegionOpacity", this.RootUri)
            || event.affectsConfiguration("C_Cpp.inactiveRegionForegroundColor", this.RootUri)
            || event.affectsConfiguration("C_Cpp.inactiveRegionBackgroundColor", this.RootUri);

        let colorThemeChanged: boolean = event.affectsConfiguration("workbench.colorTheme", this.RootUri);
        if (colorThemeChanged) {
            let otherSettings: OtherSettings = new OtherSettings(this.RootUri);
            this.languageClient.sendNotification(ColorThemeChangedNotification, { name: otherSettings.colorTheme });
        }

        if (colorizationNeedsReload) {
            this.colorizationSettings.reload();
        }
        if (colorizationNeedsRefresh) {
            let processedUris: vscode.Uri[] = [];
            for (let e of vscode.window.visibleTextEditors) {
                let uri: vscode.Uri = e.document.uri;

                // Make sure we don't process the same file multiple times.
                // colorizationState.onSettingsChanged ensures all visible text editors for that file get
                // refreshed, after it creates a set of decorators to be shared by all visible instances of the file.
                if (!processedUris.find(e => e === uri)) {
                    processedUris.push(uri);
                    let colorizationState: ColorizationState = this.colorizationState.get(uri.toString());
                    if (colorizationState) {
                        colorizationState.onSettingsChanged(uri);
                    }
                }
            }
        }
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
                this.languageClient.sendNotification(UpdateIntelliSenseCachePathNotification, util.resolveCachePath(settings.intelliSenseCachePath, this.AdditionalEnvironment));
            }
            this.configuration.onDidChangeSettings();
            telemetry.logLanguageServerEvent("CppSettingsChange", changedSettings, null);
        }
        return changedSettings;
    }

    private editVersion: number = 0;

    public onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void {
        // Increment editVersion for every call to onDidChangeTextDocument, regardless of whether the file is handled
        this.editVersion++;
        if (textDocumentChangeEvent.document.uri.scheme === "file") {
            if (textDocumentChangeEvent.document.languageId === "cpp" || textDocumentChangeEvent.document.languageId === "c") {
                try {
                    let colorizationState: ColorizationState = this.getColorizationState(textDocumentChangeEvent.document.uri.toString());

                    // Adjust colorization ranges after this edit.  (i.e. if a line was added, push decorations after it down one line)
                    colorizationState.addEdits(textDocumentChangeEvent.contentChanges, this.editVersion);
                } catch (e) {
                    // Ensure an exception does not prevent pass-through to native handler, or editVersion could become inconsistent
                    console.log(e.toString());
                }
            }
        }
    }

    public onDidOpenTextDocument(document: vscode.TextDocument): void {
        if (document.uri.scheme === "file") {
            this.sendVisibleRanges(document.uri);
        }
    }

    public onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {
        let processedUris: vscode.Uri[] = [];
        editors.forEach(editor => {
            if (editor.document.uri.scheme === "file") {
                let colorizationState: ColorizationState = this.colorizationState.get(editor.document.uri.toString());
                if (colorizationState) {
                    colorizationState.refresh(editor);
                }
                if (!processedUris.find(uri => uri === editor.document.uri)) {
                    processedUris.push(editor.document.uri);
                    this.sendVisibleRanges(editor.document.uri);
                }
            }
        });
    }

    public sendVisibleRanges(uri: vscode.Uri): void {
        let ranges: Range[] = [];
        // Get ranges from all editors matching this URI
        let editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri === uri);
        for (let e of editors) {
            e.visibleRanges.forEach(range => ranges.push(Range.create(range.start.line, range.start.character, range.end.line, range.end.character)));
        }

        // Only send ranges if they have actually changed.
        let isSame: boolean = false;
        let savedRanges: Range[] = this.visibleRanges.get(uri.toString());
        if (savedRanges) {
            if (ranges.length === savedRanges.length) {
                isSame = true;
                for (let i: number = 0; i < ranges.length; i++) {
                    if (ranges[i] !== savedRanges[i]) {
                        isSame = false;
                        break;
                    }
                }
            }
        } else {
            isSame = ranges.length === 0;
        }
        if (!isSame) {
            this.visibleRanges.set(uri.toString(), ranges);
            let params: DidChangeVisibleRangesParams = {
                uri: uri.toString(),
                ranges: ranges
            };
            this.notifyWhenReady(() => this.languageClient.sendNotification(DidChangeVisibleRangesNotification, params));
        }
    }

    public onDidChangeTextEditorVisibleRanges(textEditorVisibleRangesChangeEvent: vscode.TextEditorVisibleRangesChangeEvent): void {
        if (textEditorVisibleRangesChangeEvent.textEditor.document.uri.scheme === "file") {
            this.sendVisibleRanges(textEditorVisibleRangesChangeEvent.textEditor.document.uri);
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

            let tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
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

            let tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
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

    public async logDiagnostics(): Promise<void> {
        let response: GetDiagnosticsResult = await this.requestWhenReady(() => this.languageClient.sendRequest(GetDiagnosticsRequest, null));
        if (!this.diagnosticsChannel) {
            this.diagnosticsChannel = vscode.window.createOutputChannel("C/C++ Diagnostics");
            this.disposables.push(this.diagnosticsChannel);
        }

        let header: string = `-------- Diagnostics - ${new Date().toLocaleString()}\n`;
        let version: string = `Version: ${util.packageJson.version}\n`;
        let configJson: string = "";
        if (this.configuration.CurrentConfiguration) {
            configJson = `Current Configuration:\n${JSON.stringify(this.configuration.CurrentConfiguration, null, 4)}\n`;
        }
        this.diagnosticsChannel.appendLine(`${header}${version}${configJson}${response.diagnostics}`);
        this.diagnosticsChannel.show(false);
    }

    public async rescanFolder(): Promise<void> {
        await this.notifyWhenReady(() => this.languageClient.sendNotification(RescanFolderNotification));
    }

    public async provideCustomConfiguration(document: vscode.TextDocument): Promise<void> {
        return this.queueBlockingTask(async () => {
            let tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
            let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
            if (providers.size === 0) {
                return Promise.resolve();
            }
            console.log("provideCustomConfiguration");
            let providerId: string|undefined = this.configuration.CurrentConfigurationProvider;
            if (!providerId) {
                return Promise.resolve();
            }

            let providerName: string = providerId;
            let params: QueryTranslationUnitSourceParams = {
                uri: document.uri.toString()
            };
            let response: QueryTranslationUnitSourceResult = await this.languageClient.sendRequest(QueryTranslationUnitSourceRequest, params);
            if (response.configDisposition === QueryTranslationUnitSourceConfigDisposition.ConfigNotNeeded) {
                return Promise.resolve();
            }

            let tuUri: vscode.Uri = vscode.Uri.parse(response.uri);
            let configName: string = this.configuration.CurrentConfiguration.name;
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

            return this.callTaskWithTimeout(provideConfigurationAsync, configProviderTimeout, tokenSource).then(
                (configs: SourceFileConfigurationItem[]) => {
                    if (configs && configs.length > 0) {
                        this.sendCustomConfigurations(configs, false);
                        if (response.configDisposition === QueryTranslationUnitSourceConfigDisposition.AncestorConfigNeeded) {
                            // replacing uri with original uri
                            let newConfig: SourceFileConfigurationItem =  { uri: document.uri, configuration: configs[0].configuration };
                            this.sendCustomConfigurations([newConfig], false);
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
        });
    }

    private isExternalHeader(uri: vscode.Uri): boolean {
        return util.isHeader(uri) && !uri.toString().startsWith(this.RootUri.toString());
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
                return this.pendingTask.getPromise().then(nextTask, nextTask);
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
            this.pendingTask = new util.BlockingTask<void>(task, this.pendingTask);
            return this.pendingTask.getPromise();
        } else {
            return Promise.reject("Unsupported client");
        }
    }

    private queueTaskWithTimeout(task: () => Thenable<any>, ms: number, cancelToken?: vscode.CancellationTokenSource): Thenable<any> {
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

    private callTaskWithTimeout(task: () => Thenable<any>, ms: number, cancelToken?: vscode.CancellationTokenSource): Thenable<any> {
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
        return Promise.race([task(), timeout()]).then(
            (result: any) => {
                clearTimeout(timer);
                return result;
            },
            (error: any) => {
                clearTimeout(timer);
                throw error;
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
        this.languageClient.onNotification(SemanticColorizationRegionsNotification, (e) => this.updateSemanticColorizationRegions(e));
        this.languageClient.onNotification(CompileCommandsPathsNotification, (e) => this.promptCompileCommands(e));
        this.languageClient.onNotification(ReferencesNotification, (e) => this.processReferencesResult(e.referencesResult));
        this.languageClient.onNotification(ReportReferencesProgressNotification, (e) => this.handleReferencesProgress(e));
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
            let fileAssociations: string = payload.navigation.substr(4);
            let is_c: boolean = fileAssociations.startsWith("c");
            // Skip over rest of header: c>; or >;
            fileAssociations = fileAssociations.substr(is_c ? 3 : 2);
            this.addFileAssociations(fileAssociations, is_c);
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

    public addFileAssociations(fileAssociations: string, is_c: boolean): void {
        let settings: OtherSettings = new OtherSettings(this.RootUri);
        let assocs: any = settings.filesAssociations;

        let filesAndPaths: string[] = fileAssociations.split(";");
        let foundNewAssociation: boolean = false;
        for (let i: number = 0; i < filesAndPaths.length; ++i) {
            let fileAndPath: string[] = filesAndPaths[i].split("@");
            // Skip empty or malformed
            if (fileAndPath.length === 2) {
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
            timeStamp = Date.now();
            this.model.isUpdatingIntelliSense.Value = true;
            testHook.updateStatus(Status.IntelliSenseCompiling);
        } else if (message.endsWith("IntelliSense Ready")) {
            let settings: CppSettings = new CppSettings(this.RootUri);
            if (settings.loggingLevel === "Debug") {
                let out: logger.Logger = logger.getOutputChannelLogger();
                let duration: number = Date.now() - timeStamp;
                out.appendLine(`Update IntelliSense time (sec): ${duration / 1000}`);
            }
            this.model.isUpdatingIntelliSense.Value = false;
            testHook.updateStatus(Status.IntelliSenseReady);
        } else if (message.endsWith("Ready")) { // Tag Parser Ready
            this.model.isTagParsing.Value = false;
            testHook.updateStatus(Status.TagParsingDone);
            util.setProgress(util.getProgressParseRootSuccess());
        } else if (message.endsWith("No Squiggles")) {
            util.setIntelliSenseProgress(util.getProgressIntelliSenseNoSquiggles());
        } else if (message.endsWith("Unresolved Headers")) {
            let showIntelliSenseFallbackMessage: PersistentState<boolean> = new PersistentState<boolean>("CPP.showIntelliSenseFallbackMessage", true);
            if (showIntelliSenseFallbackMessage.Value) {
                ui.showConfigureIncludePathMessage(() => {
                    let configJSON: string = "Configure (JSON)";
                    let configUI: string = "Configure (UI)";
                    let dontShowAgain: string = "Don't Show Again";
                    let fallbackMsg: string = this.configuration.VcpkgInstalled ?
                        "Update your IntelliSense settings or use Vcpkg to install libraries to help find missing headers." :
                        "Configure your IntelliSense settings to help find missing headers.";
                    return vscode.window.showInformationMessage(fallbackMsg, configJSON, configUI, dontShowAgain).then((value) => {
                        switch (value) {
                            case configJSON:
                                vscode.commands.getCommands(true).then((commands: string[]) => {
                                    if (commands.indexOf("workbench.action.problems.focus") >= 0) {
                                        vscode.commands.executeCommand("workbench.action.problems.focus");
                                    }
                                });
                                this.handleConfigurationEditJSONCommand();
                                telemetry.logLanguageServerEvent("SettingsCommand", { "toast": "json" }, null);
                                break;
                            case configUI:
                                vscode.commands.getCommands(true).then((commands: string[]) => {
                                    if (commands.indexOf("workbench.action.problems.focus") >= 0) {
                                        vscode.commands.executeCommand("workbench.action.problems.focus");
                                    }
                                });
                                this.handleConfigurationEditUICommand();
                                telemetry.logLanguageServerEvent("SettingsCommand", { "toast": "ui" }, null);
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

    private currentReferencesProgress: ReportReferencesProgressNotification;
    private reportReferencesProgress(progress: vscode.Progress<{message?: string; increment?: number }>): void {
        switch (this.currentReferencesProgress.referencesProgress) {
            case ReferencesProgress.Started:
                progress.report({ message: 'Started.', increment: 0 });
                break;
            case ReferencesProgress.ProcessingSource:
                progress.report({ message: 'Processing source.', increment: 1 });
                break;
            case ReferencesProgress.ProcessingTargets:
                let numFilesToProcess: number = this.currentReferencesProgress.targetReferencesProgress.length;
                let maxProgress: number = numFilesToProcess * 10;
                let numWaitingToLex: number = 0;
                let numLexing: number = 0;
                let numWaitingToParse: number = 0;
                let numParsing: number = 0;
                let numConfirmingReferences: number = 0;
                let numFinishedWithoutConfirming: number = 0;
                let numFinishedConfirming: number = 0;
                for (let targetLocationProgress of this.currentReferencesProgress.targetReferencesProgress) {
                    switch (targetLocationProgress) {
                        case TargetReferencesProgress.WaitingToLex:
                            ++numWaitingToLex;
                            break;
                        case TargetReferencesProgress.Lexing:
                            ++numLexing;
                            break;
                        case TargetReferencesProgress.WaitingToParse:
                            ++numWaitingToParse;
                            break;
                        case TargetReferencesProgress.Parsing:
                            ++numParsing;
                            break;
                        case TargetReferencesProgress.ConfirmingReferences:
                            ++numConfirmingReferences;
                            break;
                        case TargetReferencesProgress.FinishedWithoutConfirming:
                            ++numFinishedWithoutConfirming;
                            break;
                        case TargetReferencesProgress.FinishedConfirming:
                            ++numFinishedConfirming;
                            break;
                        default:
                            break;
                    }
                }
                let currentProgress: number = numWaitingToParse + numParsing + numConfirmingReferences * 9 + (numFinishedWithoutConfirming + numFinishedConfirming) * 10;
                let currentMessage: string;
                if (numLexing > numParsing) {
                    let numTotalToLex: number = this.currentReferencesProgress.targetReferencesProgress.length;
                    let numFinishedLexing: number = numTotalToLex - numWaitingToLex - numLexing;
                    currentMessage += ` Lexing(${numFinishedLexing}/${numTotalToLex})`;
                } else {
                    let numTotalToParse: number = this.currentReferencesProgress.targetReferencesProgress.length - numFinishedWithoutConfirming;
                    let numFinishedParsing: number = numTotalToParse - numWaitingToParse - numParsing - numConfirmingReferences;
                    currentMessage += ` Parsing(${numFinishedParsing}/${numTotalToParse})`;
                }
                progress.report({ message: currentMessage, increment: currentProgress / maxProgress });
                break;
        }
    }

    public handleReferencesIcon(): void {
        this.notifyWhenReady(() => {
            if (this.model.isFindingReferences.Value) {
                vscode.window.withProgress(this.referencesProgressOptions, this.referencesProgressMethod);
            }
            this.sendPreviewReferences();
        });
    }

    private sendPreviewReferences(): void {
        if (this.model.isFindingReferences.Value) {
            this.languageClient.sendNotification(PreviewReferencesNotification);
            vscode.commands.executeCommand("references-view.find");
        }
    }

    private delayReferencesProgress: NodeJS.Timeout;
    private referencesProgressOptions: vscode.ProgressOptions;
    private referencesProgressMethod: (progress: vscode.Progress<{
        message?: string;
        increment?: number;
    }>, token: vscode.CancellationToken) => Thenable<unknown>;
    private handleReferencesProgress(notificationBody: ReportReferencesProgressNotification): void {
        switch (notificationBody.referencesProgress) {
            case ReferencesProgress.Started:
                this.model.isFindingReferences.Value = true;
                this.delayReferencesProgress = setInterval(() => {
                    this.referencesProgressOptions = { location: vscode.ProgressLocation.Notification, title: "Find All References", cancellable: true };
                    this.referencesProgressMethod = (progress: vscode.Progress<{message?: string; increment?: number }>, token: vscode.CancellationToken) =>
                    // tslint:disable-next-line: promise-must-complete
                        new Promise((resolve) => {
                            this.reportReferencesProgress(progress);
                            let updateProgress: NodeJS.Timeout = setInterval(() => {
                                if (token.isCancellationRequested || this.currentReferencesProgress.referencesProgress === ReferencesProgress.Finished) {
                                    if (token.isCancellationRequested) {
                                        this.sendPreviewReferences();
                                        this.languageClient.sendNotification(CancelReferencesNotification);
                                    }
                                    clearInterval(updateProgress);
                                    resolve();
                                } else {
                                    this.reportReferencesProgress(progress);
                                }
                            }, 1000);
                        });
                    vscode.window.withProgress(this.referencesProgressOptions, this.referencesProgressMethod);
                    clearInterval(this.delayReferencesProgress);
                }, 2000);
                break;
            case ReferencesProgress.Finished:
                this.currentReferencesProgress = notificationBody;
                this.model.isFindingReferences.Value = false;
                clearInterval(this.delayReferencesProgress);
                break;
            default:
                this.currentReferencesProgress = notificationBody;
                break;
        }
    }

    private getColorizationState(uri: string): ColorizationState {
        let colorizationState: ColorizationState = this.colorizationState.get(uri);
        if (!colorizationState) {
            colorizationState = new ColorizationState(this.RootUri, this.colorizationSettings);
            this.colorizationState.set(uri, colorizationState);
        }
        return colorizationState;
    }

    private updateSemanticColorizationRegions(params: SemanticColorizationRegionsParams): void {
        // Convert the params to vscode.Range's before passing to colorizationState.updateSemantic()
        let semanticRanges: vscode.Range[][] = new Array<vscode.Range[]>(TokenKind.Count);
        for (let i: number = 0; i < TokenKind.Count; i++) {
            semanticRanges[i] = [];
        }
        params.regions.forEach(element => {
            let newRange : vscode.Range = new vscode.Range(element.range.start.line, element.range.start.character, element.range.end.line, element.range.end.character);
            semanticRanges[element.kind].push(newRange);
        });
        let inactiveRanges: vscode.Range[] = [];
        params.inactiveRegions.forEach(element => {
            let newRange : vscode.Range = new vscode.Range(element.startLine, 0, element.endLine, 0);
            inactiveRanges.push(newRange);
        });
        let colorizationState: ColorizationState = this.getColorizationState(params.uri);
        colorizationState.updateSemantic(params.uri, semanticRanges, inactiveRanges, params.editVersion);
        this.languageClient.sendNotification(SemanticColorizationRegionsReceiptNotification, { uri: params.uri });
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
        this.notifyWhenReady(() => this.configuration.handleConfigurationEditCommand(null, vscode.window.showTextDocument));
    }

    public handleConfigurationEditJSONCommand(): void {
        this.notifyWhenReady(() => this.configuration.handleConfigurationEditJSONCommand(null, vscode.window.showTextDocument));
    }

    public handleConfigurationEditUICommand(): void {
        this.notifyWhenReady(() => this.configuration.handleConfigurationEditUICommand(null, vscode.window.showTextDocument));
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

            this.colorizationState.forEach(colorizationState => {
                colorizationState.dispose();
            });

            this.disposables.forEach((d) => d.dispose());
            this.disposables = [];

            for (let key in this.model) {
                if (this.model.hasOwnProperty(key)) {
                    this.model[key].dispose();
                }
            }
        });
    }

    private convertReferenceTypeToString(referenceType: ReferenceType): string {
        switch (referenceType) {
            case ReferenceType.ConfirmationInProgress: return "Possible reference (confirmation in progress)";
            case ReferenceType.ConfirmationCanceled: return "Possible reference (confirmation canceled)";
            case ReferenceType.Comment: return "Comment reference";
            case ReferenceType.String: return "String reference";
            case ReferenceType.Inactive: return "Inactive reference";
            case ReferenceType.CannotConfirm: return "Cannot confirm reference";
            case ReferenceType.NotAReference: return "Not a reference";
        }
        return "";
    }

    private referencesSavedResults: ReferenceInfo[] = null;
    private documentsForReferences: Map<string, vscode.TextDocument> = new Map<string, vscode.TextDocument>();
    private referencesProgress: vscode.Progress<{message?: string; increment?: number }>;

    private processReferencesResult(referencesResult: ReferencesResult): void {
        if (!this.referencesChannel) {
            this.referencesChannel = vscode.window.createOutputChannel("C/C++ References");
            this.disposables.push(this.referencesChannel);
        } else {
            this.referencesChannel.clear();
        }
        if (referencesResult.isInitialResult) {
            this.referencesSavedResults = [];
            this.documentsForReferences.clear();
        }
        for (let reference of referencesResult.referenceInfos) {
            if (reference.type === ReferenceType.Confirmed) {
                continue; // Already displayed in VS Code's References.
            }
            if (reference.type === ReferenceType.ConfirmationInProgress) {
                if (!this.documentsForReferences.has(reference.file)) {
                    this.documentsForReferences.set(reference.file, null);
                    this.languageClient.sendNotification(DidOpenForReferenceConfirmationNotification, reference.file);
                    vscode.workspace.openTextDocument(reference.file).then((document: vscode.TextDocument) => {
                        this.documentsForReferences.set(reference.file, document);
                    });
                }
            } else {
                this.referencesSavedResults.push(reference);
            }
            this.referencesChannel.appendLine(this.convertReferenceTypeToString(reference.type) + ": " + reference.text);
            this.referencesChannel.appendLine(reference.file + ":" + (reference.position.line + 1) + ":" + (reference.position.character + 1));
        }
        this.referencesChannel.show(true);

        if (referencesResult.isFinalResult) {
            this.documentsForReferences.clear();
        } else {
            vscode.commands.executeCommand("references-view.find");
        }
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
    public get FindingReferencesChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get NavigationLocationChanged(): vscode.Event<string> { return this.stringEvent.event; }
    public get TagParserStatusChanged(): vscode.Event<string> { return this.stringEvent.event; }
    public get ActiveConfigChanged(): vscode.Event<string> { return this.stringEvent.event; }
    RootPath: string = "/";
    RootUri: vscode.Uri = vscode.Uri.file("/");
    Name: string = "(empty)";
    TrackedDocuments = new Set<vscode.TextDocument>();
    onDidChangeSettings(event: vscode.ConfigurationChangeEvent): { [key: string] : string } { return {}; }
    onDidOpenTextDocument(document: vscode.TextDocument): void {}
    onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {}
    onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void {}
    onDidChangeTextEditorVisibleRanges(textEditorVisibleRangesChangeEvent: vscode.TextEditorVisibleRangesChangeEvent): void {}
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    provideCustomConfiguration(document: vscode.TextDocument): Promise<void> { return Promise.resolve(); }
    logDiagnostics(): Promise<void> { return Promise.resolve(); }
    rescanFolder(): Promise<void> { return Promise.resolve(); }
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
    handleReferencesIcon(): void {}
    handleConfigurationEditCommand(): void {}
    handleConfigurationEditJSONCommand(): void {}
    handleConfigurationEditUICommand(): void {}
    handleAddToIncludePathCommand(path: string): void {}
    onInterval(): void {}
    dispose(): Thenable<void> {
        this.booleanEvent.dispose();
        this.stringEvent.dispose();
        return Promise.resolve();
    }
    addFileAssociations(fileAssociations: string, is_c: boolean): void {}
}
