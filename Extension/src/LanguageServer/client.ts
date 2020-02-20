/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient, LanguageClientOptions, ServerOptions, NotificationType, TextDocumentIdentifier,
    RequestType, ErrorAction, CloseAction, DidOpenTextDocumentParams, Range, Position, DocumentFilter
} from 'vscode-languageclient';
import { SourceFileConfigurationItem, WorkspaceBrowseConfiguration, SourceFileConfiguration, Version } from 'vscode-cpptools';
import { Status, IntelliSenseStatus } from 'vscode-cpptools/out/testApi';
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
import { getCustomConfigProviders, CustomConfigurationProvider1, isSameProviderExtensionId } from '../LanguageServer/customProviders';
import { ABTestSettings, getABTestSettings } from '../abTesting';
import * as fs from 'fs';
import * as os from 'os';
import { TokenKind, ColorizationSettings, ColorizationState } from './colorization';
import * as refs from './references';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
type LocalizeStringParams = util.LocalizeStringParams;

let ui: UI;
let timeStamp: number = 0;
const configProviderTimeout: number = 2000;

// Data shared by all clients.
let languageClient: LanguageClient;
let clientCollection: ClientCollection;
let pendingTask: util.BlockingTask<any>;
let compilerDefaults: configs.CompilerDefaults;
let diagnosticsChannel: vscode.OutputChannel;
let outputChannel: vscode.OutputChannel;
let debugChannel: vscode.OutputChannel;
let diagnosticsCollection: vscode.DiagnosticCollection;
let workspaceColorizationState: Map<string, ColorizationState> = new Map<string, ColorizationState>();
let workspaceDisposables: vscode.Disposable[] = [];
let workspaceReferences: refs.ReferencesManager;

export function disposeWorkspaceData(): void {
    workspaceDisposables.forEach((d) => d.dispose());
    workspaceDisposables = [];

    workspaceColorizationState.forEach(colorizationState => {
        colorizationState.dispose();
    });
}

function logTelemetry(notificationBody: TelemetryPayload): void {
    telemetry.logLanguageServerEvent(notificationBody.event, notificationBody.properties, notificationBody.metrics);
}

/**
 * listen for logging messages from the language server and print them to the Output window
 */
function setupOutputHandlers(): void {
    console.assert(languageClient !== undefined, "This method must not be called until this.languageClient is set in \"onReady\"");

    languageClient.onNotification(DebugProtocolNotification, (output) => {
        if (!debugChannel) {
            debugChannel = vscode.window.createOutputChannel(`${localize("c.cpp.debug.protocol", "C/C++ Debug Protocol")}`);
            workspaceDisposables.push(debugChannel);
        }
        debugChannel.appendLine("");
        debugChannel.appendLine("************************************************************************************************************************");
        debugChannel.append(`${output}`);
    });

    languageClient.onNotification(DebugLogNotification, logLocalized);
}

function log(output: string): void {
    if (!outputChannel) {
        outputChannel = logger.getOutputChannel();
        workspaceDisposables.push(outputChannel);
    }
    outputChannel.appendLine(`${output}`);
}

function logLocalized(params: LocalizeStringParams): void {
    let output: string = util.getLocalizedString(params);
    log(output);
}

function showMessageWindow(params: ShowMessageWindowParams): void {
    let message: string = util.getLocalizedString(params.localizeStringParams);
    switch (params.type) {
        case 1: // Error
            vscode.window.showErrorMessage(message);
            break;
        case 2: // Warning
            vscode.window.showWarningMessage(message);
            break;
        case 3: // Info
            vscode.window.showInformationMessage(message);
            break;
        default:
            console.assert("Unrecognized type for showMessageWindow");
            break;
    }
}

function publishDiagnostics(params: PublishDiagnosticsParams): void {
    if (!diagnosticsCollection) {
        diagnosticsCollection = vscode.languages.createDiagnosticCollection("C/C++");
    }

    // Convert from our Diagnostic objects to vscode Diagnostic objects
    let diagnostics: vscode.Diagnostic[] = [];
    params.diagnostics.forEach((d) => {
        let message: string = util.getLocalizedString(d.localizeStringParams);
        let r: vscode.Range = new vscode.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character);
        let diagnostic: vscode.Diagnostic = new vscode.Diagnostic(r, message, d.severity);
        diagnostic.code = d.code;
        diagnostic.source = d.source;
        diagnostics.push(diagnostic);
    });

    let realUri: vscode.Uri = vscode.Uri.parse(params.uri);
    diagnosticsCollection.set(realUri, diagnostics);
}

function updateSemanticColorizationRegions(params: SemanticColorizationRegionsParams): void {
    let colorizationState: ColorizationState = workspaceColorizationState.get(params.uri);
    if (colorizationState) {
        // Convert the params to vscode.Range's before passing to colorizationState.updateSemantic()
        let semanticRanges: vscode.Range[][] = new Array<vscode.Range[]>(TokenKind.Count);
        for (let i: number = 0; i < TokenKind.Count; i++) {
            semanticRanges[i] = [];
        }
        params.regions.forEach(element => {
            let newRange: vscode.Range = new vscode.Range(element.range.start.line, element.range.start.character, element.range.end.line, element.range.end.character);
            semanticRanges[element.kind].push(newRange);
        });
        let inactiveRanges: vscode.Range[] = [];
        params.inactiveRegions.forEach(element => {
            let newRange: vscode.Range = new vscode.Range(element.startLine, 0, element.endLine, 0);
            inactiveRanges.push(newRange);
        });
        colorizationState.updateSemantic(params.uri, semanticRanges, inactiveRanges, params.editVersion);
        languageClient.sendNotification(SemanticColorizationRegionsReceiptNotification, { uri: params.uri });
    }
}

interface WorkspaceFolderParams {
    workspaceFolderUri?: string;
}

interface TelemetryPayload {
    event: string;
    properties?: { [key: string]: string };
    metrics?: { [key: string]: number };
}

interface DebugProtocolParams {
    jsonrpc: string;
    method: string;
    params?: any;
}

interface ReportStatusNotificationBody extends WorkspaceFolderParams {
    status: string;
}

interface QueryCompilerDefaultsParams {
}

interface CppPropertiesParams extends WorkspaceFolderParams {
    currentConfiguration: number;
    configurations: any[];
}

interface FolderSelectedSettingParams extends WorkspaceFolderParams {
    currentConfiguration: number;
}

interface SwitchHeaderSourceParams extends WorkspaceFolderParams {
    switchHeaderSourceFileName: string;
}

