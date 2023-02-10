/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';

// Start provider imports
import { OnTypeFormattingEditProvider } from './Providers/onTypeFormattingEditProvider';
import { FoldingRangeProvider } from './Providers/foldingRangeProvider';
import { SemanticTokensProvider } from './Providers/semanticTokensProvider';
import { DocumentFormattingEditProvider } from './Providers/documentFormattingEditProvider';
import { DocumentRangeFormattingEditProvider } from './Providers/documentRangeFormattingEditProvider';
import { DocumentSymbolProvider } from './Providers/documentSymbolProvider';
import { WorkspaceSymbolProvider } from './Providers/workspaceSymbolProvider';
import { RenameProvider } from './Providers/renameProvider';
import { FindAllReferencesProvider } from './Providers/findAllReferencesProvider';
import { CodeActionProvider } from './Providers/codeActionProvider';
import { InlayHintsProvider } from './Providers/inlayHintProvider';
// End provider imports

import { LanguageClientOptions, NotificationType, TextDocumentIdentifier, RequestType, ErrorAction, CloseAction, DidOpenTextDocumentParams, Range, Position } from 'vscode-languageclient';
import { LanguageClient, ServerOptions } from 'vscode-languageclient/node';
import { SourceFileConfigurationItem, WorkspaceBrowseConfiguration, SourceFileConfiguration, Version } from 'vscode-cpptools';
import { Status, IntelliSenseStatus } from 'vscode-cpptools/out/testApi';
import { getLocaleId, getLocalizedString, LocalizeStringParams } from './localization';
import { Location, TextEdit } from './commonTypes';
import { makeVscodeRange, makeVscodeLocation, handleChangedFromCppToC } from './utils';
import * as util from '../common';
import * as configs from './configurations';
import { CppSettings, getEditorConfigSettings, OtherSettings, SettingsParams, WorkspaceFolderSettingsParams } from './settings';
import * as telemetry from '../telemetry';
import { PersistentState, PersistentFolderState, PersistentWorkspaceState } from './persistentState';
import { UI, getUI } from './ui';
import { createProtocolFilter } from './protocolFilter';
import { DataBinding } from './dataBinding';
import minimatch = require("minimatch");
import { updateLanguageConfigurations, CppSourceStr, clients } from './extension';
import { SettingsTracker } from './settingsTracker';
import { getTestHook, TestHook } from '../testHook';
import { getCustomConfigProviders, CustomConfigurationProvider1, isSameProviderExtensionId } from '../LanguageServer/customProviders';
import * as fs from 'fs';
import * as os from 'os';
import * as refs from './references';
import * as nls from 'vscode-nls';
import { lookupString, localizedStringCount } from '../nativeStrings';
import {
    CodeAnalysisDiagnosticIdentifiersAndUri, RegisterCodeAnalysisNotifications, removeAllCodeAnalysisProblems,
    removeCodeAnalysisProblems, RemoveCodeAnalysisProblemsParams
} from './codeAnalysis';
import { DebugProtocolParams, getDiagnosticsChannel, getOutputChannelLogger, logDebugProtocol, Logger, logLocalized, showWarning, ShowWarningParams } from '../logger';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

let ui: UI;
let timeStamp: number = 0;
const configProviderTimeout: number = 2000;
let initializedClientCount: number = 0;
export let compilerPaths: string[] = [];
// Data shared by all clients.
let languageClient: LanguageClient;
let firstClientStarted: Promise<void>;
let languageClientCrashedNeedsRestart: boolean = false;
const languageClientCrashTimes: number[] = [];
let pendingTask: util.BlockingTask<any> | undefined;
let compilerDefaults: configs.CompilerDefaults;
let diagnosticsCollectionIntelliSense: vscode.DiagnosticCollection;
let diagnosticsCollectionRefactor: vscode.DiagnosticCollection;
let displayedSelectCompiler: boolean = false;
let secondPromptCounter: number = 0;

let workspaceDisposables: vscode.Disposable[] = [];
export let workspaceReferences: refs.ReferencesManager;
export const openFileVersions: Map<string, number> = new Map<string, number>();
export const cachedEditorConfigSettings: Map<string, any> = new Map<string, any>();
export const cachedEditorConfigLookups: Map<string, boolean> = new Map<string, boolean>();
export let semanticTokensLegend: vscode.SemanticTokensLegend | undefined;

export function disposeWorkspaceData(): void {
    workspaceDisposables.forEach((d) => d.dispose());
    workspaceDisposables = [];
}

function logTelemetry(notificationBody: TelemetryPayload): void {
    telemetry.logLanguageServerEvent(notificationBody.event, notificationBody.properties, notificationBody.metrics);
}

/**
 * listen for logging messages from the language server and print them to the Output window
 */
function setupOutputHandlers(): void {
    console.assert(languageClient !== undefined, "This method must not be called until this.languageClient is set in \"onReady\"");

    languageClient.onNotification(DebugProtocolNotification, logDebugProtocol);
    languageClient.onNotification(DebugLogNotification, logLocalized);
}

/** Note: We should not await on the following functions,
 * or any function that returns a promise acquired from them,
 * vscode.window.showInformationMessage, vscode.window.showWarningMessage, vscode.window.showErrorMessage
*/
function showMessageWindow(params: ShowMessageWindowParams): void {
    const message: string = getLocalizedString(params.localizeStringParams);
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

function publishIntelliSenseDiagnostics(params: PublishIntelliSenseDiagnosticsParams): void {
    if (!diagnosticsCollectionIntelliSense) {
        diagnosticsCollectionIntelliSense = vscode.languages.createDiagnosticCollection(CppSourceStr);
    }

    // Convert from our Diagnostic objects to vscode Diagnostic objects
    const diagnosticsIntelliSense: vscode.Diagnostic[] = [];
    params.diagnostics.forEach((d) => {
        const message: string = getLocalizedString(d.localizeStringParams);
        const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(makeVscodeRange(d.range), message, d.severity);
        diagnostic.code = d.code;
        diagnostic.source = CppSourceStr;
        if (d.relatedInformation) {
            diagnostic.relatedInformation = [];
            for (const info of d.relatedInformation) {
                diagnostic.relatedInformation.push(new vscode.DiagnosticRelatedInformation(makeVscodeLocation(info.location), info.message));
            }
        }

        diagnosticsIntelliSense.push(diagnostic);
    });

    const realUri: vscode.Uri = vscode.Uri.parse(params.uri);
    diagnosticsCollectionIntelliSense.set(realUri, diagnosticsIntelliSense);

    clients.timeTelemetryCollector.setUpdateRangeTime(realUri);
}

function publishRefactorDiagnostics(params: PublishRefactorDiagnosticsParams): void {
    if (!diagnosticsCollectionRefactor) {
        diagnosticsCollectionRefactor = vscode.languages.createDiagnosticCollection(CppSourceStr);
    }

    const newDiagnostics: vscode.Diagnostic[] = [];
    params.diagnostics.forEach((d) => {
        const message: string = getLocalizedString(d.localizeStringParams);
        const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(makeVscodeRange(d.range), message, d.severity);
        diagnostic.code = d.code;
        diagnostic.source = CppSourceStr;
        if (d.relatedInformation) {
            diagnostic.relatedInformation = [];
            for (const info of d.relatedInformation) {
                diagnostic.relatedInformation.push(new vscode.DiagnosticRelatedInformation(makeVscodeLocation(info.location), info.message));
            }
        }

        newDiagnostics.push(diagnostic);
    });

    const fileUri: vscode.Uri = vscode.Uri.parse(params.uri);
    diagnosticsCollectionRefactor.set(fileUri, newDiagnostics);
}

interface WorkspaceFolderParams {
    workspaceFolderUri?: string;
}

interface TelemetryPayload {
    event: string;
    properties?: { [key: string]: string };
    metrics?: { [key: string]: number };
}

interface ReportStatusNotificationBody extends WorkspaceFolderParams {
    status: string;
}

interface QueryDefaultCompilerParams {
    trustedCompilerPaths: string[];
}

interface CppPropertiesParams extends WorkspaceFolderParams {
    currentConfiguration: number;
    configurations: configs.Configuration[];
    isReady?: boolean;
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

interface InputRegion {
    startLine: number;
    endLine: number;
}

interface DecorationRangesPair {
    decoration: vscode.TextEditorDecorationType;
    ranges: vscode.Range[];
}

interface InactiveRegionParams {
    uri: string;
    fileVersion: number;
    regions: InputRegion[];
}

interface InternalSourceFileConfiguration extends SourceFileConfiguration {
    compilerArgsLegacy?: string[];
};

interface InternalWorkspaceBrowseConfiguration extends WorkspaceBrowseConfiguration {
    compilerArgsLegacy?: string[];
}

// Need to convert vscode.Uri to a string before sending it to the language server.
interface SourceFileConfigurationItemAdapter {
    uri: string;
    configuration: InternalSourceFileConfiguration;
}

interface CustomConfigurationParams extends WorkspaceFolderParams {
    configurationItems: SourceFileConfigurationItemAdapter[];
}

interface CustomBrowseConfigurationParams extends WorkspaceFolderParams {
    browseConfiguration: InternalWorkspaceBrowseConfiguration;
}

interface CompileCommandsPaths extends WorkspaceFolderParams {
    paths: string[];
}

interface QueryTranslationUnitSourceParams extends WorkspaceFolderParams {
    uri: string;
    ignoreExisting: boolean;
}

interface QueryTranslationUnitSourceResult {
    candidates: string[];
}

interface GetDiagnosticsResult {
    diagnostics: string;
}

interface IntelliSenseDiagnosticRelatedInformation {
    location: Location;
    message: string;
}

interface RefactorDiagnosticRelatedInformation {
    location: Location;
    message: string;
}

interface IntelliSenseDiagnostic {
    range: Range;
    code?: number;
    severity: vscode.DiagnosticSeverity;
    localizeStringParams: LocalizeStringParams;
    relatedInformation?: IntelliSenseDiagnosticRelatedInformation[];
}

interface RefactorDiagnostic {
    range: Range;
    code?: number;
    severity: vscode.DiagnosticSeverity;
    localizeStringParams: LocalizeStringParams;
    relatedInformation?: RefactorDiagnosticRelatedInformation[];
}

interface PublishIntelliSenseDiagnosticsParams {
    uri: string;
    diagnostics: IntelliSenseDiagnostic[];
}

interface PublishRefactorDiagnosticsParams {
    uri: string;
    diagnostics: RefactorDiagnostic[];
}

export interface CreateDeclarationOrDefinitionParams {
    uri: string;
    range: Range;
}

export interface CreateDeclarationOrDefinitionResult {
    changes: { [key: string]: any[] };
}

interface ShowMessageWindowParams {
    type: number;
    localizeStringParams: LocalizeStringParams;
}

export interface GetDocumentSymbolRequestParams {
    uri: string;
}

export interface WorkspaceSymbolParams extends WorkspaceFolderParams {
    query: string;
}

export enum SymbolScope {
    Public = 0,
    Protected = 1,
    Private = 2
}

export interface LocalizeDocumentSymbol {
    name: string;
    detail: LocalizeStringParams;
    kind: vscode.SymbolKind;
    scope: SymbolScope;
    range: Range;
    selectionRange: Range;
    children: LocalizeDocumentSymbol[];
}

export interface GetDocumentSymbolResult {
    symbols: LocalizeDocumentSymbol[];
}

export interface LocalizeSymbolInformation {
    name: string;
    kind: vscode.SymbolKind;
    scope: SymbolScope;
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

export interface FormatParams {
    uri: string;
    range: Range;
    character: string;
    insertSpaces: boolean;
    tabSize: number;
    editorConfigSettings: any;
    useVcFormat: boolean;
    onChanges: boolean;
}

export interface FormatResult {
    edits: TextEdit[];
}

export interface GetFoldingRangesParams {
    uri: string;
}

export enum FoldingRangeKind {
    None = 0,
    Comment = 1,
    Imports = 2,
    Region = 3
}

export interface CppFoldingRange {
    kind: FoldingRangeKind;
    range: InputRegion;
}

export interface GetFoldingRangesResult {
    ranges: CppFoldingRange[];
}

export interface GetSemanticTokensParams {
    uri: string;
}

interface SemanticToken {
    line: number;
    character: number;
    length: number;
    type: number;
    modifiers?: number;
}

export interface GetSemanticTokensResult {
    fileVersion: number;
    tokens: SemanticToken[];
}

enum SemanticTokenTypes {
    // These are camelCase as the enum names are used directly as strings in our legend.
    macro = 0,
    enumMember = 1,
    variable = 2,
    parameter = 3,
    type = 4,
    referenceType = 5,
    valueType = 6,
    function = 7,
    method = 8,
    property = 9,
    cliProperty = 10,
    event = 11,
    genericType = 12,
    templateFunction = 13,
    templateType = 14,
    namespace = 15,
    label = 16,
    customLiteral = 17,
    numberLiteral = 18,
    stringLiteral = 19,
    operatorOverload = 20,
    memberOperatorOverload = 21,
    newOperator = 22
}

enum SemanticTokenModifiers {
    // These are camelCase as the enum names are used directly as strings in our legend.
    // eslint-disable-next-line no-bitwise
    static = (1 << 0),
    // eslint-disable-next-line no-bitwise
    global = (1 << 1),
    // eslint-disable-next-line no-bitwise
    local = (1 << 2)
}

interface IntelliSenseSetup {
    uri: string;
}

interface GoToDirectiveInGroupParams {
    uri: string;
    position: Position;
    next: boolean;
};

export interface GenerateDoxygenCommentParams {
    uri: string;
    position: Position;
    isCodeAction: boolean;
    isCursorAboveSignatureLine: boolean | undefined;
}
export interface GenerateDoxygenCommentResult {
    contents: string;
    initPosition: Position;
    finalInsertionLine: number;
    finalCursorPosition: Position;
    fileVersion: number;
    isCursorAboveSignatureLine: boolean;
}

export interface IndexableQuickPickItem extends vscode.QuickPickItem {
    index: number;
}
export interface UpdateTrustedCompilerPathsResult {
    compilerPath: string;
}

export interface DoxygenCodeActionCommandArguments {
    initialCursor: Position;
    adjustedCursor: Position;
    isCursorAboveSignatureLine: boolean;
};

interface SetTemporaryTextDocumentLanguageParams {
    path: string;
    isC: boolean;
    isCuda: boolean;
}

enum CodeAnalysisScope {
    ActiveFile,
    OpenFiles,
    AllFiles,
    ClearSquiggles
};

interface CodeAnalysisParams {
    scope: CodeAnalysisScope;
}

interface FinishedRequestCustomConfigParams {
    uri: string;
}

interface IntervalTimerParams {
    freeMemory: number;
};

export interface TextDocumentWillSaveParams {
    textDocument: TextDocumentIdentifier;
    reason: vscode.TextDocumentSaveReason;
}

interface InitializationOptions {
    packageVersion: string;
    extensionPath: string;
    storagePath: string;
    freeMemory: number;
    vcpkgRoot: string;
    intelliSenseCacheDisabled: boolean;
    caseSensitiveFileSupport: boolean;
    resetDatabase: boolean;
    edgeMessagesDirectory: string;
    localizedStrings: string[];
    settings: SettingsParams;
};

interface TagParseStatus {
    localizeStringParams: LocalizeStringParams;
    isPausable: boolean;
    isPaused: boolean;
}

// Requests
const QueryCompilerDefaultsRequest: RequestType<QueryDefaultCompilerParams, configs.CompilerDefaults, void> = new RequestType<QueryDefaultCompilerParams, configs.CompilerDefaults, void>('cpptools/queryCompilerDefaults');
const QueryTranslationUnitSourceRequest: RequestType<QueryTranslationUnitSourceParams, QueryTranslationUnitSourceResult, void> = new RequestType<QueryTranslationUnitSourceParams, QueryTranslationUnitSourceResult, void>('cpptools/queryTranslationUnitSource');
const SwitchHeaderSourceRequest: RequestType<SwitchHeaderSourceParams, string, void> = new RequestType<SwitchHeaderSourceParams, string, void>('cpptools/didSwitchHeaderSource');
const GetDiagnosticsRequest: RequestType<void, GetDiagnosticsResult, void> = new RequestType<void, GetDiagnosticsResult, void>('cpptools/getDiagnostics');
export const GetDocumentSymbolRequest: RequestType<GetDocumentSymbolRequestParams, GetDocumentSymbolResult, void> = new RequestType<GetDocumentSymbolRequestParams, GetDocumentSymbolResult, void>('cpptools/getDocumentSymbols');
export const GetSymbolInfoRequest: RequestType<WorkspaceSymbolParams, LocalizeSymbolInformation[], void> = new RequestType<WorkspaceSymbolParams, LocalizeSymbolInformation[], void>('cpptools/getWorkspaceSymbols');
export const GetFoldingRangesRequest: RequestType<GetFoldingRangesParams, GetFoldingRangesResult, void> = new RequestType<GetFoldingRangesParams, GetFoldingRangesResult, void>('cpptools/getFoldingRanges');
export const GetSemanticTokensRequest: RequestType<GetSemanticTokensParams, GetSemanticTokensResult, void> = new RequestType<GetSemanticTokensParams, GetSemanticTokensResult, void>('cpptools/getSemanticTokens');
export const FormatDocumentRequest: RequestType<FormatParams, FormatResult, void> = new RequestType<FormatParams, FormatResult, void>('cpptools/formatDocument');
export const FormatRangeRequest: RequestType<FormatParams, FormatResult, void> = new RequestType<FormatParams, FormatResult, void>('cpptools/formatRange');
export const FormatOnTypeRequest: RequestType<FormatParams, FormatResult, void> = new RequestType<FormatParams, FormatResult, void>('cpptools/formatOnType');
const CreateDeclarationOrDefinitionRequest: RequestType<CreateDeclarationOrDefinitionParams, CreateDeclarationOrDefinitionResult, void> = new RequestType<CreateDeclarationOrDefinitionParams, CreateDeclarationOrDefinitionResult, void>('cpptools/createDeclDef');
const GoToDirectiveInGroupRequest: RequestType<GoToDirectiveInGroupParams, Position | undefined, void> = new RequestType<GoToDirectiveInGroupParams, Position | undefined, void>('cpptools/goToDirectiveInGroup');
const GenerateDoxygenCommentRequest: RequestType<GenerateDoxygenCommentParams, GenerateDoxygenCommentResult | undefined, void> = new RequestType<GenerateDoxygenCommentParams, GenerateDoxygenCommentResult, void>('cpptools/generateDoxygenComment');
const ChangeCppPropertiesRequest: RequestType<CppPropertiesParams, void, void> = new RequestType<CppPropertiesParams, void, void>('cpptools/didChangeCppProperties');

// Notifications to the server
const DidOpenNotification: NotificationType<DidOpenTextDocumentParams> = new NotificationType<DidOpenTextDocumentParams>('textDocument/didOpen');
const FileCreatedNotification: NotificationType<FileChangedParams> = new NotificationType<FileChangedParams>('cpptools/fileCreated');
const FileChangedNotification: NotificationType<FileChangedParams> = new NotificationType<FileChangedParams>('cpptools/fileChanged');
const FileDeletedNotification: NotificationType<FileChangedParams> = new NotificationType<FileChangedParams>('cpptools/fileDeleted');
const ResetDatabaseNotification: NotificationType<void> = new NotificationType<void>('cpptools/resetDatabase');
const PauseParsingNotification: NotificationType<void> = new NotificationType<void>('cpptools/pauseParsing');
const ResumeParsingNotification: NotificationType<void> = new NotificationType<void>('cpptools/resumeParsing');
const ActiveDocumentChangeNotification: NotificationType<TextDocumentIdentifier> = new NotificationType<TextDocumentIdentifier>('cpptools/activeDocumentChange');
const RestartIntelliSenseForFileNotification: NotificationType<TextDocumentIdentifier> = new NotificationType<TextDocumentIdentifier>('cpptools/restartIntelliSenseForFile');
const TextEditorSelectionChangeNotification: NotificationType<Range> = new NotificationType<Range>('cpptools/textEditorSelectionChange');
const ChangeCompileCommandsNotification: NotificationType<FileChangedParams> = new NotificationType<FileChangedParams>('cpptools/didChangeCompileCommands');
const ChangeSelectedSettingNotification: NotificationType<FolderSelectedSettingParams> = new NotificationType<FolderSelectedSettingParams>('cpptools/didChangeSelectedSetting');
const IntervalTimerNotification: NotificationType<IntervalTimerParams> = new NotificationType<IntervalTimerParams>('cpptools/onIntervalTimer');
const CustomConfigurationNotification: NotificationType<CustomConfigurationParams> = new NotificationType<CustomConfigurationParams>('cpptools/didChangeCustomConfiguration');
const CustomBrowseConfigurationNotification: NotificationType<CustomBrowseConfigurationParams> = new NotificationType<CustomBrowseConfigurationParams>('cpptools/didChangeCustomBrowseConfiguration');
const ClearCustomConfigurationsNotification: NotificationType<WorkspaceFolderParams> = new NotificationType<WorkspaceFolderParams>('cpptools/clearCustomConfigurations');
const ClearCustomBrowseConfigurationNotification: NotificationType<WorkspaceFolderParams> = new NotificationType<WorkspaceFolderParams>('cpptools/clearCustomBrowseConfiguration');
const RescanFolderNotification: NotificationType<void> = new NotificationType<void>('cpptools/rescanFolder');
export const RequestReferencesNotification: NotificationType<void> = new NotificationType<void>('cpptools/requestReferences');
export const CancelReferencesNotification: NotificationType<void> = new NotificationType<void>('cpptools/cancelReferences');
const FinishedRequestCustomConfig: NotificationType<FinishedRequestCustomConfigParams> = new NotificationType<FinishedRequestCustomConfigParams>('cpptools/finishedRequestCustomConfig');
const FindAllReferencesNotification: NotificationType<FindAllReferencesParams> = new NotificationType<FindAllReferencesParams>('cpptools/findAllReferences');
const RenameNotification: NotificationType<RenameParams> = new NotificationType<RenameParams>('cpptools/rename');
const DidChangeSettingsNotification: NotificationType<SettingsParams> = new NotificationType<SettingsParams>('cpptools/didChangeSettings');
const InitializationNotification: NotificationType<InitializationOptions> = new NotificationType<InitializationOptions>('cpptools/initialize');

const CodeAnalysisNotification: NotificationType<CodeAnalysisParams> = new NotificationType<CodeAnalysisParams>('cpptools/runCodeAnalysis');
const PauseCodeAnalysisNotification: NotificationType<void> = new NotificationType<void>('cpptools/pauseCodeAnalysis');
const ResumeCodeAnalysisNotification: NotificationType<void> = new NotificationType<void>('cpptools/resumeCodeAnalysis');
const CancelCodeAnalysisNotification: NotificationType<void> = new NotificationType<void>('cpptools/cancelCodeAnalysis');
const RemoveCodeAnalysisProblemsNotification: NotificationType<RemoveCodeAnalysisProblemsParams> = new NotificationType<RemoveCodeAnalysisProblemsParams>('cpptools/removeCodeAnalysisProblems');

// Notifications from the server
const ReloadWindowNotification: NotificationType<void> = new NotificationType<void>('cpptools/reloadWindow');
const UpdateTrustedCompilersNotification: NotificationType<UpdateTrustedCompilerPathsResult> = new NotificationType<UpdateTrustedCompilerPathsResult>('cpptools/updateTrustedCompilersList');
const LogTelemetryNotification: NotificationType<TelemetryPayload> = new NotificationType<TelemetryPayload>('cpptools/logTelemetry');
const ReportTagParseStatusNotification: NotificationType<TagParseStatus> = new NotificationType<TagParseStatus>('cpptools/reportTagParseStatus');
const ReportStatusNotification: NotificationType<ReportStatusNotificationBody> = new NotificationType<ReportStatusNotificationBody>('cpptools/reportStatus');
const DebugProtocolNotification: NotificationType<DebugProtocolParams> = new NotificationType<DebugProtocolParams>('cpptools/debugProtocol');
const DebugLogNotification: NotificationType<LocalizeStringParams> = new NotificationType<LocalizeStringParams>('cpptools/debugLog');
const InactiveRegionNotification: NotificationType<InactiveRegionParams> = new NotificationType<InactiveRegionParams>('cpptools/inactiveRegions');
const CompileCommandsPathsNotification: NotificationType<CompileCommandsPaths> = new NotificationType<CompileCommandsPaths>('cpptools/compileCommandsPaths');
const ReferencesNotification: NotificationType<refs.ReferencesResult> = new NotificationType<refs.ReferencesResult>('cpptools/references');
const ReportReferencesProgressNotification: NotificationType<refs.ReportReferencesProgressNotification> = new NotificationType<refs.ReportReferencesProgressNotification>('cpptools/reportReferencesProgress');
const RequestCustomConfig: NotificationType<string> = new NotificationType<string>('cpptools/requestCustomConfig');
const PublishIntelliSenseDiagnosticsNotification: NotificationType<PublishIntelliSenseDiagnosticsParams> = new NotificationType<PublishIntelliSenseDiagnosticsParams>('cpptools/publishIntelliSenseDiagnostics');
const PublishRefactorDiagnosticsNotification: NotificationType<PublishRefactorDiagnosticsParams> = new NotificationType<PublishRefactorDiagnosticsParams>('cpptools/publishRefactorDiagnostics');
const ShowMessageWindowNotification: NotificationType<ShowMessageWindowParams> = new NotificationType<ShowMessageWindowParams>('cpptools/showMessageWindow');
const ShowWarningNotification: NotificationType<ShowWarningParams> = new NotificationType<ShowWarningParams>('cpptools/showWarning');
const ReportTextDocumentLanguage: NotificationType<string> = new NotificationType<string>('cpptools/reportTextDocumentLanguage');
const SemanticTokensChanged: NotificationType<string> = new NotificationType<string>('cpptools/semanticTokensChanged');
const InlayHintsChanged: NotificationType<string> = new NotificationType<string>('cpptools/inlayHintsChanged');
const IntelliSenseSetupNotification: NotificationType<IntelliSenseSetup> = new NotificationType<IntelliSenseSetup>('cpptools/IntelliSenseSetup');
const SetTemporaryTextDocumentLanguageNotification: NotificationType<SetTemporaryTextDocumentLanguageParams> = new NotificationType<SetTemporaryTextDocumentLanguageParams>('cpptools/setTemporaryTextDocumentLanguage');
const ReportCodeAnalysisProcessedNotification: NotificationType<number> = new NotificationType<number>('cpptools/reportCodeAnalysisProcessed');
const ReportCodeAnalysisTotalNotification: NotificationType<number> = new NotificationType<number>('cpptools/reportCodeAnalysisTotal');
const DoxygenCommentGeneratedNotification: NotificationType<GenerateDoxygenCommentResult> = new NotificationType<GenerateDoxygenCommentResult>('cpptools/insertDoxygenComment');

let failureMessageShown: boolean = false;

export interface ReferencesCancellationState {
    reject(): void;
    callback(): void;
}

class ClientModel {
    public isInitializingWorkspace: DataBinding<boolean>;
    public isIndexingWorkspace: DataBinding<boolean>;
    public isParsingWorkspace: DataBinding<boolean>;
    public isParsingWorkspacePausable: DataBinding<boolean>;
    public isParsingWorkspacePaused: DataBinding<boolean>;
    public isParsingFiles: DataBinding<boolean>;
    public isUpdatingIntelliSense: DataBinding<boolean>;
    public isRunningCodeAnalysis: DataBinding<boolean>;
    public isCodeAnalysisPaused: DataBinding<boolean>;
    public codeAnalysisProcessed: DataBinding<number>;
    public codeAnalysisTotal: DataBinding<number>;
    public referencesCommandMode: DataBinding<refs.ReferencesCommandMode>;
    public parsingWorkspaceStatus: DataBinding<string>;
    public activeConfigName: DataBinding<string>;

    constructor() {
        this.isInitializingWorkspace = new DataBinding<boolean>(false);
        this.isIndexingWorkspace = new DataBinding<boolean>(false);
        this.isParsingWorkspace = new DataBinding<boolean>(false);
        this.isParsingWorkspacePausable = new DataBinding<boolean>(false);
        this.isParsingWorkspacePaused = new DataBinding<boolean>(false);
        this.isParsingFiles = new DataBinding<boolean>(false);
        this.isUpdatingIntelliSense = new DataBinding<boolean>(false);
        this.isRunningCodeAnalysis = new DataBinding<boolean>(false);
        this.isCodeAnalysisPaused = new DataBinding<boolean>(false);
        this.codeAnalysisProcessed = new DataBinding<number>(0);
        this.codeAnalysisTotal = new DataBinding<number>(0);
        this.referencesCommandMode = new DataBinding<refs.ReferencesCommandMode>(refs.ReferencesCommandMode.None);
        this.parsingWorkspaceStatus = new DataBinding<string>("");
        this.activeConfigName = new DataBinding<string>("");
    }

    public activate(): void {
        this.isInitializingWorkspace.activate();
        this.isIndexingWorkspace.activate();
        this.isParsingWorkspace.activate();
        this.isParsingWorkspacePausable.activate();
        this.isParsingWorkspacePaused.activate();
        this.isParsingFiles.activate();
        this.isUpdatingIntelliSense.activate();
        this.isRunningCodeAnalysis.activate();
        this.isCodeAnalysisPaused.activate();
        this.codeAnalysisProcessed.activate();
        this.codeAnalysisTotal.activate();
        this.referencesCommandMode.activate();
        this.parsingWorkspaceStatus.activate();
        this.activeConfigName.activate();
    }

    public deactivate(): void {
        this.isInitializingWorkspace.deactivate();
        this.isIndexingWorkspace.deactivate();
        this.isParsingWorkspace.deactivate();
        this.isParsingWorkspacePausable.deactivate();
        this.isParsingWorkspacePaused.deactivate();
        this.isParsingFiles.deactivate();
        this.isUpdatingIntelliSense.deactivate();
        this.isRunningCodeAnalysis.deactivate();
        this.isCodeAnalysisPaused.deactivate();
        this.codeAnalysisProcessed.deactivate();
        this.codeAnalysisTotal.deactivate();
        this.referencesCommandMode.deactivate();
        this.parsingWorkspaceStatus.deactivate();
        this.activeConfigName.deactivate();
    }

    public dispose(): void {
        this.isInitializingWorkspace.dispose();
        this.isIndexingWorkspace.dispose();
        this.isParsingWorkspace.dispose();
        this.isParsingWorkspacePausable.dispose();
        this.isParsingWorkspacePaused.dispose();
        this.isParsingFiles.dispose();
        this.isUpdatingIntelliSense.dispose();
        this.isRunningCodeAnalysis.dispose();
        this.isCodeAnalysisPaused.dispose();
        this.codeAnalysisProcessed.dispose();
        this.codeAnalysisTotal.dispose();
        this.referencesCommandMode.dispose();
        this.parsingWorkspaceStatus.dispose();
        this.activeConfigName.dispose();
    }
}

export interface Client {
    InitializingWorkspaceChanged: vscode.Event<boolean>;
    IndexingWorkspaceChanged: vscode.Event<boolean>;
    ParsingWorkspaceChanged: vscode.Event<boolean>;
    ParsingWorkspacePausableChanged: vscode.Event<boolean>;
    ParsingWorkspacePausedChanged: vscode.Event<boolean>;
    ParsingFilesChanged: vscode.Event<boolean>;
    IntelliSenseParsingChanged: vscode.Event<boolean>;
    RunningCodeAnalysisChanged: vscode.Event<boolean>;
    CodeAnalysisPausedChanged: vscode.Event<boolean>;
    CodeAnalysisProcessedChanged: vscode.Event<number>;
    CodeAnalysisTotalChanged: vscode.Event<number>;
    ReferencesCommandModeChanged: vscode.Event<refs.ReferencesCommandMode>;
    TagParserStatusChanged: vscode.Event<string>;
    ActiveConfigChanged: vscode.Event<string>;
    RootPath: string;
    RootRealPath: string;
    RootUri?: vscode.Uri;
    RootFolder?: vscode.WorkspaceFolder;
    Name: string;
    TrackedDocuments: Set<vscode.TextDocument>;
    onDidChangeSettings(event: vscode.ConfigurationChangeEvent): { [key: string]: string };
    onDidOpenTextDocument(document: vscode.TextDocument): void;
    onDidCloseTextDocument(document: vscode.TextDocument): void;
    onDidChangeVisibleTextEditor(editor: vscode.TextEditor): void;
    onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void;
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void>;
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    provideCustomConfiguration(docUri: vscode.Uri, requestFile?: string, replaceExisting?: boolean): Promise<void>;
    logDiagnostics(): Promise<void>;
    rescanFolder(): Promise<void>;
    toggleReferenceResultsView(): void;
    setCurrentConfigName(configurationName: string): Thenable<void>;
    getCurrentConfigName(): Thenable<string | undefined>;
    getCurrentConfigCustomVariable(variableName: string): Thenable<string>;
    getVcpkgInstalled(): Thenable<boolean>;
    getVcpkgEnabled(): Thenable<boolean>;
    getCurrentCompilerPathAndArgs(): Thenable<util.CompilerPathAndArgs | undefined>;
    getKnownCompilers(): Thenable<configs.KnownCompiler[] | undefined>;
    takeOwnership(document: vscode.TextDocument): Promise<void>;
    sendDidOpen(document: vscode.TextDocument): Promise<void>;
    queueTask<T>(task: () => Thenable<T>): Promise<T>;
    requestWhenReady<T>(request: () => Thenable<T>): Promise<T>;
    notifyWhenLanguageClientReady<T>(notify: () => T): Promise<T>;
    awaitUntilLanguageClientReady(): Promise<void>;
    requestSwitchHeaderSource(rootUri: vscode.Uri, fileName: string): Thenable<string>;
    activeDocumentChanged(document: vscode.TextDocument): Promise<void>;
    restartIntelliSenseForFile(document: vscode.TextDocument): Promise<void>;
    activate(): void;
    selectionChanged(selection: Range): void;
    resetDatabase(): void;
    deactivate(): void;
    promptSelectCompiler(command: boolean): Promise<void>;
    pauseParsing(): void;
    resumeParsing(): void;
    PauseCodeAnalysis(): void;
    ResumeCodeAnalysis(): void;
    CancelCodeAnalysis(): void;
    handleConfigurationSelectCommand(): Promise<void>;
    handleConfigurationProviderSelectCommand(): Promise<void>;
    handleShowParsingCommands(): Promise<void>;
    handleShowActiveCodeAnalysisCommands(): Promise<void>;
    handleShowIdleCodeAnalysisCommands(): Promise<void>;
    handleReferencesIcon(): void;
    handleConfigurationEditCommand(viewColumn?: vscode.ViewColumn): void;
    handleConfigurationEditJSONCommand(viewColumn?: vscode.ViewColumn): void;
    handleConfigurationEditUICommand(viewColumn?: vscode.ViewColumn): void;
    handleAddToIncludePathCommand(path: string): void;
    handleGoToDirectiveInGroup(next: boolean): Promise<void>;
    handleGenerateDoxygenComment(args: DoxygenCodeActionCommandArguments | vscode.Uri | undefined): Promise<void>;
    handleCheckForCompiler(): Promise<void>;
    handleRunCodeAnalysisOnActiveFile(): Promise<void>;
    handleRunCodeAnalysisOnOpenFiles(): Promise<void>;
    handleRunCodeAnalysisOnAllFiles(): Promise<void>;
    handleRemoveAllCodeAnalysisProblems(): Promise<void>;
    handleRemoveCodeAnalysisProblems(refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void>;
    handleFixCodeAnalysisProblems(workspaceEdit: vscode.WorkspaceEdit, refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void>;
    handleDisableAllTypeCodeAnalysisProblems(code: string, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void>;
    handleCreateDeclarationOrDefinition(): Promise<void>;
    onInterval(): void;
    dispose(): void;
    addFileAssociations(fileAssociations: string, languageId: string): void;
    sendDidChangeSettings(): void;
}

export function createClient(workspaceFolder?: vscode.WorkspaceFolder): Client {
    return new DefaultClient(workspaceFolder);
}

export function createNullClient(): Client {
    return new NullClient();
}

export class DefaultClient implements Client {
    private innerLanguageClient?: LanguageClient; // The "client" that launches and communicates with our language "server" process.
    private disposables: vscode.Disposable[] = [];
    private documentFormattingProviderDisposable: vscode.Disposable | undefined;
    private formattingRangeProviderDisposable: vscode.Disposable | undefined;
    private onTypeFormattingProviderDisposable: vscode.Disposable | undefined;
    private codeFoldingProvider: FoldingRangeProvider | undefined;
    private codeFoldingProviderDisposable: vscode.Disposable | undefined;
    private inlayHintsProvider: InlayHintsProvider | undefined;
    private semanticTokensProvider: SemanticTokensProvider | undefined;
    private semanticTokensProviderDisposable: vscode.Disposable | undefined;
    private innerConfiguration?: configs.CppProperties;
    private rootPathFileWatcher?: vscode.FileSystemWatcher;
    private rootFolder?: vscode.WorkspaceFolder;
    private rootRealPath: string;
    private storagePath: string;
    private trackedDocuments = new Set<vscode.TextDocument>();
    private isSupported: boolean = true;
    private inactiveRegionsDecorations = new Map<string, DecorationRangesPair>();
    private settingsTracker: SettingsTracker;
    private loggingLevel: string | undefined;
    private configurationProvider?: string;

    public static referencesParams: RenameParams | FindAllReferencesParams | undefined;
    public static referencesRequestPending: boolean = false;
    public static referencesPendingCancellations: ReferencesCancellationState[] = [];

    public static renameRequestsPending: number = 0;
    public static renamePending: boolean = false;

    // The "model" that is displayed via the UI (status bar).
    private model: ClientModel = new ClientModel();

    public get InitializingWorkspaceChanged(): vscode.Event<boolean> { return this.model.isInitializingWorkspace.ValueChanged; }
    public get IndexingWorkspaceChanged(): vscode.Event<boolean> { return this.model.isIndexingWorkspace.ValueChanged; }
    public get ParsingWorkspaceChanged(): vscode.Event<boolean> { return this.model.isParsingWorkspace.ValueChanged; }
    public get ParsingWorkspacePausableChanged(): vscode.Event<boolean> { return this.model.isParsingWorkspacePausable.ValueChanged; }
    public get ParsingWorkspacePausedChanged(): vscode.Event<boolean> { return this.model.isParsingWorkspacePaused.ValueChanged; }
    public get ParsingFilesChanged(): vscode.Event<boolean> { return this.model.isParsingFiles.ValueChanged; }
    public get IntelliSenseParsingChanged(): vscode.Event<boolean> { return this.model.isUpdatingIntelliSense.ValueChanged; }
    public get RunningCodeAnalysisChanged(): vscode.Event<boolean> { return this.model.isRunningCodeAnalysis.ValueChanged; }
    public get CodeAnalysisPausedChanged(): vscode.Event<boolean> { return this.model.isCodeAnalysisPaused.ValueChanged; }
    public get CodeAnalysisProcessedChanged(): vscode.Event<number> { return this.model.codeAnalysisProcessed.ValueChanged; }
    public get CodeAnalysisTotalChanged(): vscode.Event<number> { return this.model.codeAnalysisTotal.ValueChanged; }
    public get ReferencesCommandModeChanged(): vscode.Event<refs.ReferencesCommandMode> { return this.model.referencesCommandMode.ValueChanged; }
    public get TagParserStatusChanged(): vscode.Event<string> { return this.model.parsingWorkspaceStatus.ValueChanged; }
    public get ActiveConfigChanged(): vscode.Event<string> { return this.model.activeConfigName.ValueChanged; }

    /**
     * don't use this.rootFolder directly since it can be undefined
     */
    public get RootPath(): string {
        return (this.rootFolder) ? this.rootFolder.uri.fsPath : "";
    }
    public get RootRealPath(): string {
        return this.rootRealPath;
    }
    public get RootUri(): vscode.Uri | undefined {
        return (this.rootFolder) ? this.rootFolder.uri : undefined;
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
        return this.model.isParsingWorkspace.Value || this.model.isParsingFiles.Value || this.model.isInitializingWorkspace.Value || this.model.isIndexingWorkspace.Value;
    }
    public get ReferencesCommandMode(): refs.ReferencesCommandMode {
        return this.model.referencesCommandMode.Value;
    }

    public get languageClient(): LanguageClient {
        if (!this.innerLanguageClient) {
            throw new Error("Attempting to use languageClient before initialized");
        }
        return this.innerLanguageClient;
    }

    public get configuration(): configs.CppProperties {
        if (!this.innerConfiguration) {
            throw new Error("Attempting to use configuration before initialized");
        }
        return this.innerConfiguration;
    }

    public get AdditionalEnvironment(): { [key: string]: string | string[] } {
        return {
            workspaceFolderBasename: this.Name,
            workspaceStorage: this.storagePath,
            execPath: process.execPath,
            pathSeparator: (os.platform() === 'win32') ? "\\" : "/"
        };
    }

    private getName(workspaceFolder?: vscode.WorkspaceFolder): string {
        return workspaceFolder ? workspaceFolder.name : "untitled";
    }

    public static updateClientConfigurations(): void {
        clients.forEach(client => {
            if (client instanceof DefaultClient) {
                const defaultClient: DefaultClient = <DefaultClient>client;
                defaultClient.configuration.CompilerDefaults = compilerDefaults;
                defaultClient.configuration.handleConfigurationChange();
            }
        });
    }

    public async showSelectDefaultCompiler(paths: string[]): Promise<number> {
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.compile.commands", "Select a compiler to configure for IntelliSense");

        const items: IndexableQuickPickItem[] = [];
        for (let i: number = 0; i < paths.length; i++) {
            const compilerName: string = path.basename(paths[i]);
            const isCompiler: boolean = compilerName !== paths[i];

            if (isCompiler) {
                const path: string | undefined = paths[i].replace(compilerName, "");
                const description: string = localize("found.string", "Found at {0}", path);
                items.push({ label: compilerName, description: description, index: i });
            } else {
                items.push({ label: paths[i], index: i });
            }
        }

        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return (selection) ? selection.index : -1;
    }

    public async showPrompt(buttonMessage: string, showSecondPrompt: boolean): Promise<void> {
        if (secondPromptCounter < 1) {
            const value: string | undefined = await vscode.window.showInformationMessage(localize("setCompiler.message", "You do not have IntelliSense configured. Unless you set your own configurations, IntelliSense may not be functional."), buttonMessage);
            secondPromptCounter++;
            if (value === buttonMessage) {
                this.handleCompilerQuickPick(showSecondPrompt);
            }
        }
    }

    public async handleCompilerQuickPick(showSecondPrompt: boolean): Promise<void> {
        const settings: OtherSettings = new OtherSettings();
        const selectCompiler: string = localize("selectCompiler.string", "Select Compiler");
        const paths: string[] = [];
        if (compilerDefaults.knownCompilers !== undefined) {
            const tempPaths: string[] = compilerDefaults.knownCompilers.map(function (a: configs.KnownCompiler): string { return a.path; });
            let clFound: boolean = false;
            // Remove all but the first cl path.
            for (const path of tempPaths) {
                if (clFound) {
                    if (!util.isCl(path)) {
                        paths.push(path);
                    }
                } else {
                    if (util.isCl(path)) {
                        clFound = true;
                    }
                    paths.push(path);
                }
            }
        }
        paths.push(localize("selectAnotherCompiler.string", "Select another compiler on my machine"));
        paths.push(localize("installCompiler.string", "Help me install a compiler"));
        paths.push(localize("noConfig.string", "Do not configure a compiler (not recommended)"));
        const index: number = await this.showSelectDefaultCompiler(paths);
        let action: string;
        switch (index) {
            case -1:
                action = 'escaped';
                break;
            case paths.length - 1:
                action = 'disable';
                break;
            case paths.length - 2:
                action = 'help';
                break;
            case paths.length - 3:
                action = 'browse';
                break;
            default:
                action = 'select compiler';
                break;
        }
        telemetry.logLanguageServerEvent('compilerSelection', { action });
        if (index === -1) {
            if (showSecondPrompt) {
                this.showPrompt(selectCompiler, true);
            }
            return;
        }
        if (index === paths.length - 1) {
            settings.defaultCompiler = "";
            if (showSecondPrompt) {
                this.showPrompt(selectCompiler, true);
            }
            return;
        }
        if (index === paths.length - 2) {
            switch (os.platform()) {
                case 'win32':
                    vscode.commands.executeCommand('vscode.open', "https://go.microsoft.com/fwlink/?linkid=2217614");
                    return;
                case 'darwin':
                    vscode.commands.executeCommand('vscode.open', "https://go.microsoft.com/fwlink/?linkid=2217706");
                    return;
                default: // Linux
                    vscode.commands.executeCommand('vscode.open', "https://go.microsoft.com/fwlink/?linkid=2217615");
                    return;
            }
        }
        if (index === paths.length - 3) {
            const result: vscode.Uri[] | undefined = await vscode.window.showOpenDialog();
            if (result === undefined || result.length === 0) {
                return;
            }
            settings.defaultCompiler = result[0].fsPath;
        } else {
            settings.defaultCompiler = util.isCl(paths[index]) ? "cl.exe" : paths[index];
        }
        util.addTrustedCompiler(compilerPaths, settings.defaultCompiler);
        compilerDefaults = await this.requestCompiler(compilerPaths);
        DefaultClient.updateClientConfigurations();
    }

    async promptSelectCompiler(isCommand: boolean): Promise<void> {
        secondPromptCounter = 0;
        if (compilerDefaults === undefined) {
            return;
        }
        const selectCompiler: string = localize("selectCompiler.string", "Select Compiler");
        const confirmCompiler: string = localize("confirmCompiler.string", "Yes");
        const settings: OtherSettings = new OtherSettings();
        if (isCommand || compilerDefaults.compilerPath !== "") {
            if (!isCommand && (compilerDefaults.compilerPath !== undefined)) {
                const value: string | undefined = await vscode.window.showInformationMessage(localize("selectCompiler.message", "The compiler {0} was found. Do you want to configure IntelliSense with this compiler?", compilerDefaults.compilerPath), confirmCompiler, selectCompiler);
                if (value === confirmCompiler) {
                    compilerPaths = await util.addTrustedCompiler(compilerPaths, compilerDefaults.compilerPath);
                    settings.defaultCompiler = compilerDefaults.compilerPath;
                    compilerDefaults = await this.requestCompiler(compilerPaths);
                    DefaultClient.updateClientConfigurations();
                } else if (value === selectCompiler) {
                    this.handleCompilerQuickPick(true);
                } else {
                    this.showPrompt(selectCompiler, true);
                }
            } else if (!isCommand && (compilerDefaults.compilerPath === undefined)) {
                this.showPrompt(selectCompiler, false);
            } else {
                this.handleCompilerQuickPick(isCommand);
            }
        }
    }

    /**
     * All public methods on this class must be guarded by the "pendingTask" promise. Requests and notifications received before the task is
     * complete are executed after this promise is resolved.
     * @see requestWhenReady<T>(request)
     * @see notifyWhenLanguageClientReady(notify)
     * @see awaitUntilLanguageClientReady()
     */

    constructor(workspaceFolder?: vscode.WorkspaceFolder, initializeNow?: boolean) {
        if (!semanticTokensLegend) {
            // Semantic token types are identified by indexes in this list of types, in the legend.
            const tokenTypesLegend: string[] = [];
            for (const e in SemanticTokenTypes) {
                // An enum is actually a set of mappings from key <=> value.  Enumerate over only the names.
                // This allow us to represent the constants using an enum, which we can match in native code.
                if (isNaN(Number(e))) {
                    tokenTypesLegend.push(e);
                }
            }
            // Semantic token modifiers are bit indexes corresponding to the indexes in this list of modifiers in the legend.
            const tokenModifiersLegend: string[] = [];
            for (const e in SemanticTokenModifiers) {
                if (isNaN(Number(e))) {
                    tokenModifiersLegend.push(e);
                }
            }
            semanticTokensLegend = new vscode.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend);
        }

        this.rootFolder = workspaceFolder;
        this.rootRealPath = this.RootPath ? (fs.existsSync(this.RootPath) ? fs.realpathSync(this.RootPath) : this.RootPath) : "";

        let storagePath: string | undefined;
        if (util.extensionContext) {
            const path: string | undefined = util.extensionContext.storageUri?.fsPath;
            if (path) {
                storagePath = path;
            }
        }

        if (!storagePath) {
            storagePath = this.RootPath ? path.join(this.RootPath, "/.vscode") : "";
        }
        if (workspaceFolder && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
            storagePath = path.join(storagePath, util.getUniqueWorkspaceStorageName(workspaceFolder));
        }
        this.storagePath = storagePath;
        const rootUri: vscode.Uri | undefined = this.RootUri;
        this.settingsTracker = new SettingsTracker(rootUri);

        try {
            let isFirstClient: boolean = false;
            if (!languageClient || languageClientCrashedNeedsRestart) {
                if (languageClientCrashedNeedsRestart) {
                    languageClientCrashedNeedsRestart = false;
                }
                firstClientStarted = this.createLanguageClient();
                util.setProgress(util.getProgressExecutableStarted());
                isFirstClient = true;
            }

            // requests/notifications are deferred until this.languageClient is set.
            this.queueBlockingTask(async () => {
                ui = await getUI();
                ui.bind(this);
                await firstClientStarted;
                try {
                    const workspaceFolder: vscode.WorkspaceFolder | undefined = this.rootFolder;
                    this.innerConfiguration = new configs.CppProperties(rootUri, workspaceFolder);
                    this.innerConfiguration.ConfigurationsChanged((e) => this.onConfigurationsChanged(e));
                    this.innerConfiguration.SelectionChanged((e) => this.onSelectedConfigurationChanged(e));
                    this.innerConfiguration.CompileCommandsChanged((e) => this.onCompileCommandsChanged(e));
                    this.disposables.push(this.innerConfiguration);

                    this.innerLanguageClient = languageClient;
                    telemetry.logLanguageServerEvent("NonDefaultInitialCppSettings", this.settingsTracker.getUserModifiedSettings());
                    failureMessageShown = false;

                    if (isFirstClient) {
                        workspaceReferences = new refs.ReferencesManager(this);
                        // Only register file watchers and providers after the extension has finished initializing,
                        // e.g. prevents empty c_cpp_properties.json from generation.
                        this.registerFileWatcher();
                        initializedClientCount = 0;
                        this.inlayHintsProvider = new InlayHintsProvider(this);

                        this.disposables.push(vscode.languages.registerInlayHintsProvider(util.documentSelector, this.inlayHintsProvider));
                        this.disposables.push(vscode.languages.registerRenameProvider(util.documentSelector, new RenameProvider(this)));
                        this.disposables.push(vscode.languages.registerReferenceProvider(util.documentSelector, new FindAllReferencesProvider(this)));
                        this.disposables.push(vscode.languages.registerWorkspaceSymbolProvider(new WorkspaceSymbolProvider(this)));
                        this.disposables.push(vscode.languages.registerDocumentSymbolProvider(util.documentSelector, new DocumentSymbolProvider(), undefined));
                        this.disposables.push(vscode.languages.registerCodeActionsProvider(util.documentSelector, new CodeActionProvider(this), undefined));
                        // Because formatting and codeFolding can vary per folder, we need to register these providers once
                        // and leave them registered. The decision of whether to provide results needs to be made on a per folder basis,
                        // within the providers themselves.
                        this.documentFormattingProviderDisposable = vscode.languages.registerDocumentFormattingEditProvider(util.documentSelector, new DocumentFormattingEditProvider(this));
                        this.formattingRangeProviderDisposable = vscode.languages.registerDocumentRangeFormattingEditProvider(util.documentSelector, new DocumentRangeFormattingEditProvider(this));
                        this.onTypeFormattingProviderDisposable = vscode.languages.registerOnTypeFormattingEditProvider(util.documentSelector, new OnTypeFormattingEditProvider(this), ";", "}", "\n");

                        this.codeFoldingProvider = new FoldingRangeProvider(this);
                        this.codeFoldingProviderDisposable = vscode.languages.registerFoldingRangeProvider(util.documentSelector, this.codeFoldingProvider);

                        const settings: CppSettings = new CppSettings();
                        if (settings.enhancedColorization && semanticTokensLegend) {
                            this.semanticTokensProvider = new SemanticTokensProvider(this);
                            this.semanticTokensProviderDisposable = vscode.languages.registerDocumentSemanticTokensProvider(util.documentSelector, this.semanticTokensProvider, semanticTokensLegend);
                        }
                        // Listen for messages from the language server.
                        this.registerNotifications();
                    }
                    // update all client configurations
                    this.configuration.setupConfigurations();
                    initializedClientCount++;
                    // count number of clients, once all clients are configured, check for trusted compiler to display notification to user and add a short delay to account for config provider logic to finish
                    if ((vscode.workspace.workspaceFolders === undefined) || (initializedClientCount >= vscode.workspace.workspaceFolders.length)) {
                        // The configurations will not be sent to the language server until the default include paths and frameworks have been set.
                        // The event handlers must be set before this happens.
                        compilerDefaults = await this.requestCompiler(compilerPaths);
                        DefaultClient.updateClientConfigurations();
                        if (!compilerDefaults.trustedCompilerFound && !displayedSelectCompiler && (compilerPaths.length !== 1 || compilerPaths[0] !== "")) {
                            // if there is no compilerPath in c_cpp_properties.json, prompt user to configure a compiler
                            this.promptSelectCompiler(false);
                            displayedSelectCompiler = true;
                        }
                    }
                } catch (err) {
                    this.isSupported = false;   // Running on an OS we don't support yet.
                    if (!failureMessageShown) {
                        failureMessageShown = true;
                        vscode.window.showErrorMessage(localize("unable.to.start", "Unable to start the C/C++ language server. IntelliSense features will be disabled. Error: {0}", String(err)));
                    }
                }
            });
        } catch (errJS) {
            const err: NodeJS.ErrnoException = errJS as NodeJS.ErrnoException;
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
    }

    public sendFindAllReferencesNotification(params: FindAllReferencesParams): void {
        this.languageClient.sendNotification(FindAllReferencesNotification, params);
    }

    public sendRenameNotification(params: RenameParams): void {
        this.languageClient.sendNotification(RenameNotification, params);
    }

    private getWorkspaceFolderSettings(workspaceFolderUri: vscode.Uri | undefined, settings: CppSettings, otherSettings: OtherSettings): WorkspaceFolderSettingsParams {
        const result: WorkspaceFolderSettingsParams = {
            uri: workspaceFolderUri?.toString(),
            intelliSenseEngine: settings.intelliSenseEngine,
            intelliSenseEngineFallback: settings.intelliSenseEngineFallback,
            autocomplete: settings.autocomplete,
            autocompleteAddParentheses: settings.autocompleteAddParentheses,
            errorSquiggles: settings.errorSquiggles,
            exclusionPolicy: settings.exclusionPolicy,
            preferredPathSeparator: settings.preferredPathSeparator,
            intelliSenseCachePath: util.resolveCachePath(settings.intelliSenseCachePath, this.AdditionalEnvironment),
            intelliSenseCacheSize: settings.intelliSenseCacheSize,
            intelliSenseMemoryLimit: settings.intelliSenseMemoryLimit,
            dimInactiveRegions: settings.dimInactiveRegions,
            suggestSnippets: settings.suggestSnippets,
            legacyCompilerArgsBehavior: settings.legacyCompilerArgsBehavior,
            defaultSystemIncludePath: settings.defaultSystemIncludePath,
            cppFilesExclude: settings.filesExclude,
            clangFormatPath: util.resolveVariables(settings.clangFormatPath, this.AdditionalEnvironment),
            clangFormatStyle: settings.clangFormatStyle,
            clangFormatFallbackStyle: settings.clangFormatFallbackStyle,
            clangFormatSortIncludes: settings.clangFormatSortIncludes,
            codeAnalysisRunAutomatically: settings.codeAnalysisRunAutomatically,
            codeAnalysisExclude: settings.codeAnalysisExclude,
            clangTidyEnabled: settings.clangTidyEnabled,
            clangTidyPath: util.resolveVariables(settings.clangTidyPath, this.AdditionalEnvironment),
            clangTidyConfig: settings.clangTidyConfig,
            clangTidyFallbackConfig: settings.clangTidyFallbackConfig,
            clangTidyHeaderFilter: (settings.clangTidyHeaderFilter !== null ? util.resolveVariables(settings.clangTidyHeaderFilter, this.AdditionalEnvironment) : null),
            clangTidyArgs: util.resolveVariablesArray(settings.clangTidyArgs, this.AdditionalEnvironment),
            clangTidyUseBuildPath: settings.clangTidyUseBuildPath,
            clangTidyFixWarnings: settings.clangTidyFixWarnings,
            clangTidyFixErrors: settings.clangTidyFixErrors,
            clangTidyFixNotes: settings.clangTidyFixNotes,
            clangTidyChecksEnabled: settings.clangTidyChecksEnabled,
            clangTidyChecksDisabled: settings.clangTidyChecksDisabled,
            hover: settings.hover,
            vcFormatIndentBraces: settings.vcFormatIndentBraces,
            vcFormatIndentMultiLineRelativeTo: settings.vcFormatIndentMultiLineRelativeTo,
            vcFormatIndentWithinParentheses: settings.vcFormatIndentWithinParentheses,
            vcFormatIndentPreserveWithinParentheses: settings.vcFormatIndentPreserveWithinParentheses,
            vcFormatIndentCaseLabels: settings.vcFormatIndentCaseLabels,
            vcFormatIndentCaseContents: settings.vcFormatIndentCaseContents,
            vcFormatIndentCaseContentsWhenBlock: settings.vcFormatIndentCaseContentsWhenBlock,
            vcFormatIndentLambdaBracesWhenParameter: settings.vcFormatIndentLambdaBracesWhenParameter,
            vcFormatIndentGotoLabels: settings.vcFormatIndentGotoLabels,
            vcFormatIndentPreprocessor: settings.vcFormatIndentPreprocessor,
            vcFormatIndentAccesSpecifiers: settings.vcFormatIndentAccessSpecifiers,
            vcFormatIndentNamespaceContents: settings.vcFormatIndentNamespaceContents,
            vcFormatIndentPreserveComments: settings.vcFormatIndentPreserveComments,
            vcFormatNewLineScopeBracesOnSeparateLines: settings.vcFormatNewlineScopeBracesOnSeparateLines,
            vcFormatNewLineBeforeOpenBraceNamespace: settings.vcFormatNewlineBeforeOpenBraceNamespace,
            vcFormatNewLineBeforeOpenBraceType: settings.vcFormatNewlineBeforeOpenBraceType,
            vcFormatNewLineBeforeOpenBraceFunction: settings.vcFormatNewlineBeforeOpenBraceFunction,
            vcFormatNewLineBeforeOpenBraceBlock: settings.vcFormatNewlineBeforeOpenBraceBlock,
            vcFormatNewLineBeforeOpenBraceLambda: settings.vcFormatNewlineBeforeOpenBraceLambda,
            vcFormatNewLineBeforeCatch: settings.vcFormatNewlineBeforeCatch,
            vcFormatNewLineBeforeElse: settings.vcFormatNewlineBeforeElse,
            vcFormatNewLineBeforeWhileInDoWhile: settings.vcFormatNewlineBeforeWhileInDoWhile,
            vcFormatNewLineCloseBraceSameLineEmptyType: settings.vcFormatNewlineCloseBraceSameLineEmptyType,
            vcFormatNewLineCloseBraceSameLineEmptyFunction: settings.vcFormatNewlineCloseBraceSameLineEmptyFunction,
            vcFormatSpaceBeforeFunctionOpenParenthesis: settings.vcFormatSpaceBeforeFunctionOpenParenthesis,
            vcFormatSpaceWithinParameterListParentheses: settings.vcFormatSpaceWithinParameterListParentheses,
            vcFormatSpaceBetweenEmptyParameterListParentheses: settings.vcFormatSpaceBetweenEmptyParameterListParentheses,
            vcFormatSpaceAfterKeywordsInControlFlowStatements: settings.vcFormatSpaceAfterKeywordsInControlFlowStatements,
            vcFormatSpaceWithinControlFlowStatementParentheses: settings.vcFormatSpaceWithinControlFlowStatementParentheses,
            vcFormatSpaceBeforeLambdaOpenParenthesis: settings.vcFormatSpaceBeforeLambdaOpenParenthesis,
            vcFormatSpaceWithinCastParentheses: settings.vcFormatSpaceWithinCastParentheses,
            vcFormatSpaceAfterCastCloseParenthesis: settings.vcFormatSpaceAfterCastCloseParenthesis,
            vcFormatSpaceWithinExpressionParentheses: settings.vcFormatSpaceWithinExpressionParentheses,
            vcFormatSpaceBeforeBlockOpenBrace: settings.vcFormatSpaceBeforeBlockOpenBrace,
            vcFormatSpaceBetweenEmptyBraces: settings.vcFormatSpaceBetweenEmptyBraces,
            vcFormatSpaceBeforeInitializerListOpenBrace: settings.vcFormatSpaceBeforeInitializerListOpenBrace,
            vcFormatSpaceWithinInitializerListBraces: settings.vcFormatSpaceWithinInitializerListBraces,
            vcFormatSpacePreserveInInitializerList: settings.vcFormatSpacePreserveInInitializerList,
            vcFormatSpaceBeforeOpenSquareBracket: settings.vcFormatSpaceBeforeOpenSquareBracket,
            vcFormatSpaceWithinSquareBrackets: settings.vcFormatSpaceWithinSquareBrackets,
            vcFormatSpaceBeforeEmptySquareBrackets: settings.vcFormatSpaceBeforeEmptySquareBrackets,
            vcFormatSpaceBetweenEmptySquareBrackets: settings.vcFormatSpaceBetweenEmptySquareBrackets,
            vcFormatSpaceGroupSquareBrackets: settings.vcFormatSpaceGroupSquareBrackets,
            vcFormatSpaceWithinLambdaBrackets: settings.vcFormatSpaceWithinLambdaBrackets,
            vcFormatSpaceBetweenEmptyLambdaBrackets: settings.vcFormatSpaceBetweenEmptyLambdaBrackets,
            vcFormatSpaceBeforeComma: settings.vcFormatSpaceBeforeComma,
            vcFormatSpaceAfterComma: settings.vcFormatSpaceAfterComma,
            vcFormatSpaceRemoveAroundMemberOperators: settings.vcFormatSpaceRemoveAroundMemberOperators,
            vcFormatSpaceBeforeInheritanceColon: settings.vcFormatSpaceBeforeInheritanceColon,
            vcFormatSpaceBeforeConstructorColon: settings.vcFormatSpaceBeforeConstructorColon,
            vcFormatSpaceRemoveBeforeSemicolon: settings.vcFormatSpaceRemoveBeforeSemicolon,
            vcFormatSpaceInsertAfterSemicolon: settings.vcFormatSpaceInsertAfterSemicolon,
            vcFormatSpaceRemoveAroundUnaryOperator: settings.vcFormatSpaceRemoveAroundUnaryOperator,
            vcFormatSpaceAroundBinaryOperator: settings.vcFormatSpaceAroundBinaryOperator,
            vcFormatSpaceAroundAssignmentOperator: settings.vcFormatSpaceAroundAssignmentOperator,
            vcFormatSpacePointerReferenceAlignment: settings.vcFormatSpacePointerReferenceAlignment,
            vcFormatSpaceAroundTernaryOperator: settings.vcFormatSpaceAroundTernaryOperator,
            vcFormatWrapPreserveBlocks: settings.vcFormatWrapPreserveBlocks,
            doxygenGenerateOnType: settings.doxygenGenerateOnType,
            doxygenGeneratedStyle: settings.doxygenGeneratedCommentStyle,
            doxygenSectionTags: settings.doxygenSectionTags,
            filesExclude: otherSettings.filesExclude,
            filesAutoSaveAfterDelay: otherSettings.filesAutoSaveAfterDelay,
            filesEncoding: otherSettings.filesEncoding,
            searchExclude: otherSettings.searchExclude,
            editorAutoClosingBrackets: otherSettings.editorAutoClosingBrackets,
            editorInlayHintsEnabled: otherSettings.editorInlayHintsEnabled,
            editorParameterHintsEnabled: otherSettings.editorParameterHintsEnabled
        };
        return result;
    };

    private getAllWorkspaceFolderSettings(): WorkspaceFolderSettingsParams[] {
        const workspaceSettings: CppSettings = new CppSettings();
        const workspaceOtherSettings: OtherSettings = new OtherSettings();
        const workspaceFolderSettingsParams: WorkspaceFolderSettingsParams[] = [];
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                workspaceFolderSettingsParams.push(this.getWorkspaceFolderSettings(workspaceFolder.uri, new CppSettings(workspaceFolder.uri), new OtherSettings(workspaceFolder.uri)));
            }
        } else {
            workspaceFolderSettingsParams.push(this.getWorkspaceFolderSettings(this.RootUri, workspaceSettings, workspaceOtherSettings));
        }
        return workspaceFolderSettingsParams;
    }

    private getAllSettings(): SettingsParams {
        const workspaceSettings: CppSettings = new CppSettings();
        const workspaceOtherSettings: OtherSettings = new OtherSettings();
        const workspaceFolderSettingsParams: WorkspaceFolderSettingsParams[] = this.getAllWorkspaceFolderSettings();
        return {
            filesAssociations: workspaceOtherSettings.filesAssociations,
            workspaceFallbackEncoding: workspaceOtherSettings.filesEncoding,
            maxConcurrentThreads: workspaceSettings.maxConcurrentThreads,
            maxCachedProcesses: workspaceSettings.maxCachedProcesses,
            maxMemory: workspaceSettings.maxMemory,
            loggingLevel: workspaceSettings.loggingLevel,
            workspaceParsingPriority: workspaceSettings.workspaceParsingPriority,
            workspaceSymbols: workspaceSettings.workspaceSymbols,
            simplifyStructuredComments: workspaceSettings.simplifyStructuredComments,
            intelliSenseUpdateDelay: workspaceSettings.intelliSenseUpdateDelay,
            experimentalFeatures: workspaceSettings.experimentalFeatures,
            enhancedColorization: workspaceSettings.enhancedColorization,
            intellisenseMaxCachedProcesses: workspaceSettings.intelliSenseMaxCachedProcesses,
            intellisenseMaxMemory: workspaceSettings.intelliSenseMaxMemory,
            referencesMaxConcurrentThreads: workspaceSettings.referencesMaxConcurrentThreads,
            referencesMaxCachedProcesses: workspaceSettings.referencesMaxCachedProcesses,
            referencesMaxMemory: workspaceSettings.referencesMaxMemory,
            codeAnalysisMaxConcurrentThreads: workspaceSettings.codeAnalysisMaxConcurrentThreads,
            codeAnalysisMaxMemory: workspaceSettings.codeAnalysisMaxMemory,
            codeAnalysisUpdateDelay: workspaceSettings.codeAnalysisUpdateDelay,
            workspaceFolderSettings: workspaceFolderSettingsParams
        };
    }

    private async createLanguageClient(): Promise<void> {
        const currentCaseSensitiveFileSupport: PersistentWorkspaceState<boolean> = new PersistentWorkspaceState<boolean>("CPP.currentCaseSensitiveFileSupport", false);
        let resetDatabase: boolean = false;
        const serverModule: string = getLanguageServerFileName();
        const exeExists: boolean = fs.existsSync(serverModule);
        if (!exeExists) {
            telemetry.logLanguageServerEvent("missingLanguageServerBinary");
            throw String('Missing binary at ' + serverModule);
        }
        const serverName: string = this.getName(this.rootFolder);
        const serverOptions: ServerOptions = {
            run: { command: serverModule, options: { detached: false } },
            debug: { command: serverModule, args: [serverName], options: { detached: true } }
        };

        let intelliSenseCacheDisabled: boolean = false;
        if (os.platform() === "darwin") {
            const releaseParts: string[] = os.release().split(".");
            if (releaseParts.length >= 1) {
                // AutoPCH doesn't work for older Mac OS's.
                intelliSenseCacheDisabled = parseInt(releaseParts[0]) < 17;
            }
        }

        const localizedStrings: string[] = [];
        for (let i: number = 0; i < localizedStringCount; i++) {
            localizedStrings.push(lookupString(i));
        }

        const workspaceSettings: CppSettings = new CppSettings();
        if (workspaceSettings.caseSensitiveFileSupport !== currentCaseSensitiveFileSupport.Value) {
            resetDatabase = true;
            currentCaseSensitiveFileSupport.Value = workspaceSettings.caseSensitiveFileSupport;
        }

        const initializationOptions: InitializationOptions = {
            packageVersion: util.packageJson.version,
            extensionPath: util.extensionPath,
            storagePath: this.storagePath,
            freeMemory: Math.floor(os.freemem() / 1048576),
            vcpkgRoot: util.getVcpkgRoot(),
            intelliSenseCacheDisabled: intelliSenseCacheDisabled,
            caseSensitiveFileSupport: workspaceSettings.caseSensitiveFileSupport,
            resetDatabase: resetDatabase,
            edgeMessagesDirectory: path.join(util.getExtensionFilePath("bin"), "messages", getLocaleId()),
            localizedStrings: localizedStrings,
            settings: this.getAllSettings()
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'c' },
                { scheme: 'file', language: 'cpp' },
                { scheme: 'file', language: 'cuda-cpp' }
            ],
            middleware: createProtocolFilter(),
            errorHandler: {
                error: (error, message, count) => ({ action: ErrorAction.Continue }),
                closed: () => {
                    languageClientCrashTimes.push(Date.now());
                    languageClientCrashedNeedsRestart = true;
                    telemetry.logLanguageServerEvent("languageClientCrash");
                    let restart: boolean = true;
                    if (languageClientCrashTimes.length < 5) {
                        clients.recreateClients();
                    } else {
                        const elapsed: number = languageClientCrashTimes[languageClientCrashTimes.length - 1] - languageClientCrashTimes[0];
                        if (elapsed <= 3 * 60 * 1000) {
                            clients.recreateClients(true);
                            restart = false;
                        } else {
                            languageClientCrashTimes.shift();
                            clients.recreateClients();
                        }
                    }
                    const message: string = restart ? localize('server.crashed.restart', 'The language server crashed. Restarting...')
                        : localize('server.crashed2', 'The language server crashed 5 times in the last 3 minutes. It will not be restarted.');

                    // We manually restart the language server so tell the LanguageClient not to do it automatically for us.
                    return { action: CloseAction.DoNotRestart, message };
                }
            }

            // TODO: should I set the output channel?  Does this sort output between servers?
        };

        // Create the language client
        this.loggingLevel = initializationOptions.settings.loggingLevel;
        languageClient = new LanguageClient(`cpptools`, serverOptions, clientOptions);
        setupOutputHandlers();
        languageClient.registerProposedFeatures();
        await languageClient.start();
        // Move initialization to a separate message, so we can see log output from it.
        await languageClient.sendNotification(InitializationNotification, initializationOptions);
    }

    public sendDidChangeSettings(): void {
        // Send settings json to native side
        this.notifyWhenLanguageClientReady(() => {
            this.languageClient.sendNotification(DidChangeSettingsNotification, this.getAllSettings());
        });
    }

    public onDidChangeSettings(event: vscode.ConfigurationChangeEvent): { [key: string]: string } {
        const defaultClient: Client = clients.getDefaultClient();
        if (this === defaultClient) {
            // Only send the updated settings information once, as it includes values for all folders.
            this.sendDidChangeSettings();
        }
        const changedSettings: { [key: string]: string } = this.settingsTracker.getChangedSettings();
        this.notifyWhenLanguageClientReady(() => {
            if (Object.keys(changedSettings).length > 0) {
                if (this === defaultClient) {
                    if (changedSettings["commentContinuationPatterns"]) {
                        updateLanguageConfigurations();
                    }
                    if (changedSettings["loggingLevel"]) {
                        const oldLoggingLevelLogged: boolean = !!this.loggingLevel && this.loggingLevel !== "None" && this.loggingLevel !== "Error";
                        const newLoggingLevel: string | undefined = changedSettings["loggingLevel"];
                        this.loggingLevel = newLoggingLevel;
                        const newLoggingLevelLogged: boolean = !!newLoggingLevel && newLoggingLevel !== "None" && newLoggingLevel !== "Error";
                        if (oldLoggingLevelLogged || newLoggingLevelLogged) {
                            const out: Logger = getOutputChannelLogger();
                            out.appendLine(localize({ key: "loggingLevel.changed", comment: ["{0} is the setting name 'loggingLevel', {1} is a string value such as 'Debug'"] }, "{0} has changed to: {1}", "loggingLevel", changedSettings["loggingLevel"]));
                        }
                    }
                    const settings: CppSettings = new CppSettings();
                    if (changedSettings["enhancedColorization"]) {
                        if (settings.enhancedColorization && semanticTokensLegend) {
                            this.semanticTokensProvider = new SemanticTokensProvider(this);
                            this.semanticTokensProviderDisposable = vscode.languages.registerDocumentSemanticTokensProvider(util.documentSelector, this.semanticTokensProvider, semanticTokensLegend);
                        } else if (this.semanticTokensProviderDisposable) {
                            this.semanticTokensProviderDisposable.dispose();
                            this.semanticTokensProviderDisposable = undefined;
                            this.semanticTokensProvider = undefined;
                        }
                    }
                    if (changedSettings["caseSensitiveFileSupport"] && util.isWindows()) {
                        util.promptForReloadWindowDueToSettingsChange();
                    }
                    if (changedSettings["hover"]) {
                        util.promptForReloadWindowDueToSettingsChange();
                    }
                    // if addNodeAddonIncludePaths was turned on but no includes have been found yet then 1) presume that nan
                    // or node-addon-api was installed so prompt for reload.
                    if (changedSettings["addNodeAddonIncludePaths"] && settings.addNodeAddonIncludePaths && this.configuration.nodeAddonIncludesFound() === 0) {
                        util.promptForReloadWindowDueToSettingsChange();
                    }
                }
                if (changedSettings["legacyCompilerArgsBehavior"]) {
                    this.configuration.handleConfigurationChange();
                }
                this.configuration.onDidChangeSettings();
                telemetry.logLanguageServerEvent("CppSettingsChange", changedSettings, undefined);
            }
        });
        return changedSettings;
    }

    public onDidChangeVisibleTextEditor(editor: vscode.TextEditor): void {
        const settings: CppSettings = new CppSettings(this.RootUri);
        if (settings.dimInactiveRegions) {
            // Apply text decorations to inactive regions
            const valuePair: DecorationRangesPair | undefined = this.inactiveRegionsDecorations.get(editor.document.uri.toString());
            if (valuePair) {
                editor.setDecorations(valuePair.decoration, valuePair.ranges); // VSCode clears the decorations when the text editor becomes invisible
            }
        }
    }

    public onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void {
        if (textDocumentChangeEvent.document.uri.scheme === "file") {
            if (textDocumentChangeEvent.document.languageId === "c"
                || textDocumentChangeEvent.document.languageId === "cpp"
                || textDocumentChangeEvent.document.languageId === "cuda-cpp") {
                // If any file has changed, we need to abort the current rename operation
                if (DefaultClient.renamePending) {
                    this.cancelReferences();
                }

                const oldVersion: number | undefined = openFileVersions.get(textDocumentChangeEvent.document.uri.toString());
                const newVersion: number = textDocumentChangeEvent.document.version;
                if (oldVersion === undefined || newVersion > oldVersion) {
                    openFileVersions.set(textDocumentChangeEvent.document.uri.toString(), newVersion);
                }
            }
        }
    }

    public onDidOpenTextDocument(document: vscode.TextDocument): void {
        if (document.uri.scheme === "file") {
            const uri: string = document.uri.toString();
            openFileVersions.set(uri, document.version);
            vscode.commands.executeCommand('setContext', 'BuildAndDebug.isSourceFile', util.isCppOrCFile(document.uri));
            vscode.commands.executeCommand('setContext', 'BuildAndDebug.isFolderOpen', util.isFolderOpen(document.uri));
        } else {
            vscode.commands.executeCommand('setContext', 'BuildAndDebug.isSourceFile', false);
        }
    }

    public onDidCloseTextDocument(document: vscode.TextDocument): void {
        const uri: string = document.uri.toString();
        if (this.semanticTokensProvider) {
            this.semanticTokensProvider.invalidateFile(uri);
        }
        if (this.inlayHintsProvider) {
            this.inlayHintsProvider.invalidateFile(uri);
        }
        openFileVersions.delete(uri);
    }

    private registeredProviders: CustomConfigurationProvider1[] = [];
    public onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void> {
        const onRegistered: () => void = () => {
            // version 2 providers control the browse.path. Avoid thrashing the tag parser database by pausing parsing until
            // the provider has sent the correct browse.path value.
            if (provider.version >= Version.v2) {
                this.pauseParsing();
            }
        };
        return this.notifyWhenLanguageClientReady(() => {
            if (this.registeredProviders.includes(provider)) {
                return; // Prevent duplicate processing.
            }
            this.registeredProviders.push(provider);
            const rootFolder: vscode.WorkspaceFolder | undefined = this.RootFolder;
            if (!rootFolder) {
                return; // There is no c_cpp_properties.json to edit because there is no folder open.
            }
            this.configuration.handleConfigurationChange();
            const selectedProvider: string | undefined = this.configuration.CurrentConfigurationProvider;
            if (!selectedProvider) {
                const ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("Client.registerProvider", true, rootFolder);
                // If c_cpp_properties.json and settings.json are both missing, reset our prompt
                if (!fs.existsSync(`${this.RootPath}/.vscode/c_cpp_properties.json`) && !fs.existsSync(`${this.RootPath}/.vscode/settings.json`)) {
                    ask.Value = true;
                }
                if (ask.Value) {
                    ui.showConfigureCustomProviderMessage(async () => {
                        const message: string = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1)
                            ? localize("provider.configure.folder", "{0} would like to configure IntelliSense for the '{1}' folder.", provider.name, this.Name)
                            : localize("provider.configure.this.folder", "{0} would like to configure IntelliSense for this folder.", provider.name);
                        const allow: string = localize("allow.button", "Allow");
                        const dontAllow: string = localize("dont.allow.button", "Don't Allow");
                        const askLater: string = localize("ask.me.later.button", "Ask Me Later");
                        return vscode.window.showInformationMessage(message, allow, dontAllow, askLater).then(async result => {
                            switch (result) {
                                case allow: {
                                    await this.configuration.updateCustomConfigurationProvider(provider.extensionId);
                                    onRegistered();
                                    ask.Value = false;
                                    telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": provider.extensionId });
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
                    }, () => ask.Value = false);
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
        return this.notifyWhenLanguageClientReady(() => {
            if (!this.configurationProvider) {
                this.clearCustomConfigurations();
                return;
            }
            const currentProvider: CustomConfigurationProvider1 | undefined = getCustomConfigProviders().get(this.configurationProvider);
            if (!currentProvider) {
                this.clearCustomConfigurations();
                return;
            }
            if (requestingProvider && requestingProvider.extensionId !== currentProvider.extensionId) {
                // If we are being called by a configuration provider other than the current one, ignore it.
                return;
            }
            if (!currentProvider.isReady) {
                return;
            }

            this.clearCustomConfigurations();
            this.handleRemoveAllCodeAnalysisProblems();
            this.trackedDocuments.forEach(document => {
                this.provideCustomConfiguration(document.uri, undefined, true);
            });
        });
    }

    public updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Promise<void> {
        return this.notifyWhenLanguageClientReady(() => {
            if (!this.configurationProvider) {
                return;
            }
            console.log("updateCustomBrowseConfiguration");
            const currentProvider: CustomConfigurationProvider1 | undefined = getCustomConfigProviders().get(this.configurationProvider);
            if (!currentProvider || !currentProvider.isReady || (requestingProvider && requestingProvider.extensionId !== currentProvider.extensionId)) {
                return;
            }

            const tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
            const task: () => Thenable<WorkspaceBrowseConfiguration | null> = async () => {
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
                if (!config) {
                    return;
                }
                if (currentProvider.version < Version.v3) {
                    // This is to get around the (fixed) CMake Tools bug: https://github.com/microsoft/vscode-cmake-tools/issues/1073
                    for (const c of config.browsePath) {
                        if (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(c)) === this.RootFolder) {
                            this.sendCustomBrowseConfiguration(config, currentProvider.extensionId, currentProvider.version);
                            break;
                        }
                    }
                } else {
                    this.sendCustomBrowseConfiguration(config, currentProvider.extensionId, currentProvider.version);
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
                    this.sendCustomBrowseConfiguration(null, undefined, Version.v0, true);
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
        await this.awaitUntilLanguageClientReady();
        const response: GetDiagnosticsResult = await this.languageClient.sendRequest(GetDiagnosticsRequest, null);
        const diagnosticsChannel: vscode.OutputChannel = getDiagnosticsChannel();
        diagnosticsChannel.clear();

        const header: string = `-------- Diagnostics - ${new Date().toLocaleString()}\n`;
        const version: string = `Version: ${util.packageJson.version}\n`;
        let configJson: string = "";
        if (this.configuration.CurrentConfiguration) {
            configJson = `Current Configuration:\n${JSON.stringify(this.configuration.CurrentConfiguration, null, 4)}\n`;
        }

        // Get diagnostics for configuration provider info.
        let configurationLoggingStr: string = "";
        const tuSearchStart: number = response.diagnostics.indexOf("Translation Unit Mappings:");
        if (tuSearchStart >= 0) {
            const tuSearchEnd: number = response.diagnostics.indexOf("Translation Unit Configurations:");
            if (tuSearchEnd >= 0 && tuSearchEnd > tuSearchStart) {
                let tuSearchString: string = response.diagnostics.substring(tuSearchStart, tuSearchEnd);
                let tuSearchIndex: number = tuSearchString.indexOf("[");
                while (tuSearchIndex >= 0) {
                    const tuMatch: RegExpMatchArray | null = tuSearchString.match(/\[\s(.*)\s\]/);
                    if (tuMatch && tuMatch.length > 1) {
                        const tuPath: string = vscode.Uri.file(tuMatch[1]).toString();
                        if (this.configurationLogging.has(tuPath)) {
                            if (configurationLoggingStr.length === 0) {
                                configurationLoggingStr += "Custom configurations:\n";
                            }
                            configurationLoggingStr += `[ ${tuMatch[1]} ]\n${this.configurationLogging.get(tuPath)}\n`;
                        }
                    }
                    tuSearchString = tuSearchString.substring(tuSearchIndex + 1);
                    tuSearchIndex = tuSearchString.indexOf("[");
                }
            }
        }
        diagnosticsChannel.appendLine(`${header}${version}${configJson}${this.browseConfigurationLogging}${configurationLoggingStr}${response.diagnostics}`);
        diagnosticsChannel.show(false);
    }

    public async rescanFolder(): Promise<void> {
        await this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(RescanFolderNotification));
    }

    public async provideCustomConfiguration(docUri: vscode.Uri, requestFile?: string, replaceExisting?: boolean): Promise<void> {
        const onFinished: () => void = () => {
            if (requestFile) {
                this.languageClient.sendNotification(FinishedRequestCustomConfig, { uri: requestFile });
            }
        };
        const providerId: string | undefined = this.configurationProvider;
        if (!providerId) {
            onFinished();
            return;
        }
        const provider: CustomConfigurationProvider1 | undefined = getCustomConfigProviders().get(providerId);
        if (!provider || !provider.isReady) {
            onFinished();
            return;
        }
        telemetry.logLanguageServerEvent('provideCustomConfiguration', { providerId });

        return this.queueBlockingTask(async () => {
            const tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
            console.log("provideCustomConfiguration");

            const providerName: string = provider.name;

            const params: QueryTranslationUnitSourceParams = {
                uri: docUri.toString(),
                ignoreExisting: !!replaceExisting,
                workspaceFolderUri: this.RootUri?.toString()
            };
            const response: QueryTranslationUnitSourceResult = await this.languageClient.sendRequest(QueryTranslationUnitSourceRequest, params);
            if (!response.candidates || response.candidates.length === 0) {
                // If we didn't receive any candidates, no configuration is needed.
                onFinished();
                return;
            }

            // Need to loop through candidates, to see if we can get a custom configuration from any of them.
            // Wrap all lookups in a single task, so we can apply a timeout to the entire duration.
            const provideConfigurationAsync: () => Thenable<SourceFileConfigurationItem[] | null | undefined> = async () => {
                const uris: vscode.Uri[] = [];
                for (let i: number = 0; i < response.candidates.length; ++i) {
                    const candidate: string = response.candidates[i];
                    const tuUri: vscode.Uri = vscode.Uri.parse(candidate);
                    try {
                        if (await provider.canProvideConfiguration(tuUri, tokenSource.token)) {
                            uris.push(tuUri);
                        }
                    } catch (err) {
                        console.warn("Caught exception from canProvideConfiguration");
                    }
                }
                if (!uris.length) {
                    return [];
                }
                let configs: util.Mutable<SourceFileConfigurationItem>[] = [];
                try {
                    configs = await provider.provideConfigurations(uris, tokenSource.token);
                } catch (err) {
                    console.warn("Caught exception from provideConfigurations");
                }

                if (configs && configs.length > 0 && configs[0]) {
                    const fileConfiguration: configs.Configuration | undefined = this.configuration.CurrentConfiguration;
                    if (fileConfiguration?.mergeConfigurations) {
                        configs.forEach(config => {
                            if (fileConfiguration.includePath) {
                                fileConfiguration.includePath.forEach(p => {
                                    if (!config.configuration.includePath.includes(p)) {
                                        config.configuration.includePath.push(p);
                                    }
                                });
                            }

                            if (fileConfiguration.defines) {
                                fileConfiguration.defines.forEach(d => {
                                    if (!config.configuration.defines.includes(d)) {
                                        config.configuration.defines.push(d);
                                    }
                                });
                            }

                            if (!config.configuration.forcedInclude) {
                                config.configuration.forcedInclude = [];
                            }

                            if (fileConfiguration.forcedInclude) {
                                fileConfiguration.forcedInclude.forEach(i => {
                                    if (config.configuration.forcedInclude) {
                                        if (!config.configuration.forcedInclude.includes(i)) {
                                            config.configuration.forcedInclude.push(i);
                                        }
                                    }
                                });
                            }
                        });
                    }
                    return configs as SourceFileConfigurationItem[];
                }
                if (tokenSource.token.isCancellationRequested) {
                    return null;
                }
            };
            const configs: SourceFileConfigurationItem[] | null | undefined = await this.callTaskWithTimeout(provideConfigurationAsync, configProviderTimeout, tokenSource);
            try {
                if (configs && configs.length > 0) {
                    this.sendCustomConfigurations(configs, provider.version);
                }
                onFinished();
            } catch (err) {
                if (requestFile) {
                    onFinished();
                    return;
                }
                const settings: CppSettings = new CppSettings(this.RootUri);
                if (settings.configurationWarnings === true && !this.isExternalHeader(docUri) && !vscode.debug.activeDebugSession) {
                    const dismiss: string = localize("dismiss.button", "Dismiss");
                    const disable: string = localize("diable.warnings.button", "Disable Warnings");
                    const configName: string | undefined = this.configuration.CurrentConfiguration?.name;
                    if (!configName) {
                        return;
                    }
                    let message: string = localize("unable.to.provide.configuration",
                        "{0} is unable to provide IntelliSense configuration information for '{1}'. Settings from the '{2}' configuration will be used instead.",
                        providerName, docUri.fsPath, configName);
                    if (err) {
                        message += ` (${err})`;
                    }

                    vscode.window.showInformationMessage(message, dismiss, disable).then(response => {
                        switch (response) {
                            case disable: {
                                settings.toggleSetting("configurationWarnings", "enabled", "disabled");
                                break;
                            }
                        }
                    });
                }
            }
        });
    }

    private async handleRequestCustomConfig(requestFile: string): Promise<void> {
        await this.provideCustomConfiguration(vscode.Uri.file(requestFile), requestFile);
    }

    private isExternalHeader(uri: vscode.Uri): boolean {
        const rootUri: vscode.Uri | undefined = this.RootUri;
        return !rootUri || (util.isHeaderFile(uri) && !uri.toString().startsWith(rootUri.toString()));
    }

    public getCurrentConfigName(): Thenable<string | undefined> {
        return this.queueTask(() => Promise.resolve(this.configuration.CurrentConfiguration?.name));
    }

    public getCurrentConfigCustomVariable(variableName: string): Thenable<string> {
        return this.queueTask(() => Promise.resolve(this.configuration.CurrentConfiguration?.customConfigurationVariables?.[variableName] || ''));
    }

    public setCurrentConfigName(configurationName: string): Thenable<void> {
        return this.queueTask(() => new Promise((resolve, reject) => {
            const configurations: configs.Configuration[] = this.configuration.Configurations || [];
            const configurationIndex: number = configurations.findIndex((config) => config.name === configurationName);

            if (configurationIndex !== -1) {
                this.configuration.select(configurationIndex);
                resolve();
            } else {
                reject(new Error(localize("config.not.found", "The requested configuration name is not found: {0}", configurationName)));
            }
        }));
    }

    public getCurrentCompilerPathAndArgs(): Thenable<util.CompilerPathAndArgs | undefined> {
        const settings: CppSettings = new CppSettings(this.RootUri);
        return this.queueTask(() => Promise.resolve(
            util.extractCompilerPathAndArgs(!!settings.legacyCompilerArgsBehavior,
                this.configuration.CurrentConfiguration?.compilerPath,
                this.configuration.CurrentConfiguration?.compilerArgs)
        ));
    }

    public getVcpkgInstalled(): Thenable<boolean> {
        return this.queueTask(() => Promise.resolve(this.configuration.VcpkgInstalled));
    }

    public getVcpkgEnabled(): Thenable<boolean> {
        const cppSettings: CppSettings = new CppSettings(this.RootUri);
        return Promise.resolve(cppSettings.vcpkgEnabled === true);
    }

    public getKnownCompilers(): Thenable<configs.KnownCompiler[] | undefined> {
        return this.queueTask(() => Promise.resolve(this.configuration.KnownCompiler));
    }

    /**
     * Take ownership of a document that was previously serviced by another client.
     * This process involves sending a textDocument/didOpen message to the server so
     * that it knows about the file, as well as adding it to this client's set of
     * tracked documents.
     */
    public async takeOwnership(document: vscode.TextDocument): Promise<void> {
        this.trackedDocuments.add(document);
        this.updateActiveDocumentTextOptions();
        await this.requestWhenReady(() => this.sendDidOpen(document));
    }

    public async sendDidOpen(document: vscode.TextDocument): Promise<void> {
        const params: DidOpenTextDocumentParams = {
            textDocument: {
                uri: document.uri.toString(),
                languageId: document.languageId,
                version: document.version,
                text: document.getText()
            }
        };
        await this.languageClient.sendNotification(DidOpenNotification, params);
    }

    /**
     * wait until the all pendingTasks are complete (e.g. language client is ready for use)
     * before attempting to send messages or operate on the client.
     */

    public async queueTask<T>(task: () => Thenable<T>): Promise<T> {
        if (this.isSupported) {
            const nextTask: () => Promise<T> = async () => {
                try {
                    return await task();
                } catch (err) {
                    console.error(err);
                    throw err;
                }
            };
            if (pendingTask && !pendingTask.Done) {
                // We don't want the queue to stall because of a rejected promise.
                try {
                    await pendingTask.getPromise();
                } catch (e) { }
            } else {
                pendingTask = undefined;
            }
            return nextTask();
        } else {
            throw new Error(localize("unsupported.client", "Unsupported client"));
        }
    }

    /**
     * Queue a task that blocks all future tasks until it completes. This is currently only intended to be used
     * during language client startup and for custom configuration providers.
     * @param task The task that blocks all future tasks
     */
    private async queueBlockingTask<T>(task: () => Thenable<T>): Promise<T> {
        if (this.isSupported) {
            pendingTask = new util.BlockingTask<T>(task, pendingTask);
            return pendingTask.getPromise();
        } else {
            throw new Error(localize("unsupported.client", "Unsupported client"));
        }
    }

    private callTaskWithTimeout<T>(task: () => Thenable<T>, ms: number, cancelToken?: vscode.CancellationTokenSource): Promise<T> {
        let timer: NodeJS.Timer;
        // Create a promise that rejects in <ms> milliseconds
        const timeout: () => Promise<T> = () => new Promise<T>((resolve, reject) => {
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

    public requestWhenReady<T>(request: () => Thenable<T>): Promise<T> {
        return this.queueTask(request);
    }

    public notifyWhenLanguageClientReady<T>(notify: () => T): Promise<T> {
        const task: () => Promise<T> = () => new Promise<T>(resolve => {
            resolve(notify());
        });
        return this.queueTask(task);
    }

    public awaitUntilLanguageClientReady(): Promise<void> {
        const task: () => Thenable<void> = () => new Promise<void>(resolve => {
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
        this.languageClient.onNotification(UpdateTrustedCompilersNotification, (e) => util.addTrustedCompiler(compilerPaths, e.compilerPath));
        this.languageClient.onNotification(LogTelemetryNotification, logTelemetry);
        this.languageClient.onNotification(ReportStatusNotification, (e) => this.updateStatus(e));
        this.languageClient.onNotification(ReportTagParseStatusNotification, (e) => this.updateTagParseStatus(e));
        this.languageClient.onNotification(InactiveRegionNotification, (e) => this.updateInactiveRegions(e));
        this.languageClient.onNotification(CompileCommandsPathsNotification, (e) => this.promptCompileCommands(e));
        this.languageClient.onNotification(ReferencesNotification, (e) => this.processReferencesResult(e));
        this.languageClient.onNotification(ReportReferencesProgressNotification, (e) => this.handleReferencesProgress(e));
        this.languageClient.onNotification(RequestCustomConfig, (requestFile: string) => {
            const client: Client = clients.getClientFor(vscode.Uri.file(requestFile));
            if (client instanceof DefaultClient) {
                const defaultClient: DefaultClient = <DefaultClient>client;
                defaultClient.handleRequestCustomConfig(requestFile);
            }
        });
        this.languageClient.onNotification(PublishIntelliSenseDiagnosticsNotification, publishIntelliSenseDiagnostics);
        this.languageClient.onNotification(PublishRefactorDiagnosticsNotification, publishRefactorDiagnostics);
        RegisterCodeAnalysisNotifications(this.languageClient);
        this.languageClient.onNotification(ShowMessageWindowNotification, showMessageWindow);
        this.languageClient.onNotification(ShowWarningNotification, showWarning);
        this.languageClient.onNotification(ReportTextDocumentLanguage, (e) => this.setTextDocumentLanguage(e));
        this.languageClient.onNotification(SemanticTokensChanged, (e) => this.semanticTokensProvider?.invalidateFile(e));
        this.languageClient.onNotification(InlayHintsChanged, (e) => this.inlayHintsProvider?.invalidateFile(e));
        this.languageClient.onNotification(IntelliSenseSetupNotification, (e) => this.logIntellisenseSetupTime(e));
        this.languageClient.onNotification(SetTemporaryTextDocumentLanguageNotification, (e) => this.setTemporaryTextDocumentLanguage(e));
        this.languageClient.onNotification(ReportCodeAnalysisProcessedNotification, (e) => this.updateCodeAnalysisProcessed(e));
        this.languageClient.onNotification(ReportCodeAnalysisTotalNotification, (e) => this.updateCodeAnalysisTotal(e));
        this.languageClient.onNotification(DoxygenCommentGeneratedNotification, (e) => this.insertDoxygenComment(e));
    }

    private setTextDocumentLanguage(languageStr: string): void {
        const cppSettings: CppSettings = new CppSettings();
        if (cppSettings.autoAddFileAssociations) {
            const is_c: boolean = languageStr.startsWith("c;");
            const is_cuda: boolean = languageStr.startsWith("cu;");
            languageStr = languageStr.substring(is_c ? 2 : (is_cuda ? 3 : 1));
            this.addFileAssociations(languageStr, is_c ? "c" : (is_cuda ? "cuda-cpp" : "cpp"));
        }
    }

    private async setTemporaryTextDocumentLanguage(params: SetTemporaryTextDocumentLanguageParams): Promise<void> {
        const languageId: string = params.isC ? "c" : (params.isCuda ? "cuda-cpp" : "cpp");
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(params.path);
        if (!!document && document.languageId !== languageId) {
            if (document.languageId === "cpp" && languageId === "c") {
                handleChangedFromCppToC(document);
            }
            vscode.languages.setTextDocumentLanguage(document, languageId);
        }
    }

    private associations_for_did_change?: Set<string>;

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

            this.rootPathFileWatcher.onDidCreate(async (uri) => {
                if (uri.scheme !== 'file') {
                    return;
                }
                const fileName: string = path.basename(uri.fsPath).toLowerCase();
                if (fileName === ".editorconfig") {
                    cachedEditorConfigSettings.clear();
                    cachedEditorConfigLookups.clear();
                    this.updateActiveDocumentTextOptions();
                }
                if (fileName === ".clang-format" || fileName === "_clang-format") {
                    cachedEditorConfigLookups.clear();
                }

                this.languageClient.sendNotification(FileCreatedNotification, { uri: uri.toString() });
            });

            // TODO: Handle new associations without a reload.
            this.associations_for_did_change = new Set<string>(["cu", "cuh", "c", "i", "cpp", "cc", "cxx", "c++", "cp", "hpp", "hh", "hxx", "h++", "hp", "h", "ii", "ino", "inl", "ipp", "tcc", "idl"]);
            const assocs: any = new OtherSettings().filesAssociations;
            for (const assoc in assocs) {
                const dotIndex: number = assoc.lastIndexOf('.');
                if (dotIndex !== -1) {
                    const ext: string = assoc.substring(dotIndex + 1);
                    this.associations_for_did_change.add(ext);
                }
            }
            this.rootPathFileWatcher.onDidChange(async (uri) => {
                if (uri.scheme !== 'file') {
                    return;
                }
                const dotIndex: number = uri.fsPath.lastIndexOf('.');
                const fileName: string = path.basename(uri.fsPath).toLowerCase();
                if (fileName === ".editorconfig") {
                    cachedEditorConfigSettings.clear();
                    cachedEditorConfigLookups.clear();
                    this.updateActiveDocumentTextOptions();
                }
                if (dotIndex !== -1) {
                    const ext: string = uri.fsPath.substring(dotIndex + 1);
                    if (this.associations_for_did_change?.has(ext)) {
                        // VS Code has a bug that causes onDidChange events to happen to files that aren't changed,
                        // which causes a large backlog of "files to parse" to accumulate.
                        // We workaround this via only sending the change message if the modified time is within 10 seconds.
                        const mtime: Date = fs.statSync(uri.fsPath).mtime;
                        const duration: number = Date.now() - mtime.getTime();
                        if (duration < 10000) {
                            this.languageClient.sendNotification(FileChangedNotification, { uri: uri.toString() });
                        }
                    }
                }
            });

            this.rootPathFileWatcher.onDidDelete((uri) => {
                if (uri.scheme !== 'file') {
                    return;
                }
                const fileName: string = path.basename(uri.fsPath).toLowerCase();
                if (fileName === ".editorconfig") {
                    cachedEditorConfigSettings.clear();
                    cachedEditorConfigLookups.clear();
                }
                if (fileName === ".clang-format" || fileName === "_clang-format") {
                    cachedEditorConfigLookups.clear();
                }
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

    public addFileAssociations(fileAssociations: string, languageId: string): void {
        const settings: OtherSettings = new OtherSettings();
        const assocs: any = settings.filesAssociations;

        let foundNewAssociation: boolean = false;
        const filesAndPaths: string[] = fileAssociations.split(";");
        for (let i: number = 0; i < filesAndPaths.length; ++i) {
            const fileAndPath: string[] = filesAndPaths[i].split("@");
            // Skip empty or malformed
            if (fileAndPath.length === 2) {
                const file: string = fileAndPath[0];
                const filePath: string = fileAndPath[1];
                if ((file in assocs) || (("**/" + file) in assocs)) {
                    continue; // File already has an association.
                }
                const j: number = file.lastIndexOf('.');
                if (j !== -1) {
                    const ext: string = file.substring(j);
                    if ((("*" + ext) in assocs) || (("**/*" + ext) in assocs)) {
                        continue; // Extension already has an association.
                    }
                }
                let foundGlobMatch: boolean = false;
                for (const assoc in assocs) {
                    if (minimatch(filePath, assoc)) {
                        foundGlobMatch = true;
                        break; // Assoc matched a glob pattern.
                    }
                }
                if (foundGlobMatch) {
                    continue;
                }
                assocs[file] = languageId;
                foundNewAssociation = true;
            }
        }
        if (foundNewAssociation) {
            settings.filesAssociations = assocs;
        }
    }

    private updateStatus(notificationBody: ReportStatusNotificationBody): void {
        const message: string = notificationBody.status;
        util.setProgress(util.getProgressExecutableSuccess());
        const testHook: TestHook = getTestHook();
        if (message.endsWith("Idle")) {
            // nothing to do
        } else if (message.endsWith("Parsing")) {
            this.model.isParsingWorkspace.Value = true;
            this.model.isInitializingWorkspace.Value = false;
            this.model.isIndexingWorkspace.Value = false;
            this.model.isParsingWorkspacePausable.Value = false;
            const status: IntelliSenseStatus = { status: Status.TagParsingBegun };
            testHook.updateStatus(status);
        } else if (message.endsWith("Initializing")) {
            if (ui.isNewUI) {
                this.model.isInitializingWorkspace.Value = true;
            } else {
                this.model.isParsingWorkspace.Value = true;
            }
        } else if (message.endsWith("Indexing")) {
            if (ui.isNewUI) {
                this.model.isIndexingWorkspace.Value = true;
                this.model.isInitializingWorkspace.Value = false;
            } else {
                this.model.isParsingWorkspace.Value = true;
            }
        } else if (message.endsWith("files")) {
            this.model.isParsingFiles.Value = true;
        } else if (message.endsWith("IntelliSense")) {
            timeStamp = Date.now();
            this.model.isUpdatingIntelliSense.Value = true;
            const status: IntelliSenseStatus = { status: Status.IntelliSenseCompiling };
            testHook.updateStatus(status);
        } else if (message.endsWith("IntelliSense done")) {
            const settings: CppSettings = new CppSettings();
            if (settings.loggingLevel === "Debug") {
                const out: Logger = getOutputChannelLogger();
                const duration: number = Date.now() - timeStamp;
                out.appendLine(localize("update.intellisense.time", "Update IntelliSense time (sec): {0}", duration / 1000));
            }
            this.model.isUpdatingIntelliSense.Value = false;
            const status: IntelliSenseStatus = { status: Status.IntelliSenseReady };
            testHook.updateStatus(status);
        } else if (message.endsWith("Parsing done")) { // Tag Parser Ready
            this.model.isParsingWorkspace.Value = false;
            const status: IntelliSenseStatus = { status: Status.TagParsingDone };
            testHook.updateStatus(status);
            util.setProgress(util.getProgressParseRootSuccess());
        } else if (message.endsWith("files done")) {
            this.model.isParsingFiles.Value = false;
        } else if (message.endsWith("Analysis")) {
            this.model.isRunningCodeAnalysis.Value = true;
            this.model.codeAnalysisTotal.Value = 1;
            this.model.codeAnalysisProcessed.Value = 0;
        } else if (message.endsWith("Analysis done")) {
            this.model.isRunningCodeAnalysis.Value = false;
        } else if (message.includes("Squiggles Finished - File name:")) {
            const index: number = message.lastIndexOf(":");
            const name: string = message.substring(index + 2);
            const status: IntelliSenseStatus = { status: Status.IntelliSenseReady, filename: name };
            testHook.updateStatus(status);
        } else if (message.endsWith("No Squiggles")) {
            util.setIntelliSenseProgress(util.getProgressIntelliSenseNoSquiggles());
        } else if (message.endsWith("Unresolved Headers")) {
            if (notificationBody.workspaceFolderUri) {
                const client: Client = clients.getClientFor(vscode.Uri.file(notificationBody.workspaceFolderUri));
                if (client instanceof DefaultClient) {
                    const defaultClient: DefaultClient = <DefaultClient>client;
                    if (!defaultClient.configuration.CurrentConfiguration?.configurationProvider) {
                        const showIntelliSenseFallbackMessage: PersistentState<boolean> = new PersistentState<boolean>("CPP.showIntelliSenseFallbackMessage", true);
                        if (showIntelliSenseFallbackMessage.Value) {
                            ui.showConfigureIncludePathMessage(async () => {
                                const configJSON: string = localize("configure.json.button", "Configure (JSON)");
                                const configUI: string = localize("configure.ui.button", "Configure (UI)");
                                const dontShowAgain: string = localize("dont.show.again", "Don't Show Again");
                                const fallbackMsg: string = defaultClient.configuration.VcpkgInstalled ?
                                    localize("update.your.intellisense.settings", "Update your IntelliSense settings or use Vcpkg to install libraries to help find missing headers.") :
                                    localize("configure.your.intellisense.settings", "Configure your IntelliSense settings to help find missing headers.");
                                return vscode.window.showInformationMessage(fallbackMsg, configJSON, configUI, dontShowAgain).then(async (value) => {
                                    let commands: string[];
                                    switch (value) {
                                        case configJSON:
                                            commands = await vscode.commands.getCommands(true);
                                            if (commands.indexOf("workbench.action.problems.focus") >= 0) {
                                                vscode.commands.executeCommand("workbench.action.problems.focus");
                                            }
                                            defaultClient.handleConfigurationEditJSONCommand();
                                            telemetry.logLanguageServerEvent("SettingsCommand", { "toast": "json" }, undefined);
                                            break;
                                        case configUI:
                                            commands = await vscode.commands.getCommands(true);
                                            if (commands.indexOf("workbench.action.problems.focus") >= 0) {
                                                vscode.commands.executeCommand("workbench.action.problems.focus");
                                            }
                                            defaultClient.handleConfigurationEditUICommand();
                                            telemetry.logLanguageServerEvent("SettingsCommand", { "toast": "ui" }, undefined);
                                            break;
                                        case dontShowAgain:
                                            showIntelliSenseFallbackMessage.Value = false;
                                            break;
                                    }
                                    return true;
                                });
                            }, () => showIntelliSenseFallbackMessage.Value = false);
                        }
                    }
                }
            }
        }
    }

    private updateTagParseStatus(tagParseStatus: TagParseStatus): void {
        this.model.parsingWorkspaceStatus.Value = getLocalizedString(tagParseStatus.localizeStringParams);
        this.model.isParsingWorkspacePausable.Value = tagParseStatus.isPausable;
        this.model.isParsingWorkspacePaused.Value = tagParseStatus.isPaused;
    }

    private updateInactiveRegions(params: InactiveRegionParams): void {
        const settings: CppSettings = new CppSettings(this.RootUri);
        const opacity: number | undefined = settings.inactiveRegionOpacity;
        if (opacity !== null && opacity !== undefined) {
            let backgroundColor: string | undefined = settings.inactiveRegionBackgroundColor;
            if (backgroundColor === "") {
                backgroundColor = undefined;
            }
            let color: string | undefined = settings.inactiveRegionForegroundColor;
            if (color === "") {
                color = undefined;
            }
            const decoration: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
                opacity: opacity.toString(),
                backgroundColor: backgroundColor,
                color: color,
                rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
            });
            // We must convert to vscode.Ranges in order to make use of the API's
            const ranges: vscode.Range[] = params.regions.map(element => new vscode.Range(element.startLine, 0, element.endLine, 0));
            // Find entry for cached file and act accordingly
            const valuePair: DecorationRangesPair | undefined = this.inactiveRegionsDecorations.get(params.uri);
            if (valuePair) {
                // Disposing of and resetting the decoration will undo previously applied text decorations
                valuePair.decoration.dispose();
                valuePair.decoration = decoration;
                // As vscode.TextEditor.setDecorations only applies to visible editors, we must cache the range for when another editor becomes visible
                valuePair.ranges = ranges;
            } else { // The entry does not exist. Make a new one
                const toInsert: DecorationRangesPair = {
                    decoration: decoration,
                    ranges: ranges
                };
                this.inactiveRegionsDecorations.set(params.uri, toInsert);
            }
            if (settings.dimInactiveRegions && params.fileVersion === openFileVersions.get(params.uri)) {
                // Apply the decorations to all *visible* text editors
                const editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === params.uri);
                for (const e of editors) {
                    e.setDecorations(decoration, ranges);
                }
            }
        }
        if (this.codeFoldingProvider) {
            this.codeFoldingProvider.refresh();
        }
    }

    public logIntellisenseSetupTime(notification: IntelliSenseSetup): void {
        clients.timeTelemetryCollector.setSetupTime(vscode.Uri.parse(notification.uri));
    }

    private promptCompileCommands(params: CompileCommandsPaths): void {
        if (!params.workspaceFolderUri) {
            return;
        }
        const potentialClient: Client = clients.getClientFor(vscode.Uri.file(params.workspaceFolderUri));
        if (!(potentialClient instanceof DefaultClient)) {
            return;
        }
        const client: DefaultClient = <DefaultClient>potentialClient;
        if (client.configuration.CurrentConfiguration?.compileCommands || client.configuration.CurrentConfiguration?.configurationProvider) {
            return;
        }
        const rootFolder: vscode.WorkspaceFolder | undefined = client.RootFolder;
        if (!rootFolder) {
            return;
        }

        const ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("CPP.showCompileCommandsSelection", true, rootFolder);
        if (!ask.Value) {
            return;
        }

        const aCompileCommandsFile: string = localize("a.compile.commands.file", "a compile_commands.json file");
        const compileCommandStr: string = params.paths.length > 1 ? aCompileCommandsFile : params.paths[0];
        const message: string = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1)
            ? localize("auto-configure.intellisense.folder", "Would you like to use {0} to auto-configure IntelliSense for the '{1}' folder?", compileCommandStr, client.Name)
            : localize("auto-configure.intellisense.this.folder", "Would you like to use {0} to auto-configure IntelliSense for this folder?", compileCommandStr);

        ui.showConfigureCompileCommandsMessage(async () => {
            const yes: string = localize("yes.button", "Yes");
            const no: string = localize("no.button", "No");
            const askLater: string = localize("ask.me.later.button", "Ask Me Later");
            return vscode.window.showInformationMessage(message, yes, no, askLater).then(async (value) => {
                switch (value) {
                    case yes:
                        if (params.paths.length > 1) {
                            const index: number = await ui.showCompileCommands(params.paths);
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
    public requestSwitchHeaderSource(rootUri: vscode.Uri, fileName: string): Thenable<string> {
        const params: SwitchHeaderSourceParams = {
            switchHeaderSourceFileName: fileName,
            workspaceFolderUri: rootUri.toString()
        };
        return this.requestWhenReady(() => this.languageClient.sendRequest(SwitchHeaderSourceRequest, params));
    }

    public requestCompiler(compilerPath: string[]): Thenable<configs.CompilerDefaults> {
        const params: QueryDefaultCompilerParams = {
            trustedCompilerPaths: compilerPath
        };
        return this.languageClient.sendRequest(QueryCompilerDefaultsRequest, params);
    }

    private updateActiveDocumentTextOptions(): void {
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (editor?.document?.uri.scheme === "file"
            && (editor.document.languageId === "c"
                || editor.document.languageId === "cpp"
                || editor.document.languageId === "cuda-cpp")) {
            vscode.commands.executeCommand('setContext', 'BuildAndDebug.isSourceFile', util.isCppOrCFile(editor.document.uri));
            vscode.commands.executeCommand('setContext', 'BuildAndDebug.isFolderOpen', util.isFolderOpen(editor.document.uri));
            // If using vcFormat, check for a ".editorconfig" file, and apply those text options to the active document.
            const settings: CppSettings = new CppSettings(this.RootUri);
            if (settings.useVcFormat(editor.document)) {
                const editorConfigSettings: any = getEditorConfigSettings(editor.document.uri.fsPath);
                if (editorConfigSettings.indent_style === "space" || editorConfigSettings.indent_style === "tab") {
                    editor.options.insertSpaces = editorConfigSettings.indent_style === "space";
                    if (editorConfigSettings.indent_size === "tab") {
                        if (!editorConfigSettings.tab_width !== undefined) {
                            editor.options.tabSize = editorConfigSettings.tab_width;
                        }
                    } else if (editorConfigSettings.indent_size !== undefined) {
                        editor.options.tabSize = editorConfigSettings.indent_size;
                    }
                }
                if (editorConfigSettings.end_of_line !== undefined) {
                    editor.edit((edit) => {
                        edit.setEndOfLine(editorConfigSettings.end_of_line === "lf" ? vscode.EndOfLine.LF : vscode.EndOfLine.CRLF);
                    });
                }
            }
        } else {
            vscode.commands.executeCommand('setContext', 'BuildAndDebug.isSourceFile', false);
        }
    }

    /**
     * notifications to the language server
     */
    public async activeDocumentChanged(document: vscode.TextDocument): Promise<void> {
        this.updateActiveDocumentTextOptions();
        await this.awaitUntilLanguageClientReady();
        this.languageClient.sendNotification(ActiveDocumentChangeNotification, this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document));
    }

    /**
     * send notifications to the language server to restart IntelliSense for the selected file.
     */
    public async restartIntelliSenseForFile(document: vscode.TextDocument): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        this.languageClient.sendNotification(RestartIntelliSenseForFileNotification, this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document));
    }

    /**
     * enable UI updates from this client and resume tag parsing on the server.
     */
    public activate(): void {
        this.model.activate();
        this.resumeParsing();
    }

    public selectionChanged(selection: Range): void {
        this.notifyWhenLanguageClientReady(() => {
            this.languageClient.sendNotification(TextEditorSelectionChangeNotification, selection);
        });
    }

    public resetDatabase(): void {
        this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(ResetDatabaseNotification));
    }

    /**
     * disable UI updates from this client and pause tag parsing on the server.
     */
    public deactivate(): void {
        this.model.deactivate();
    }

    public pauseParsing(): void {
        this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(PauseParsingNotification));
    }

    public resumeParsing(): void {
        this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(ResumeParsingNotification));
    }

    public PauseCodeAnalysis(): void {
        this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(PauseCodeAnalysisNotification));
        this.model.isCodeAnalysisPaused.Value = true;
    }

    public ResumeCodeAnalysis(): void {
        this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(ResumeCodeAnalysisNotification));
        this.model.isCodeAnalysisPaused.Value = false;
    }

    public CancelCodeAnalysis(): void {
        this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(CancelCodeAnalysisNotification));
    }

    private updateCodeAnalysisProcessed(processed: number): void {
        this.model.codeAnalysisProcessed.Value = processed;
    }

    private updateCodeAnalysisTotal(total: number): void {
        this.model.codeAnalysisTotal.Value = total;
    }

    private async insertDoxygenComment(result: GenerateDoxygenCommentResult): Promise<void> {
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const currentFileVersion: number | undefined = openFileVersions.get(editor.document.uri.toString());
        // Insert the comment only if the cursor has not moved
        if (result.fileVersion === currentFileVersion &&
            result.initPosition.line === editor.selection.start.line &&
            result.initPosition.character === editor.selection.start.character &&
            result.contents.length > 1) {
            const workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
            const edits: vscode.TextEdit[] = [];
            const maxColumn: number = 99999999;
            const newRange: vscode.Range = new vscode.Range(editor.selection.start.line, 0, editor.selection.end.line, maxColumn);
            edits.push(new vscode.TextEdit(newRange, result?.contents));
            workspaceEdit.set(editor.document.uri, edits);
            await vscode.workspace.applyEdit(workspaceEdit);

            // Set the cursor position after @brief
            const newPosition: vscode.Position = new vscode.Position(result.finalCursorPosition.line, result.finalCursorPosition.character);
            const newSelection: vscode.Selection = new vscode.Selection(newPosition, newPosition);
            editor.selection = newSelection;
        }
    }

    private doneInitialCustomBrowseConfigurationCheck: boolean = false;

    private async onConfigurationsChanged(cppProperties: configs.CppProperties): Promise<void> {
        if (!cppProperties.Configurations) {
            return;
        }
        const configurations: configs.Configuration[] = cppProperties.Configurations;
        const params: CppPropertiesParams = {
            configurations: [],
            currentConfiguration: this.configuration.CurrentConfigurationIndex,
            workspaceFolderUri: this.RootUri?.toString(),
            isReady: true
        };
        const settings: CppSettings = new CppSettings(this.RootUri);
        // Clone each entry, as we make modifications before sending it, and don't
        // want to add those modifications to the original objects.
        configurations.forEach((c) => {
            const modifiedConfig: configs.Configuration = { ...c };
            // Separate compiler path and args before sending to language client
            const compilerPathAndArgs: util.CompilerPathAndArgs =
                util.extractCompilerPathAndArgs(!!settings.legacyCompilerArgsBehavior, c.compilerPath, c.compilerArgs);
            modifiedConfig.compilerPath = compilerPathAndArgs.compilerPath;
            if (settings.legacyCompilerArgsBehavior) {
                modifiedConfig.compilerArgsLegacy = compilerPathAndArgs.allCompilerArgs;
                modifiedConfig.compilerArgs = undefined;
            } else {
                modifiedConfig.compilerArgs = compilerPathAndArgs.allCompilerArgs;
            }

            params.configurations.push(modifiedConfig);
        });

        await this.languageClient.sendRequest(ChangeCppPropertiesRequest, params);
        const lastCustomBrowseConfigurationProviderId: PersistentFolderState<string | undefined> | undefined = cppProperties.LastCustomBrowseConfigurationProviderId;
        const lastCustomBrowseConfigurationProviderVersion: PersistentFolderState<Version> | undefined = cppProperties.LastCustomBrowseConfigurationProviderVersion;
        const lastCustomBrowseConfiguration: PersistentFolderState<WorkspaceBrowseConfiguration | undefined> | undefined = cppProperties.LastCustomBrowseConfiguration;
        if (!!lastCustomBrowseConfigurationProviderId && !!lastCustomBrowseConfiguration && !!lastCustomBrowseConfigurationProviderVersion) {
            if (!this.doneInitialCustomBrowseConfigurationCheck) {
                // Send the last custom browse configuration we received from this provider.
                // This ensures we don't start tag parsing without it, and undo'ing work we have to re-do when the (likely same) browse config arrives
                // Should only execute on launch, for the initial delivery of configurations
                if (lastCustomBrowseConfiguration.Value) {
                    this.sendCustomBrowseConfiguration(lastCustomBrowseConfiguration.Value, lastCustomBrowseConfigurationProviderId.Value, lastCustomBrowseConfigurationProviderVersion.Value);
                    params.isReady = false;
                }
                this.doneInitialCustomBrowseConfigurationCheck = true;
            }
        }
        const configName: string | undefined = configurations[params.currentConfiguration].name ?? "";
        this.model.activeConfigName.setValueIfActive(configName);
        const newProvider: string | undefined = this.configuration.CurrentConfigurationProvider;
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
        const params: FolderSelectedSettingParams = {
            currentConfiguration: index,
            workspaceFolderUri: this.RootUri?.toString()
        };
        this.notifyWhenLanguageClientReady(() => {
            this.languageClient.sendNotification(ChangeSelectedSettingNotification, params);
            let configName: string = "";
            if (this.configuration.ConfigurationNames) {
                configName = this.configuration.ConfigurationNames[index];
            }
            this.model.activeConfigName.Value = configName;
            this.configuration.onDidChangeSettings();
        });
    }

    private onCompileCommandsChanged(path: string): void {
        const params: FileChangedParams = {
            uri: vscode.Uri.file(path).toString(),
            workspaceFolderUri: this.RootUri?.toString()
        };
        this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(ChangeCompileCommandsNotification, params));
    }

    private isSourceFileConfigurationItem(input: any, providerVersion: Version): input is SourceFileConfigurationItem {
        // IntelliSenseMode and standard are optional for version 5+.
        let areOptionalsValid: boolean = false;
        if (providerVersion < Version.v5) {
            areOptionalsValid = util.isString(input.configuration.intelliSenseMode) && util.isString(input.configuration.standard);
        } else {
            areOptionalsValid = util.isOptionalString(input.configuration.intelliSenseMode) && util.isOptionalString(input.configuration.standard);
        }
        return (input && (util.isString(input.uri) || util.isUri(input.uri)) &&
            input.configuration &&
            areOptionalsValid &&
            util.isArrayOfString(input.configuration.includePath) &&
            util.isArrayOfString(input.configuration.defines) &&
            util.isOptionalArrayOfString(input.configuration.compilerArgs) &&
            util.isOptionalArrayOfString(input.configuration.forcedInclude));
    }

    private sendCustomConfigurations(configs: any, providerVersion: Version): void {
        // configs is marked as 'any' because it is untrusted data coming from a 3rd-party. We need to sanitize it before sending it to the language server.
        if (!configs || !(configs instanceof Array)) {
            console.warn("discarding invalid SourceFileConfigurationItems[]: " + configs);
            return;
        }

        const settings: CppSettings = new CppSettings();
        const out: Logger = getOutputChannelLogger();
        if (settings.loggingLevel === "Debug") {
            out.appendLine(localize("configurations.received", "Custom configurations received:"));
        }
        const sanitized: SourceFileConfigurationItemAdapter[] = [];
        configs.forEach(item => {
            if (this.isSourceFileConfigurationItem(item, providerVersion)) {
                let uri: string;
                if (util.isString(item.uri) && !item.uri.startsWith("file://")) {
                    // If the uri field is a string, it may actually contain an fsPath.
                    uri = vscode.Uri.file(item.uri).toString();
                } else {
                    uri = item.uri.toString();
                }
                this.configurationLogging.set(uri, JSON.stringify(item.configuration, null, 4));
                if (settings.loggingLevel === "Debug") {
                    out.appendLine(`  uri: ${uri}`);
                    out.appendLine(`  config: ${JSON.stringify(item.configuration, null, 2)}`);
                }
                if (item.configuration.includePath.some(path => path.endsWith('**'))) {
                    console.warn("custom include paths should not use recursive includes ('**')");
                }
                // Separate compiler path and args before sending to language client
                const itemConfig: util.Mutable<InternalSourceFileConfiguration> = { ...item.configuration };
                if (util.isString(itemConfig.compilerPath)) {
                    const compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(
                        providerVersion < Version.v6,
                        itemConfig.compilerPath,
                        util.isArrayOfString(itemConfig.compilerArgs) ? itemConfig.compilerArgs : undefined);
                    itemConfig.compilerPath = compilerPathAndArgs.compilerPath;
                    if (itemConfig.compilerPath !== undefined) {
                        util.addTrustedCompiler(compilerPaths, itemConfig.compilerPath);
                    }
                    if (providerVersion < Version.v6) {
                        itemConfig.compilerArgsLegacy = compilerPathAndArgs.allCompilerArgs;
                        itemConfig.compilerArgs = undefined;
                    } else {
                        itemConfig.compilerArgs = compilerPathAndArgs.allCompilerArgs;
                    }
                }
                sanitized.push({
                    uri,
                    configuration: itemConfig
                });
            } else {
                console.warn("discarding invalid SourceFileConfigurationItem: " + JSON.stringify(item));
            }
        });

        if (sanitized.length === 0) {
            return;
        }

        const params: CustomConfigurationParams = {
            configurationItems: sanitized,
            workspaceFolderUri: this.RootUri?.toString()
        };

        this.languageClient.sendNotification(CustomConfigurationNotification, params);
    }

    private browseConfigurationLogging: string = "";
    private configurationLogging: Map<string, string> = new Map<string, string>();

    private isWorkspaceBrowseConfiguration(input: any): boolean {
        return util.isArrayOfString(input.browsePath) &&
            util.isOptionalString(input.compilerPath) &&
            util.isOptionalString(input.standard) &&
            util.isOptionalArrayOfString(input.compilerArgs) &&
            util.isOptionalString(input.windowsSdkVersion);
    }

    private sendCustomBrowseConfiguration(config: any, providerId: string | undefined, providerVersion: Version, timeoutOccured?: boolean): void {
        const rootFolder: vscode.WorkspaceFolder | undefined = this.RootFolder;
        if (!rootFolder) {
            return;
        }
        const lastCustomBrowseConfiguration: PersistentFolderState<WorkspaceBrowseConfiguration | undefined> = new PersistentFolderState<WorkspaceBrowseConfiguration | undefined>("CPP.lastCustomBrowseConfiguration", undefined, rootFolder);
        const lastCustomBrowseConfigurationProviderId: PersistentFolderState<string | undefined> = new PersistentFolderState<string | undefined>("CPP.lastCustomBrowseConfigurationProviderId", undefined, rootFolder);
        let sanitized: util.Mutable<InternalWorkspaceBrowseConfiguration>;

        this.browseConfigurationLogging = "";

        // This while (true) is here just so we can break out early if the config is set on error
        while (true) {
            // config is marked as 'any' because it is untrusted data coming from a 3rd-party. We need to sanitize it before sending it to the language server.
            if (timeoutOccured || !config || config instanceof Array) {
                if (!timeoutOccured) {
                    console.log("Received an invalid browse configuration from configuration provider.");
                }
                const configValue: WorkspaceBrowseConfiguration | undefined = lastCustomBrowseConfiguration.Value;
                if (configValue) {
                    sanitized = configValue;
                    console.log("Falling back to last received browse configuration: ", JSON.stringify(sanitized, null, 2));
                    break;
                }
                console.log("No browse configuration is available.");
                return;
            }

            sanitized = { ...<InternalWorkspaceBrowseConfiguration>config };
            if (!this.isWorkspaceBrowseConfiguration(sanitized)) {
                console.log("Received an invalid browse configuration from configuration provider: " + JSON.stringify(sanitized));
                const configValue: WorkspaceBrowseConfiguration | undefined = lastCustomBrowseConfiguration.Value;
                if (configValue) {
                    sanitized = configValue;
                    console.log("Falling back to last received browse configuration: ", JSON.stringify(sanitized, null, 2));
                    break;
                }
                return;
            }

            const settings: CppSettings = new CppSettings();
            if (settings.loggingLevel === "Debug") {
                const out: Logger = getOutputChannelLogger();
                out.appendLine(localize("browse.configuration.received", "Custom browse configuration received: {0}", JSON.stringify(sanitized, null, 2)));
            }

            // Separate compiler path and args before sending to language client
            if (util.isString(sanitized.compilerPath)) {
                const compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(
                    providerVersion < Version.v6,
                    sanitized.compilerPath,
                    util.isArrayOfString(sanitized.compilerArgs) ? sanitized.compilerArgs : undefined);
                sanitized.compilerPath = compilerPathAndArgs.compilerPath;
                if (sanitized.compilerPath !== undefined) {
                    util.addTrustedCompiler(compilerPaths, sanitized.compilerPath);
                }
                if (providerVersion < Version.v6) {
                    sanitized.compilerArgsLegacy = compilerPathAndArgs.allCompilerArgs;
                    sanitized.compilerArgs = undefined;
                } else {
                    sanitized.compilerArgs = compilerPathAndArgs.allCompilerArgs;
                }
            }

            lastCustomBrowseConfiguration.Value = sanitized;
            if (!providerId) {
                lastCustomBrowseConfigurationProviderId.setDefault();
            } else {
                lastCustomBrowseConfigurationProviderId.Value = providerId;
            }
            break;
        }

        this.browseConfigurationLogging = `Custom browse configuration: \n${JSON.stringify(sanitized, null, 4)}\n`;

        const params: CustomBrowseConfigurationParams = {
            browseConfiguration: sanitized,
            workspaceFolderUri: this.RootUri?.toString()
        };

        this.languageClient.sendNotification(CustomBrowseConfigurationNotification, params);
    }

    private clearCustomConfigurations(): void {
        this.configurationLogging.clear();
        const params: WorkspaceFolderParams = {
            workspaceFolderUri: this.RootUri?.toString()
        };
        this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(ClearCustomConfigurationsNotification, params));
    }

    private clearCustomBrowseConfiguration(): void {
        this.browseConfigurationLogging = "";
        const params: WorkspaceFolderParams = {
            workspaceFolderUri: this.RootUri?.toString()
        };
        this.notifyWhenLanguageClientReady(() => this.languageClient.sendNotification(ClearCustomBrowseConfigurationNotification, params));
    }

    /**
     * command handlers
     */
    public async handleConfigurationSelectCommand(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        const configNames: string[] | undefined = this.configuration.ConfigurationNames;
        if (configNames) {
            const index: number = await ui.showConfigurations(configNames);
            if (index < 0) {
                return;
            }
            this.configuration.select(index);
        }
    }

    public async handleConfigurationProviderSelectCommand(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        const extensionId: string | undefined = await ui.showConfigurationProviders(this.configuration.CurrentConfigurationProvider);
        if (extensionId === undefined) {
            // operation was canceled.
            return;
        }
        await this.configuration.updateCustomConfigurationProvider(extensionId);
        if (extensionId) {
            const provider: CustomConfigurationProvider1 | undefined = getCustomConfigProviders().get(extensionId);
            this.updateCustomBrowseConfiguration(provider);
            this.updateCustomConfigurations(provider);
            telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": extensionId });
        } else {
            this.clearCustomConfigurations();
            this.clearCustomBrowseConfiguration();
        }
    }

    public async handleShowParsingCommands(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        const index: number = await ui.showParsingCommands();
        if (index === 0) {
            this.pauseParsing();
        } else if (index === 1) {
            this.resumeParsing();
        }
    }

    public async handleShowActiveCodeAnalysisCommands(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        const index: number = await ui.showActiveCodeAnalysisCommands();
        switch (index) {
            case 0: this.CancelCodeAnalysis(); break;
            case 1: this.PauseCodeAnalysis(); break;
            case 2: this.ResumeCodeAnalysis(); break;
            case 3: this.handleShowIdleCodeAnalysisCommands(); break;
        }
    }

    public async handleShowIdleCodeAnalysisCommands(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        const index: number = await ui.showIdleCodeAnalysisCommands();
        switch (index) {
            case 0: this.handleRunCodeAnalysisOnActiveFile(); break;
            case 1: this.handleRunCodeAnalysisOnAllFiles(); break;
            case 2: this.handleRunCodeAnalysisOnOpenFiles(); break;
        }
    }

    public handleConfigurationEditCommand(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): void {
        this.notifyWhenLanguageClientReady(() => this.configuration.handleConfigurationEditCommand(undefined, vscode.window.showTextDocument, viewColumn));
    }

    public handleConfigurationEditJSONCommand(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): void {
        this.notifyWhenLanguageClientReady(() => this.configuration.handleConfigurationEditJSONCommand(undefined, vscode.window.showTextDocument, viewColumn));
    }

    public handleConfigurationEditUICommand(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): void {
        this.notifyWhenLanguageClientReady(() => this.configuration.handleConfigurationEditUICommand(undefined, vscode.window.showTextDocument, viewColumn));
    }

    public handleAddToIncludePathCommand(path: string): void {
        this.notifyWhenLanguageClientReady(() => this.configuration.addToIncludePathCommand(path));
    }

    public async handleGoToDirectiveInGroup(next: boolean): Promise<void> {
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (editor) {
            const params: GoToDirectiveInGroupParams = {
                uri: editor.document.uri.toString(),
                position: editor.selection.active,
                next: next
            };
            await this.awaitUntilLanguageClientReady();
            const response: Position | undefined = await this.languageClient.sendRequest(GoToDirectiveInGroupRequest, params);
            if (response) {
                const p: vscode.Position = new vscode.Position(response.line, response.character);
                const r: vscode.Range = new vscode.Range(p, p);

                // Check if still the active document.
                const currentEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
                if (currentEditor && editor.document.uri === currentEditor.document.uri) {
                    currentEditor.selection = new vscode.Selection(r.start, r.end);
                    currentEditor.revealRange(r);
                }
            }
        }
    }

    public async handleGenerateDoxygenComment(args: DoxygenCodeActionCommandArguments | vscode.Uri | undefined): Promise<void> {
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        if (editor.document.uri.scheme !== "file") {
            return;
        }

        if (!(editor.document.languageId === "c" || editor.document.languageId === "cpp" || editor.document.languageId === "cuda-cpp")) {
            return;
        }

        let codeActionArguments: DoxygenCodeActionCommandArguments | undefined;
        if (args !== undefined && !(args instanceof vscode.Uri)) {
            codeActionArguments = args;
        }
        const initCursorPosition: vscode.Position = (codeActionArguments !== undefined) ? new vscode.Position(codeActionArguments.initialCursor.line, codeActionArguments.initialCursor.character) : editor.selection.start;
        const params: GenerateDoxygenCommentParams = {
            uri: editor.document.uri.toString(),
            position: (codeActionArguments !== undefined) ? new vscode.Position(codeActionArguments.adjustedCursor.line, codeActionArguments.adjustedCursor.character) : editor.selection.start,
            isCodeAction: codeActionArguments !== undefined,
            isCursorAboveSignatureLine: codeActionArguments?.isCursorAboveSignatureLine
        };
        await this.awaitUntilLanguageClientReady();
        const currentFileVersion: number | undefined = openFileVersions.get(params.uri);
        if (currentFileVersion === undefined) {
            return;
        }
        const result: GenerateDoxygenCommentResult | undefined = await this.languageClient.sendRequest(GenerateDoxygenCommentRequest, params);
        // Insert the comment only if the comment has contents and the cursor has not moved
        if (result !== undefined &&
            initCursorPosition.line === editor.selection.start.line &&
            initCursorPosition.character === editor.selection.start.character &&
            result.fileVersion !== undefined &&
            result.fileVersion === currentFileVersion &&
            result.contents && result.contents.length > 1) {
            const workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
            const edits: vscode.TextEdit[] = [];
            const maxColumn: number = 99999999;
            let newRange: vscode.Range;
            const cursorOnEmptyLineAboveSignature: boolean = result.isCursorAboveSignatureLine;
            // The reason why we need to set different range is because if cursor is immediately above the signature line, we want the comments to be inserted at the line of cursor and to replace everything on the line.
            // If the cursor is on the signature line or is inside the boby, the comment will be inserted on the same line of the signature and it shouldn't replace the content of the signature line.
            if (cursorOnEmptyLineAboveSignature) {
                if (codeActionArguments !== undefined) {
                    // The reson why we cannot use finalInsertionLine is because the line number sent from the result is not correct.
                    // In most cases, the finalInsertionLine is the line of the signature line.
                    newRange = new vscode.Range(initCursorPosition.line, 0, initCursorPosition.line, maxColumn);
                } else {
                    newRange = new vscode.Range(result.finalInsertionLine, 0, result.finalInsertionLine, maxColumn);
                }
            } else {
                newRange = new vscode.Range(result.finalInsertionLine, 0, result.finalInsertionLine, 0);
            }
            edits.push(new vscode.TextEdit(newRange, result?.contents));
            workspaceEdit.set(editor.document.uri, edits);
            await vscode.workspace.applyEdit(workspaceEdit);
            // Set the cursor position after @brief
            let newPosition: vscode.Position;
            if (cursorOnEmptyLineAboveSignature && codeActionArguments !== undefined) {
                newPosition = new vscode.Position(result.finalCursorPosition.line - 1, result.finalCursorPosition.character);
            } else {
                newPosition = new vscode.Position(result.finalCursorPosition.line, result.finalCursorPosition.character);
            }
            const newSelection: vscode.Selection = new vscode.Selection(newPosition, newPosition);
            editor.selection = newSelection;
        }

    }

    public async handleCheckForCompiler(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        const compilers: configs.KnownCompiler[] | undefined = await this.getKnownCompilers();
        if (!compilers || compilers.length === 0) {
            const compilerName: string = process.platform === "win32" ? "MSVC" : (process.platform === "darwin" ? "Clang" : "GCC");
            vscode.window.showInformationMessage(localize("no.compilers.found", "No C++ compilers were found on your system. For your platform, we recommend installing {0} using the instructions in the editor.", compilerName), { modal: true });
        } else {
            const header: string = localize("compilers.found", "We found the following C++ compilers on your system. Choose a compiler in your project's IntelliSense Configuration.");
            let message: string = "";
            const settings: CppSettings = new CppSettings(this.RootUri);
            const pathSeparator: string | undefined = settings.preferredPathSeparator;
            let isFirstLine: boolean = true;
            compilers.forEach(compiler => {
                if (isFirstLine) {
                    isFirstLine = false;
                } else {
                    message += "\n";
                }
                if (pathSeparator !== "Forward Slash") {
                    message += compiler.path.replace(/\//g, '\\');
                } else {
                    message += compiler.path.replace(/\\/g, '/');
                }
            });
            vscode.window.showInformationMessage(header, { modal: true, detail: message });
        }
    }

    public async handleRunCodeAnalysisOnActiveFile(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        this.languageClient.sendNotification(CodeAnalysisNotification, { scope: CodeAnalysisScope.ActiveFile });
    }

    public async handleRunCodeAnalysisOnOpenFiles(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        this.languageClient.sendNotification(CodeAnalysisNotification, { scope: CodeAnalysisScope.OpenFiles });
    }

    public async handleRunCodeAnalysisOnAllFiles(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        this.languageClient.sendNotification(CodeAnalysisNotification, { scope: CodeAnalysisScope.AllFiles });
    }

    public async handleRemoveAllCodeAnalysisProblems(): Promise<void> {
        await this.awaitUntilLanguageClientReady();
        if (removeAllCodeAnalysisProblems()) {
            this.languageClient.sendNotification(CodeAnalysisNotification, { scope: CodeAnalysisScope.ClearSquiggles });
        }
    }

    public async handleFixCodeAnalysisProblems(workspaceEdit: vscode.WorkspaceEdit, refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> {
        if (await vscode.workspace.applyEdit(workspaceEdit)) {
            const settings: CppSettings = new CppSettings(this.RootUri);
            if (settings.clangTidyCodeActionFormatFixes) {
                const editedFiles: Set<vscode.Uri> = new Set<vscode.Uri>();
                for (const entry of workspaceEdit.entries()) {
                    editedFiles.add(entry[0]);
                }
                const formatEdits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                for (const uri of editedFiles) {
                    const formatTextEdits: vscode.TextEdit[] | undefined = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>("vscode.executeFormatDocumentProvider", uri, { onChanges: true });
                    if (formatTextEdits && formatTextEdits.length > 0) {
                        formatEdits.set(uri, formatTextEdits);
                    }
                }
                if (formatEdits.size > 0) {
                    await vscode.workspace.applyEdit(formatEdits);
                }
            }
            return this.handleRemoveCodeAnalysisProblems(refreshSquigglesOnSave, identifiersAndUris);
        }
    }

    public async handleRemoveCodeAnalysisProblems(refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> {
        await this.awaitUntilLanguageClientReady();

        // A deep copy is needed because the call to identifiers.splice below can
        // remove elements in identifiersAndUris[...].identifiers.
        const identifiersAndUrisCopy: CodeAnalysisDiagnosticIdentifiersAndUri[] = [];
        for (const identifiersAndUri of identifiersAndUris) {
            identifiersAndUrisCopy.push({ uri: identifiersAndUri.uri, identifiers: [...identifiersAndUri.identifiers] });
        }

        if (removeCodeAnalysisProblems(identifiersAndUris)) {
            // Need to notify the language client of the removed diagnostics so it doesn't re-send them.
            this.languageClient.sendNotification(RemoveCodeAnalysisProblemsNotification, {
                identifiersAndUris: identifiersAndUrisCopy, refreshSquigglesOnSave: refreshSquigglesOnSave
            });
        }
    }

    public async handleDisableAllTypeCodeAnalysisProblems(code: string,
        identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> {
        const settings: CppSettings = new CppSettings(this.RootUri);
        const codes: string[] = code.split(',');
        for (const code of codes) {
            settings.addClangTidyChecksDisabled(code);
        }
        this.handleRemoveCodeAnalysisProblems(false, identifiersAndUris);
    }

    public async handleCreateDeclarationOrDefinition(): Promise<void> {
        let range: vscode.Range | undefined;
        let uri: vscode.Uri | undefined;
        // range is based on the cursor position.
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (editor) {
            uri = editor.document.uri;
            if (editor.selection.isEmpty) {
                range = new vscode.Range(editor.selection.active, editor.selection.active);
            } else if (editor.selection.isReversed) {
                range = new vscode.Range(editor.selection.active, editor.selection.anchor);
            } else {
                range = new vscode.Range(editor.selection.anchor, editor.selection.active);
            }
        }

        if (uri === undefined || range === undefined) {
            return;
        }

        const params: CreateDeclarationOrDefinitionParams = {
            uri: uri.toString(),
            range: {
                start: {
                    character: range.start.character,
                    line: range.start.line
                },
                end: {
                    character: range.end.character,
                    line: range.end.line
                }
            }
        };

        const result: CreateDeclarationOrDefinitionResult = await this.languageClient.sendRequest(CreateDeclarationOrDefinitionRequest, params);
        // TODO: return specific errors info in result.
        if (result.changes === undefined) {
            return;
        }

        const workspaceEdits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
        let modifiedDocument: vscode.Uri | undefined;
        let lastEdit: vscode.TextEdit | undefined;
        let editPositionAdjustment: number = 0;
        let selectionPositionAdjustment: number = 0;
        for (const file in result.changes) {
            const uri: vscode.Uri = vscode.Uri.file(file);
            // At most, there will only be two text edits:
            // 1.) an edit for: #include header file
            // 2.) an edit for: definition or declaration
            for (const edit of result.changes[file]) {
                const range: vscode.Range = makeVscodeRange(edit.range);
                // Get new lines from an edit for: #include header file.
                if (lastEdit && lastEdit.newText.includes("#include")) {
                    if (lastEdit.range.isEqual(range)) {
                        // Destination file is empty.
                        // The edit positions for #include header file and definition or declaration are the same.
                        selectionPositionAdjustment = (lastEdit.newText.match(/\n/g) || []).length;
                    } else {
                        // Destination file is not empty.
                        // VS Code workspace.applyEdit calculates the position of subsequent edits.
                        // That is, the positions of text edits that are originally calculated by the language server
                        // are adjusted based on the number of text edits applied by VS Code workspace.applyEdit.
                        // Since the language server's refactoring API already pre-calculates the positions of multiple text edits,
                        // re-adjust the new line of the next text edit for the VS Code applyEdit to calculate again.
                        editPositionAdjustment = (lastEdit.newText.match(/\n/g) || []).length;
                    }
                }
                lastEdit = new vscode.TextEdit(range, edit.newText);
                const position: vscode.Position = new vscode.Position(edit.range.start.line - editPositionAdjustment, edit.range.start.character);
                workspaceEdits.insert(uri, position, edit.newText);
            }
            modifiedDocument = uri;
        };

        if (modifiedDocument === undefined || lastEdit === undefined) {
            return;
        }

        // Apply the create declaration/definition text edits.
        await vscode.workspace.applyEdit(workspaceEdits);

        // Move the cursor to the new declaration/definition edit, accounting for \n or \n\n at the start.
        let startLine: number = lastEdit.range.start.line;
        let numNewlines: number = (lastEdit.newText.match(/\n/g) || []).length;
        if (lastEdit.newText.startsWith("\r\n\r\n") || lastEdit.newText.startsWith("\n\n")) {
            startLine += 2;
            numNewlines -= 2;
        } else if (lastEdit.newText.startsWith("\r\n") || lastEdit.newText.startsWith("\n")) {
            startLine += 1;
            numNewlines -= 1;
        }
        if (!lastEdit.newText.endsWith("\n")) {
            numNewlines++; // Increase the format range.
        }

        const selectionPosition: vscode.Position = new vscode.Position(startLine + selectionPositionAdjustment, 0);
        const selectionRange: vscode.Range = new vscode.Range(selectionPosition, selectionPosition);
        await vscode.window.showTextDocument(modifiedDocument, { selection: selectionRange });

        // Format the new text edits.
        const formatEdits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
        const formatRange: vscode.Range = new vscode.Range(selectionRange.start, new vscode.Position(selectionRange.start.line + numNewlines, 0));
        const settings: OtherSettings = new OtherSettings(vscode.workspace.getWorkspaceFolder(modifiedDocument)?.uri);
        const formatOptions: vscode.FormattingOptions = {
            insertSpaces: settings.editorInsertSpaces ?? true,
            tabSize: settings.editorTabSize ?? 4
        };
        const versionBeforeFormatting: number | undefined = openFileVersions.get(modifiedDocument.toString());
        if (versionBeforeFormatting === undefined) {
            return;
        }
        const formatTextEdits: vscode.TextEdit[] | undefined = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>("vscode.executeFormatRangeProvider", modifiedDocument, formatRange, formatOptions);
        if (formatTextEdits && formatTextEdits.length > 0) {
            formatEdits.set(modifiedDocument, formatTextEdits);
        }
        if (formatEdits.size === 0 || versionBeforeFormatting === undefined) {
            return;
        }
        // Only apply formatting if the document version hasn't changed to prevent
        // stale formatting results from being applied.
        const versionAfterFormatting: number | undefined = openFileVersions.get(modifiedDocument.toString());
        if (versionAfterFormatting === undefined || versionAfterFormatting > versionBeforeFormatting) {
            return;
        }
        await vscode.workspace.applyEdit(formatEdits);
    }

    public onInterval(): void {
        // These events can be discarded until the language client is ready.
        // Don't queue them up with this.notifyWhenLanguageClientReady calls.
        if (this.innerLanguageClient !== undefined && this.configuration !== undefined) {
            const params: IntervalTimerParams = {
                freeMemory: Math.floor(os.freemem() / 1048576)
            };
            this.languageClient.sendNotification(IntervalTimerNotification, params);
            this.configuration.checkCppProperties();
            this.configuration.checkCompileCommands();
        }
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        if (this.documentFormattingProviderDisposable) {
            this.documentFormattingProviderDisposable.dispose();
            this.documentFormattingProviderDisposable = undefined;
        }
        if (this.formattingRangeProviderDisposable) {
            this.formattingRangeProviderDisposable.dispose();
            this.formattingRangeProviderDisposable = undefined;
        }
        if (this.onTypeFormattingProviderDisposable) {
            this.onTypeFormattingProviderDisposable.dispose();
            this.onTypeFormattingProviderDisposable = undefined;
        }
        if (this.codeFoldingProviderDisposable) {
            this.codeFoldingProviderDisposable.dispose();
            this.codeFoldingProviderDisposable = undefined;
        }
        if (this.semanticTokensProviderDisposable) {
            this.semanticTokensProviderDisposable.dispose();
            this.semanticTokensProviderDisposable = undefined;
        }
        this.model.dispose();
    }

    public static stopLanguageClient(): Thenable<void> {
        return languageClient ? languageClient.stop() : Promise.resolve();
    }

    public handleReferencesIcon(): void {
        this.notifyWhenLanguageClientReady(() => {
            const cancelling: boolean = DefaultClient.referencesPendingCancellations.length > 0;
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
                            this.languageClient.sendNotification(RequestReferencesNotification);
                        }
                    }
                }
            }
        });
    }

    public cancelReferences(): void {
        DefaultClient.referencesParams = undefined;
        DefaultClient.renamePending = false;
        if (DefaultClient.referencesRequestPending || workspaceReferences.symbolSearchInProgress) {
            const cancelling: boolean = DefaultClient.referencesPendingCancellations.length > 0;
            DefaultClient.referencesPendingCancellations.push({
                reject: () => { },
                callback: () => { }
            });
            if (!cancelling) {
                workspaceReferences.referencesCanceled = true;
                languageClient.sendNotification(CancelReferencesNotification);
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
    const plat: NodeJS.Platform = process.platform;
    if (plat === 'win32') {
        extensionProcessName += '.exe';
    } else if (plat !== 'linux' && plat !== 'darwin') {
        throw "Invalid Platform";
    }
    return path.resolve(util.getExtensionFilePath("bin"), extensionProcessName);
}

class NullClient implements Client {
    private booleanEvent = new vscode.EventEmitter<boolean>();
    private numberEvent = new vscode.EventEmitter<number>();
    private stringEvent = new vscode.EventEmitter<string>();
    private referencesCommandModeEvent = new vscode.EventEmitter<refs.ReferencesCommandMode>();

    public get InitializingWorkspaceChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get IndexingWorkspaceChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get ParsingWorkspaceChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get ParsingWorkspacePausableChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get ParsingWorkspacePausedChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get ParsingFilesChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get IntelliSenseParsingChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get RunningCodeAnalysisChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get CodeAnalysisPausedChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get CodeAnalysisProcessedChanged(): vscode.Event<number> { return this.numberEvent.event; }
    public get CodeAnalysisTotalChanged(): vscode.Event<number> { return this.numberEvent.event; }
    public get ReferencesCommandModeChanged(): vscode.Event<refs.ReferencesCommandMode> { return this.referencesCommandModeEvent.event; }
    public get TagParserStatusChanged(): vscode.Event<string> { return this.stringEvent.event; }
    public get ActiveConfigChanged(): vscode.Event<string> { return this.stringEvent.event; }
    RootPath: string = "/";
    RootRealPath: string = "/";
    RootUri?: vscode.Uri = vscode.Uri.file("/");
    Name: string = "(empty)";
    TrackedDocuments = new Set<vscode.TextDocument>();
    onDidChangeSettings(event: vscode.ConfigurationChangeEvent): { [key: string]: string } { return {}; }
    onDidOpenTextDocument(document: vscode.TextDocument): void { }
    onDidCloseTextDocument(document: vscode.TextDocument): void { }
    onDidChangeVisibleTextEditor(editor: vscode.TextEditor): void { }
    onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void { }
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    provideCustomConfiguration(docUri: vscode.Uri, requestFile?: string, replaceExisting?: boolean): Promise<void> { return Promise.resolve(); }
    logDiagnostics(): Promise<void> { return Promise.resolve(); }
    rescanFolder(): Promise<void> { return Promise.resolve(); }
    toggleReferenceResultsView(): void { }
    setCurrentConfigName(configurationName: string): Thenable<void> { return Promise.resolve(); }
    getCurrentConfigName(): Thenable<string> { return Promise.resolve(""); }
    getCurrentConfigCustomVariable(variableName: string): Thenable<string> { return Promise.resolve(""); }
    getVcpkgInstalled(): Thenable<boolean> { return Promise.resolve(false); }
    getVcpkgEnabled(): Thenable<boolean> { return Promise.resolve(false); }
    getCurrentCompilerPathAndArgs(): Thenable<util.CompilerPathAndArgs | undefined> { return Promise.resolve(undefined); }
    getKnownCompilers(): Thenable<configs.KnownCompiler[] | undefined> { return Promise.resolve([]); }
    takeOwnership(document: vscode.TextDocument): Promise<void> { return Promise.resolve(); }
    sendDidOpen(document: vscode.TextDocument): Promise<void> { return Promise.resolve(); }
    queueTask<T>(task: () => Thenable<T>): Promise<T> { return Promise.resolve(task()); }
    requestWhenReady<T>(request: () => Thenable<T>): Promise<T> { return Promise.resolve(request()); }
    notifyWhenLanguageClientReady<T>(notify: () => T): Promise<T> { return Promise.resolve(notify()); }
    awaitUntilLanguageClientReady(): Promise<void> { return Promise.resolve(); }
    requestSwitchHeaderSource(rootUri: vscode.Uri, fileName: string): Thenable<string> { return Promise.resolve(""); }
    activeDocumentChanged(document: vscode.TextDocument): Promise<void> { return Promise.resolve(); }
    restartIntelliSenseForFile(document: vscode.TextDocument): Promise<void> { return Promise.resolve(); }
    activate(): void { }
    selectionChanged(selection: Range): void { }
    resetDatabase(): void { }
    promptSelectCompiler(command: boolean): Promise<void> { return Promise.resolve(); }
    deactivate(): void { }
    pauseParsing(): void { }
    resumeParsing(): void { }
    PauseCodeAnalysis(): void { }
    ResumeCodeAnalysis(): void { }
    CancelCodeAnalysis(): void { }
    handleConfigurationSelectCommand(): Promise<void> { return Promise.resolve(); }
    handleConfigurationProviderSelectCommand(): Promise<void> { return Promise.resolve(); }
    handleShowParsingCommands(): Promise<void> { return Promise.resolve(); }
    handleShowActiveCodeAnalysisCommands(): Promise<void> { return Promise.resolve(); }
    handleShowIdleCodeAnalysisCommands(): Promise<void> { return Promise.resolve(); }
    handleReferencesIcon(): void { }
    handleConfigurationEditCommand(viewColumn?: vscode.ViewColumn): void { }
    handleConfigurationEditJSONCommand(viewColumn?: vscode.ViewColumn): void { }
    handleConfigurationEditUICommand(viewColumn?: vscode.ViewColumn): void { }
    handleAddToIncludePathCommand(path: string): void { }
    handleGoToDirectiveInGroup(next: boolean): Promise<void> { return Promise.resolve(); }
    handleGenerateDoxygenComment(args: DoxygenCodeActionCommandArguments | vscode.Uri | undefined): Promise<void> { return Promise.resolve(); }
    handleCheckForCompiler(): Promise<void> { return Promise.resolve(); }
    handleRunCodeAnalysisOnActiveFile(): Promise<void> { return Promise.resolve(); }
    handleRunCodeAnalysisOnOpenFiles(): Promise<void> { return Promise.resolve(); }
    handleRunCodeAnalysisOnAllFiles(): Promise<void> { return Promise.resolve(); }
    handleRemoveAllCodeAnalysisProblems(): Promise<void> { return Promise.resolve(); }
    handleRemoveCodeAnalysisProblems(refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> { return Promise.resolve(); }
    handleFixCodeAnalysisProblems(workspaceEdit: vscode.WorkspaceEdit, refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> { return Promise.resolve(); }
    handleDisableAllTypeCodeAnalysisProblems(code: string, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> { return Promise.resolve(); }
    handleCreateDeclarationOrDefinition(): Promise<void> { return Promise.resolve(); }
    onInterval(): void { }
    dispose(): void {
        this.booleanEvent.dispose();
        this.stringEvent.dispose();
    }
    addFileAssociations(fileAssociations: string, languageId: string): void { }
    sendDidChangeSettings(): void { }
}