interface FileChangedParams extends WorkspaceFolderParams {
    uri: string;
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

interface CustomConfigurationParams extends WorkspaceFolderParams {
    configurationItems: SourceFileConfigurationItemAdapter[];
}

interface CustomBrowseConfigurationParams extends WorkspaceFolderParams {
    browseConfiguration: WorkspaceBrowseConfiguration;
}

interface CompileCommandsPaths extends WorkspaceFolderParams {
    paths: string[];
}

interface QueryTranslationUnitSourceParams extends WorkspaceFolderParams {
    uri: string;
}

interface QueryTranslationUnitSourceResult {
    candidates: string[];
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

interface Diagnostic {
    range: Range;
    code?: number | string;
    source?: string;
    severity: vscode.DiagnosticSeverity;
    localizeStringParams: LocalizeStringParams;
}

interface PublishDiagnosticsParams {
    uri: string;
    diagnostics: Diagnostic[];
}

interface GetCodeActionsRequestParams {
    uri: string;
    range: Range;
}

interface CodeActionCommand {
    localizeStringParams: LocalizeStringParams;
    command: string;
    arguments?: any[];
}

interface ShowMessageWindowParams {
    type: number;
    localizeStringParams: LocalizeStringParams;
}

interface GetDocumentSymbolRequestParams {
    uri: string;
}

interface WorkspaceSymbolParams extends WorkspaceFolderParams {
    query: string;
}

interface LocalizeDocumentSymbol {
    name: string;
    detail: LocalizeStringParams;
    kind: vscode.SymbolKind;
    range: Range;
    selectionRange: Range;
    children: LocalizeDocumentSymbol[];
}

interface Location {
    uri: string;
    range: Range;
}

interface LocalizeSymbolInformation {
    name: string;
    kind: vscode.SymbolKind;
    location: Location;
    containerName: string;
    suffix: LocalizeStringParams;
}

export interface RenameParams {
    newName: string;
    position: Position;
    textDocument: TextDocumentIdentifier;
}

export interface FindAllReferencesParams {
    position: Position;
    textDocument: TextDocumentIdentifier;
}

interface DidChangeConfigurationParams extends WorkspaceFolderParams {
    settings: any;
}

// Requests
const QueryCompilerDefaultsRequest: RequestType<QueryCompilerDefaultsParams, configs.CompilerDefaults, void, void> = new RequestType<QueryCompilerDefaultsParams, configs.CompilerDefaults, void, void>('cpptools/queryCompilerDefaults');
const QueryTranslationUnitSourceRequest: RequestType<QueryTranslationUnitSourceParams, QueryTranslationUnitSourceResult, void, void> = new RequestType<QueryTranslationUnitSourceParams, QueryTranslationUnitSourceResult, void, void>('cpptools/queryTranslationUnitSource');
const SwitchHeaderSourceRequest: RequestType<SwitchHeaderSourceParams, string, void, void> = new RequestType<SwitchHeaderSourceParams, string, void, void>('cpptools/didSwitchHeaderSource');
const GetDiagnosticsRequest: RequestType<void, GetDiagnosticsResult, void, void> = new RequestType<void, GetDiagnosticsResult, void, void>('cpptools/getDiagnostics');
const GetCodeActionsRequest: RequestType<GetCodeActionsRequestParams, CodeActionCommand[], void, void> = new RequestType<GetCodeActionsRequestParams, CodeActionCommand[], void, void>('cpptools/getCodeActions');
const GetDocumentSymbolRequest: RequestType<GetDocumentSymbolRequestParams, LocalizeDocumentSymbol[], void, void> = new RequestType<GetDocumentSymbolRequestParams, LocalizeDocumentSymbol[], void, void>('cpptools/getDocumentSymbols');
const GetSymbolInfoRequest: RequestType<WorkspaceSymbolParams, LocalizeSymbolInformation[], void, void> = new RequestType<WorkspaceSymbolParams, LocalizeSymbolInformation[], void, void>('cpptools/getWorkspaceSymbols');

// Notifications to the server
const DidOpenNotification: NotificationType<DidOpenTextDocumentParams, void> = new NotificationType<DidOpenTextDocumentParams, void>('textDocument/didOpen');
const FileCreatedNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/fileCreated');
const FileChangedNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/fileChanged');
const FileDeletedNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/fileDeleted');
const ResetDatabaseNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/resetDatabase');
const PauseParsingNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/pauseParsing');
const ResumeParsingNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/resumeParsing');
const ActiveDocumentChangeNotification: NotificationType<TextDocumentIdentifier, void> = new NotificationType<TextDocumentIdentifier, void>('cpptools/activeDocumentChange');
const TextEditorSelectionChangeNotification: NotificationType<Range, void> = new NotificationType<Range, void>('cpptools/textEditorSelectionChange');
const ChangeCppPropertiesNotification: NotificationType<CppPropertiesParams, void> = new NotificationType<CppPropertiesParams, void>('cpptools/didChangeCppProperties');
const ChangeCompileCommandsNotification: NotificationType<FileChangedParams, void> = new NotificationType<FileChangedParams, void>('cpptools/didChangeCompileCommands');
const ChangeSelectedSettingNotification: NotificationType<FolderSelectedSettingParams, void> = new NotificationType<FolderSelectedSettingParams, void>('cpptools/didChangeSelectedSetting');
const IntervalTimerNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/onIntervalTimer');
const CustomConfigurationNotification: NotificationType<CustomConfigurationParams, void> = new NotificationType<CustomConfigurationParams, void>('cpptools/didChangeCustomConfiguration');
const CustomBrowseConfigurationNotification: NotificationType<CustomBrowseConfigurationParams, void> = new NotificationType<CustomBrowseConfigurationParams, void>('cpptools/didChangeCustomBrowseConfiguration');
const ClearCustomConfigurationsNotification: NotificationType<WorkspaceFolderParams, void> = new NotificationType<WorkspaceFolderParams, void>('cpptools/clearCustomConfigurations');
const ClearCustomBrowseConfigurationNotification: NotificationType<WorkspaceFolderParams, void> = new NotificationType<WorkspaceFolderParams, void>('cpptools/clearCustomBrowseConfiguration');
const RescanFolderNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/rescanFolder');
const DidChangeVisibleRangesNotification: NotificationType<DidChangeVisibleRangesParams, void> = new NotificationType<DidChangeVisibleRangesParams, void>('cpptools/didChangeVisibleRanges');
const SemanticColorizationRegionsReceiptNotification: NotificationType<SemanticColorizationRegionsReceiptParams, void> = new NotificationType<SemanticColorizationRegionsReceiptParams, void>('cpptools/semanticColorizationRegionsReceipt');
const ColorThemeChangedNotification: NotificationType<ColorThemeChangedParams, void> = new NotificationType<ColorThemeChangedParams, void>('cpptools/colorThemeChanged');
const RequestReferencesNotification: NotificationType<boolean, void> = new NotificationType<boolean, void>('cpptools/requestReferences');
const CancelReferencesNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/cancelReferences');
const FinishedRequestCustomConfig: NotificationType<string, void> = new NotificationType<string, void>('cpptools/finishedRequestCustomConfig');
const FindAllReferencesNotification: NotificationType<FindAllReferencesParams, void> = new NotificationType<FindAllReferencesParams, void>('cpptools/findAllReferences');
const RenameNotification: NotificationType<RenameParams, void> = new NotificationType<RenameParams, void>('cpptools/rename');
const DidChangeSettingsNotification: NotificationType<DidChangeConfigurationParams, void> = new NotificationType<DidChangeConfigurationParams, void>('cpptools/didChangeSettings');

// Notifications from the server
const ReloadWindowNotification: NotificationType<void, void> = new NotificationType<void, void>('cpptools/reloadWindow');
const LogTelemetryNotification: NotificationType<TelemetryPayload, void> = new NotificationType<TelemetryPayload, void>('cpptools/logTelemetry');
const ReportTagParseStatusNotification: NotificationType<LocalizeStringParams, void> = new NotificationType<LocalizeStringParams, void>('cpptools/reportTagParseStatus');
const ReportStatusNotification: NotificationType<ReportStatusNotificationBody, void> = new NotificationType<ReportStatusNotificationBody, void>('cpptools/reportStatus');
const DebugProtocolNotification: NotificationType<DebugProtocolParams, void> = new NotificationType<DebugProtocolParams, void>('cpptools/debugProtocol');
const DebugLogNotification:  NotificationType<LocalizeStringParams, void> = new NotificationType<LocalizeStringParams, void>('cpptools/debugLog');
const SemanticColorizationRegionsNotification:  NotificationType<SemanticColorizationRegionsParams, void> = new NotificationType<SemanticColorizationRegionsParams, void>('cpptools/semanticColorizationRegions');
const CompileCommandsPathsNotification:  NotificationType<CompileCommandsPaths, void> = new NotificationType<CompileCommandsPaths, void>('cpptools/compileCommandsPaths');
const ReferencesNotification: NotificationType<refs.ReferencesResultMessage, void> = new NotificationType<refs.ReferencesResultMessage, void>('cpptools/references');
const ReportReferencesProgressNotification: NotificationType<refs.ReportReferencesProgressNotification, void> = new NotificationType<refs.ReportReferencesProgressNotification, void>('cpptools/reportReferencesProgress');
const RequestCustomConfig: NotificationType<string, void> = new NotificationType<string, void>('cpptools/requestCustomConfig');
const PublishDiagnosticsNotification: NotificationType<PublishDiagnosticsParams, void> = new NotificationType<PublishDiagnosticsParams, void>('cpptools/publishDiagnostics');
const ShowMessageWindowNotification: NotificationType<ShowMessageWindowParams, void> = new NotificationType<ShowMessageWindowParams, void>('cpptools/showMessageWindow');
const ReportTextDocumentLanguage: NotificationType<string, void> = new NotificationType<string, void>('cpptools/reportTextDocumentLanguage');

let failureMessageShown: boolean = false;

let referencesRequestPending: boolean = false;
let renamePending: boolean = false;
let renameRequestsPending: number = 0;
let referencesParams: RenameParams | FindAllReferencesParams;

interface ReferencesCancellationState {
    reject(): void;
    callback(): void;
}

let referencesPendingCancellations: ReferencesCancellationState[] = [];

interface ClientModel {
    isTagParsing: DataBinding<boolean>;
    isUpdatingIntelliSense: DataBinding<boolean>;
    referencesCommandMode: DataBinding<refs.ReferencesCommandMode>;
    tagParserStatus: DataBinding<string>;
    activeConfigName: DataBinding<string>;
}

export interface Client {
    TagParsingChanged: vscode.Event<boolean>;
    IntelliSenseParsingChanged: vscode.Event<boolean>;
    ReferencesCommandModeChanged: vscode.Event<refs.ReferencesCommandMode>;
    TagParserStatusChanged: vscode.Event<string>;
    ActiveConfigChanged: vscode.Event<string>;
    RootPath: string;
    RootUri: vscode.Uri;
    Name: string;
    TrackedDocuments: Set<vscode.TextDocument>;
    onDidChangeSettings(event: vscode.ConfigurationChangeEvent): { [key: string]: string };
    onDidOpenTextDocument(document: vscode.TextDocument): void;
    onDidCloseTextDocument(document: vscode.TextDocument): void;
    onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void;
    onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void;
    onDidChangeTextEditorVisibleRanges(textEditorVisibleRangesChangeEvent: vscode.TextEditorVisibleRangesChangeEvent): void;
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void>;
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    provideCustomConfiguration(docUri: vscode.Uri, requestFile?: string): Promise<void>;
    logDiagnostics(): Promise<void>;
    rescanFolder(): Promise<void>;
    toggleReferenceResultsView(): void;
    setCurrentConfigName(configurationName: string): Thenable<void>;
    getCurrentConfigName(): Thenable<string>;
    getVcpkgInstalled(): Thenable<boolean>;
    getVcpkgEnabled(): Thenable<boolean>;
    getCurrentCompilerPathAndArgs(): Thenable<util.CompilerPathAndArgs>;
    getKnownCompilers(): Thenable<configs.KnownCompiler[]>;
    takeOwnership(document: vscode.TextDocument): void;
    queueTask<T>(task: () => Thenable<T>): Thenable<T>;
    requestWhenReady(request: () => Thenable<any>): Thenable<any>;
    notifyWhenReady(notify: () => void): void;
    requestSwitchHeaderSource(rootPath: string, fileName: string): Thenable<string>;
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

export class DefaultClient implements Client {
    private languageClient: LanguageClient; // The "client" that launches and communicates with our language "server" process.
    private disposables: vscode.Disposable[] = [];
    private configuration: configs.CppProperties;
    private rootPathFileWatcher: vscode.FileSystemWatcher;
    private rootFolder: vscode.WorkspaceFolder | undefined;
    private storagePath: string;
    private trackedDocuments = new Set<vscode.TextDocument>();
    private crashTimes: number[] = [];
    private isSupported: boolean = true;
    private colorizationSettings: ColorizationSettings;
    private openFileVersions = new Map<string, number>();
    private visibleRanges = new Map<string, Range[]>();
    private settingsTracker: SettingsTracker;
    private configurationProvider: string;

    // The "model" that is displayed via the UI (status bar).
    private model: ClientModel = {
        isTagParsing: new DataBinding<boolean>(false),
        isUpdatingIntelliSense: new DataBinding<boolean>(false),
        referencesCommandMode: new DataBinding<refs.ReferencesCommandMode>(refs.ReferencesCommandMode.None),
        tagParserStatus: new DataBinding<string>(""),
        activeConfigName: new DataBinding<string>("")
    };

    public get TagParsingChanged(): vscode.Event<boolean> { return this.model.isTagParsing.ValueChanged; }
    public get IntelliSenseParsingChanged(): vscode.Event<boolean> { return this.model.isUpdatingIntelliSense.ValueChanged; }
    public get ReferencesCommandModeChanged(): vscode.Event<refs.ReferencesCommandMode> { return this.model.referencesCommandMode.ValueChanged; }
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
    public get RootFolder(): vscode.WorkspaceFolder | undefined {
        return this.rootFolder;
    }
    public get Name(): string {
        return this.getName(this.rootFolder);
    }
    public get TrackedDocuments(): Set<vscode.TextDocument> {
        return this.trackedDocuments;
    }
    public get IsTagParsing(): boolean {
        return this.model.isTagParsing.Value;
    }
    public get ReferencesCommandMode(): refs.ReferencesCommandMode {
        return this.model.referencesCommandMode.Value;
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

    constructor(allClients: ClientCollection, workspaceFolder?: vscode.WorkspaceFolder) {
        this.rootFolder = workspaceFolder;
        this.storagePath = util.extensionContext ? util.extensionContext.storagePath :
            path.join((this.rootFolder ? this.rootFolder.uri.fsPath : ""), "/.vscode");
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
            this.storagePath = path.join(this.storagePath, util.getUniqueWorkspaceStorageName(this.rootFolder));
        }
        try {
            let firstClient: boolean = false;
            if (!languageClient) {
                languageClient = this.createLanguageClient(allClients);
                clientCollection = allClients;
                languageClient.registerProposedFeatures();
                languageClient.start();  // This returns Disposable, but doesn't need to be tracked because we call .stop() explicitly in our dispose()
                util.setProgress(util.getProgressExecutableStarted());
                firstClient = true;
            }
            ui = getUI();
            ui.bind(this);

            // requests/notifications are deferred until this.languageClient is set.
            this.queueBlockingTask(() => languageClient.onReady().then(
                () => {
                    this.configuration = new configs.CppProperties(this.RootUri, this.rootFolder);
                    this.configuration.ConfigurationsChanged((e) => this.onConfigurationsChanged(e));
                    this.configuration.SelectionChanged((e) => this.onSelectedConfigurationChanged(e));
                    this.configuration.CompileCommandsChanged((e) => this.onCompileCommandsChanged(e));
                    this.disposables.push(this.configuration);

                    this.languageClient = languageClient;
                    this.settingsTracker = getTracker(this.RootUri);
                    telemetry.logLanguageServerEvent("NonDefaultInitialCppSettings", this.settingsTracker.getUserModifiedSettings());
                    failureMessageShown = false;

                    let documentSelector: DocumentFilter[] = [
                        { scheme: 'file', language: 'cpp' },
                        { scheme: 'file', language: 'c' }
                    ];

                    class CodeActionProvider implements vscode.CodeActionProvider {
                        private client: DefaultClient;
                        constructor(client: DefaultClient) {
                            this.client = client;
                        }

                        public async provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): Promise<(vscode.Command | vscode.CodeAction)[]> {
                            return this.client.requestWhenReady(() => {
                                let r: Range;
                                if (range instanceof vscode.Selection) {
                                    if (range.active.isBefore(range.anchor)) {
                                        r = Range.create(Position.create(range.active.line, range.active.character), Position.create(range.anchor.line, range.anchor.character));
                                    } else {
                                        r = Range.create(Position.create(range.anchor.line, range.anchor.character), Position.create(range.active.line, range.active.character));
                                    }
                                } else {
                                    r = Range.create(Position.create(range.start.line, range.start.character), Position.create(range.end.line, range.end.character));
                                }

                                let params: GetCodeActionsRequestParams = {
                                    range: r,
                                    uri: document.uri.toString()
                                };

                                return this.client.languageClient.sendRequest(GetCodeActionsRequest, params)
                                    .then((commands) => {
                                        let resultCommands: vscode.Command[] = [];

                                        // Convert to vscode.Command array
                                        commands.forEach((command) => {
                                            let title: string = util.getLocalizedString(command.localizeStringParams);
                                            let vscodeCommand: vscode.Command = {
                                                title: title,
                                                command: command.command,
                                                arguments: command.arguments
                                            };
                                            resultCommands.push(vscodeCommand);
                                        });

                                        return resultCommands;
                                    });
                            });
                        }
                    }

                    class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
                        private client: DefaultClient;
                        constructor(client: DefaultClient) {
                            this.client = client;
                        }
                        private getChildrenSymbols(symbols: LocalizeDocumentSymbol[]): vscode.DocumentSymbol[] {
                            let documentSymbols: vscode.DocumentSymbol[] = [];
                            if (symbols) {
                                symbols.forEach((symbol) => {
                                    let detail: string = util.getLocalizedString(symbol.detail);
                                    let r: vscode.Range= new vscode.Range(symbol.range.start.line, symbol.range.start.character, symbol.range.end.line, symbol.range.end.character);
                                    let sr: vscode.Range= new vscode.Range(symbol.selectionRange.start.line, symbol.selectionRange.start.character, symbol.selectionRange.end.line, symbol.selectionRange.end.character);
                                    let vscodeSymbol: vscode.DocumentSymbol = new vscode.DocumentSymbol (symbol.name, detail, symbol.kind, r, sr);
                                    vscodeSymbol.children = this.getChildrenSymbols(symbol.children);
                                    documentSymbols.push(vscodeSymbol);
                                });
                            }
                            return documentSymbols;
                        }
                        public async provideDocumentSymbols(document: vscode.TextDocument): Promise<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
                            return this.client.requestWhenReady(() => {
                                let params: GetDocumentSymbolRequestParams = {
                                    uri: document.uri.toString()
                                };
                                return this.client.languageClient.sendRequest(GetDocumentSymbolRequest, params)
                                    .then((symbols) => {
                                        let resultSymbols: vscode.DocumentSymbol[] = this.getChildrenSymbols(symbols);
                                        return resultSymbols;
                                    });
                            });
                        }
                    }

                    class WorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
                        private client: DefaultClient;
                        constructor(client: DefaultClient) {
                            this.client = client;
                        }

                        public async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
                            let params: WorkspaceSymbolParams = {
                                query: query,
                                workspaceFolderUri: this.client.RootPath
                            };

                            return this.client.languageClient.sendRequest(GetSymbolInfoRequest, params)
                                .then((symbols) => {
                                    let resultSymbols: vscode.SymbolInformation[] = [];

                                    // Convert to vscode.Command array
                                    symbols.forEach((symbol) => {
                                        let suffix: string = util.getLocalizedString(symbol.suffix);
                                        let name: string = symbol.name;
                                        let range: vscode.Range = new vscode.Range(symbol.location.range.start.line, symbol.location.range.start.character, symbol.location.range.end.line, symbol.location.range.end.character);
                                        let uri: vscode.Uri = vscode.Uri.parse(symbol.location.uri.toString());
                                        if (suffix.length) {
                                            name = name + ' (' + suffix + ')';
                                        }
                                        let vscodeSymbol: vscode.SymbolInformation = new vscode.SymbolInformation(
                                            name,
                                            symbol.kind,
                                            range,
                                            uri,
                                            symbol.containerName
                                        );
                                        resultSymbols.push(vscodeSymbol);
                                    });
                                    return resultSymbols;
                                });
                        }
                    }

                    class FindAllReferencesProvider implements vscode.ReferenceProvider {
                        private client: DefaultClient;
                        constructor(client: DefaultClient) {
                            this.client = client;
                        }
                        public async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken): Promise<vscode.Location[] | undefined> {
                            return new Promise<vscode.Location[]>((resolve, reject) => {
                                let callback: () => void = () => {
                                    let params: FindAllReferencesParams = {
                                        position: Position.create(position.line, position.character),
                                        textDocument: this.client.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document)
                                    };
                                    referencesParams = params;
                                    this.client.notifyWhenReady(() => {
                                        // The current request is represented by referencesParams.  If a request detects
                                        // referencesParams does not match the object used when creating the request, abort it.
                                        if (params !== referencesParams) {
                                            // Complete with nothing instead of rejecting, to avoid an error message from VS Code
                                            let locations: vscode.Location[] = [];
                                            resolve(locations);
                                            return;
                                        }
                                        referencesRequestPending = true;
                                        // Register a single-fire handler for the reply.
                                        let resultCallback: refs.ReferencesResultCallback = (result: refs.ReferencesResult, doResolve: boolean) => {
                                            referencesRequestPending = false;
                                            let locations: vscode.Location[] = [];
                                            if (result) {
                                                result.referenceInfos.forEach((referenceInfo: refs.ReferenceInfo) => {
                                                    if (referenceInfo.type === refs.ReferenceType.Confirmed) {
                                                        let uri: vscode.Uri = vscode.Uri.file(referenceInfo.file);
                                                        let range: vscode.Range = new vscode.Range(referenceInfo.position.line, referenceInfo.position.character, referenceInfo.position.line, referenceInfo.position.character + result.text.length);
                                                        locations.push(new vscode.Location(uri, range));
                                                    }
                                                });
                                            }
                                            // If references were canceled while in a preview state, there is not an outstanding promise.
                                            if (doResolve) {
                                                resolve(locations);
                                            }
                                            if (referencesPendingCancellations.length > 0) {
                                                while (referencesPendingCancellations.length > 1) {
                                                    let pendingCancel: ReferencesCancellationState = referencesPendingCancellations[0];
                                                    referencesPendingCancellations.pop();
                                                    pendingCancel.reject();
                                                }
                                                let pendingCancel: ReferencesCancellationState = referencesPendingCancellations[0];
                                                referencesPendingCancellations.pop();
                                                pendingCancel.callback();
                                            }
                                        };
                                        if (!workspaceReferences.referencesRefreshPending) {
                                            workspaceReferences.setResultsCallback(resultCallback);
                                            workspaceReferences.startFindAllReferences(params);
                                        } else {
                                            // We are responding to a refresh (preview or final result)
                                            workspaceReferences.referencesRefreshPending = false;
                                            if (workspaceReferences.lastResults) {
                                                // This is a final result
                                                let lastResults: refs.ReferencesResult = workspaceReferences.lastResults;
                                                workspaceReferences.lastResults = null;
                                                resultCallback(lastResults, true);
                                            } else {
                                                // This is a preview (2nd or later preview)
                                                workspaceReferences.referencesRequestPending = true;
                                                workspaceReferences.setResultsCallback(resultCallback);
                                                this.client.languageClient.sendNotification(RequestReferencesNotification, false);
                                            }
                                        }
                                    });
                                    token.onCancellationRequested(e => {
                                        if (params === referencesParams) {
                                            this.client.cancelReferences();
                                        }
                                    });
                                };

                                if (referencesRequestPending || (workspaceReferences.symbolSearchInProgress && !workspaceReferences.referencesRefreshPending)) {
                                    let cancelling: boolean = referencesPendingCancellations.length > 0;
                                    referencesPendingCancellations.push({ reject: () => {
                                        // Complete with nothing instead of rejecting, to avoid an error message from VS Code
                                        let locations: vscode.Location[] = [];
                                        resolve(locations);
                                    }, callback });
                                    if (!cancelling) {
                                        renamePending = false;
                                        workspaceReferences.referencesCanceled = true;
                                        if (!referencesRequestPending) {
                                            workspaceReferences.referencesCanceledWhilePreviewing = true;
                                        }
                                        this.client.languageClient.sendNotification(CancelReferencesNotification);
                                        workspaceReferences.closeRenameUI();
                                    }
                                } else {
                                    callback();
                                }
                            });
                        }
                    }

                    class RenameProvider implements vscode.RenameProvider {
                        private client: DefaultClient;
                        constructor(client: DefaultClient) {
                            this.client = client;
                        }
                        public async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Promise<vscode.WorkspaceEdit> {
                            let settings: CppSettings = new CppSettings();
                            if (settings.renameRequiresIdentifier && !util.isValidIdentifier(newName)) {
                                vscode.window.showErrorMessage(localize("invalid.identifier.for.rename", "Invalid identifier provided for the Rename Symbol operation."));
                                let workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                                return Promise.resolve(workspaceEdit);
                            }
                            // Normally, VS Code considers rename to be an atomic operation.
                            // If the user clicks anywhere in the document, it attempts to cancel it.
                            // Because that prevents our rename UI, we ignore cancellation requests.
                            // VS Code will attempt to issue new rename requests while another is still active.
                            // When we receive another rename request, cancel the one that is in progress.
                            renamePending = true;
                            ++renameRequestsPending;
                            return new Promise<vscode.WorkspaceEdit>((resolve, reject) => {
                                let callback: () => void = () => {
                                    let params: RenameParams = {
                                        newName: newName,
                                        position: Position.create(position.line, position.character),
                                        textDocument: this.client.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document)
                                    };
                                    referencesParams = params;
                                    this.client.notifyWhenReady(() => {
                                        // The current request is represented by referencesParams.  If a request detects
                                        // referencesParams does not match the object used when creating the request, abort it.
                                        if (params !== referencesParams) {
                                            if (--renameRequestsPending === 0) {
                                                renamePending = false;
                                            }

                                            // Complete with nothing instead of rejecting, to avoid an error message from VS Code
                                            let workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                                            resolve(workspaceEdit);
                                            return;
                                        }
                                        referencesRequestPending = true;
                                        workspaceReferences.setResultsCallback((referencesResult: refs.ReferencesResult, doResolve: boolean) => {
                                            if (doResolve && referencesResult === null) {
                                                // The result callback will be called with doResult of true and a null result when the Find All References
                                                // portion of the rename is complete.  We complete the promise with an empty edit at this point,
                                                // to cause the progress indicator to be dismissed.
                                                let workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                                                resolve(workspaceEdit);
                                            } else {
                                                referencesRequestPending = false;
                                                --renameRequestsPending;
                                                let workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                                                let cancelling: boolean = referencesPendingCancellations.length > 0;
                                                if (cancelling) {
                                                    while (referencesPendingCancellations.length > 1) {
                                                        let pendingCancel: ReferencesCancellationState = referencesPendingCancellations[0];
                                                        referencesPendingCancellations.pop();
                                                        pendingCancel.reject();
                                                    }
                                                    let pendingCancel: ReferencesCancellationState = referencesPendingCancellations[0];
                                                    referencesPendingCancellations.pop();
                                                    pendingCancel.callback();
                                                } else {
                                                    if (renameRequestsPending === 0) {
                                                        renamePending = false;
                                                    }
                                                    // If rename UI was canceled, we will get a null result.
                                                    // If null, return an empty list to avoid Rename failure dialog.
                                                    if (referencesResult !== null) {
                                                        for (let reference of referencesResult.referenceInfos) {
                                                            let uri: vscode.Uri = vscode.Uri.file(reference.file);
                                                            let range: vscode.Range = new vscode.Range(reference.position.line, reference.position.character, reference.position.line, reference.position.character + referencesResult.text.length);
                                                            workspaceEdit.replace(uri, range, newName);
                                                        }
                                                    }
                                                    workspaceReferences.closeRenameUI();
                                                }
                                                if (doResolve) {
                                                    if (referencesResult.referenceInfos === null || referencesResult.referenceInfos.length === 0) {
                                                        vscode.window.showErrorMessage(localize("unable.to.locate.selected.symbol", "A definition for the selected symbol could not be located."));
                                                    }
                                                    resolve(workspaceEdit);
                                                } else if (workspaceEdit.size > 0) {
                                                    vscode.workspace.applyEdit(workspaceEdit);
                                                }
                                            }
                                        });
                                        workspaceReferences.startRename(params);
                                    });
                                };

                                if (referencesRequestPending || workspaceReferences.symbolSearchInProgress) {
                                    let cancelling: boolean = referencesPendingCancellations.length > 0;
                                    referencesPendingCancellations.push({ reject: () => {
                                        --renameRequestsPending;
                                        // Complete with nothing instead of rejecting, to avoid an error message from VS Code
                                        let workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                                        resolve(workspaceEdit);
                                    }, callback });
                                    if (!cancelling) {
                                        workspaceReferences.referencesCanceled = true;
                                        if (!referencesRequestPending) {
                                            workspaceReferences.referencesCanceledWhilePreviewing = true;
                                        }
                                        this.client.languageClient.sendNotification(CancelReferencesNotification);
                                        workspaceReferences.closeRenameUI();
                                    }
                                } else {
                                    callback();
                                }
                            });
                        }
                    }

                    this.registerFileWatcher();

                    if (firstClient) {
                        this.disposables.push(vscode.languages.registerRenameProvider(documentSelector, new RenameProvider(this)));
                        this.disposables.push(vscode.languages.registerReferenceProvider(documentSelector, new FindAllReferencesProvider(this)));
                        this.disposables.push(vscode.languages.registerWorkspaceSymbolProvider(new WorkspaceSymbolProvider(this)));
                        this.disposables.push(vscode.languages.registerDocumentSymbolProvider(documentSelector, new DocumentSymbolProvider(this), null));
                        this.disposables.push(vscode.languages.registerCodeActionsProvider(documentSelector, new CodeActionProvider(this), null));

                        // Listen for messages from the language server.
                        this.registerNotifications();

                        workspaceReferences = new refs.ReferencesManager(this);

                        // The configurations will not be sent to the language server until the default include paths and frameworks have been set.
                        // The event handlers must be set before this happens.
                        return languageClient.sendRequest(QueryCompilerDefaultsRequest, {}).then((inputCompilerDefaults: configs.CompilerDefaults) => {
                            compilerDefaults = inputCompilerDefaults;
                            this.configuration.CompilerDefaults = compilerDefaults;

                            // Only register the real commands after the extension has finished initializing,
                            // e.g. prevents empty c_cpp_properties.json from generation.
                            registerCommands();
                        });
                    } else {
                        this.configuration.CompilerDefaults = compilerDefaults;
                    }
                },
                (err) => {
                    this.isSupported = false;   // Running on an OS we don't support yet.
                    if (!failureMessageShown) {
                        failureMessageShown = true;
                        vscode.window.showErrorMessage(localize("unable.to.start", "Unable to start the C/C++ language server. IntelliSense features will be disabled. Error: {0}", String(err)));
                    }
                }));
        } catch (err) {
            this.isSupported = false;   // Running on an OS we don't support yet.
            if (!failureMessageShown) {
                failureMessageShown = true;
                let additionalInfo: string;
                if (err.code === "EPERM") {
                    additionalInfo = localize('check.permissions', "EPERM: Check permissions for '{0}'", getLanguageServerFileName());
                } else {
                    additionalInfo = String(err);
                }
                vscode.window.showErrorMessage(localize("unable.to.start", "Unable to start the C/C++ language server. IntelliSense features will be disabled. Error: {0}", additionalInfo));
            }
        }

        this.colorizationSettings = new ColorizationSettings(this.RootUri);
    }

    public sendFindAllReferencesNotification(params: FindAllReferencesParams): void {
        this.languageClient.sendNotification(FindAllReferencesNotification, params);
    }

    public sendRenameNofication(params: RenameParams): void {
        this.languageClient.sendNotification(RenameNotification, params);
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

        // Get all the per-workspace settings.
        let settings_clangFormatPath: string[] = [];
        let settings_clangFormatStyle: string[] = [];
        let settings_clangFormatFallbackStyle: string[] = [];
        let settings_clangFormatSortIncludes: string[] = [];
        let settings_filesExclude: vscode.WorkspaceConfiguration[] = [];
        let settings_searchExclude: vscode.WorkspaceConfiguration[] = [];
        let settings_editorTabSize: number[] = [];
        let settings_intelliSenseEngine: string[] = [];
        let settings_intelliSenseEngineFallback: string[] = [];
        let settings_errorSquiggles: string[] = [];
        let settings_dimInactiveRegions: boolean[] = [];
        let settings_enhancedColorization: string[] = [];
        let settings_suggestSnippets: boolean[] = [];
        let settings_exclusionPolicy: string[] = [];
        let settings_preferredPathSeparator: string[] = [];
        let settings_defaultSystemIncludePath: string[][] = [];
        let settings_intelliSenseCachePath: string[] = [];
        let settings_intelliSenseCacheSize: number[] = [];
        let settings_autoComplete: string[] = [];
        let settings_formatting: string[] = [];
        let workspaceSettings: CppSettings = new CppSettings();
        let workspaceOtherSettings: OtherSettings = new OtherSettings(null);
        {
            let settings: CppSettings[] = [];
            let otherSettings: OtherSettings[] = [];

            settings.push(workspaceSettings);
            otherSettings.push(workspaceOtherSettings);
            for (let workspaceFolder of vscode.workspace.workspaceFolders) {
                settings.push(new CppSettings(workspaceFolder.uri));
                otherSettings.push(new OtherSettings(workspaceFolder.uri));
            }

            for (let setting of settings) {
                settings_clangFormatPath.push(util.resolveVariables(setting.clangFormatPath, this.AdditionalEnvironment));
                settings_clangFormatStyle.push(setting.clangFormatStyle);
                settings_clangFormatFallbackStyle.push(setting.clangFormatFallbackStyle);
                settings_clangFormatSortIncludes.push(setting.clangFormatSortIncludes);
                settings_intelliSenseEngine.push(setting.intelliSenseEngine);
                settings_intelliSenseEngineFallback.push(setting.intelliSenseEngineFallback);
                settings_errorSquiggles.push(setting.errorSquiggles);
                settings_dimInactiveRegions.push(setting.dimInactiveRegions);
                settings_enhancedColorization.push(setting.enhancedColorization ? "Enabled" : "Disabled");
                settings_suggestSnippets.push(setting.suggestSnippets);
                settings_exclusionPolicy.push(setting.exclusionPolicy);
                settings_preferredPathSeparator.push(setting.preferredPathSeparator);
                settings_defaultSystemIncludePath.push(setting.defaultSystemIncludePath);
                settings_intelliSenseCachePath.push(util.resolveCachePath(setting.intelliSenseCachePath, this.AdditionalEnvironment));
                settings_intelliSenseCacheSize.push(setting.intelliSenseCacheSize);
                settings_autoComplete.push(setting.autoComplete);
                settings_formatting.push(setting.formatting);
            }

            for (let otherSetting of otherSettings) {
                settings_filesExclude.push(otherSetting.filesExclude);
                settings_searchExclude.push(otherSetting.searchExclude);
                settings_editorTabSize.push(otherSetting.editorTabSize);
            }
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
            initializationOptions: {
                clang_format_path: settings_clangFormatPath,
                clang_format_style: settings_clangFormatStyle,
                clang_format_fallbackStyle: settings_clangFormatFallbackStyle,
                clang_format_sortIncludes: settings_clangFormatSortIncludes,
                formatting: settings_formatting,
                extension_path: util.extensionPath,
                exclude_files: settings_filesExclude,
                associations: workspaceOtherSettings.filesAssociations,
                storage_path: this.storagePath,
                tabSize: settings_editorTabSize,
                intelliSenseEngine: settings_intelliSenseEngine,
                intelliSenseEngineFallback: settings_intelliSenseEngineFallback,
                intelliSenseCacheDisabled: intelliSenseCacheDisabled,
                intelliSenseCachePath : settings_intelliSenseCachePath,
                intelliSenseCacheSize : settings_intelliSenseCacheSize,
                autocomplete: settings_autoComplete,
                errorSquiggles: settings_errorSquiggles,
                dimInactiveRegions: settings_dimInactiveRegions,
                enhancedColorization: settings_enhancedColorization,
                suggestSnippets: settings_suggestSnippets,
                loggingLevel: workspaceSettings.loggingLevel,
                workspaceParsingPriority: workspaceSettings.workspaceParsingPriority,
                workspaceSymbols: workspaceSettings.workspaceSymbols,
                exclusionPolicy: settings_exclusionPolicy,
                preferredPathSeparator: settings_preferredPathSeparator,
                default: {
                    systemIncludePath: settings_defaultSystemIncludePath
                },
                vcpkg_root: util.getVcpkgRoot(),
                gotoDefIntelliSense: abTestSettings.UseGoToDefIntelliSense,
                experimentalFeatures: workspaceSettings.experimentalFeatures,
                edgeMessagesDirectory: path.join(util.getExtensionFilePath("bin"), "messages", util.getLocaleId())
            },
            middleware: createProtocolFilter(allClients),
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
                                vscode.window.showErrorMessage(localize('server.crashed', "The language server for '{0}' crashed 5 times in the last 3 minutes. It will not be restarted.", serverName));
                            } else {
                                vscode.window.showErrorMessage(localize('server.crashed2', "The language server crashed 5 times in the last 3 minutes. It will not be restarted."));
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
        return new LanguageClient(`cpptools`, serverOptions, clientOptions);
    }

    public onDidChangeSettings(event: vscode.ConfigurationChangeEvent): { [key: string]: string } {
        let changedSettings: { [key: string]: string };
        this.notifyWhenReady(() => {
            changedSettings = this.settingsTracker.getChangedSettings();
            let cppSettingsScoped: { [key: string]: any } = {};
            // Gather the C_Cpp settings
            {
                let cppSettingsResourceScoped: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", this.RootUri);
                let cppSettingsNonScoped: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp");

                for (let key in cppSettingsResourceScoped) {
                    let curSetting: any = util.packageJson.contributes.configuration.properties["C_Cpp." + key];
                    if (curSetting === undefined) {
                        continue;
                    }
                    let settings: vscode.WorkspaceConfiguration = (curSetting.scope === "resource" || curSetting.scope === "machine-overridable") ? cppSettingsResourceScoped : cppSettingsNonScoped;
                    cppSettingsScoped[key] = settings.get(key);
                }
                cppSettingsScoped["default"] = { systemIncludePath: cppSettingsResourceScoped.get("default.systemIncludePath") };
            }

            // Unlike the LSP message, the event does not contain all settings as a payload, so we need to
            // build a new JSON object with everything we need on the native side.
            let settings: any = {
                C_Cpp: {
                    ...cppSettingsScoped,
                    tabSize: vscode.workspace.getConfiguration("editor.tabSize", this.RootUri)
                },
                files: {
                    exclude: vscode.workspace.getConfiguration("files.exclude", this.RootUri)
                },
                search: {
                    exclude: vscode.workspace.getConfiguration("search.exclude", this.RootUri)
                }
            };

            // Send settings json to native side
            this.languageClient.sendNotification(DidChangeSettingsNotification, {settings, workspaceFolderUri: this.RootPath});

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
                        let colorizationState: ColorizationState = workspaceColorizationState.get(uri.toString());
                        if (colorizationState) {
                            colorizationState.onSettingsChanged(uri);
                        }
                    }
                }
            }
            if (Object.keys(changedSettings).length > 0) {
                if (changedSettings["commentContinuationPatterns"]) {
                    updateLanguageConfigurations();
                }
                this.configuration.onDidChangeSettings();
                telemetry.logLanguageServerEvent("CppSettingsChange", changedSettings, null);
            }
        });
        return changedSettings;
    }

    private editVersion: number = 0;

    public onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void {
        // Increment editVersion for every call to onDidChangeTextDocument, regardless of whether the file is handled
        this.editVersion++;
        if (textDocumentChangeEvent.document.uri.scheme === "file") {
            if (textDocumentChangeEvent.document.languageId === "cpp" || textDocumentChangeEvent.document.languageId === "c") {

                // If any file has changed, we need to abort the current rename operation
                if (renamePending) {
                    this.cancelReferences();
                }

                let oldVersion: number = this.openFileVersions.get(textDocumentChangeEvent.document.uri.toString());
                let newVersion: number = textDocumentChangeEvent.document.version;
                if (newVersion > oldVersion) {
                    this.openFileVersions.set(textDocumentChangeEvent.document.uri.toString(), newVersion);
                    try {
                        let colorizationState: ColorizationState = workspaceColorizationState.get(textDocumentChangeEvent.document.uri.toString());
                        if (colorizationState) {
                            // Adjust colorization ranges after this edit.  (i.e. if a line was added, push decorations after it down one line)
                            colorizationState.addEdits(textDocumentChangeEvent.contentChanges, this.editVersion);
                        }
                    } catch (e) {
                        // Ensure an exception does not prevent pass-through to native handler, or editVersion could become inconsistent
                        console.log(e.toString());
                    }
                }
            }
        }
    }

    public onDidOpenTextDocument(document: vscode.TextDocument): void {
        if (document.uri.scheme === "file") {
            this.openFileVersions.set(document.uri.toString(), document.version);
            workspaceColorizationState.set(document.uri.toString(), new ColorizationState(document.uri, this.colorizationSettings));
            this.sendVisibleRanges(document.uri);
        }
    }

    public onDidCloseTextDocument(document: vscode.TextDocument): void {
        workspaceColorizationState.delete(document.uri.toString());
        this.openFileVersions.delete(document.uri.toString());
    }

    public onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {
        let processedUris: vscode.Uri[] = [];
        editors.forEach(editor => {
            if (editor.document.uri.scheme === "file") {
                let colorizationState: ColorizationState = workspaceColorizationState.get(editor.document.uri.toString());
                if (colorizationState) {
                    colorizationState.refresh(editor);
                    if (!processedUris.find(uri => uri === editor.document.uri)) {
                        processedUris.push(editor.document.uri);
                        this.sendVisibleRanges(editor.document.uri);
                    }
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
            if (vscode.window.activeTextEditor === textEditorVisibleRangesChangeEvent.textEditor) {
                if (textEditorVisibleRangesChangeEvent.visibleRanges.length === 1) {
                    let visibleRangesLength: number = textEditorVisibleRangesChangeEvent.visibleRanges[0].end.line - textEditorVisibleRangesChangeEvent.visibleRanges[0].start.line;
                    workspaceReferences.updateVisibleRange(visibleRangesLength);
                }
            }
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
                let ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("Client.registerProvider", true, this.RootFolder);
                // If c_cpp_properties.json and settings.json are both missing, reset our prompt
                if (!fs.existsSync(`${this.RootPath}/.vscode/c_cpp_properties.json`) && !fs.existsSync(`${this.RootPath}/.vscode/settings.json`)) {
                    ask.Value = true;
                }
                if (ask.Value) {
                    ui.showConfigureCustomProviderMessage(() => {
                        const message: string = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1)
                            ? localize("provider.configure.folder", "{0} would like to configure IntelliSense for the '{1}' folder.", provider.name, this.Name)
                            : localize("provider.configure.this.folder", "{0} would like to configure IntelliSense for this folder.", provider.name);
                        const allow: string = localize("allow.button", "Allow");
                        const dontAllow: string = localize("dont.allow.button", "Don't Allow");
                        const askLater: string = localize("ask.me.later.button", "Ask Me Later");

                        return vscode.window.showInformationMessage(message, allow, dontAllow, askLater).then(result => {
                            switch (result) {
                                case allow: {
                                    this.configuration.updateCustomConfigurationProvider(provider.extensionId).then(() => {
                                        onRegistered();
                                        ask.Value = false;
                                        telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": provider.extensionId });
                                    });
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
            } else if (isSameProviderExtensionId(selectedProvider, provider.extensionId)) {
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
                this.clearCustomConfigurations();
                return;
            }
            let currentProvider: CustomConfigurationProvider1 = getCustomConfigProviders().get(this.configurationProvider);
            if (!currentProvider) {
                this.clearCustomConfigurations();
                return;
            }
            if (requestingProvider && requestingProvider.extensionId !== currentProvider.extensionId) {
                // If we are being called by a configuration provider other than the current one, ignore it.
                return;
            }

            this.clearCustomConfigurations();
            this.trackedDocuments.forEach(document => {
                this.provideCustomConfiguration(document.uri, null);
            });
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
                if (this.RootUri && await currentProvider.canProvideBrowseConfigurationsPerFolder(tokenSource.token)) {
                    return (currentProvider.provideFolderBrowseConfiguration(this.RootUri, tokenSource.token));
                }
                if (await currentProvider.canProvideBrowseConfiguration(tokenSource.token)) {
                    return currentProvider.provideBrowseConfiguration(tokenSource.token);
                }
                if (currentProvider.version >= Version.v2) {
                    console.warn("failed to provide browse configuration");
                }
                return null;
            };

            // Initiate request for custom configuration.
            // Resume parsing on either resolve or reject, only if parsing was not resumed due to timeout
            let hasCompleted: boolean = false;
            task().then(async config => {
                // TODO: This is a hack to get around CMake Tools bug: https://github.com/microsoft/vscode-cmake-tools/issues/1073
                let foundMatch: boolean = false;
                for (let c of config.browsePath) {
                    if (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(c)) === this.RootFolder) {
                        foundMatch = true;
                        break;
                    }
                }
                if (foundMatch) {
                    this.sendCustomBrowseConfiguration(config, currentProvider.extensionId);
                }
                if (!hasCompleted) {
                    hasCompleted = true;
                    if (currentProvider.version >= Version.v2) {
                        this.resumeParsing();
                    }
                }
            }, () => {
                if (!hasCompleted) {
                    hasCompleted = true;
                    if (currentProvider.version >= Version.v2) {
                        this.resumeParsing();
                    }
                }
            });

            // Set up a timeout to use previously received configuration and resume parsing if the provider times out
            global.setTimeout(async () => {
                if (!hasCompleted) {
                    hasCompleted = true;
                    this.sendCustomBrowseConfiguration(null, null, true);
                    if (currentProvider.version >= Version.v2) {
                        console.warn("Configuration Provider timed out in {0}ms.", configProviderTimeout);
                        this.resumeParsing();
                    }
                }
            }, configProviderTimeout);
        });
    }

    public toggleReferenceResultsView(): void {
        workspaceReferences.toggleGroupView();
    }

    public async logDiagnostics(): Promise<void> {
        let response: GetDiagnosticsResult = await this.requestWhenReady(() => this.languageClient.sendRequest(GetDiagnosticsRequest, null));
        if (!diagnosticsChannel) {
            diagnosticsChannel = vscode.window.createOutputChannel(localize("c.cpp.diagnostics", "C/C++ Diagnostics"));
            workspaceDisposables.push(diagnosticsChannel);
        }

        let header: string = `-------- Diagnostics - ${new Date().toLocaleString()}\n`;
        let version: string = `Version: ${util.packageJson.version}\n`;
        let configJson: string = "";
        if (this.configuration.CurrentConfiguration) {
            configJson = `Current Configuration:\n${JSON.stringify(this.configuration.CurrentConfiguration, null, 4)}\n`;
        }
        diagnosticsChannel.appendLine(`${header}${version}${configJson}${response.diagnostics}`);
        diagnosticsChannel.show(false);
    }

    public async rescanFolder(): Promise<void> {
        await this.notifyWhenReady(() => this.languageClient.sendNotification(RescanFolderNotification));
    }

    public async provideCustomConfiguration(docUri: vscode.Uri, requestFile?: string): Promise<void> {
        let onFinished: () => void = () => {
            if (requestFile) {
                this.languageClient.sendNotification(FinishedRequestCustomConfig, requestFile);
            }
        };
        let providerId: string | undefined = this.configurationProvider;
        if (!providerId) {
            onFinished();
            return Promise.resolve();
        }
        let provider: CustomConfigurationProvider1 | null = getCustomConfigProviders().get(providerId);
        if (!provider) {
            onFinished();
            return Promise.resolve();
        }
        if (!provider.isReady) {
            onFinished();
            return Promise.reject(`${this.configurationProvider} is not ready`);
        }
        return this.queueBlockingTask(async () => {
            let tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
            console.log("provideCustomConfiguration");

            let providerName: string = provider.name;

            let params: QueryTranslationUnitSourceParams = {
                uri: docUri.toString(),
                workspaceFolderUri: this.RootPath
            };
            let response: QueryTranslationUnitSourceResult = await this.languageClient.sendRequest(QueryTranslationUnitSourceRequest, params);
            if (!response.candidates || response.candidates.length === 0) {
                // If we didn't receive any candidates, no configuration is needed.
                onFinished();
                return Promise.resolve();
            }

            // Need to loop through candidates, to see if we can get a custom configuration from any of them.
            // Wrap all lookups in a single task, so we can apply a timeout to the entire duration.
            let provideConfigurationAsync: () => Thenable<SourceFileConfigurationItem[]> = async () => {
                if (provider) {
                    for (let i: number = 0; i < response.candidates.length; ++i) {
                        try {
                            let candidate: string = response.candidates[i];
                            let tuUri: vscode.Uri = vscode.Uri.parse(candidate);
                            if (await provider.canProvideConfiguration(tuUri, tokenSource.token)) {
                                let configs: SourceFileConfigurationItem[] = await provider.provideConfigurations([tuUri], tokenSource.token);
                                if (configs && configs.length > 0 && configs[0]) {
                                    return configs;
                                }
                            }
                            if (tokenSource.token.isCancellationRequested) {
                                return null;
                            }
                        } catch (err) {
                            console.warn("Caught exception request configuration");
                        }
                    }
                }
            };
            return this.callTaskWithTimeout(provideConfigurationAsync, configProviderTimeout, tokenSource).then(
                (configs: SourceFileConfigurationItem[]) => {
                    if (configs && configs.length > 0) {
                        this.sendCustomConfigurations(configs);
                    }
                    onFinished();
                },
                (err) => {
                    if (requestFile) {
                        onFinished();
                        return;
                    }
                    let settings: CppSettings = new CppSettings(this.RootUri);
                    if (settings.configurationWarnings === "Enabled" && !this.isExternalHeader(docUri) && !vscode.debug.activeDebugSession) {
                        const dismiss: string = localize("dismiss.button", "Dismiss");
                        const disable: string = localize("diable.warnings.button", "Disable Warnings");
                        let configName: string = this.configuration.CurrentConfiguration.name;
                        let message: string = localize("unable.to.provide.configuraiton",
                            "{0} is unable to provide IntelliSense configuration information for '{1}'. Settings from the '{2}' configuration will be used instead.",
                            providerName, docUri.fsPath, configName);
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

    private async handleRequestCustomConfig(requestFile: string): Promise<void> {
        await this.provideCustomConfiguration(vscode.Uri.file(requestFile), requestFile);
    }

    private isExternalHeader(uri: vscode.Uri): boolean {
        return util.isHeader(uri) && !uri.toString().startsWith(this.RootUri.toString());
    }

    public getCurrentConfigName(): Thenable<string> {
        return this.queueTask(() => Promise.resolve(this.configuration.CurrentConfiguration.name));
    }

    public setCurrentConfigName(configurationName: string): Thenable<void> {
        return this.queueTask(() => new Promise((resolve, reject) => {
            let configurations: configs.Configuration[] = this.configuration.Configurations || [];
            let configurationIndex: number = configurations.findIndex((config) => config.name === configurationName);

            if (configurationIndex !== -1) {
                this.configuration.select(configurationIndex);
                resolve();
            } else {
                reject(new Error(localize("config.not.found", "The requested configuration name is not found: {0}", configurationName)));
            }
        }));
    }

    public getCurrentCompilerPathAndArgs(): Thenable<util.CompilerPathAndArgs> {
        return this.queueTask(() => Promise.resolve(
            util.extractCompilerPathAndArgs(
                this.configuration.CurrentConfiguration.compilerPath,
                this.configuration.CurrentConfiguration.compilerArgs)
        ));
    }

    public getVcpkgInstalled(): Thenable<boolean> {
        return this.queueTask(() => Promise.resolve(this.configuration.VcpkgInstalled));
    }

    public getVcpkgEnabled(): Thenable<boolean> {
        const cppSettings: CppSettings = new CppSettings(this.RootUri);
        return Promise.resolve(cppSettings.vcpkgEnabled);
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

    /**
     * wait until the all pendingTasks are complete (e.g. language client is ready for use)
     * before attempting to send messages or operate on the client.
     */

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

            if (pendingTask && !pendingTask.Done) {
                // We don't want the queue to stall because of a rejected promise.
                return pendingTask.getPromise().then(nextTask, nextTask);
            } else {
                pendingTask = undefined;
                return nextTask();
            }
        } else {
            return Promise.reject(localize("unsupported.client", "Unsupported client"));
        }
    }

    /**
     * Queue a task that blocks all future tasks until it completes. This is currently only intended to be used
     * during language client startup and for custom configuration providers.
     * @param task The task that blocks all future tasks
     */
    private queueBlockingTask(task: () => Thenable<any>): Thenable<any> {
        if (this.isSupported) {
            pendingTask = new util.BlockingTask<any>(task, pendingTask);
            return pendingTask.getPromise();
        } else {
            return Promise.reject(localize("unsupported.client", "Unsupported client"));
        }
    }

    private callTaskWithTimeout(task: () => Thenable<any>, ms: number, cancelToken?: vscode.CancellationTokenSource): Thenable<any> {
        let timer: NodeJS.Timer;
        // Create a promise that rejects in <ms> milliseconds
        let timeout: () => Promise<any> = () => new Promise((resolve, reject) => {
            timer = global.setTimeout(() => {
                clearTimeout(timer);
                if (cancelToken) {
                    cancelToken.cancel();
                }
                reject(localize("timed.out", "Timed out in {0}ms.", ms));
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

    public notifyWhenReady(notify: () => void): Thenable<void> {
        let task: () => Thenable<void> = () => new Promise(resolve => {
            notify();
            resolve();
        });
        return this.queueTask(task);
    }

    /**
     * listen for notifications from the language server.
     */
    private registerNotifications(): void {
        console.assert(this.languageClient !== undefined, "This method must not be called until this.languageClient is set in \"onReady\"");

        this.languageClient.onNotification(ReloadWindowNotification, () => util.promptForReloadWindowDueToSettingsChange());
        this.languageClient.onNotification(LogTelemetryNotification, logTelemetry);
        this.languageClient.onNotification(ReportStatusNotification, (e) => this.updateStatus(e));
        this.languageClient.onNotification(ReportTagParseStatusNotification, (e) => this.updateTagParseStatus(e));
        this.languageClient.onNotification(SemanticColorizationRegionsNotification, updateSemanticColorizationRegions);
        this.languageClient.onNotification(CompileCommandsPathsNotification, (e) => this.promptCompileCommands(e));
        this.languageClient.onNotification(ReferencesNotification, (e) => this.processReferencesResult(e.referencesResult));
        this.languageClient.onNotification(ReportReferencesProgressNotification, (e) => this.handleReferencesProgress(e));
        this.languageClient.onNotification(RequestCustomConfig, (requestFile: string) => {
            let client: DefaultClient = <DefaultClient>clientCollection.getClientFor(vscode.Uri.file(requestFile));
            client.handleRequestCustomConfig(requestFile);
        });
        this.languageClient.onNotification(PublishDiagnosticsNotification, publishDiagnostics);
        this.languageClient.onNotification(ShowMessageWindowNotification, showMessageWindow);
        this.languageClient.onNotification(ReportTextDocumentLanguage, (e) => this.setTextDocumentLanguage(e));
        setupOutputHandlers();
    }

    private setTextDocumentLanguage(languageStr: string): void {
        let cppSettings: CppSettings = new CppSettings();
        if (cppSettings.autoAddFileAssociations) {
            const is_c: boolean = languageStr.startsWith("c;");
            languageStr = languageStr.substr(is_c ? 2 : 1);
            this.addFileAssociations(languageStr, is_c);
        }
    }

    private associations_for_did_change: Set<string>;

    /**
     * listen for file created/deleted events under the ${workspaceFolder} folder
     */
    private registerFileWatcher(): void {
        console.assert(this.languageClient !== undefined, "This method must not be called until this.languageClient is set in \"onReady\"");

        if (this.rootFolder) {
            // WARNING: The default limit on Linux is 8k, so for big directories, this can cause file watching to fail.
            this.rootPathFileWatcher = vscode.workspace.createFileSystemWatcher(
                "**/*",
                false /* ignoreCreateEvents */,
                false /* ignoreChangeEvents */,
                false /* ignoreDeleteEvents */);

            this.rootPathFileWatcher.onDidCreate((uri) => {
                this.languageClient.sendNotification(FileCreatedNotification, { uri: uri.toString() });
            });

            // TODO: Handle new associations without a reload.
            this.associations_for_did_change = new Set<string>(["c", "i", "cpp", "cc", "cxx", "c++", "cp", "hpp", "hh", "hxx", "h++", "hp", "h", "ii", "ino", "inl", "ipp", "tcc", "idl"]);
            let settings: OtherSettings = new OtherSettings(this.RootUri);
            let assocs: any = settings.filesAssociations;
            for (let assoc in assocs) {
                let dotIndex: number = assoc.lastIndexOf('.');
                if (dotIndex !== -1) {
                    let ext: string = assoc.substr(dotIndex + 1);
                    this.associations_for_did_change.add(ext);
                }
            }
            this.rootPathFileWatcher.onDidChange((uri) => {
                let dotIndex: number = uri.fsPath.lastIndexOf('.');
                if (dotIndex !== -1) {
                    let ext: string = uri.fsPath.substr(dotIndex + 1);
                    if (this.associations_for_did_change.has(ext)) {
                        // VS Code has a bug that causes onDidChange events to happen to files that aren't changed,
                        // which causes a large backlog of "files to parse" to accumulate.
                        // We workaround this via only sending the change message if the modified time is within 10 seconds.
                        let mtime: Date = fs.statSync(uri.fsPath).mtime;
                        let duration: number = Date.now() - mtime.getTime();
                        if (duration < 10000) {
                            this.languageClient.sendNotification(FileChangedNotification, { uri: uri.toString() });
                        }
                    }
                }
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
     * handle notifications coming from the language server
     */

    public addFileAssociations(fileAssociations: string, is_c: boolean): void {
        let settings: OtherSettings = new OtherSettings();
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
            let status: IntelliSenseStatus = { status: Status.TagParsingBegun };
            testHook.updateStatus(status);
        } else if (message.endsWith("Updating IntelliSense...")) {
            timeStamp = Date.now();
            this.model.isUpdatingIntelliSense.Value = true;
            let status: IntelliSenseStatus = { status: Status.IntelliSenseCompiling };
            testHook.updateStatus(status);
        } else if (message.endsWith("IntelliSense Ready")) {
            let settings: CppSettings = new CppSettings();
            if (settings.loggingLevel === "Debug") {
                let out: logger.Logger = logger.getOutputChannelLogger();
                let duration: number = Date.now() - timeStamp;
                out.appendLine(localize("update.intellisense.time", "Update IntelliSense time (sec): {0}", duration / 1000));
            }
            this.model.isUpdatingIntelliSense.Value = false;
            let status: IntelliSenseStatus = { status: Status.IntelliSenseReady };
            testHook.updateStatus(status);
        } else if (message.endsWith("Ready")) { // Tag Parser Ready
            this.model.isTagParsing.Value = false;
            let status: IntelliSenseStatus = { status: Status.TagParsingDone };
            testHook.updateStatus(status);
            util.setProgress(util.getProgressParseRootSuccess());
        } else if (message.includes("Squiggles Finished - File name:")) {
            let index: number = message.lastIndexOf(":");
            let name: string = message.substring(index + 2);
            let status: IntelliSenseStatus = { status: Status.IntelliSenseReady, filename: name };
            testHook.updateStatus(status);
        } else if (message.endsWith("No Squiggles")) {
            util.setIntelliSenseProgress(util.getProgressIntelliSenseNoSquiggles());
        } else if (message.endsWith("Unresolved Headers")) {
            let client: DefaultClient = <DefaultClient>clientCollection.getClientFor(vscode.Uri.file(notificationBody.workspaceFolderUri));
            if (!client.configuration.CurrentConfiguration.configurationProvider) {
                let showIntelliSenseFallbackMessage: PersistentState<boolean> = new PersistentState<boolean>("CPP.showIntelliSenseFallbackMessage", true);
                if (showIntelliSenseFallbackMessage.Value) {
                    ui.showConfigureIncludePathMessage(() => {
                        let configJSON: string = localize("configure.json.button", "Configure (JSON)");
                        let configUI: string = localize("configure.ui.button", "Configure (UI)");
                        let dontShowAgain: string = localize("dont.show.again", "Don't Show Again");
                        let fallbackMsg: string = client.configuration.VcpkgInstalled ?
                            localize("update.your.intellisense.settings", "Update your IntelliSense settings or use Vcpkg to install libraries to help find missing headers.") :
                            localize("configure.your.intellisense.settings", "Configure your IntelliSense settings to help find missing headers.");
                        return vscode.window.showInformationMessage(fallbackMsg, configJSON, configUI, dontShowAgain).then((value) => {
                            switch (value) {
                                case configJSON:
                                    vscode.commands.getCommands(true).then((commands: string[]) => {
                                        if (commands.indexOf("workbench.action.problems.focus") >= 0) {
                                            vscode.commands.executeCommand("workbench.action.problems.focus");
                                        }
                                    });
                                    client.handleConfigurationEditJSONCommand();
                                    telemetry.logLanguageServerEvent("SettingsCommand", { "toast": "json" }, null);
                                    break;
                                case configUI:
                                    vscode.commands.getCommands(true).then((commands: string[]) => {
                                        if (commands.indexOf("workbench.action.problems.focus") >= 0) {
                                            vscode.commands.executeCommand("workbench.action.problems.focus");
                                        }
                                    });
                                    client.handleConfigurationEditUICommand();
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
    }

    private updateTagParseStatus(notificationBody: LocalizeStringParams): void {
        this.model.tagParserStatus.Value = util.getLocalizedString(notificationBody);
    }

    private promptCompileCommands(params: CompileCommandsPaths): void {
        let client: DefaultClient = <DefaultClient>clientCollection.getClientFor(vscode.Uri.file(params.workspaceFolderUri));
        if (client.configuration.CurrentConfiguration.compileCommands || client.configuration.CurrentConfiguration.configurationProvider) {
            return;
        }

        let ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("CPP.showCompileCommandsSelection", true, client.RootFolder);
        if (!ask.Value) {
            return;
        }

        let aCompileCommandsFile: string = localize("a.compile.commands.file", "a compile_commands.json file");
        let compileCommandStr: string = params.paths.length > 1 ? aCompileCommandsFile : params.paths[0];
        const message: string = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1)
            ? localize("auto-configure.intellisense.folder", "Would you like to use {0} to auto-configure IntelliSense for the '{1}' folder?", compileCommandStr, client.Name)
            : localize("auto-configure.intellisense.this.folder", "Would you like to use {0} to auto-configure IntelliSense for this folder?", compileCommandStr);

        ui.showConfigureCompileCommandsMessage(() => {
            const yes: string = localize("yes.button", "Yes");
            const no: string = localize("no.button", "No");
            const askLater: string = localize("ask.me.later.button", "Ask Me Later");
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

    /**
     * requests to the language server
     */
    public requestSwitchHeaderSource(rootPath: string, fileName: string): Thenable<string> {
        let params: SwitchHeaderSourceParams = {
            switchHeaderSourceFileName: fileName,
            workspaceFolderUri: rootPath
        };
        return this.requestWhenReady(() => this.languageClient.sendRequest(SwitchHeaderSourceRequest, params));
    }

    /**
     * notifications to the language server
     */
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
        this.notifyWhenReady(() => {
            this.languageClient.sendNotification(TextEditorSelectionChangeNotification, selection);
        });
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
    }

    public pauseParsing(): void {
        this.notifyWhenReady(() => this.languageClient.sendNotification(PauseParsingNotification));
    }

    public resumeParsing(): void {
        this.notifyWhenReady(() => this.languageClient.sendNotification(ResumeParsingNotification));
    }

    private doneInitialCustomBrowseConfigurationCheck: Boolean = false;

    private onConfigurationsChanged(configurations: configs.Configuration[]): void {
        let params: CppPropertiesParams = {
            configurations: configurations,
            currentConfiguration: this.configuration.CurrentConfigurationIndex,
            workspaceFolderUri: this.RootPath
        };
        // Separate compiler path and args before sending to language client
        params.configurations.forEach((c: configs.Configuration) => {
            let compilerPathAndArgs: util.CompilerPathAndArgs =
                util.extractCompilerPathAndArgs(c.compilerPath, c.compilerArgs);
            c.compilerPath = compilerPathAndArgs.compilerPath;
            c.compilerArgs = compilerPathAndArgs.additionalArgs;
        });
        if (!this.doneInitialCustomBrowseConfigurationCheck) {
            // Send the last custom browse configuration we received from this provider.
            // This ensures we don't start tag parsing without it, and undo'ing work we have to re-do when the (likely same) browse config arrives
            // Should only execute on launch, for the initial delivery of configurations
            let lastCustomBrowseConfigurationProviderId: PersistentFolderState<string> = new PersistentFolderState<string>("CPP.lastCustomBrowseConfigurationProviderId", null, this.RootFolder);
            if (isSameProviderExtensionId(lastCustomBrowseConfigurationProviderId.Value, configurations[params.currentConfiguration].configurationProvider)) {
                let lastCustomBrowseConfiguration: PersistentFolderState<WorkspaceBrowseConfiguration> = new PersistentFolderState<WorkspaceBrowseConfiguration>("CPP.lastCustomBrowseConfiguration", null, this.RootFolder);
                if (lastCustomBrowseConfiguration.Value) {
                    this.sendCustomBrowseConfiguration(lastCustomBrowseConfiguration.Value, lastCustomBrowseConfigurationProviderId.Value);
                }
            }
            this.doneInitialCustomBrowseConfigurationCheck = true;
        }
        this.languageClient.sendNotification(ChangeCppPropertiesNotification, params);
        this.model.activeConfigName.setValueIfActive(configurations[params.currentConfiguration].name);
        let newProvider: string = this.configuration.CurrentConfigurationProvider;
        if (!isSameProviderExtensionId(newProvider, this.configurationProvider)) {
            if (this.configurationProvider) {
                this.clearCustomBrowseConfiguration();
            }
            this.configurationProvider = newProvider;
            this.updateCustomBrowseConfiguration();
            this.updateCustomConfigurations();
        }
    }

    private onSelectedConfigurationChanged(index: number): void {
        let params: FolderSelectedSettingParams = {
            currentConfiguration: index,
            workspaceFolderUri: this.RootPath
        };
        this.notifyWhenReady(() => {
            this.languageClient.sendNotification(ChangeSelectedSettingNotification, params);
            this.model.activeConfigName.Value = this.configuration.ConfigurationNames[index];
            this.configuration.onDidChangeSettings();
        });
    }

    private onCompileCommandsChanged(path: string): void {
        let params: FileChangedParams = {
            uri: vscode.Uri.file(path).toString(),
            workspaceFolderUri: this.RootPath
        };
        this.notifyWhenReady(() => this.languageClient.sendNotification(ChangeCompileCommandsNotification, params));
    }

    private isSourceFileConfigurationItem(input: any): input is SourceFileConfigurationItem {
        return (input && (util.isString(input.uri) || util.isUri(input.uri)) &&
            input.configuration &&
            util.isArrayOfString(input.configuration.includePath) &&
            util.isArrayOfString(input.configuration.defines) &&
            util.isString(input.configuration.intelliSenseMode) &&
            util.isString(input.configuration.standard) &&
            util.isOptionalString(input.configuration.compilerPath) &&
            util.isOptionalArrayOfString(input.configuration.compilerArgs) &&
            util.isOptionalArrayOfString(input.configuration.forcedInclude));
    }

    private sendCustomConfigurations(configs: any): void {
        // configs is marked as 'any' because it is untrusted data coming from a 3rd-party. We need to sanitize it before sending it to the language server.
        if (!configs || !(configs instanceof Array)) {
            console.warn("discarding invalid SourceFileConfigurationItems[]: " + configs);
            return;
        }

        let settings: CppSettings = new CppSettings();
        let out: logger.Logger = logger.getOutputChannelLogger();
        if (settings.loggingLevel === "Debug") {
            out.appendLine(localize("configurations.received", "Custom configurations received:"));
        }
        let sanitized: SourceFileConfigurationItemAdapter[] = [];
        configs.forEach(item => {
            if (this.isSourceFileConfigurationItem(item)) {
                if (settings.loggingLevel === "Debug") {
                    out.appendLine(`  uri: ${item.uri.toString()}`);
                    out.appendLine(`  config: ${JSON.stringify(item.configuration, null, 2)}`);
                }
                if (item.configuration.includePath.some(path => path.endsWith('**'))) {
                    console.warn("custom include paths should not use recursive includes ('**')");
                }
                // Separate compiler path and args before sending to language client
                let itemConfig: util.Mutable<SourceFileConfiguration> = {...item.configuration};
                if (util.isString(itemConfig.compilerPath)) {
                    let compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(
                        itemConfig.compilerPath,
                        util.isArrayOfString(itemConfig.compilerArgs) ? itemConfig.compilerArgs : undefined);
                    itemConfig.compilerPath = compilerPathAndArgs.compilerPath;
                    itemConfig.compilerArgs = compilerPathAndArgs.additionalArgs;
                }
                sanitized.push({
                    uri: item.uri.toString(),
                    configuration: itemConfig
                });
            } else {
                console.warn("discarding invalid SourceFileConfigurationItem: " + item);
            }
        });

        if (sanitized.length === 0) {
            return;
        }

        let params: CustomConfigurationParams = {
            configurationItems: sanitized,
            workspaceFolderUri: this.RootPath
        };

        this.languageClient.sendNotification(CustomConfigurationNotification, params);
    }

    private sendCustomBrowseConfiguration(config: any, providerId: string, timeoutOccured?: boolean): void {
        let lastCustomBrowseConfiguration: PersistentFolderState<WorkspaceBrowseConfiguration> = new PersistentFolderState<WorkspaceBrowseConfiguration>("CPP.lastCustomBrowseConfiguration", null, this.RootFolder);
        let lastCustomBrowseConfigurationProviderId: PersistentFolderState<string> = new PersistentFolderState<string>("CPP.lastCustomBrowseConfigurationProviderId", null, this.RootFolder);
        let sanitized: util.Mutable<WorkspaceBrowseConfiguration>;

        // This while (true) is here just so we can break out early if the config is set on error
        while (true) {
            // config is marked as 'any' because it is untrusted data coming from a 3rd-party. We need to sanitize it before sending it to the language server.
            if (timeoutOccured || !config || config instanceof Array) {
                if (!timeoutOccured) {
                    console.log("Received an invalid browse configuration from configuration provider.");
                }
                if (lastCustomBrowseConfiguration.Value !== null) {
                    sanitized = lastCustomBrowseConfiguration.Value;
                    console.log("Falling back to last received browse configuration: ", JSON.stringify(sanitized, null, 2));
                    break;
                }
                console.log("No browse configuration is available.");
                return;
            }

            sanitized = {...<WorkspaceBrowseConfiguration>config};
            if (!util.isArrayOfString(sanitized.browsePath) ||
                !util.isOptionalString(sanitized.compilerPath) ||
                !util.isOptionalArrayOfString(sanitized.compilerArgs) ||
                !util.isOptionalString(sanitized.standard) ||
                !util.isOptionalString(sanitized.windowsSdkVersion)) {
                console.log("Received an invalid browse configuration from configuration provider.");
                if (lastCustomBrowseConfiguration.Value !== null) {
                    sanitized = lastCustomBrowseConfiguration.Value;
                    console.log("Falling back to last received browse configuration: ", JSON.stringify(sanitized, null, 2));
                    break;
                }
                return;
            }

            let settings: CppSettings = new CppSettings();
            if (settings.loggingLevel === "Debug") {
                let out: logger.Logger = logger.getOutputChannelLogger();
                out.appendLine(localize("browse.configuration.received", "Custom browse configuration received: {0}", JSON.stringify(sanitized, null, 2)));
            }

            // Separate compiler path and args before sending to language client
            if (util.isString(sanitized.compilerPath)) {
                let compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(
                    sanitized.compilerPath,
                    util.isArrayOfString(sanitized.compilerArgs) ? sanitized.compilerArgs : undefined);
                sanitized.compilerPath = compilerPathAndArgs.compilerPath;
                sanitized.compilerArgs = compilerPathAndArgs.additionalArgs;
            }

            lastCustomBrowseConfiguration.Value = sanitized;
            lastCustomBrowseConfigurationProviderId.Value = providerId;
            break;
        }

        let params: CustomBrowseConfigurationParams = {
            browseConfiguration: sanitized,
            workspaceFolderUri: this.RootPath
        };

        this.languageClient.sendNotification(CustomBrowseConfigurationNotification, params);
    }

    private clearCustomConfigurations(): void {
        let params: WorkspaceFolderParams = {
            workspaceFolderUri: this.RootPath
        };
        this.notifyWhenReady(() => this.languageClient.sendNotification(ClearCustomConfigurationsNotification, params));
    }

    private clearCustomBrowseConfiguration(): void {
        let params: WorkspaceFolderParams = {
            workspaceFolderUri: this.RootPath
        };
        this.notifyWhenReady(() => this.languageClient.sendNotification(ClearCustomBrowseConfigurationNotification, params));
    }

    /**
     * command handlers
     */
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
                        // operation was canceled.
                        return;
                    }
                    this.configuration.updateCustomConfigurationProvider(extensionId)
                        .then(() => {
                            if (extensionId) {
                                let provider: CustomConfigurationProvider1 = getCustomConfigProviders().get(extensionId);
                                this.updateCustomBrowseConfiguration(provider);
                                this.updateCustomConfigurations(provider);
                                telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": extensionId });
                            } else {
                                this.clearCustomConfigurations();
                                this.clearCustomBrowseConfiguration();
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
        let promise: Thenable<void> = (this.languageClient && clientCollection.Count === 0) ? this.languageClient.stop() : Promise.resolve();
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

    public handleReferencesIcon(): void {
        this.notifyWhenReady(() => {
            let cancelling: boolean = referencesPendingCancellations.length > 0;
            if (!cancelling) {
                workspaceReferences.UpdateProgressUICounter(this.model.referencesCommandMode.Value);
                if (this.ReferencesCommandMode === refs.ReferencesCommandMode.Find) {
                    if (!workspaceReferences.referencesRequestPending) {
                        if (workspaceReferences.referencesRequestHasOccurred) {
                            // References are not usable if a references request is pending,
                            // So after the initial request, we don't send a 2nd references request until the next request occurs.
                            if (!workspaceReferences.referencesRefreshPending) {
                                workspaceReferences.referencesRefreshPending = true;
                                vscode.commands.executeCommand("references-view.refresh");
                            }
                        } else {
                            workspaceReferences.referencesRequestHasOccurred = true;
                            workspaceReferences.referencesRequestPending = true;
                            this.languageClient.sendNotification(RequestReferencesNotification, false);
                        }
                    }
                }
            }
        });
    }

    public cancelReferences(): void {
        referencesParams = null;
        renamePending = false;
        if (referencesRequestPending || workspaceReferences.symbolSearchInProgress) {
            let cancelling: boolean = referencesPendingCancellations.length > 0;
            referencesPendingCancellations.push({ reject: () => {}, callback: () => {} });
            if (!cancelling) {
                workspaceReferences.referencesCanceled = true;
                languageClient.sendNotification(CancelReferencesNotification);
                workspaceReferences.closeRenameUI();
            }
        }
    }

    private handleReferencesProgress(notificationBody: refs.ReportReferencesProgressNotification): void {
        workspaceReferences.handleProgress(notificationBody);
    }

    private processReferencesResult(referencesResult: refs.ReferencesResult): void {
        workspaceReferences.processResults(referencesResult);
    }

    public setReferencesCommandMode(mode: refs.ReferencesCommandMode): void {
        this.model.referencesCommandMode.Value = mode;
    }
}

function getLanguageServerFileName(): string {
    let extensionProcessName: string = 'cpptools';
    let plat: NodeJS.Platform = process.platform;
    if (plat === 'win32') {
        extensionProcessName += '.exe';
    } else if (plat !== 'linux' && plat !== 'darwin') {
        throw "Invalid Platform";
    }
    return path.resolve(util.getExtensionFilePath("bin"), extensionProcessName);
}

class NullClient implements Client {
    private booleanEvent = new vscode.EventEmitter<boolean>();
    private stringEvent = new vscode.EventEmitter<string>();
    private referencesCommandModeEvent = new vscode.EventEmitter<refs.ReferencesCommandMode>();

    public get TagParsingChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get IntelliSenseParsingChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get ReferencesCommandModeChanged(): vscode.Event<refs.ReferencesCommandMode> { return this.referencesCommandModeEvent.event; }
    public get TagParserStatusChanged(): vscode.Event<string> { return this.stringEvent.event; }
    public get ActiveConfigChanged(): vscode.Event<string> { return this.stringEvent.event; }
    RootPath: string = "/";
    RootUri: vscode.Uri = vscode.Uri.file("/");
    Name: string = "(empty)";
    TrackedDocuments = new Set<vscode.TextDocument>();
    onDidChangeSettings(event: vscode.ConfigurationChangeEvent): { [key: string]: string } { return {}; }
    onDidOpenTextDocument(document: vscode.TextDocument): void {}
    onDidCloseTextDocument(document: vscode.TextDocument): void {}
    onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {}
    onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void {}
    onDidChangeTextEditorVisibleRanges(textEditorVisibleRangesChangeEvent: vscode.TextEditorVisibleRangesChangeEvent): void {}
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    provideCustomConfiguration(docUri: vscode.Uri, requestFile?: string): Promise<void> { return Promise.resolve(); }
    logDiagnostics(): Promise<void> { return Promise.resolve(); }
    rescanFolder(): Promise<void> { return Promise.resolve(); }
    toggleReferenceResultsView(): void {}
    setCurrentConfigName(configurationName: string): Thenable<void> { return Promise.resolve(); }
    getCurrentConfigName(): Thenable<string> { return Promise.resolve(""); }
    getVcpkgInstalled(): Thenable<boolean> { return Promise.resolve(false); }
    getVcpkgEnabled(): Thenable<boolean> { return Promise.resolve(false); }
    getCurrentCompilerPathAndArgs(): Thenable<util.CompilerPathAndArgs> { return Promise.resolve(undefined); }
    getKnownCompilers(): Thenable<configs.KnownCompiler[]> { return Promise.resolve([]); }
    takeOwnership(document: vscode.TextDocument): void {}
    queueTask<T>(task: () => Thenable<T>): Thenable<T> { return task(); }
    requestWhenReady(request: () => Thenable<any>): Thenable<any> { return; }
    notifyWhenReady(notify: () => void): void {}
    requestSwitchHeaderSource(rootPath: string, fileName: string): Thenable<string> { return Promise.resolve(""); }
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
