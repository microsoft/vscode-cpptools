/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';

// Start provider imports
import { CallHierarchyProvider } from './Providers/callHierarchyProvider';
import { CodeActionProvider } from './Providers/codeActionProvider';
import { DocumentFormattingEditProvider } from './Providers/documentFormattingEditProvider';
import { DocumentRangeFormattingEditProvider } from './Providers/documentRangeFormattingEditProvider';
import { DocumentSymbolProvider } from './Providers/documentSymbolProvider';
import { FindAllReferencesProvider } from './Providers/findAllReferencesProvider';
import { FoldingRangeProvider } from './Providers/foldingRangeProvider';
import { CppInlayHint, InlayHintsProvider } from './Providers/inlayHintProvider';
import { OnTypeFormattingEditProvider } from './Providers/onTypeFormattingEditProvider';
import { RenameProvider } from './Providers/renameProvider';
import { SemanticToken, SemanticTokensProvider } from './Providers/semanticTokensProvider';
import { WorkspaceSymbolProvider } from './Providers/workspaceSymbolProvider';
// End provider imports

import { CodeSnippet, Trait } from '@github/copilot-language-server';
import { ok } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import { SourceFileConfiguration, SourceFileConfigurationItem, Version, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { IntelliSenseStatus, Status } from 'vscode-cpptools/out/testApi';
import { CloseAction, DidOpenTextDocumentParams, ErrorAction, LanguageClientOptions, NotificationType, Position, Range, RequestType, ResponseError, TextDocumentIdentifier, TextDocumentPositionParams } from 'vscode-languageclient';
import { LanguageClient, ServerOptions } from 'vscode-languageclient/node';
import * as nls from 'vscode-nls';
import { DebugConfigurationProvider } from '../Debugger/configurationProvider';
import { CustomConfigurationProvider1, getCustomConfigProviders, isSameProviderExtensionId } from '../LanguageServer/customProviders';
import { ManualPromise } from '../Utility/Async/manualPromise';
import { ManualSignal } from '../Utility/Async/manualSignal';
import { logAndReturn } from '../Utility/Async/returns';
import { is } from '../Utility/System/guards';
import * as util from '../common';
import { isWindows } from '../constants';
import { instrument, isInstrumentationEnabled } from '../instrumentation';
import { DebugProtocolParams, Logger, ShowWarningParams, getDiagnosticsChannel, getOutputChannelLogger, logDebugProtocol, logLocalized, showWarning } from '../logger';
import { localizedStringCount, lookupString } from '../nativeStrings';
import { SessionState } from '../sessionState';
import * as telemetry from '../telemetry';
import { TestHook, getTestHook } from '../testHook';
import { CopilotHoverProvider } from './Providers/CopilotHoverProvider';
import { HoverProvider } from './Providers/HoverProvider';
import {
    CodeAnalysisDiagnosticIdentifiersAndUri,
    RegisterCodeAnalysisNotifications,
    RemoveCodeAnalysisProblemsParams,
    removeAllCodeAnalysisProblems,
    removeCodeAnalysisProblems
} from './codeAnalysis';
import { Location, TextEdit, WorkspaceEdit } from './commonTypes';
import * as configs from './configurations';
import { CopilotCompletionContextFeatures, CopilotCompletionContextProvider } from './copilotCompletionContextProvider';
import { DataBinding } from './dataBinding';
import { cachedEditorConfigSettings, getEditorConfigSettings } from './editorConfig';
import { CppSourceStr, clients, configPrefix, initializeIntervalTimer, updateLanguageConfigurations, usesCrashHandler, watchForCrashes } from './extension';
import { LocalizeStringParams, getLocaleId, getLocalizedString } from './localization';
import { PersistentFolderState, PersistentState, PersistentWorkspaceState } from './persistentState';
import { RequestCancelled, ServerCancelled, createProtocolFilter } from './protocolFilter';
import * as refs from './references';
import { CppSettings, OtherSettings, SettingsParams, WorkspaceFolderSettingsParams } from './settings';
import { SettingsTracker } from './settingsTracker';
import { ConfigurationType, LanguageStatusUI, getUI } from './ui';
import { handleChangedFromCppToC, makeLspRange, makeVscodeLocation, makeVscodeRange, withCancellation } from './utils';
import minimatch = require("minimatch");

function deepCopy(obj: any) {
    return JSON.parse(JSON.stringify(obj));
}
nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

let ui: LanguageStatusUI;
let timeStamp: number = 0;
const configProviderTimeout: number = 2000;
let initializedClientCount: number = 0;

// Compiler paths that are known to be acceptable to execute.
const trustedCompilerPaths: string[] = [];
export function hasTrustedCompilerPaths(): boolean {
    return trustedCompilerPaths.length !== 0;
}

// Data shared by all clients.
let languageClient: LanguageClient;
let firstClientStarted: Promise<{ wasShutdown: boolean }>;
let languageClientCrashedNeedsRestart: boolean = false;
const languageClientCrashTimes: number[] = [];
let compilerDefaults: configs.CompilerDefaults | undefined;
let diagnosticsCollectionIntelliSense: vscode.DiagnosticCollection;
let diagnosticsCollectionRefactor: vscode.DiagnosticCollection;

interface ConfigStateReceived {
    compilers: boolean;
    compileCommands: boolean;
    configProviders?: CustomConfigurationProvider1[];
    timeout: boolean;
}

let workspaceHash: string = "";

let workspaceDisposables: vscode.Disposable[] = [];
export let workspaceReferences: refs.ReferencesManager;
export const openFileVersions: Map<string, number> = new Map<string, number>();
export const cachedEditorConfigLookups: Map<string, boolean> = new Map<string, boolean>();
export let semanticTokensLegend: vscode.SemanticTokensLegend | undefined;

export function disposeWorkspaceData(): void {
    workspaceDisposables.forEach((d) => d.dispose());
    workspaceDisposables = [];
}

/** Note: We should not await on the following functions,
 * or any function that returns a promise acquired from them,
 * vscode.window.showInformationMessage, vscode.window.showWarningMessage, vscode.window.showErrorMessage
*/
function showMessageWindow(params: ShowMessageWindowParams): void {
    const message: string = getLocalizedString(params.localizeStringParams);
    switch (params.type) {
        case 1: // Error
            void vscode.window.showErrorMessage(message);
            break;
        case 2: // Warning
            void vscode.window.showWarningMessage(message);
            break;
        case 3: // Info
            void vscode.window.showInformationMessage(message);
            break;
        default:
            console.assert("Unrecognized type for showMessageWindow");
            break;
    }
}

function publishRefactorDiagnostics(params: PublishRefactorDiagnosticsParams): void {
    if (!diagnosticsCollectionRefactor) {
        diagnosticsCollectionRefactor = vscode.languages.createDiagnosticCollection(configPrefix + "Refactor");
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

interface SelectionParams {
    uri: string;
    range: Range;
}

export interface VsCodeUriAndRange {
    uri: vscode.Uri;
    range: vscode.Range;
}

interface WorkspaceEditResult {
    workspaceEdits: WorkspaceEdit[];
    errorText?: string;
}

interface TelemetryPayload {
    event: string;
    properties?: Record<string, string>;
    metrics?: Record<string, number>;
}

interface ReportStatusNotificationBody extends WorkspaceFolderParams {
    status: string;
}

interface QueryDefaultCompilerParams {
    newTrustedCompilerPath: string;
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

interface InternalSourceFileConfiguration extends SourceFileConfiguration {
    compilerArgsLegacy?: string[];
}

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

interface PublishRefactorDiagnosticsParams {
    uri: string;
    diagnostics: RefactorDiagnostic[];
}

export interface CreateDeclarationOrDefinitionParams extends SelectionParams {
    formatParams: FormatParams;
    copyToClipboard: boolean;
}

export interface CreateDeclarationOrDefinitionResult extends WorkspaceEditResult {
    clipboardText?: string;
}

export interface ExtractToFunctionParams extends SelectionParams {
    extractAsGlobal: boolean;
    name: string;
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

export interface FormatParams extends SelectionParams {
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

export interface IntelliSenseResult {
    uri: string;
    fileVersion: number;
    diagnostics: IntelliSenseDiagnostic[];
    inactiveRegions: InputRegion[];
    semanticTokens: SemanticToken[];
    inlayHints: CppInlayHint[];
    clearExistingDiagnostics: boolean;
    clearExistingInactiveRegions: boolean;
    clearExistingSemanticTokens: boolean;
    clearExistingInlayHint: boolean;
    isCompletePass: boolean;
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
    static = 0b001,
    global = 0b010,
    local = 0b100
}

interface IntelliSenseSetup {
    uri: string;
}

interface GoToDirectiveInGroupParams {
    uri: string;
    position: Position;
    next: boolean;
}

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
}

interface SetTemporaryTextDocumentLanguageParams {
    uri: string;
    isC: boolean;
    isCuda: boolean;
}

enum CodeAnalysisScope {
    ActiveFile,
    OpenFiles,
    AllFiles,
    ClearSquiggles
}

interface CodeAnalysisParams {
    scope: CodeAnalysisScope;
}

interface FinishedRequestCustomConfigParams {
    uri: string;
    isProviderRegistered: boolean;
}

export interface TextDocumentWillSaveParams {
    textDocument: TextDocumentIdentifier;
    reason: vscode.TextDocumentSaveReason;
}

interface LspInitializationOptions {
    loggingLevel: number;
}

interface CppInitializationParams {
    packageVersion: string;
    extensionPath: string;
    cacheStoragePath: string;
    workspaceStoragePath: string;
    databaseStoragePath: string;
    vcpkgRoot: string;
    intelliSenseCacheDisabled: boolean;
    caseSensitiveFileSupport: boolean;
    resetDatabase: boolean;
    edgeMessagesDirectory: string;
    localizedStrings: string[];
    settings: SettingsParams;
}

interface CppInitializationResult {
    shouldShutdown: boolean;
}

interface TagParseStatus {
    localizeStringParams: LocalizeStringParams;
    isPaused: boolean;
}

interface DidChangeVisibleTextEditorsParams {
    activeUri?: string;
    activeSelection?: Range;
    visibleRanges?: { [uri: string]: Range[] };
}

interface DidChangeTextEditorVisibleRangesParams {
    uri: string;
    visibleRanges: Range[];
}

interface DidChangeActiveEditorParams {
    uri?: string;
    selection?: Range;
}

interface GetIncludesParams {
    fileUri: string;
    maxDepth: number;
}

export interface GetIncludesResult {
    includedFiles: string[];
}

export interface GetCopilotHoverInfoParams {
    textDocument: TextDocumentIdentifier;
    position: Position;
}

export interface GetCopilotHoverInfoResult {
    content: string;
    files: string[];
}

export interface ChatContextResult {
    language: string;
    standardVersion: string;
    compiler: string;
    targetPlatform: string;
    targetArchitecture: string;
    usedTestFrameworks: string[];
}

interface FolderFilesEncodingChanged {
    uri: string;
    filesEncoding: string;
}

interface FilesEncodingChanged {
    workspaceFallbackEncoding?: string;
    foldersFilesEncoding: FolderFilesEncodingChanged[];
}

export interface CopilotCompletionContextResult {
    requestId: number;
    areSnippetsMissing: boolean;
    snippets: CodeSnippet[];
    traits: Trait[];
    sourceFileUri: string;
    caretOffset: number;
    featureFlag: CopilotCompletionContextFeatures;
}

export interface CopilotCompletionContextParams {
    uri: string;
    caretOffset: number;
    featureFlag: CopilotCompletionContextFeatures;
    maxSnippetCount: number;
    maxSnippetLength: number;
    doAggregateSnippets: boolean;
}

// Requests
const PreInitializationRequest: RequestType<void, string, void> = new RequestType<void, string, void>('cpptools/preinitialize');
const InitializationRequest: RequestType<CppInitializationParams, CppInitializationResult, void> = new RequestType<CppInitializationParams, CppInitializationResult, void>('cpptools/initialize');
const QueryCompilerDefaultsRequest: RequestType<QueryDefaultCompilerParams, configs.CompilerDefaults, void> = new RequestType<QueryDefaultCompilerParams, configs.CompilerDefaults, void>('cpptools/queryCompilerDefaults');
const SwitchHeaderSourceRequest: RequestType<SwitchHeaderSourceParams, string, void> = new RequestType<SwitchHeaderSourceParams, string, void>('cpptools/didSwitchHeaderSource');
const GetDiagnosticsRequest: RequestType<void, GetDiagnosticsResult, void> = new RequestType<void, GetDiagnosticsResult, void>('cpptools/getDiagnostics');
export const GetDocumentSymbolRequest: RequestType<GetDocumentSymbolRequestParams, GetDocumentSymbolResult, void> = new RequestType<GetDocumentSymbolRequestParams, GetDocumentSymbolResult, void>('cpptools/getDocumentSymbols');
export const GetSymbolInfoRequest: RequestType<WorkspaceSymbolParams, LocalizeSymbolInformation[], void> = new RequestType<WorkspaceSymbolParams, LocalizeSymbolInformation[], void>('cpptools/getWorkspaceSymbols');
export const GetFoldingRangesRequest: RequestType<GetFoldingRangesParams, GetFoldingRangesResult, void> = new RequestType<GetFoldingRangesParams, GetFoldingRangesResult, void>('cpptools/getFoldingRanges');
export const FormatDocumentRequest: RequestType<FormatParams, FormatResult, void> = new RequestType<FormatParams, FormatResult, void>('cpptools/formatDocument');
export const FormatRangeRequest: RequestType<FormatParams, FormatResult, void> = new RequestType<FormatParams, FormatResult, void>('cpptools/formatRange');
export const FormatOnTypeRequest: RequestType<FormatParams, FormatResult, void> = new RequestType<FormatParams, FormatResult, void>('cpptools/formatOnType');
export const HoverRequest: RequestType<TextDocumentPositionParams, vscode.Hover, void> = new RequestType<TextDocumentPositionParams, vscode.Hover, void>('cpptools/hover');
export const GetCopilotHoverInfoRequest: RequestType<GetCopilotHoverInfoParams, GetCopilotHoverInfoResult, void> = new RequestType<GetCopilotHoverInfoParams, GetCopilotHoverInfoResult, void>('cpptools/getCopilotHoverInfo');
const CreateDeclarationOrDefinitionRequest: RequestType<CreateDeclarationOrDefinitionParams, CreateDeclarationOrDefinitionResult, void> = new RequestType<CreateDeclarationOrDefinitionParams, CreateDeclarationOrDefinitionResult, void>('cpptools/createDeclDef');
const ExtractToFunctionRequest: RequestType<ExtractToFunctionParams, WorkspaceEditResult, void> = new RequestType<ExtractToFunctionParams, WorkspaceEditResult, void>('cpptools/extractToFunction');
const GoToDirectiveInGroupRequest: RequestType<GoToDirectiveInGroupParams, Position | undefined, void> = new RequestType<GoToDirectiveInGroupParams, Position | undefined, void>('cpptools/goToDirectiveInGroup');
const GenerateDoxygenCommentRequest: RequestType<GenerateDoxygenCommentParams, GenerateDoxygenCommentResult | undefined, void> = new RequestType<GenerateDoxygenCommentParams, GenerateDoxygenCommentResult, void>('cpptools/generateDoxygenComment');
const ChangeCppPropertiesRequest: RequestType<CppPropertiesParams, void, void> = new RequestType<CppPropertiesParams, void, void>('cpptools/didChangeCppProperties');
const IncludesRequest: RequestType<GetIncludesParams, GetIncludesResult, void> = new RequestType<GetIncludesParams, GetIncludesResult, void>('cpptools/getIncludes');
const CppContextRequest: RequestType<TextDocumentIdentifier, ChatContextResult, void> = new RequestType<TextDocumentIdentifier, ChatContextResult, void>('cpptools/getChatContext');
const CopilotCompletionContextRequest: RequestType<CopilotCompletionContextParams, CopilotCompletionContextResult, void> = new RequestType<CopilotCompletionContextParams, CopilotCompletionContextResult, void>('cpptools/getCompletionContext');

// Notifications to the server
const DidOpenNotification: NotificationType<DidOpenTextDocumentParams> = new NotificationType<DidOpenTextDocumentParams>('textDocument/didOpen');
const FileCreatedNotification: NotificationType<FileChangedParams> = new NotificationType<FileChangedParams>('cpptools/fileCreated');
const FileChangedNotification: NotificationType<FileChangedParams> = new NotificationType<FileChangedParams>('cpptools/fileChanged');
const FileDeletedNotification: NotificationType<FileChangedParams> = new NotificationType<FileChangedParams>('cpptools/fileDeleted');
const ResetDatabaseNotification: NotificationType<void> = new NotificationType<void>('cpptools/resetDatabase');
const PauseParsingNotification: NotificationType<void> = new NotificationType<void>('cpptools/pauseParsing');
const ResumeParsingNotification: NotificationType<void> = new NotificationType<void>('cpptools/resumeParsing');
const DidChangeActiveEditorNotification: NotificationType<DidChangeActiveEditorParams> = new NotificationType<DidChangeActiveEditorParams>('cpptools/didChangeActiveEditor');
const RestartIntelliSenseForFileNotification: NotificationType<TextDocumentIdentifier> = new NotificationType<TextDocumentIdentifier>('cpptools/restartIntelliSenseForFile');
const DidChangeTextEditorSelectionNotification: NotificationType<Range> = new NotificationType<Range>('cpptools/didChangeTextEditorSelection');
const ChangeCompileCommandsNotification: NotificationType<FileChangedParams> = new NotificationType<FileChangedParams>('cpptools/didChangeCompileCommands');
const ChangeSelectedSettingNotification: NotificationType<FolderSelectedSettingParams> = new NotificationType<FolderSelectedSettingParams>('cpptools/didChangeSelectedSetting');
const IntervalTimerNotification: NotificationType<void> = new NotificationType<void>('cpptools/onIntervalTimer');
const CustomConfigurationHighPriorityNotification: NotificationType<CustomConfigurationParams> = new NotificationType<CustomConfigurationParams>('cpptools/didChangeCustomConfigurationHighPriority');
const CustomConfigurationNotification: NotificationType<CustomConfigurationParams> = new NotificationType<CustomConfigurationParams>('cpptools/didChangeCustomConfiguration');
const CustomBrowseConfigurationNotification: NotificationType<CustomBrowseConfigurationParams> = new NotificationType<CustomBrowseConfigurationParams>('cpptools/didChangeCustomBrowseConfiguration');
const ClearCustomConfigurationsNotification: NotificationType<WorkspaceFolderParams> = new NotificationType<WorkspaceFolderParams>('cpptools/clearCustomConfigurations');
const ClearCustomBrowseConfigurationNotification: NotificationType<WorkspaceFolderParams> = new NotificationType<WorkspaceFolderParams>('cpptools/clearCustomBrowseConfiguration');
const PreviewReferencesNotification: NotificationType<void> = new NotificationType<void>('cpptools/previewReferences');
const RescanFolderNotification: NotificationType<void> = new NotificationType<void>('cpptools/rescanFolder');
const FinishedRequestCustomConfig: NotificationType<FinishedRequestCustomConfigParams> = new NotificationType<FinishedRequestCustomConfigParams>('cpptools/finishedRequestCustomConfig');
const DidChangeSettingsNotification: NotificationType<SettingsParams> = new NotificationType<SettingsParams>('cpptools/didChangeSettings');
const DidChangeVisibleTextEditorsNotification: NotificationType<DidChangeVisibleTextEditorsParams> = new NotificationType<DidChangeVisibleTextEditorsParams>('cpptools/didChangeVisibleTextEditors');
const DidChangeTextEditorVisibleRangesNotification: NotificationType<DidChangeTextEditorVisibleRangesParams> = new NotificationType<DidChangeTextEditorVisibleRangesParams>('cpptools/didChangeTextEditorVisibleRanges');

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
const CompileCommandsPathsNotification: NotificationType<CompileCommandsPaths> = new NotificationType<CompileCommandsPaths>('cpptools/compileCommandsPaths');
const ReferencesNotification: NotificationType<refs.ReferencesResult> = new NotificationType<refs.ReferencesResult>('cpptools/references');
const ReportReferencesProgressNotification: NotificationType<refs.ReportReferencesProgressNotification> = new NotificationType<refs.ReportReferencesProgressNotification>('cpptools/reportReferencesProgress');
const RequestCustomConfig: NotificationType<string> = new NotificationType<string>('cpptools/requestCustomConfig');
const PublishRefactorDiagnosticsNotification: NotificationType<PublishRefactorDiagnosticsParams> = new NotificationType<PublishRefactorDiagnosticsParams>('cpptools/publishRefactorDiagnostics');
const ShowMessageWindowNotification: NotificationType<ShowMessageWindowParams> = new NotificationType<ShowMessageWindowParams>('cpptools/showMessageWindow');
const ShowWarningNotification: NotificationType<ShowWarningParams> = new NotificationType<ShowWarningParams>('cpptools/showWarning');
const ReportTextDocumentLanguage: NotificationType<string> = new NotificationType<string>('cpptools/reportTextDocumentLanguage');
const IntelliSenseSetupNotification: NotificationType<IntelliSenseSetup> = new NotificationType<IntelliSenseSetup>('cpptools/IntelliSenseSetup');
const SetTemporaryTextDocumentLanguageNotification: NotificationType<SetTemporaryTextDocumentLanguageParams> = new NotificationType<SetTemporaryTextDocumentLanguageParams>('cpptools/setTemporaryTextDocumentLanguage');
const ReportCodeAnalysisProcessedNotification: NotificationType<number> = new NotificationType<number>('cpptools/reportCodeAnalysisProcessed');
const ReportCodeAnalysisTotalNotification: NotificationType<number> = new NotificationType<number>('cpptools/reportCodeAnalysisTotal');
const DoxygenCommentGeneratedNotification: NotificationType<GenerateDoxygenCommentResult> = new NotificationType<GenerateDoxygenCommentResult>('cpptools/insertDoxygenComment');
const CanceledReferencesNotification: NotificationType<void> = new NotificationType<void>('cpptools/canceledReferences');
const IntelliSenseResultNotification: NotificationType<IntelliSenseResult> = new NotificationType<IntelliSenseResult>('cpptools/intelliSenseResult');
const FilesEncodingChangedNotification: NotificationType<FilesEncodingChanged> = new NotificationType<FilesEncodingChanged>('cpptools/filesEncodingChanged');

let failureMessageShown: boolean = false;

class ClientModel {
    public isInitializingWorkspace: DataBinding<boolean>;
    public isIndexingWorkspace: DataBinding<boolean>;
    public isParsingWorkspace: DataBinding<boolean>;
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

        // The following elements add a delay of 500ms before notitfying the UI that the icon can hide itself.
        this.isParsingWorkspace = new DataBinding<boolean>(false, 500, false);
        this.isParsingWorkspacePaused = new DataBinding<boolean>(false, 500, false);
        this.isParsingFiles = new DataBinding<boolean>(false, 500, false);
        this.isUpdatingIntelliSense = new DataBinding<boolean>(false, 500, false);

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
    readonly ready: Promise<void>;
    enqueue<T>(task: () => Promise<T>): Promise<T>;
    InitializingWorkspaceChanged: vscode.Event<boolean>;
    IndexingWorkspaceChanged: vscode.Event<boolean>;
    ParsingWorkspaceChanged: vscode.Event<boolean>;
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
    TrackedDocuments: Map<string, vscode.TextDocument>;
    onDidChangeSettings(event: vscode.ConfigurationChangeEvent): Promise<Record<string, string>>;
    onDidOpenTextDocument(document: vscode.TextDocument): void;
    onDidCloseTextDocument(document: vscode.TextDocument): void;
    onDidChangeVisibleTextEditors(editors: readonly vscode.TextEditor[]): Promise<void>;
    onDidChangeTextEditorVisibleRanges(uri: vscode.Uri): Promise<void>;
    onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void;
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void>;
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void>;
    provideCustomConfiguration(docUri: vscode.Uri): Promise<void>;
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
    takeOwnership(document: vscode.TextDocument): void;
    sendDidOpen(document: vscode.TextDocument): Promise<void>;
    requestSwitchHeaderSource(rootUri: vscode.Uri, fileName: string): Thenable<string>;
    updateActiveDocumentTextOptions(): void;
    didChangeActiveEditor(editor?: vscode.TextEditor, selection?: Range): Promise<void>;
    restartIntelliSenseForFile(document: vscode.TextDocument): Promise<void>;
    activate(): void;
    selectionChanged(selection: Range): void;
    resetDatabase(): void;
    deactivate(): void;
    promptSelectIntelliSenseConfiguration(sender?: any): Promise<void>;
    rescanCompilers(sender?: any): Promise<void>;
    pauseParsing(): void;
    resumeParsing(): void;
    PauseCodeAnalysis(): void;
    ResumeCodeAnalysis(): void;
    CancelCodeAnalysis(): void;
    handleConfigurationSelectCommand(config?: string): Promise<void>;
    handleConfigurationProviderSelectCommand(): Promise<void>;
    handleShowActiveCodeAnalysisCommands(): Promise<void>;
    handleShowIdleCodeAnalysisCommands(): Promise<void>;
    handleReferencesIcon(): void;
    handleConfigurationEditCommand(viewColumn?: vscode.ViewColumn): void;
    handleConfigurationEditJSONCommand(viewColumn?: vscode.ViewColumn): void;
    handleConfigurationEditUICommand(viewColumn?: vscode.ViewColumn): void;
    handleAddToIncludePathCommand(path: string): void;
    handleGoToDirectiveInGroup(next: boolean): Promise<void>;
    handleGenerateDoxygenComment(args: DoxygenCodeActionCommandArguments | vscode.Uri | undefined): Promise<void>;
    handleRunCodeAnalysisOnActiveFile(): Promise<void>;
    handleRunCodeAnalysisOnOpenFiles(): Promise<void>;
    handleRunCodeAnalysisOnAllFiles(): Promise<void>;
    handleRemoveAllCodeAnalysisProblems(): Promise<void>;
    handleRemoveCodeAnalysisProblems(refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void>;
    handleFixCodeAnalysisProblems(workspaceEdit: vscode.WorkspaceEdit, refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void>;
    handleDisableAllTypeCodeAnalysisProblems(code: string, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void>;
    handleCreateDeclarationOrDefinition(isCopyToClipboard: boolean, codeActionRange?: Range): Promise<void>;
    handleExtractToFunction(extractAsGlobal: boolean): Promise<void>;
    onInterval(): void;
    dispose(): void;
    addFileAssociations(fileAssociations: string, languageId: string): void;
    sendDidChangeSettings(): void;
    isInitialized(): boolean;
    getShowConfigureIntelliSenseButton(): boolean;
    setShowConfigureIntelliSenseButton(show: boolean): void;
    addTrustedCompiler(path: string): Promise<void>;
    getCopilotHoverProvider(): CopilotHoverProvider | undefined;
    getIncludes(uri: vscode.Uri, maxDepth: number): Promise<GetIncludesResult>;
    getChatContext(uri: vscode.Uri, token: vscode.CancellationToken): Promise<ChatContextResult>;
    filesEncodingChanged(filesEncodingChanged: FilesEncodingChanged): void;
    getCompletionContext(fileName: vscode.Uri, caretOffset: number, featureFlag: CopilotCompletionContextFeatures, maxSnippetCount: number, maxSnippetLength: number, doAggregateSnippets: boolean, token: vscode.CancellationToken): Promise<CopilotCompletionContextResult>;
}

export function createClient(workspaceFolder?: vscode.WorkspaceFolder): Client {
    if (isInstrumentationEnabled) {
        instrument(vscode.languages, { name: "languages" });
        instrument(vscode.window, { name: "window" });
        instrument(vscode.workspace, { name: "workspace" });
        instrument(vscode.commands, { name: "commands" });
        instrument(vscode.debug, { name: "debug" });
        instrument(vscode.env, { name: "env" });
        instrument(vscode.extensions, { name: "extensions" });
        return instrument(new DefaultClient(workspaceFolder), { ignore: ["enqueue", "onInterval", "logTelemetry"] });
    }
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
    private workspaceStoragePath: string;
    private trackedDocuments = new Map<string, vscode.TextDocument>();
    private isSupported: boolean = true;
    private inactiveRegionsDecorations = new Map<string, DecorationRangesPair>();
    private settingsTracker: SettingsTracker;
    private loggingLevel: number = 1;
    private configurationProvider?: string;
    private hoverProvider: HoverProvider | undefined;
    private copilotHoverProvider: CopilotHoverProvider | undefined;
    private copilotCompletionProvider?: CopilotCompletionContextProvider;

    public lastCustomBrowseConfiguration: PersistentFolderState<WorkspaceBrowseConfiguration | undefined> | undefined;
    public lastCustomBrowseConfigurationProviderId: PersistentFolderState<string | undefined> | undefined;
    public lastCustomBrowseConfigurationProviderVersion: PersistentFolderState<Version> | undefined;
    public currentCaseSensitiveFileSupport: PersistentWorkspaceState<boolean> | undefined;
    public currentCopilotHoverEnabled: PersistentWorkspaceState<string> | undefined;
    private registeredProviders: PersistentFolderState<string[]> | undefined;

    private configStateReceived: ConfigStateReceived = { compilers: false, compileCommands: false, configProviders: undefined, timeout: false };
    private showConfigureIntelliSenseButton: boolean = false;

    /** A queue of asynchronous tasks that need to be processed befofe ready is considered active. */
    private static queue = new Array<[ManualPromise<unknown>, () => Promise<unknown>] | [ManualPromise<unknown>]>();

    /** returns a promise that waits initialization and/or a change to configuration to complete (i.e. language client is ready-to-use) */
    private static readonly isStarted = new ManualSignal<void>(true);

    /**
     * Indicates if the blocking task dispatcher is currently running
     *
     * This will be in the Set state when the dispatcher is not running (i.e. if you await this it will be resolved immediately)
     * If the dispatcher is running, this will be in the Reset state (i.e. if you await this it will be resolved when the dispatcher is done)
     */
    private static readonly dispatching = new ManualSignal<void>();

    // The "model" that is displayed via the UI (status bar).
    private model: ClientModel = new ClientModel();

    public get InitializingWorkspaceChanged(): vscode.Event<boolean> { return this.model.isInitializingWorkspace.ValueChanged; }
    public get IndexingWorkspaceChanged(): vscode.Event<boolean> { return this.model.isIndexingWorkspace.ValueChanged; }
    public get ParsingWorkspaceChanged(): vscode.Event<boolean> { return this.model.isParsingWorkspace.ValueChanged; }
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
    public isInitialized(): boolean { return this.innerLanguageClient !== undefined; }
    public getShowConfigureIntelliSenseButton(): boolean { return this.showConfigureIntelliSenseButton; }
    public setShowConfigureIntelliSenseButton(show: boolean): void { this.showConfigureIntelliSenseButton = show; }

    /**
     * don't use this.rootFolder directly since it can be undefined
     */
    public get RootPath(): string {
        return this.rootFolder ? this.rootFolder.uri.fsPath : "";
    }
    public get RootRealPath(): string {
        return this.rootRealPath;
    }
    public get RootUri(): vscode.Uri | undefined {
        return this.rootFolder ? this.rootFolder.uri : undefined;
    }
    public get RootFolder(): vscode.WorkspaceFolder | undefined {
        return this.rootFolder;
    }
    public get Name(): string {
        return this.getName(this.rootFolder);
    }
    public get TrackedDocuments(): Map<string, vscode.TextDocument> {
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

    public get AdditionalEnvironment(): Record<string, string | string[]> {
        return {
            workspaceFolderBasename: this.Name,
            workspaceStorage: this.workspaceStoragePath,
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
                const defaultClient: DefaultClient = client as DefaultClient;
                if (!client.isInitialized() || !compilerDefaults) {
                    // This can randomly get hit when adding/removing workspace folders.
                    return;
                }
                defaultClient.configuration.CompilerDefaults = compilerDefaults;
                defaultClient.configuration.handleConfigurationChange();
            }
        });
    }

    private static readonly configurationProvidersLabel: string = "configuration providers";
    private static readonly compileCommandsLabel: string = "compile_commands.json";
    private static readonly compilersLabel: string = "compilers";

    public async showSelectIntelliSenseConfiguration(paths: string[], preferredPathSeparator: string, compilersOnly?: boolean): Promise<number> {
        paths = paths.map(p => p.replace(/[\\/]/g, preferredPathSeparator));
        const options: vscode.QuickPickOptions = {};
        options.placeHolder = compilersOnly || !vscode.workspace.workspaceFolders || !this.RootFolder ?
            localize("select.compiler", "Select a compiler to configure for IntelliSense") :
            vscode.workspace.workspaceFolders.length > 1 ?
                localize("configure.intelliSense.forFolder", "How would you like to configure IntelliSense for the '{0}' folder?", this.RootFolder.name) :
                localize("configure.intelliSense.thisFolder", "How would you like to configure IntelliSense for this folder?");

        const items: IndexableQuickPickItem[] = [];
        let isCompilerSection: boolean = false;
        for (let i: number = 0; i < paths.length; i++) {
            const compilerName: string = path.basename(paths[i]);
            const isCompiler: boolean = isCompilerSection && compilerName !== paths[i];

            if (isCompiler) {
                const path: string | undefined = paths[i].replace(compilerName, "");
                const description: string = localize("found.string", "Found at {0}", path);
                const label: string = localize("use.compiler", "Use {0}", compilerName);
                items.push({ label: label, description: description, index: i });
            } else if (paths[i] === DefaultClient.configurationProvidersLabel) {
                items.push({ label: localize("configuration.providers", "configuration providers"), index: i, kind: vscode.QuickPickItemKind.Separator });
            } else if (paths[i] === DefaultClient.compileCommandsLabel) {
                items.push({ label: paths[i], index: i, kind: vscode.QuickPickItemKind.Separator });
            } else if (paths[i] === DefaultClient.compilersLabel) {
                isCompilerSection = true;
                items.push({ label: localize("compilers", "compilers"), index: i, kind: vscode.QuickPickItemKind.Separator });
            } else {
                items.push({ label: paths[i], index: i });
            }
        }

        const selection: IndexableQuickPickItem | undefined = await vscode.window.showQuickPick(items, options);
        return selection ? selection.index : -1;
    }

    public async showPrompt(sender?: any): Promise<void> {
        const buttonMessage: string = localize("selectIntelliSenseConfiguration.string", "Select IntelliSense Configuration...");
        const value: string | undefined = await vscode.window.showInformationMessage(localize("setCompiler.message", "You do not have IntelliSense configured. Unless you set your own configurations, IntelliSense may not be functional."), buttonMessage);
        if (value === buttonMessage) {
            return this.handleIntelliSenseConfigurationQuickPick(sender);
        }
    }

    public async handleIntelliSenseConfigurationQuickPick(sender?: any, showCompilersOnly?: boolean): Promise<void> {
        const settings: CppSettings = new CppSettings(showCompilersOnly ? undefined : this.RootUri);
        const paths: string[] = [];
        const configProviders: CustomConfigurationProvider1[] | undefined = showCompilersOnly ? undefined : this.configStateReceived.configProviders;
        if (configProviders && configProviders.length > 0) {
            paths.push(DefaultClient.configurationProvidersLabel);
            for (const provider of configProviders) {
                paths.push(localize("use.provider", "Use {0}", provider.name));
            }
        }
        const configProvidersIndex: number = paths.length;
        const configProviderCount: number = configProvidersIndex === 0 ? 0 : configProvidersIndex - 1;
        if (!showCompilersOnly && this.compileCommandsPaths.length > 0) {
            paths.push(DefaultClient.compileCommandsLabel);
            for (const compileCommandsPath of this.compileCommandsPaths) {
                paths.push(localize("use.compileCommands", "Use {0}", compileCommandsPath));
            }
        }
        const compileCommandsIndex: number = paths.length;
        const compileCommandsCount: number = compileCommandsIndex === configProvidersIndex ? 0 : compileCommandsIndex - configProvidersIndex - 1;
        paths.push(DefaultClient.compilersLabel);
        if (compilerDefaults?.knownCompilers !== undefined) {
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
        const compilersIndex: number = paths.length;
        const compilerCount: number = compilersIndex === compileCommandsIndex ? 0 : compilersIndex - compileCommandsIndex - 1;
        paths.push(localize("selectAnotherCompiler.string", "Select another compiler on my machine..."));
        let installShown = true;
        if (isWindows && util.getSenderType(sender) !== 'walkthrough') {
            paths.push(localize("installCompiler.string", "Help me install a compiler"));
        } else if (!isWindows) {
            paths.push(localize("installCompiler.string.nix", "Install a compiler"));
        } else {
            installShown = false;
        }
        paths.push(localize("noConfig.string", "Do not configure with a compiler (not recommended)"));
        let preferredPathSeparator: string = settings.preferredPathSeparator;
        if (preferredPathSeparator === "Forward Slash") {
            preferredPathSeparator = "/";
        } else if (preferredPathSeparator === "Backslash") {
            preferredPathSeparator = "\\";
        }
        const index: number = await this.showSelectIntelliSenseConfiguration(paths, preferredPathSeparator, showCompilersOnly);
        let action: string = "";
        let configurationSelected: boolean = false;
        const fromStatusBarButton: boolean = !showCompilersOnly;
        try {
            if (index === -1) {
                action = "escaped";
                return;
            }
            if (index === paths.length - 1) {
                action = "disable";
                settings.defaultCompilerPath = "";
                await this.configuration.updateCompilerPathIfSet("");
                configurationSelected = true;
                await this.showPrompt(sender);
                return ui.ShowConfigureIntelliSenseButton(false, this, ConfigurationType.CompilerPath, "disablePrompt");
            }
            if (installShown && index === paths.length - 2) {
                action = "install";
                void vscode.commands.executeCommand('C_Cpp.InstallCompiler', sender);
                return;
            }
            const showButtonSender: string = "quickPick";
            if (index === paths.length - 3 || (!installShown && index === paths.length - 2)) {
                const result: vscode.Uri[] | undefined = await vscode.window.showOpenDialog();
                if (result === undefined || result.length === 0) {
                    action = "browse dismissed";
                    return;
                }
                configurationSelected = true;
                action = "compiler browsed";
                settings.defaultCompilerPath = result[0].fsPath;
                await this.configuration.updateCompilerPathIfSet(result[0].fsPath);
                void SessionState.trustedCompilerFound.set(true);
            } else {
                configurationSelected = true;
                if (index < configProvidersIndex && configProviders) {
                    action = "select config provider";
                    const provider: CustomConfigurationProvider1 = configProviders[index - 1];
                    await this.configuration.updateCustomConfigurationProvider(provider.extensionId);
                    void this.onCustomConfigurationProviderRegistered(provider).catch(logAndReturn.undefined);
                    telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": provider.extensionId });

                    return ui.ShowConfigureIntelliSenseButton(false, this, ConfigurationType.ConfigProvider, showButtonSender);
                } else if (index < compileCommandsIndex) {
                    action = "select compile commands";
                    await this.configuration.setCompileCommands(this.compileCommandsPaths[index - configProvidersIndex - 1]);
                    return ui.ShowConfigureIntelliSenseButton(false, this, ConfigurationType.CompileCommands, showButtonSender);
                } else {
                    action = "select compiler";
                    let newCompiler: string = util.isCl(paths[index]) ? "cl.exe" : paths[index];
                    newCompiler = newCompiler.replace(/[\\/]/g, preferredPathSeparator);
                    settings.defaultCompilerPath = newCompiler;
                    await this.configuration.updateCompilerPathIfSet(newCompiler);
                    void SessionState.trustedCompilerFound.set(true);
                }
            }

            await ui.ShowConfigureIntelliSenseButton(false, this, ConfigurationType.CompilerPath, showButtonSender);

            await this.addTrustedCompiler(settings.defaultCompilerPath);
            DefaultClient.updateClientConfigurations();
        } finally {
            if (showCompilersOnly) {
                telemetry.logLanguageServerEvent('compilerSelection', { action, sender: util.getSenderType(sender) },
                    { compilerCount: compilerCount + 3 }); // + 3 is to match what was being incorrectly sent previously
            } else {
                telemetry.logLanguageServerEvent('configurationSelection', { action, sender: util.getSenderType(sender) },
                    { configProviderCount, compileCommandsCount, compilerCount });
            }

            // Clear the prompt state.
            // TODO: Add some way to change this state to true.
            const rootFolder: vscode.WorkspaceFolder | undefined = this.RootFolder;
            if (rootFolder && fromStatusBarButton) {
                if (configurationSelected || configProviderCount > 0) {
                    const ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("Client.registerProvider", true, rootFolder);
                    ask.Value = false;
                }
                if (configurationSelected || compileCommandsCount > 0) {
                    const ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("CPP.showCompileCommandsSelection", true, rootFolder);
                    ask.Value = false;
                }
                if (!configurationSelected) {
                    await this.handleConfigStatus();
                }
            }
        }
    }

    public async rescanCompilers(sender?: any): Promise<void> {
        compilerDefaults = await this.requestCompiler();
        DefaultClient.updateClientConfigurations();
        if (compilerDefaults.knownCompilers !== undefined && compilerDefaults.knownCompilers.length > 0) {
            await this.handleIntelliSenseConfigurationQuickPick(sender, true);
        }
    }

    async promptSelectIntelliSenseConfiguration(sender?: any): Promise<void> {
        if (compilerDefaults === undefined) {
            return;
        }
        if (compilerDefaults.compilerPath !== "") {
            const showCompilersOnly: boolean = util.getSenderType(sender) === 'walkthrough';
            return this.handleIntelliSenseConfigurationQuickPick(sender, showCompilersOnly);
        }
    }

    /**
     * All public methods on this class must be guarded by the "ready" promise. Requests and notifications received before the task is
     * complete are executed after this promise is resolved.
     */

    constructor(workspaceFolder?: vscode.WorkspaceFolder) {
        if (workspaceFolder !== undefined) {
            this.lastCustomBrowseConfiguration = new PersistentFolderState<WorkspaceBrowseConfiguration | undefined>("CPP.lastCustomBrowseConfiguration", undefined, workspaceFolder);
            this.lastCustomBrowseConfigurationProviderId = new PersistentFolderState<string | undefined>("CPP.lastCustomBrowseConfigurationProviderId", undefined, workspaceFolder);
            this.lastCustomBrowseConfigurationProviderVersion = new PersistentFolderState<Version>("CPP.lastCustomBrowseConfigurationProviderVersion", Version.v5, workspaceFolder);
            this.registeredProviders = new PersistentFolderState<string[]>("CPP.registeredProviders", [], workspaceFolder);
            // If this provider did the register in the last session, clear out the cached browse config.
            if (!this.isProviderRegistered(this.lastCustomBrowseConfigurationProviderId.Value)) {
                this.lastCustomBrowseConfigurationProviderId.Value = undefined;
                if (this.lastCustomBrowseConfiguration !== undefined) {
                    this.lastCustomBrowseConfiguration.Value = undefined;
                }
            }
            if (this.lastCustomBrowseConfigurationProviderId.Value) {
                this.configStateReceived.configProviders = []; // avoid waiting for the timeout if it's cached
            }
            this.registeredProviders.Value = [];
        } else {
            this.configStateReceived.configProviders = [];
            this.configStateReceived.compileCommands = true;
        }
        if (!semanticTokensLegend) {
            // Semantic token types are identified by indexes in this list of types, in the legend.
            const tokenTypesLegend: string[] = [];
            for (const e in SemanticTokenTypes) {
                // An enum is actually a set of mappings from key <=> value. Enumerate over only the names.
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
        this.rootRealPath = this.RootPath ? fs.existsSync(this.RootPath) ? fs.realpathSync(this.RootPath) : this.RootPath : "";

        this.workspaceStoragePath = util.extensionContext?.storageUri?.fsPath ?? "";
        if (this.workspaceStoragePath.length > 0) {
            workspaceHash = path.basename(path.dirname(this.workspaceStoragePath));
        } else {
            this.workspaceStoragePath = this.RootPath ? path.join(this.RootPath, ".vscode") : "";
        }

        if (workspaceFolder && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
            this.workspaceStoragePath = path.join(this.workspaceStoragePath, util.getUniqueWorkspaceStorageName(workspaceFolder));
        }

        const rootUri: vscode.Uri | undefined = this.RootUri;
        this.settingsTracker = new SettingsTracker(rootUri);

        try {
            let isFirstClient: boolean = false;
            if (firstClientStarted === undefined || languageClientCrashedNeedsRestart) {
                if (languageClientCrashedNeedsRestart) {
                    languageClientCrashedNeedsRestart = false;
                    // if we're recovering, the isStarted needs to be reset.
                    // because we're starting the first client again.
                    DefaultClient.isStarted.reset();
                }
                firstClientStarted = this.createLanguageClient();
                util.setProgress(util.getProgressExecutableStarted());
                isFirstClient = true;
            }
            void this.init(rootUri, isFirstClient).catch(logAndReturn.undefined);

        } catch (errJS) {
            const err: NodeJS.ErrnoException = errJS as NodeJS.ErrnoException;
            this.isSupported = false; // Running on an OS we don't support yet.
            if (!failureMessageShown) {
                failureMessageShown = true;
                let additionalInfo: string;
                if (err.code === "EPERM") {
                    additionalInfo = localize('check.permissions', "EPERM: Check permissions for '{0}'", getLanguageServerFileName());
                } else {
                    additionalInfo = String(err);
                }
                void vscode.window.showErrorMessage(localize("unable.to.start", "Unable to start the C/C++ language server. IntelliSense features will be disabled. Error: {0}", additionalInfo));
            }
        }

        this.updateActiveDocumentTextOptions();
    }

    private async init(rootUri: vscode.Uri | undefined, isFirstClient: boolean) {
        ui = getUI();
        ui.bind(this);
        if ((await firstClientStarted).wasShutdown) {
            this.isSupported = false;
            DefaultClient.isStarted.resolve();
            return;
        }

        try {
            const workspaceFolder: vscode.WorkspaceFolder | undefined = this.rootFolder;
            this.innerConfiguration = new configs.CppProperties(this, rootUri, workspaceFolder);
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
                this.inlayHintsProvider = new InlayHintsProvider();
                this.hoverProvider = new HoverProvider(this);
                this.copilotHoverProvider = new CopilotHoverProvider(this);

                this.disposables.push(vscode.languages.registerHoverProvider(util.documentSelector, instrument(this.copilotHoverProvider)));
                this.disposables.push(vscode.languages.registerHoverProvider(util.documentSelector, instrument(this.hoverProvider)));
                this.disposables.push(vscode.languages.registerInlayHintsProvider(util.documentSelector, instrument(this.inlayHintsProvider)));
                this.disposables.push(vscode.languages.registerRenameProvider(util.documentSelector, instrument(new RenameProvider(this))));
                this.disposables.push(vscode.languages.registerReferenceProvider(util.documentSelector, instrument(new FindAllReferencesProvider(this))));
                this.disposables.push(vscode.languages.registerWorkspaceSymbolProvider(instrument(new WorkspaceSymbolProvider(this))));
                this.disposables.push(vscode.languages.registerDocumentSymbolProvider(util.documentSelector, instrument(new DocumentSymbolProvider()), undefined));
                this.disposables.push(vscode.languages.registerCodeActionsProvider(util.documentSelector, instrument(new CodeActionProvider(this)), undefined));
                this.disposables.push(vscode.languages.registerCallHierarchyProvider(util.documentSelector, instrument(new CallHierarchyProvider(this))));

                // Because formatting and codeFolding can vary per folder, we need to register these providers once
                // and leave them registered. The decision of whether to provide results needs to be made on a per folder basis,
                // within the providers themselves.
                this.documentFormattingProviderDisposable = vscode.languages.registerDocumentFormattingEditProvider(util.documentSelector, instrument(new DocumentFormattingEditProvider(this)));
                this.formattingRangeProviderDisposable = vscode.languages.registerDocumentRangeFormattingEditProvider(util.documentSelector, instrument(new DocumentRangeFormattingEditProvider(this)));
                this.onTypeFormattingProviderDisposable = vscode.languages.registerOnTypeFormattingEditProvider(util.documentSelector, instrument(new OnTypeFormattingEditProvider(this)), ";", "}", "\n");

                this.codeFoldingProvider = new FoldingRangeProvider(this);
                this.codeFoldingProviderDisposable = vscode.languages.registerFoldingRangeProvider(util.documentSelector, instrument(this.codeFoldingProvider));

                const settings: CppSettings = new CppSettings();
                if (settings.isEnhancedColorizationEnabled && semanticTokensLegend) {
                    this.semanticTokensProvider = instrument(new SemanticTokensProvider());
                    this.semanticTokensProviderDisposable = vscode.languages.registerDocumentSemanticTokensProvider(util.documentSelector, this.semanticTokensProvider, semanticTokensLegend);
                }

                this.copilotCompletionProvider = await CopilotCompletionContextProvider.Create();
                this.disposables.push(this.copilotCompletionProvider);

                // Listen for messages from the language server.
                this.registerNotifications();

                initializeIntervalTimer();
            }

            // update all client configurations
            this.configuration.setupConfigurations();
            initializedClientCount++;
            // count number of clients, once all clients are configured, check for trusted compiler to display notification to user and add a short delay to account for config provider logic to finish
            if ((vscode.workspace.workspaceFolders === undefined) || (initializedClientCount >= vscode.workspace.workspaceFolders.length)) {
                // Timeout waiting for compile_commands.json and config providers.
                // The quick pick options will update if they're added later on.
                clients.forEach(client => {
                    if (client instanceof DefaultClient) {
                        global.setTimeout(() => {
                            client.configStateReceived.timeout = true;
                            void client.handleConfigStatus();
                        }, 15000);
                    }
                });
                // The configurations will not be sent to the language server until the default include paths and frameworks have been set.
                // The event handlers must be set before this happens.
                compilerDefaults = await this.requestCompiler();
                DefaultClient.updateClientConfigurations();
                clients.forEach(client => {
                    if (client instanceof DefaultClient) {
                        client.configStateReceived.compilers = true;
                        void client.handleConfigStatus();
                    }
                });
            }
        } catch (err) {
            this.isSupported = false; // Running on an OS we don't support yet.
            if (!failureMessageShown) {
                failureMessageShown = true;
                void vscode.window.showErrorMessage(localize("unable.to.start", "Unable to start the C/C++ language server. IntelliSense features will be disabled. Error: {0}", String(err)));
            }
        }

        DefaultClient.isStarted.resolve();
    }

    private getWorkspaceFolderSettings(workspaceFolderUri: vscode.Uri | undefined, workspaceFolder: vscode.WorkspaceFolder | undefined, settings: CppSettings, otherSettings: OtherSettings): WorkspaceFolderSettingsParams {
        const filesEncoding: string = otherSettings.filesEncoding;
        let filesEncodingChanged: boolean = false;
        if (workspaceFolder) {
            const lastFilesEncoding: PersistentFolderState<string> = new PersistentFolderState<string>("CPP.lastFilesEncoding", filesEncoding, workspaceFolder);
            filesEncodingChanged = lastFilesEncoding.Value !== filesEncoding;
        }
        const result: WorkspaceFolderSettingsParams = {
            uri: workspaceFolderUri?.toString(),
            intelliSenseEngine: settings.intelliSenseEngine,
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
            clangFormatStyle: settings.clangFormatStyle ? util.resolveVariables(settings.clangFormatStyle, this.AdditionalEnvironment) : undefined,
            clangFormatFallbackStyle: settings.clangFormatFallbackStyle,
            clangFormatSortIncludes: settings.clangFormatSortIncludes,
            codeAnalysisRunAutomatically: settings.codeAnalysisRunAutomatically,
            codeAnalysisExclude: settings.codeAnalysisExclude,
            clangTidyEnabled: settings.clangTidyEnabled,
            clangTidyPath: util.resolveVariables(settings.clangTidyPath, this.AdditionalEnvironment),
            clangTidyConfig: settings.clangTidyConfig,
            clangTidyFallbackConfig: settings.clangTidyFallbackConfig,
            clangTidyHeaderFilter: settings.clangTidyHeaderFilter !== null ? util.resolveVariables(settings.clangTidyHeaderFilter, this.AdditionalEnvironment) : null,
            clangTidyArgs: util.resolveVariablesArray(settings.clangTidyArgs, this.AdditionalEnvironment),
            clangTidyUseBuildPath: settings.clangTidyUseBuildPath,
            clangTidyChecksEnabled: settings.clangTidyChecksEnabled,
            clangTidyChecksDisabled: settings.clangTidyChecksDisabled,
            markdownInComments: settings.markdownInComments,
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
            filesEncoding: filesEncoding,
            filesEncodingChanged: filesEncodingChanged,
            searchExclude: otherSettings.searchExclude,
            editorAutoClosingBrackets: otherSettings.editorAutoClosingBrackets,
            editorInlayHintsEnabled: otherSettings.editorInlayHintsEnabled,
            editorParameterHintsEnabled: otherSettings.editorParameterHintsEnabled,
            refactoringIncludeHeader: settings.refactoringIncludeHeader
        };
        return result;
    }

    private getAllWorkspaceFolderSettings(): WorkspaceFolderSettingsParams[] {
        const workspaceSettings: CppSettings = new CppSettings();
        const workspaceOtherSettings: OtherSettings = new OtherSettings();
        const workspaceFolderSettingsParams: WorkspaceFolderSettingsParams[] = [];
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                workspaceFolderSettingsParams.push(this.getWorkspaceFolderSettings(workspaceFolder.uri, workspaceFolder, new CppSettings(workspaceFolder.uri), new OtherSettings(workspaceFolder.uri)));
            }
        } else {
            workspaceFolderSettingsParams.push(this.getWorkspaceFolderSettings(this.RootUri, undefined, workspaceSettings, workspaceOtherSettings));
        }
        return workspaceFolderSettingsParams;
    }

    private getAllSettings(): SettingsParams {
        const workspaceSettings: CppSettings = new CppSettings();
        const workspaceOtherSettings: OtherSettings = new OtherSettings();
        const workspaceFolderSettingsParams: WorkspaceFolderSettingsParams[] = this.getAllWorkspaceFolderSettings();
        if (this.currentCaseSensitiveFileSupport && workspaceSettings.isCaseSensitiveFileSupportEnabled !== this.currentCaseSensitiveFileSupport.Value) {
            void util.promptForReloadWindowDueToSettingsChange();
        }
        if (this.currentCopilotHoverEnabled && workspaceSettings.copilotHover !== this.currentCopilotHoverEnabled.Value) {
            void util.promptForReloadWindowDueToSettingsChange();
        }
        const workspaceFallbackEncoding: string = workspaceOtherSettings.filesEncoding;
        const lastWorkspaceFallbackEncoding: PersistentState<string> = new PersistentState<string>("CPP.lastWorkspaceFallbackEncoding", workspaceFallbackEncoding);
        const workspaceFallbackEncodingChanged = lastWorkspaceFallbackEncoding.Value !== workspaceFallbackEncoding;
        return {
            filesAssociations: workspaceOtherSettings.filesAssociations,
            workspaceFallbackEncoding: workspaceFallbackEncoding,
            workspaceFallbackEncodingChanged: workspaceFallbackEncodingChanged,
            maxConcurrentThreads: workspaceSettings.maxConcurrentThreads,
            maxCachedProcesses: workspaceSettings.maxCachedProcesses,
            maxMemory: workspaceSettings.maxMemory,
            maxSymbolSearchResults: workspaceSettings.maxSymbolSearchResults,
            loggingLevel: workspaceSettings.loggingLevel,
            workspaceParsingPriority: workspaceSettings.workspaceParsingPriority,
            workspaceSymbols: workspaceSettings.workspaceSymbols,
            simplifyStructuredComments: workspaceSettings.simplifyStructuredComments,
            intelliSenseUpdateDelay: workspaceSettings.intelliSenseUpdateDelay,
            experimentalFeatures: workspaceSettings.experimentalFeatures,
            enhancedColorization: workspaceSettings.isEnhancedColorizationEnabled,
            intellisenseMaxCachedProcesses: workspaceSettings.intelliSenseMaxCachedProcesses,
            intellisenseMaxMemory: workspaceSettings.intelliSenseMaxMemory,
            referencesMaxConcurrentThreads: workspaceSettings.referencesMaxConcurrentThreads,
            referencesMaxCachedProcesses: workspaceSettings.referencesMaxCachedProcesses,
            referencesMaxMemory: workspaceSettings.referencesMaxMemory,
            codeAnalysisMaxConcurrentThreads: workspaceSettings.codeAnalysisMaxConcurrentThreads,
            codeAnalysisMaxMemory: workspaceSettings.codeAnalysisMaxMemory,
            codeAnalysisUpdateDelay: workspaceSettings.codeAnalysisUpdateDelay,
            copilotHover: workspaceSettings.copilotHover,
            workspaceFolderSettings: workspaceFolderSettingsParams
        };
    }

    private async createLanguageClient(): Promise<{ wasShutdown: boolean }> {
        this.currentCaseSensitiveFileSupport = new PersistentWorkspaceState<boolean>("CPP.currentCaseSensitiveFileSupport", false);
        let resetDatabase: boolean = false;
        const serverModule: string = getLanguageServerFileName();
        const exeExists: boolean = fs.existsSync(serverModule);
        if (!exeExists) {
            telemetry.logLanguageServerEvent("missingLanguageServerBinary");
            throw String('Missing binary at ' + serverModule);
        }
        const serverName: string = this.getName(this.rootFolder);
        const serverOptions: ServerOptions = {
            run: { command: serverModule, options: { detached: false, cwd: util.getExtensionFilePath("bin") } },
            debug: { command: serverModule, args: [serverName], options: { detached: true, cwd: util.getExtensionFilePath("bin") } }
        };

        // The IntelliSense process should automatically detect when AutoPCH is
        // not supportable (on platforms that don't support disabling ASLR/PIE).
        // We've had reports of issues on arm64 macOS that are addressed by
        // disabling the IntelliSense cache, suggesting fallback does not
        // always work as expected. It's actually more efficient to disable
        // the cache on platforms we know do not support it. We do that here.
        let intelliSenseCacheDisabled: boolean = false;
        if (os.platform() === "darwin") {
            // AutoPCH doesn't work for arm64 macOS.
            if (os.arch() === "arm64") {
                intelliSenseCacheDisabled = true;
            } else {
                // AutoPCH doesn't work for older x64 macOS's.
                const releaseParts: string[] = os.release().split(".");
                if (releaseParts.length >= 1) {
                    intelliSenseCacheDisabled = parseInt(releaseParts[0]) < 17;
                }
            }
        } else {
            // AutoPCH doesn't work for arm64 Windows.
            intelliSenseCacheDisabled = os.platform() === "win32" && os.arch() === "arm64";
        }

        const localizedStrings: string[] = [];
        for (let i: number = 0; i < localizedStringCount; i++) {
            localizedStrings.push(lookupString(i));
        }

        const workspaceSettings: CppSettings = new CppSettings();
        if (workspaceSettings.isCaseSensitiveFileSupportEnabled !== this.currentCaseSensitiveFileSupport.Value) {
            resetDatabase = true;
            this.currentCaseSensitiveFileSupport.Value = workspaceSettings.isCaseSensitiveFileSupportEnabled;
        }

        const cacheStoragePath: string = util.getCacheStoragePath();
        const databaseStoragePath: string = (cacheStoragePath.length > 0) && (workspaceHash.length > 0) ?
            path.join(cacheStoragePath, workspaceHash) : "";

        const cppInitializationParams: CppInitializationParams = {
            packageVersion: util.packageJson.version,
            extensionPath: util.extensionPath,
            databaseStoragePath: databaseStoragePath,
            workspaceStoragePath: this.workspaceStoragePath,
            cacheStoragePath: cacheStoragePath,
            vcpkgRoot: util.getVcpkgRoot(),
            intelliSenseCacheDisabled: intelliSenseCacheDisabled,
            caseSensitiveFileSupport: workspaceSettings.isCaseSensitiveFileSupportEnabled,
            resetDatabase: resetDatabase,
            edgeMessagesDirectory: path.join(util.getExtensionFilePath("bin"), "messages", getLocaleId()),
            localizedStrings: localizedStrings,
            settings: this.getAllSettings()
        };

        this.loggingLevel = util.getNumericLoggingLevel(cppInitializationParams.settings.loggingLevel);
        const lspInitializationOptions: LspInitializationOptions = {
            loggingLevel: this.loggingLevel
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: 'file', language: 'c' },
                { scheme: 'file', language: 'cpp' },
                { scheme: 'file', language: 'cuda-cpp' }
            ],
            initializationOptions: lspInitializationOptions,
            middleware: createProtocolFilter(),
            errorHandler: {
                error: (_error, _message, _count) => ({ action: ErrorAction.Continue }),
                closed: () => {
                    languageClientCrashTimes.push(Date.now());
                    languageClientCrashedNeedsRestart = true;
                    telemetry.logLanguageServerEvent("languageClientCrash");
                    let restart: boolean = true;
                    if (languageClientCrashTimes.length < 5) {
                        void clients.recreateClients();
                    } else {
                        const elapsed: number = languageClientCrashTimes[languageClientCrashTimes.length - 1] - languageClientCrashTimes[0];
                        if (elapsed <= 3 * 60 * 1000) {
                            void clients.recreateClients(true);
                            restart = false;
                        } else {
                            languageClientCrashTimes.shift();
                            void clients.recreateClients();
                        }
                    }
                    const message: string = restart ? localize('server.crashed.restart', 'The language server crashed. Restarting...')
                        : localize('server.crashed2', 'The language server crashed 5 times in the last 3 minutes. It will not be restarted.');

                    // We manually restart the language server so tell the LanguageClient not to do it automatically for us.
                    return { action: CloseAction.DoNotRestart, message };
                }
            },
            markdown: {
                isTrusted: true
                // TODO: support for icons in markdown is not yet in the released version of vscode-languageclient.
                // Based on PR (https://github.com/microsoft/vscode-languageserver-node/pull/1504)
                //supportThemeIcons: true
            }

            // TODO: should I set the output channel? Does this sort output between servers?
        };

        // Create the language client
        languageClient = new LanguageClient(`cpptools`, serverOptions, clientOptions);
        languageClient.onNotification(DebugProtocolNotification, logDebugProtocol);
        languageClient.onNotification(DebugLogNotification, logLocalized);
        languageClient.onNotification(LogTelemetryNotification, (e) => this.logTelemetry(e));
        languageClient.onNotification(ShowMessageWindowNotification, showMessageWindow);
        languageClient.registerProposedFeatures();
        await languageClient.start();

        if (usesCrashHandler()) {
            watchForCrashes(await languageClient.sendRequest(PreInitializationRequest, null));
        }

        // Move initialization to a separate message, so we can see log output from it.
        // A request is used in order to wait for completion and ensure that no subsequent
        // higher priority message may be processed before the Initialization request.
        const initializeResult = await languageClient.sendRequest(InitializationRequest, cppInitializationParams);

        // If the server requested shutdown, then reload with the failsafe (null) client.
        if (initializeResult.shouldShutdown) {
            await languageClient.stop();
            await clients.recreateClients(true);
        }

        return { wasShutdown: initializeResult.shouldShutdown };
    }

    public async sendDidChangeSettings(): Promise<void> {
        // Send settings json to native side
        await this.ready;
        await this.languageClient.sendNotification(DidChangeSettingsNotification, this.getAllSettings());
    }

    public async onDidChangeSettings(_event: vscode.ConfigurationChangeEvent): Promise<Record<string, string>> {
        const defaultClient: Client = clients.getDefaultClient();
        if (this === defaultClient) {
            // Only send the updated settings information once, as it includes values for all folders.
            void this.sendDidChangeSettings();
        }
        const changedSettings: Record<string, string> = this.settingsTracker.getChangedSettings();

        await this.ready;

        if (Object.keys(changedSettings).length > 0) {
            if (this === defaultClient) {
                if (changedSettings.commentContinuationPatterns) {
                    updateLanguageConfigurations();
                }
                if (changedSettings.loggingLevel) {
                    const oldLoggingLevelLogged: boolean = this.loggingLevel > 1;
                    this.loggingLevel = util.getNumericLoggingLevel(changedSettings.loggingLevel);
                    if (oldLoggingLevelLogged || this.loggingLevel > 1) {
                        getOutputChannelLogger().appendLine(localize({ key: "loggingLevel.changed", comment: ["{0} is the setting name 'loggingLevel', {1} is a string value such as 'Debug'"] }, "{0} has changed to: {1}", "loggingLevel", changedSettings.loggingLevel));
                    }
                }
                const settings: CppSettings = new CppSettings();
                if (changedSettings.enhancedColorization) {
                    if (settings.isEnhancedColorizationEnabled && semanticTokensLegend) {
                        this.semanticTokensProvider = new SemanticTokensProvider();
                        this.semanticTokensProviderDisposable = vscode.languages.registerDocumentSemanticTokensProvider(util.documentSelector, this.semanticTokensProvider, semanticTokensLegend);
                    } else if (this.semanticTokensProviderDisposable) {
                        this.semanticTokensProviderDisposable.dispose();
                        this.semanticTokensProviderDisposable = undefined;
                        this.semanticTokensProvider = undefined;
                    }
                }

                // If an inlay hints setting has changed, force an inlay provider update on the visible documents.
                if (["inlayHints.autoDeclarationTypes.enabled",
                    "inlayHints.autoDeclarationTypes.showOnLeft",
                    "inlayHints.parameterNames.enabled",
                    "inlayHints.parameterNames.hideLeadingUnderscores",
                    "inlayHints.parameterNames.suppressWhenArgumentContainsName",
                    "inlayHints.referenceOperator.enabled",
                    "inlayHints.referenceOperator.showSpace"].some(setting => setting in changedSettings)) {
                    vscode.window.visibleTextEditors.forEach((visibleEditor: vscode.TextEditor) => {
                        // The exact range doesn't matter.
                        const visibleRange: vscode.Range | undefined = visibleEditor.visibleRanges.at(0);
                        if (visibleRange !== undefined) {
                            void vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider',
                                visibleEditor.document.uri, visibleRange);
                        }
                    });
                }

                if (changedSettings['codeAnalysis.runAutomatically'] !== undefined || changedSettings['codeAnalysis.clangTidy.enabled'] !== undefined) {
                    ui.refreshCodeAnalysisText(this.model.isRunningCodeAnalysis.Value);
                }

                const showButtonSender: string = "settingsChanged";
                if (changedSettings["default.configurationProvider"] !== undefined) {
                    void ui.ShowConfigureIntelliSenseButton(false, this, ConfigurationType.ConfigProvider, showButtonSender);
                } else if (changedSettings["default.compileCommands"] !== undefined) {
                    void ui.ShowConfigureIntelliSenseButton(false, this, ConfigurationType.CompileCommands, showButtonSender);
                } if (changedSettings["default.compilerPath"] !== undefined) {
                    void ui.ShowConfigureIntelliSenseButton(false, this, ConfigurationType.CompilerPath, showButtonSender);
                }
            }
            if (changedSettings.legacyCompilerArgsBehavior) {
                this.configuration.handleConfigurationChange();
            }
            if (changedSettings["default.compilerPath"] !== undefined || changedSettings["default.compileCommands"] !== undefined || changedSettings["default.configurationProvider"] !== undefined) {
                void ui.ShowConfigureIntelliSenseButton(false, this).catch(logAndReturn.undefined);
            }
            this.configuration.onDidChangeSettings();
            telemetry.logLanguageServerEvent("CppSettingsChange", changedSettings, undefined);
        }

        return changedSettings;
    }

    private prepareVisibleRanges(editors: readonly vscode.TextEditor[]): { [uri: string]: Range[] } {
        const visibleRanges: { [uri: string]: Range[] } = {};
        editors.forEach(editor => {
            // Use a map, to account for multiple editors for the same file.
            // First, we just concat all ranges for the same file.
            const uri: string = editor.document.uri.toString();
            if (!visibleRanges[uri]) {
                visibleRanges[uri] = [];
            }
            visibleRanges[uri] = visibleRanges[uri].concat(editor.visibleRanges.map(makeLspRange));
        });

        // We may need to merge visible ranges, if there are multiple editors for the same file,
        // and some of the ranges overlap.
        Object.keys(visibleRanges).forEach(uri => {
            visibleRanges[uri] = util.mergeOverlappingRanges(visibleRanges[uri]);
        });

        return visibleRanges;
    }

    // Handles changes to visible files/ranges, changes to current selection/position,
    // and changes to the active text editor. Should only be called on the primary client.
    public async onDidChangeVisibleTextEditors(editors: readonly vscode.TextEditor[]): Promise<void> {
        const params: DidChangeVisibleTextEditorsParams = {
            visibleRanges: this.prepareVisibleRanges(editors)
        };
        if (vscode.window.activeTextEditor) {
            if (util.isCpp(vscode.window.activeTextEditor.document)) {
                params.activeUri = vscode.window.activeTextEditor.document.uri.toString();
                params.activeSelection = makeLspRange(vscode.window.activeTextEditor.selection);
            }
        }

        await this.languageClient.sendNotification(DidChangeVisibleTextEditorsNotification, params);
    }

    public async onDidChangeTextEditorVisibleRanges(uri: vscode.Uri): Promise<void> {
        // VS Code will notify us of a particular editor, but same file may be open in
        // multiple editors, so we coalesc those visible ranges.
        const editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(editor => editor.document.uri === uri);

        let visibleRanges: Range[] = [];
        if (editors.length === 1) {
            visibleRanges = editors[0].visibleRanges.map(makeLspRange);
        } else {
            editors.forEach(editor => {
                // Use a map, to account for multiple editors for the same file.
                // First, we just concat all ranges for the same file.
                visibleRanges = visibleRanges.concat(editor.visibleRanges.map(makeLspRange));
            });
        }

        const params: DidChangeTextEditorVisibleRangesParams = {
            uri: uri.toString(),
            visibleRanges
        };

        await this.languageClient.sendNotification(DidChangeTextEditorVisibleRangesNotification, params);
    }

    public onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void {
        if (util.isCpp(textDocumentChangeEvent.document)) {
            // If any file has changed, we need to abort the current rename operation
            if (workspaceReferences !== undefined // Occurs when a document changes before cpptools starts.
                && workspaceReferences.renamePending) {
                workspaceReferences.cancelCurrentReferenceRequest(refs.CancellationSender.User);
            }

            const oldVersion: number | undefined = openFileVersions.get(textDocumentChangeEvent.document.uri.toString());
            const newVersion: number = textDocumentChangeEvent.document.version;
            if (oldVersion === undefined || newVersion > oldVersion) {
                openFileVersions.set(textDocumentChangeEvent.document.uri.toString(), newVersion);
            }
        }
    }

    public onDidOpenTextDocument(document: vscode.TextDocument): void {
        if (document.uri.scheme === "file") {
            const uri: string = document.uri.toString();
            openFileVersions.set(uri, document.version);
        }
    }

    public onDidCloseTextDocument(document: vscode.TextDocument): void {
        const uri: string = document.uri.toString();
        if (this.semanticTokensProvider) {
            this.semanticTokensProvider.removeFile(uri);
        }
        if (this.inlayHintsProvider) {
            this.inlayHintsProvider.removeFile(uri);
        }
        this.inactiveRegionsDecorations.delete(uri);
        if (diagnosticsCollectionIntelliSense) {
            diagnosticsCollectionIntelliSense.delete(document.uri);
        }
        this.copilotCompletionProvider?.removeFile(uri);
        openFileVersions.delete(uri);
    }

    public isProviderRegistered(extensionId: string | undefined): boolean {
        if (extensionId === undefined || this.registeredProviders === undefined) {
            return false;
        }
        for (const provider of this.registeredProviders.Value) {
            if (provider === extensionId) {
                return true;
            }
        }
        return false;
    }

    private async onCustomConfigurationProviderRegistered(provider: CustomConfigurationProvider1): Promise<void> {
        // version 2 providers control the browse.path. Avoid thrashing the tag parser database by pausing parsing until
        // the provider has sent the correct browse.path value.
        if (provider.version >= Version.v2) {
            return this.pauseParsing();
        }
    }

    public async onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Promise<void> {
        await this.ready;

        if (this.registeredProviders === undefined // Shouldn't happen.
            // Prevent duplicate processing.
            || this.registeredProviders.Value.includes(provider.extensionId)) {
            return;
        }
        this.registeredProviders.Value.push(provider.extensionId);
        const rootFolder: vscode.WorkspaceFolder | undefined = this.RootFolder;
        if (!rootFolder) {
            return; // There is no c_cpp_properties.json to edit because there is no folder open.
        }
        this.configuration.handleConfigurationChange();
        if (this.configStateReceived.configProviders === undefined) {
            this.configStateReceived.configProviders = [];
        }
        this.configStateReceived.configProviders.push(provider);
        const selectedProvider: string | undefined = this.configuration.CurrentConfigurationProvider;
        if (!selectedProvider || this.showConfigureIntelliSenseButton) {
            void this.handleConfigStatus("configProviders");
            if (!selectedProvider) {
                return;
            }
        }
        if (isSameProviderExtensionId(selectedProvider, provider.extensionId)) {
            void this.onCustomConfigurationProviderRegistered(provider).catch(logAndReturn.undefined);
            telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": provider.extensionId });
        } else if (selectedProvider === provider.name) {
            void this.onCustomConfigurationProviderRegistered(provider).catch(logAndReturn.undefined);
            await this.configuration.updateCustomConfigurationProvider(provider.extensionId); // v0 -> v1 upgrade. Update the configurationProvider in c_cpp_properties.json
        }
    }

    public async updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Promise<void> {
        await this.ready;

        if (!this.configurationProvider) {
            return this.clearCustomConfigurations();
        }
        const currentProvider: CustomConfigurationProvider1 | undefined = getCustomConfigProviders().get(this.configurationProvider);
        if (!currentProvider) {
            return this.clearCustomConfigurations();
        }
        if (requestingProvider && requestingProvider.extensionId !== currentProvider.extensionId) {
            // If we are being called by a configuration provider other than the current one, ignore it.
            return;
        }
        if (!currentProvider.isReady) {
            return;
        }

        await this.clearCustomConfigurations();
    }

    public async updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Promise<void> {
        await this.ready;

        if (!this.configurationProvider) {
            return;
        }

        const currentProvider: CustomConfigurationProvider1 | undefined = getCustomConfigProviders().get(this.configurationProvider);
        if (!currentProvider || !currentProvider.isReady || (requestingProvider && requestingProvider.extensionId !== currentProvider.extensionId)) {
            return;
        }

        const tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
        let config: WorkspaceBrowseConfiguration | null = null;
        let hasCompleted: boolean = false;
        try {
            if (this.RootUri && await currentProvider.canProvideBrowseConfigurationsPerFolder(tokenSource.token)) {
                config = await currentProvider.provideFolderBrowseConfiguration(this.RootUri, tokenSource.token);
            } else if (await currentProvider.canProvideBrowseConfiguration(tokenSource.token)) {
                config = await currentProvider.provideBrowseConfiguration(tokenSource.token);
            } else if (currentProvider.version >= Version.v2) {
                console.warn("failed to provide browse configuration");
            }
        } catch {
            if (!hasCompleted) {
                hasCompleted = true;
                if (currentProvider.version >= Version.v2) {
                    await this.resumeParsing();
                }
            }
        }

        // Initiate request for custom configuration.
        // Resume parsing on either resolve or reject, only if parsing was not resumed due to timeout

        if (config) {
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
                    await this.resumeParsing();
                }
            }
        }

        // Set up a timeout to use previously received configuration and resume parsing if the provider times out
        global.setTimeout(() => {
            if (!hasCompleted) {
                hasCompleted = true;
                this.sendCustomBrowseConfiguration(null, undefined, Version.v0, true);
                if (currentProvider.version >= Version.v2) {
                    console.warn(`Configuration Provider timed out in ${configProviderTimeout}ms.`);
                    void this.resumeParsing().catch(logAndReturn.undefined);
                }
            }
        }, configProviderTimeout);

    }

    public toggleReferenceResultsView(): void {
        workspaceReferences.toggleGroupView();
    }

    public async logDiagnostics(): Promise<void> {
        await this.ready;
        const response: GetDiagnosticsResult = await this.languageClient.sendRequest(GetDiagnosticsRequest, null);
        const diagnosticsChannel: vscode.OutputChannel = getDiagnosticsChannel();
        diagnosticsChannel.clear();

        const header: string = `-------- Diagnostics - ${new Date().toLocaleString()}\n`;
        const version: string = `Version: ${util.packageJson.version}\n`;
        let configJson: string = "";
        if (this.configuration.CurrentConfiguration) {
            configJson = `Current Configuration:\n${JSON.stringify(this.configuration.CurrentConfiguration, null, 4)}\n`;
        }
        const userModifiedSettings = Object.entries(this.settingsTracker.getUserModifiedSettings());
        if (userModifiedSettings.length > 0) {
            const settings: Record<string, any> = {};
            for (const [key] of userModifiedSettings) {
                // Some settings were renamed during a telemetry change, so we need to undo that here.
                const realKey = key.endsWith('2') ? key.slice(0, key.length - 1) : key;
                const fullKey = `C_Cpp.${realKey}`;
                settings[fullKey] = vscode.workspace.getConfiguration("C_Cpp").get(realKey) ?? '<error-retrieving-value>';
            }
            configJson += `Modified Settings:\n${JSON.stringify(settings, null, 4)}\n`;
        }

        {
            const editorSettings = new OtherSettings(this.RootUri);
            const settings: Record<string, any> = {};
            settings.editorTabSize = editorSettings.editorTabSize;
            settings.editorInsertSpaces = editorSettings.editorInsertSpaces;
            settings.editorAutoClosingBrackets = editorSettings.editorAutoClosingBrackets;
            settings.filesEncoding = editorSettings.filesEncoding;
            settings.filesAssociations = editorSettings.filesAssociations;
            settings.filesExclude = editorSettings.filesExclude;
            settings.filesAutoSaveAfterDelay = editorSettings.filesAutoSaveAfterDelay;
            settings.editorInlayHintsEnabled = editorSettings.editorInlayHintsEnabled;
            settings.editorParameterHintsEnabled = editorSettings.editorParameterHintsEnabled;
            settings.searchExclude = editorSettings.searchExclude;
            settings.workbenchSettingsEditor = editorSettings.workbenchSettingsEditor;
            configJson += `Additional Tracked Settings:\n${JSON.stringify(settings, null, 4)}\n`;
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
        await this.ready;
        return this.languageClient.sendNotification(RescanFolderNotification);
    }

    public async provideCustomConfiguration(docUri: vscode.Uri): Promise<void> {
        let isProviderRegistered: boolean = false;
        const onFinished: () => void = () => {
            void this.languageClient.sendNotification(FinishedRequestCustomConfig, { uri: docUri.toString(), isProviderRegistered });
        };
        try {
            const providerId: string | undefined = this.configurationProvider;
            if (!providerId) {
                return;
            }
            const provider: CustomConfigurationProvider1 | undefined = getCustomConfigProviders().get(providerId);
            if (!provider || !provider.isReady) {
                return;
            }
            isProviderRegistered = true;
            const resultCode = await this.provideCustomConfigurationAsync(docUri, provider);
            telemetry.logLanguageServerEvent('provideCustomConfiguration', { providerId, resultCode });
        } finally {
            onFinished();
        }
    }

    private async provideCustomConfigurationAsync(docUri: vscode.Uri, provider: CustomConfigurationProvider1): Promise<string> {
        const tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();

        // Need to loop through candidates, to see if we can get a custom configuration from any of them.
        // Wrap all lookups in a single task, so we can apply a timeout to the entire duration.
        const provideConfigurationAsync: () => Thenable<SourceFileConfigurationItem[] | undefined> = async () => {
            try {
                if (!await provider.canProvideConfiguration(docUri, tokenSource.token)) {
                    return [];
                }
            } catch (err) {
                console.warn("Caught exception from canProvideConfiguration");
            }
            let configs: util.Mutable<SourceFileConfigurationItem>[] = [];
            try {
                configs = await provider.provideConfigurations([docUri], tokenSource.token);
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
            return undefined;
        };
        let result: string = "success";
        try {
            const configs: SourceFileConfigurationItem[] | undefined = await this.callTaskWithTimeout(provideConfigurationAsync, configProviderTimeout, tokenSource);
            if (configs && configs.length > 0) {
                this.sendCustomConfigurations(configs, provider.version);
            } else {
                result = "noConfigurations";
            }
        } catch (err) {
            result = "timeout";
            const settings: CppSettings = new CppSettings(this.RootUri);
            if (settings.isConfigurationWarningsEnabled && !this.isExternalHeader(docUri) && !vscode.debug.activeDebugSession) {
                const dismiss: string = localize("dismiss.button", "Dismiss");
                const disable: string = localize("disable.warnings.button", "Disable Warnings");
                const configName: string | undefined = this.configuration.CurrentConfiguration?.name;
                if (!configName) {
                    return "noConfigName";
                }
                let message: string = localize("unable.to.provide.configuration",
                    "{0} is unable to provide IntelliSense configuration information for '{1}'. Settings from the '{2}' configuration will be used instead.",
                    provider.name, docUri.fsPath, configName);
                if (err) {
                    message += ` (${err})`;
                }

                if (await vscode.window.showInformationMessage(message, dismiss, disable) === disable) {
                    settings.toggleSetting("configurationWarnings", "enabled", "disabled");
                }
            }
        }
        return result;
    }

    private handleRequestCustomConfig(file: string): void {
        const uri: vscode.Uri = vscode.Uri.file(file);
        const client: Client = clients.getClientFor(uri);
        if (client instanceof DefaultClient) {
            const defaultClient: DefaultClient = client as DefaultClient;
            void defaultClient.provideCustomConfiguration(uri).catch(logAndReturn.undefined);
        }
    }

    private isExternalHeader(uri: vscode.Uri): boolean {
        const rootUri: vscode.Uri | undefined = this.RootUri;
        return !rootUri || (util.isHeaderFile(uri) && !uri.toString().startsWith(rootUri.toString()));
    }

    public async getCurrentConfigName(): Promise<string | undefined> {
        await this.ready;
        return this.configuration.CurrentConfiguration?.name;
    }

    public async getCurrentConfigCustomVariable(variableName: string): Promise<string> {
        await this.ready;
        return this.configuration.CurrentConfiguration?.customConfigurationVariables?.[variableName] ?? '';
    }

    public async setCurrentConfigName(configurationName: string): Promise<void> {
        await this.ready;

        const configurations: configs.Configuration[] = this.configuration.Configurations ?? [];
        const configurationIndex: number = configurations.findIndex((config) => config.name === configurationName);

        if (configurationIndex === -1) {
            throw new Error(localize("config.not.found", "The requested configuration name is not found: {0}", configurationName));
        }
        this.configuration.select(configurationIndex);
    }

    public async getCurrentCompilerPathAndArgs(): Promise<util.CompilerPathAndArgs | undefined> {
        const settings: CppSettings = new CppSettings(this.RootUri);
        await this.ready;
        return util.extractCompilerPathAndArgs(!!settings.legacyCompilerArgsBehavior,
            this.configuration.CurrentConfiguration?.compilerPath,
            this.configuration.CurrentConfiguration?.compilerArgs);
    }

    public async getVcpkgInstalled(): Promise<boolean> {
        await this.ready;
        return this.configuration.VcpkgInstalled;
    }

    public getVcpkgEnabled(): Promise<boolean> {
        const cppSettings: CppSettings = new CppSettings(this.RootUri);
        return Promise.resolve(cppSettings.vcpkgEnabled);
    }

    public async getKnownCompilers(): Promise<configs.KnownCompiler[] | undefined> {
        await this.ready;
        return this.configuration.KnownCompiler;
    }

    /**
     * Take ownership of a document that was previously serviced by another client.
     * This process involves sending a textDocument/didOpen message to the server so
     * that it knows about the file, as well as adding it to this client's set of
     * tracked documents.
     */
    public takeOwnership(document: vscode.TextDocument): void {
        this.trackedDocuments.set(document.uri.toString(), document);
    }

    // Only used in crash recovery. Otherwise, VS Code sends didOpen directly to native process (through the protocolFilter).
    public async sendDidOpen(document: vscode.TextDocument): Promise<void> {
        const params: DidOpenTextDocumentParams = {
            textDocument: {
                uri: document.uri.toString(),
                languageId: document.languageId,
                version: document.version,
                text: document.getText()
            }
        };
        await this.ready;
        await this.languageClient.sendNotification(DidOpenNotification, params);
    }

    /**
     * Copilot completion-related requests (e.g. getIncludes and getProjectContext) will have their cancellation tokens cancelled
     * if the current request times out (showing the user completion results without context info),
     * but the results can still be used for future requests (due to caching) so it's better to return results instead of cancelling.
     * This is different behavior from the getChatContext, which does handle cancel requests, since the request blocks
     * the UI results and always re-requests (no caching).
    */

    public async getIncludes(uri: vscode.Uri, maxDepth: number): Promise<GetIncludesResult> {
        const params: GetIncludesParams = { fileUri: uri.toString(), maxDepth };
        await this.ready;
        return this.languageClient.sendRequest(IncludesRequest, params);
    }

    public async getChatContext(uri: vscode.Uri, token: vscode.CancellationToken): Promise<ChatContextResult> {
        const params: TextDocumentIdentifier = { uri: uri.toString() };
        await withCancellation(this.ready, token);
        return DefaultClient.withLspCancellationHandling(
            () => this.languageClient.sendRequest(CppContextRequest, params, token), token);
    }

    public async getCompletionContext(file: vscode.Uri, caretOffset: number, featureFlag: CopilotCompletionContextFeatures,
        maxSnippetCount: number, maxSnippetLength: number, doAggregateSnippets: boolean,
        token: vscode.CancellationToken): Promise<CopilotCompletionContextResult> {
        await withCancellation(this.ready, token);
        return DefaultClient.withLspCancellationHandling(
            () => this.languageClient.sendRequest(CopilotCompletionContextRequest,
                { uri: file.toString(), caretOffset, featureFlag, maxSnippetCount, maxSnippetLength, doAggregateSnippets }, token), token);
    }

    /**
     * a Promise that can be awaited to know when it's ok to proceed.
     *
     * This is a lighter-weight complement to `enqueue()`
     *
     * Use `await <client>.ready` when you need to ensure that the client is initialized, and to run in order
     * Use `enqueue()` when you want to ensure that subsequent calls are blocked until a critical bit of code is run.
     *
     * This is lightweight, because if the queue is empty, then the only thing to wait for is the client itself to be initialized
     */
    get ready(): Promise<void> {
        if (!DefaultClient.dispatching.isCompleted || DefaultClient.queue.length) {
            // if the dispatcher has stuff going on, then we need to stick in a promise into the queue so we can
            // be notified when it's our turn
            const p = new ManualPromise<void>();
            DefaultClient.queue.push([p as ManualPromise<unknown>]);
            return p;
        }

        // otherwise, we're only waiting for the client to be in an initialized state, in which case just wait for that.
        return DefaultClient.isStarted;
    }

    /**
     * Enqueue a task to ensure that the order is maintained. The tasks are executed sequentially after the client is ready.
     *
     * this is a bit more expensive than `.ready` - this ensures the task is absolutely finished executing before allowing
     * the dispatcher to move forward.
     *
     * Use `enqueue()` when you want to ensure that subsequent calls are blocked until a critical bit of code is run.
     * Use `await <client>.ready` when you need to ensure that the client is initialized, and still run in order.
     */
    enqueue<T>(task: () => Promise<T>) {
        ok(this.isSupported, localize("unsupported.client", "Unsupported client"));

        // create a placeholder promise that is resolved when the task is complete.
        const result = new ManualPromise<unknown>();

        // add the task to the queue
        DefaultClient.queue.push([result, task]);

        // if we're not already dispatching, start
        if (DefaultClient.dispatching.isSet) {
            // start dispatching
            void DefaultClient.dispatch();
        }

        // return the placeholder promise to the caller.
        return result as Promise<T>;
    }

    /**
     * The dispatch loop asynchronously processes items in the async queue in order, and ensures that tasks are dispatched in the
     * order they were inserted.
     */
    private static async dispatch() {
        // reset the promise for the dispatcher
        DefaultClient.dispatching.reset();

        do {
            // ensure that this is OK to start working
            await this.isStarted;

            // pick items up off the queue and run then one at a time until the queue is empty
            const [promise, task] = DefaultClient.queue.shift() ?? [];
            if (is.promise(promise)) {
                try {
                    promise.resolve(task ? await task() : undefined);
                } catch (e) {
                    console.log(e);
                    promise.reject(e);
                }
            }
        } while (DefaultClient.queue.length);

        // unblock anything that is waiting for the dispatcher to empty
        this.dispatching.resolve();
    }

    private static async withLspCancellationHandling<T>(task: () => Promise<T>, token: vscode.CancellationToken): Promise<T> {
        let result: T;

        try {
            result = await task();
        } catch (e: any) {
            if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
                throw new vscode.CancellationError();
            } else {
                throw e;
            }
        }
        if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        return result;
    }

    private callTaskWithTimeout<T>(task: () => Thenable<T>, ms: number, cancelToken?: vscode.CancellationTokenSource): Promise<T> {
        let timer: NodeJS.Timeout;

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

    /**
     * listen for notifications from the language server.
     */
    private registerNotifications(): void {
        console.assert(this.languageClient !== undefined, "This method must not be called until this.languageClient is set in \"onReady\"");

        this.languageClient.onNotification(ReloadWindowNotification, () => void util.promptForReloadWindowDueToSettingsChange());
        this.languageClient.onNotification(UpdateTrustedCompilersNotification, (e) => void this.addTrustedCompiler(e.compilerPath));
        this.languageClient.onNotification(ReportStatusNotification, (e) => void this.updateStatus(e));
        this.languageClient.onNotification(ReportTagParseStatusNotification, (e) => this.updateTagParseStatus(e));
        this.languageClient.onNotification(CompileCommandsPathsNotification, (e) => void this.promptCompileCommands(e));
        this.languageClient.onNotification(ReferencesNotification, (e) => this.processReferencesPreview(e));
        this.languageClient.onNotification(ReportReferencesProgressNotification, (e) => this.handleReferencesProgress(e));
        this.languageClient.onNotification(RequestCustomConfig, (e) => this.handleRequestCustomConfig(e));
        this.languageClient.onNotification(IntelliSenseResultNotification, (e) => this.handleIntelliSenseResult(e));
        this.languageClient.onNotification(PublishRefactorDiagnosticsNotification, publishRefactorDiagnostics);
        RegisterCodeAnalysisNotifications(this.languageClient);
        this.languageClient.onNotification(ShowWarningNotification, showWarning);
        this.languageClient.onNotification(ReportTextDocumentLanguage, (e) => this.setTextDocumentLanguage(e));
        this.languageClient.onNotification(IntelliSenseSetupNotification, (e) => this.logIntelliSenseSetupTime(e));
        this.languageClient.onNotification(SetTemporaryTextDocumentLanguageNotification, (e) => void this.setTemporaryTextDocumentLanguage(e));
        this.languageClient.onNotification(ReportCodeAnalysisProcessedNotification, (e) => this.updateCodeAnalysisProcessed(e));
        this.languageClient.onNotification(ReportCodeAnalysisTotalNotification, (e) => this.updateCodeAnalysisTotal(e));
        this.languageClient.onNotification(DoxygenCommentGeneratedNotification, (e) => void this.insertDoxygenComment(e));
        this.languageClient.onNotification(CanceledReferencesNotification, this.serverCanceledReferences);
        this.languageClient.onNotification(FilesEncodingChangedNotification, (e) => this.filesEncodingChanged(e));
    }

    private handleIntelliSenseResult(intelliSenseResult: IntelliSenseResult): void {
        const fileVersion: number | undefined = openFileVersions.get(intelliSenseResult.uri);
        if (fileVersion !== undefined && fileVersion !== intelliSenseResult.fileVersion) {
            return;
        }

        if (this.semanticTokensProvider) {
            this.semanticTokensProvider.deliverTokens(intelliSenseResult.uri, intelliSenseResult.semanticTokens, intelliSenseResult.clearExistingSemanticTokens);
        }
        if (this.inlayHintsProvider) {
            this.inlayHintsProvider.deliverInlayHints(intelliSenseResult.uri, intelliSenseResult.inlayHints, intelliSenseResult.clearExistingInlayHint);
        }

        this.updateInactiveRegions(intelliSenseResult.uri, intelliSenseResult.inactiveRegions, intelliSenseResult.clearExistingInactiveRegions, intelliSenseResult.isCompletePass);
        if (intelliSenseResult.clearExistingDiagnostics || intelliSenseResult.diagnostics.length > 0) {
            this.updateSquiggles(intelliSenseResult.uri, intelliSenseResult.diagnostics, intelliSenseResult.clearExistingDiagnostics);
        }
    }

    private updateSquiggles(uriString: string, diagnostics: IntelliSenseDiagnostic[], startNewSet: boolean): void {

        if (!diagnosticsCollectionIntelliSense) {
            diagnosticsCollectionIntelliSense = vscode.languages.createDiagnosticCollection(configPrefix + "IntelliSense");
        }

        // Convert from our Diagnostic objects to vscode Diagnostic objects

        const diagnosticsIntelliSense: vscode.Diagnostic[] = [];
        diagnostics.forEach((d) => {
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

        const realUri: vscode.Uri = vscode.Uri.parse(uriString);
        if (!startNewSet) {
            const existingDiagnostics: readonly vscode.Diagnostic[] | undefined = diagnosticsCollectionIntelliSense.get(realUri);
            if (existingDiagnostics) {
                // Note: The spread operator puts every element on the stack, so it should be avoided for large arrays.
                Array.prototype.push.apply(diagnosticsIntelliSense, existingDiagnostics as any[]);
            }
        }
        diagnosticsCollectionIntelliSense.set(realUri, diagnosticsIntelliSense);

        clients.timeTelemetryCollector.setUpdateRangeTime(realUri);
    }

    private setTextDocumentLanguage(languageStr: string): void {
        const cppSettings: CppSettings = new CppSettings();
        if (cppSettings.autoAddFileAssociations) {
            const is_c: boolean = languageStr.startsWith("c;");
            const is_cuda: boolean = languageStr.startsWith("cu;");
            languageStr = languageStr.substring(is_c ? 2 : is_cuda ? 3 : 1);
            this.addFileAssociations(languageStr, is_c ? "c" : is_cuda ? "cuda-cpp" : "cpp");
        }
    }

    private async setTemporaryTextDocumentLanguage(params: SetTemporaryTextDocumentLanguageParams): Promise<void> {
        const languageId: string = params.isC ? "c" : params.isCuda ? "cuda-cpp" : "cpp";
        const uri: vscode.Uri = vscode.Uri.parse(params.uri);
        const client: Client = clients.getClientFor(uri);
        const document: vscode.TextDocument | undefined = client.TrackedDocuments.get(params.uri);
        if (!!document && document.languageId !== languageId) {
            if (document.languageId === "cpp" && languageId === "c") {
                handleChangedFromCppToC(document);
            }
            await vscode.languages.setTextDocumentLanguage(document, languageId);
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

                void this.languageClient.sendNotification(FileCreatedNotification, { uri: uri.toString() }).catch(logAndReturn.undefined);
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
                            void this.languageClient.sendNotification(FileChangedNotification, { uri: uri.toString() }).catch(logAndReturn.undefined);
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
                void this.languageClient.sendNotification(FileDeletedNotification, { uri: uri.toString() }).catch(logAndReturn.undefined);
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
                    const matcher = new minimatch.Minimatch(assoc);
                    if (matcher.match(filePath)) {
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

    private logTelemetry(notificationBody: TelemetryPayload): void {
        if (notificationBody.event === "includeSquiggles" && this.configurationProvider && notificationBody.properties) {
            notificationBody.properties["providerId"] = this.configurationProvider;
        }
        telemetry.logLanguageServerEvent(notificationBody.event, notificationBody.properties, notificationBody.metrics);
    }

    private async updateStatus(notificationBody: ReportStatusNotificationBody): Promise<void> {
        const message: string = notificationBody.status;
        util.setProgress(util.getProgressExecutableSuccess());
        const testHook: TestHook = getTestHook();
        if (message.endsWith("Idle")) {
            const status: IntelliSenseStatus = { status: Status.Idle };
            testHook.updateStatus(status);
        } else if (message.endsWith("Parsing")) {
            this.model.isParsingWorkspace.Value = true;
            this.model.isInitializingWorkspace.Value = false;
            this.model.isIndexingWorkspace.Value = false;
            const status: IntelliSenseStatus = { status: Status.TagParsingBegun };
            testHook.updateStatus(status);
        } else if (message.endsWith("Initializing")) {
            this.model.isInitializingWorkspace.Value = true;
            this.model.isIndexingWorkspace.Value = false;
            this.model.isParsingWorkspace.Value = false;
        } else if (message.endsWith("Indexing")) {
            this.model.isIndexingWorkspace.Value = true;
            this.model.isInitializingWorkspace.Value = false;
            this.model.isParsingWorkspace.Value = false;
        } else if (message.endsWith("files")) {
            this.model.isParsingFiles.Value = true;
        } else if (message.endsWith("IntelliSense")) {
            timeStamp = Date.now();
            this.model.isUpdatingIntelliSense.Value = true;
            const status: IntelliSenseStatus = { status: Status.IntelliSenseCompiling };
            testHook.updateStatus(status);
        } else if (message.endsWith("IntelliSense done")) {
            getOutputChannelLogger().appendLineAtLevel(6, localize("update.intellisense.time", "Update IntelliSense time (sec): {0}", (Date.now() - timeStamp) / 1000));
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
        }
    }

    private updateTagParseStatus(tagParseStatus: TagParseStatus): void {
        this.model.parsingWorkspaceStatus.Value = getLocalizedString(tagParseStatus.localizeStringParams);
        this.model.isParsingWorkspacePaused.Value = tagParseStatus.isPaused;
    }

    private updateInactiveRegions(uriString: string, inactiveRegions: InputRegion[], startNewSet: boolean, updateFoldingRanges: boolean): void {
        if (this.codeFoldingProvider && updateFoldingRanges) {
            this.codeFoldingProvider.refresh();
        }

        const client: Client = clients.getClientFor(vscode.Uri.parse(uriString));
        if (!(client instanceof DefaultClient) || (!startNewSet && inactiveRegions.length === 0)) {
            return;
        }
        const settings: CppSettings = new CppSettings(client.RootUri);
        const dimInactiveRegions: boolean = settings.dimInactiveRegions;
        let currentSet: DecorationRangesPair | undefined = this.inactiveRegionsDecorations.get(uriString);
        if (startNewSet || !dimInactiveRegions) {
            if (currentSet) {
                currentSet.decoration.dispose();
                this.inactiveRegionsDecorations.delete(uriString);
            }
            if (!dimInactiveRegions) {
                return;
            }
            currentSet = undefined;
        }
        if (currentSet === undefined) {
            const opacity: number | undefined = settings.inactiveRegionOpacity;
            currentSet = {
                decoration: vscode.window.createTextEditorDecorationType({
                    opacity: (opacity === undefined) ? "0.55" : opacity.toString(),
                    backgroundColor: settings.inactiveRegionBackgroundColor,
                    color: settings.inactiveRegionForegroundColor,
                    rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
                }),
                ranges: []
            };
            this.inactiveRegionsDecorations.set(uriString, currentSet);
        }

        Array.prototype.push.apply(currentSet.ranges, inactiveRegions.map(element => new vscode.Range(element.startLine, 0, element.endLine, 0)));

        // Apply the decorations to all *visible* text editors
        const editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === uriString);
        for (const e of editors) {
            e.setDecorations(currentSet.decoration, currentSet.ranges);
        }
    }

    public logIntelliSenseSetupTime(notification: IntelliSenseSetup): void {
        clients.timeTelemetryCollector.setSetupTime(vscode.Uri.parse(notification.uri));
    }

    private compileCommandsPaths: string[] = [];
    private async promptCompileCommands(params: CompileCommandsPaths): Promise<void> {
        if (!params.workspaceFolderUri) {
            return;
        }
        const potentialClient: Client = clients.getClientFor(vscode.Uri.file(params.workspaceFolderUri));
        const client: DefaultClient = potentialClient as DefaultClient;
        if (!client) {
            return;
        }
        if (client.configStateReceived.compileCommands) {
            return;
        }

        client.compileCommandsPaths = params.paths;
        client.configStateReceived.compileCommands = true;
        await client.handleConfigStatus("compileCommands");
    }

    public async handleConfigStatus(sender?: string): Promise<void> {
        if (!this.configStateReceived.timeout
            && (!this.configStateReceived.compilers || !this.configStateReceived.compileCommands || !this.configStateReceived.configProviders)) {
            return; // Wait till the config state is recevied or timed out.
        }

        const rootFolder: vscode.WorkspaceFolder | undefined = this.RootFolder;
        const settings: CppSettings = new CppSettings(this.RootUri);
        const configProviderNotSet: boolean = !settings.defaultConfigurationProvider && !this.configuration.CurrentConfiguration?.configurationProvider &&
            !this.configuration.CurrentConfiguration?.configurationProviderInCppPropertiesJson;
        const configProviderNotSetAndNoCache: boolean = configProviderNotSet && this.lastCustomBrowseConfigurationProviderId?.Value === undefined;
        const compileCommandsNotSet: boolean = !settings.defaultCompileCommands && !this.configuration.CurrentConfiguration?.compileCommands && !this.configuration.CurrentConfiguration?.compileCommandsInCppPropertiesJson;

        // Handle config providers
        const provider: CustomConfigurationProvider1 | undefined =
            !this.configStateReceived.configProviders ? undefined :
                this.configStateReceived.configProviders.length === 0 ? undefined : this.configStateReceived.configProviders[0];
        let showConfigStatus: boolean = false;
        if (rootFolder && configProviderNotSetAndNoCache && provider && (sender === "configProviders")) {
            const ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("Client.registerProvider", true, rootFolder);
            showConfigStatus = ask.Value;
        }

        // Handle compile commands
        if (rootFolder && configProviderNotSetAndNoCache && !this.configStateReceived.configProviders &&
            compileCommandsNotSet && this.compileCommandsPaths.length > 0 && (sender === "compileCommands")) {
            const ask: PersistentFolderState<boolean> = new PersistentFolderState<boolean>("CPP.showCompileCommandsSelection", true, rootFolder);
            showConfigStatus = ask.Value;
        }

        const compilerPathNotSet: boolean = settings.defaultCompilerPath === null && this.configuration.CurrentConfiguration?.compilerPath === undefined && this.configuration.CurrentConfiguration?.compilerPathInCppPropertiesJson === undefined;
        const configurationNotSet: boolean = configProviderNotSetAndNoCache && compileCommandsNotSet && compilerPathNotSet;

        showConfigStatus = showConfigStatus || (configurationNotSet &&
            !!compilerDefaults && !compilerDefaults.trustedCompilerFound && trustedCompilerPaths && (trustedCompilerPaths.length !== 1 || trustedCompilerPaths[0] !== ""));

        const configProviderType: ConfigurationType = this.configuration.ConfigProviderAutoSelected ? ConfigurationType.AutoConfigProvider : ConfigurationType.ConfigProvider;
        const compilerType: ConfigurationType = this.configuration.CurrentConfiguration?.compilerPathIsExplicit ? ConfigurationType.CompilerPath : ConfigurationType.AutoCompilerPath;
        const configType: ConfigurationType =
            !configProviderNotSet ? configProviderType :
                !compileCommandsNotSet ? ConfigurationType.CompileCommands :
                    !compilerPathNotSet ? compilerType :
                        ConfigurationType.NotConfigured;

        this.showConfigureIntelliSenseButton = showConfigStatus;
        return ui.ShowConfigureIntelliSenseButton(showConfigStatus, this, configType, "handleConfig");
    }

    /**
     * requests to the language server
     */
    public async requestSwitchHeaderSource(rootUri: vscode.Uri, fileName: string): Promise<string> {
        const params: SwitchHeaderSourceParams = {
            switchHeaderSourceFileName: fileName,
            workspaceFolderUri: rootUri.toString()
        };
        return this.enqueue(async () => this.languageClient.sendRequest(SwitchHeaderSourceRequest, params));
    }

    public async requestCompiler(newCompilerPath?: string): Promise<configs.CompilerDefaults> {
        const params: QueryDefaultCompilerParams = {
            newTrustedCompilerPath: newCompilerPath ?? ""
        };
        const results: configs.CompilerDefaults = await this.languageClient.sendRequest(QueryCompilerDefaultsRequest, params);
        void SessionState.scanForCompilersDone.set(true);
        void SessionState.scanForCompilersEmpty.set(results.knownCompilers === undefined || !results.knownCompilers.length);
        void SessionState.trustedCompilerFound.set(results.trustedCompilerFound);
        return results;
    }

    public updateActiveDocumentTextOptions(): void {
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (editor && util.isCpp(editor.document)) {
            void SessionState.buildAndDebugIsSourceFile.set(util.isCppOrCFile(editor.document.uri));
            void SessionState.buildAndDebugIsFolderOpen.set(util.isFolderOpen(editor.document.uri));
            // If using vcFormat, check for a ".editorconfig" file, and apply those text options to the active document.
            const settings: CppSettings = new CppSettings(this.RootUri);
            if (settings.useVcFormat(editor.document)) {
                const editorConfigSettings: any = getEditorConfigSettings(editor.document.uri.fsPath);
                if (editorConfigSettings.indent_style === "tab") {
                    editor.options.insertSpaces = false;
                } else if (editorConfigSettings.indent_style === "space") {
                    editor.options.insertSpaces = true;
                }
                if (editorConfigSettings.indent_size !== undefined) {
                    if (editorConfigSettings.indent_size === "tab") {
                        editor.options.indentSize = "tabSize";
                    } else {
                        editor.options.indentSize = editorConfigSettings.indent_size;
                        editor.options.tabSize = editorConfigSettings.indent_size;
                    }
                }
                if (editorConfigSettings.tab_width !== undefined) {
                    editor.options.tabSize = editorConfigSettings.tab_width;
                }
                if (editorConfigSettings.end_of_line !== undefined) {
                    void editor.edit((edit) => {
                        edit.setEndOfLine(editorConfigSettings.end_of_line === "lf" ? vscode.EndOfLine.LF : vscode.EndOfLine.CRLF);
                    }).then(undefined, logAndReturn.undefined);
                }
            }
        } else {
            void SessionState.buildAndDebugIsSourceFile.set(false);
        }
    }

    /**
     * notifications to the language server
     */
    public async didChangeActiveEditor(editor?: vscode.TextEditor): Promise<void> {
        // For now, we ignore deactivation events.
        // VS will refresh IntelliSense on activation, as a catch-all for file changes in
        // other applications. But VS Code will deactivate the document when focus is moved
        // to another control, such as the Output window. So, to avoid costly updates, we
        // only trigger that update when focus moves from one C++ document to another.
        // Fortunately, VS Code generates file-change notifications for all files
        // in the workspace, so we should trigger appropriate updates for most changes
        // made in other applications.
        if (!editor || !util.isCpp(editor.document)) {
            return;
        }

        this.updateActiveDocumentTextOptions();

        const params: DidChangeActiveEditorParams = {
            uri: editor?.document?.uri.toString(),
            selection: editor ? makeLspRange(editor.selection) : undefined
        };

        return this.languageClient.sendNotification(DidChangeActiveEditorNotification, params).catch(logAndReturn.undefined);
    }

    /**
     * send notifications to the language server to restart IntelliSense for the selected file.
     */
    public async restartIntelliSenseForFile(document: vscode.TextDocument): Promise<void> {
        await this.ready;
        return this.languageClient.sendNotification(RestartIntelliSenseForFileNotification, this.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document)).catch(logAndReturn.undefined);
    }

    /**
     * enable UI updates from this client and resume tag parsing on the server.
     */
    public activate(): void {
        this.model.activate();
        void this.resumeParsing().catch(logAndReturn.undefined);
    }

    public async selectionChanged(selection: Range): Promise<void> {
        return this.languageClient.sendNotification(DidChangeTextEditorSelectionNotification, selection);
    }

    public async resetDatabase(): Promise<void> {
        await this.ready;
        return this.languageClient.sendNotification(ResetDatabaseNotification);
    }

    /**
     * disable UI updates from this client and pause tag parsing on the server.
     */
    public deactivate(): void {
        this.model.deactivate();
    }

    public async pauseParsing(): Promise<void> {
        await this.ready;
        return this.languageClient.sendNotification(PauseParsingNotification);
    }

    public async resumeParsing(): Promise<void> {
        await this.ready;
        return this.languageClient.sendNotification(ResumeParsingNotification);
    }

    public async PauseCodeAnalysis(): Promise<void> {
        await this.ready;
        this.model.isCodeAnalysisPaused.Value = true;
        return this.languageClient.sendNotification(PauseCodeAnalysisNotification);
    }

    public async ResumeCodeAnalysis(): Promise<void> {
        await this.ready;
        this.model.isCodeAnalysisPaused.Value = false;
        return this.languageClient.sendNotification(ResumeCodeAnalysisNotification);
    }

    public async CancelCodeAnalysis(): Promise<void> {
        await this.ready;
        return this.languageClient.sendNotification(CancelCodeAnalysisNotification);
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
            edits.push(new vscode.TextEdit(newRange, result.contents));
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
            const modifiedConfig: configs.Configuration = deepCopy(c);
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
        if (!!this.lastCustomBrowseConfigurationProviderId && !!this.lastCustomBrowseConfiguration && !!this.lastCustomBrowseConfigurationProviderVersion) {
            if (!this.doneInitialCustomBrowseConfigurationCheck) {
                // Send the last custom browse configuration we received from this provider.
                // This ensures we don't start tag parsing without it, and undo'ing work we have to re-do when the (likely same) browse config arrives
                // Should only execute on launch, for the initial delivery of configurations
                if (this.lastCustomBrowseConfiguration.Value) {
                    this.sendCustomBrowseConfiguration(this.lastCustomBrowseConfiguration.Value, this.lastCustomBrowseConfigurationProviderId.Value, this.lastCustomBrowseConfigurationProviderVersion.Value);
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
                void this.clearCustomBrowseConfiguration().catch(logAndReturn.undefined);
            }
            this.configurationProvider = newProvider;
            void this.updateCustomBrowseConfiguration().catch(logAndReturn.undefined);
            void this.updateCustomConfigurations().catch(logAndReturn.undefined);
        }
    }

    private async onSelectedConfigurationChanged(index: number): Promise<void> {
        const params: FolderSelectedSettingParams = {
            currentConfiguration: index,
            workspaceFolderUri: this.RootUri?.toString()
        };
        await this.ready;
        await this.languageClient.sendNotification(ChangeSelectedSettingNotification, params);

        let configName: string = "";
        if (this.configuration.ConfigurationNames) {
            configName = this.configuration.ConfigurationNames[index];
        }
        this.model.activeConfigName.Value = configName;
        this.configuration.onDidChangeSettings();
    }

    private async onCompileCommandsChanged(path: string): Promise<void> {
        const params: FileChangedParams = {
            uri: vscode.Uri.file(path).toString(),
            workspaceFolderUri: this.RootUri?.toString()
        };
        await this.ready;
        return this.languageClient.sendNotification(ChangeCompileCommandsNotification, params);
    }

    private isSourceFileConfigurationItem(input: any, providerVersion: Version): input is SourceFileConfigurationItem {
        // IntelliSenseMode and standard are optional for version 5+.
        let areOptionalsValid: boolean = false;
        if (providerVersion < Version.v5) {
            areOptionalsValid = util.isString(input.configuration.intelliSenseMode) && util.isString(input.configuration.standard);
        } else {
            areOptionalsValid = util.isOptionalString(input.configuration.intelliSenseMode) && util.isOptionalString(input.configuration.standard);
        }
        return input && (util.isString(input.uri) || util.isUri(input.uri)) &&
            input.configuration &&
            areOptionalsValid &&
            util.isArrayOfString(input.configuration.includePath) &&
            util.isArrayOfString(input.configuration.defines) &&
            util.isOptionalArrayOfString(input.configuration.compilerArgs) &&
            util.isOptionalArrayOfString(input.configuration.forcedInclude);
    }

    private sendCustomConfigurations(configs: any, providerVersion: Version): void {
        // configs is marked as 'any' because it is untrusted data coming from a 3rd-party. We need to sanitize it before sending it to the language server.
        if (!configs || !(configs instanceof Array)) {
            console.warn("discarding invalid SourceFileConfigurationItems[]: " + configs);
            return;
        }

        const out: Logger = getOutputChannelLogger();
        out.appendLineAtLevel(6, localize("configurations.received", "Custom configurations received:"));
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
                out.appendLineAtLevel(6, `  uri: ${uri}`);
                out.appendLineAtLevel(6, `  config: ${JSON.stringify(item.configuration, null, 2)}`);
                if (item.configuration.includePath.some(path => path.endsWith('**'))) {
                    console.warn("custom include paths should not use recursive includes ('**')");
                }
                // Separate compiler path and args before sending to language client
                const itemConfig: util.Mutable<InternalSourceFileConfiguration> = deepCopy(item.configuration);
                if (util.isString(itemConfig.compilerPath)) {
                    const compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(
                        providerVersion < Version.v6,
                        itemConfig.compilerPath,
                        util.isArrayOfString(itemConfig.compilerArgs) ? itemConfig.compilerArgs : undefined);
                    itemConfig.compilerPath = compilerPathAndArgs.compilerPath ?? undefined;
                    if (itemConfig.compilerPath !== undefined) {
                        void this.addTrustedCompiler(itemConfig.compilerPath).catch(logAndReturn.undefined);
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

        // We send the higher priority notification to ensure we don't deadlock if the request is blocking the queue.
        // We send the normal priority notification to avoid a race that could result in a redundant request when racing with
        // the reset of custom configurations.
        void this.languageClient.sendNotification(CustomConfigurationHighPriorityNotification, params).catch(logAndReturn.undefined);
        void this.languageClient.sendNotification(CustomConfigurationNotification, params).catch(logAndReturn.undefined);
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
        if (!rootFolder
            || !this.lastCustomBrowseConfiguration
            || !this.lastCustomBrowseConfigurationProviderId) {
            return;
        }

        let sanitized: util.Mutable<InternalWorkspaceBrowseConfiguration>;

        this.browseConfigurationLogging = "";

        // This while (true) is here just so we can break out early if the config is set on error
        // eslint-disable-next-line no-constant-condition
        while (true) {
            // config is marked as 'any' because it is untrusted data coming from a 3rd-party. We need to sanitize it before sending it to the language server.
            if (timeoutOccured || !config || config instanceof Array) {
                if (!timeoutOccured) {
                    console.log("Received an invalid browse configuration from configuration provider.");
                }
                const configValue: WorkspaceBrowseConfiguration | undefined = this.lastCustomBrowseConfiguration.Value;
                if (configValue) {
                    sanitized = configValue;
                    if (sanitized.browsePath.length === 0) {
                        sanitized.browsePath = ["${workspaceFolder}/**"];
                    }
                    break;
                }
                return;
            }

            const browseConfig: InternalWorkspaceBrowseConfiguration = config as InternalWorkspaceBrowseConfiguration;
            sanitized = deepCopy(browseConfig);
            if (!this.isWorkspaceBrowseConfiguration(sanitized) || sanitized.browsePath.length === 0) {
                console.log("Received an invalid browse configuration from configuration provider: " + JSON.stringify(sanitized));
                const configValue: WorkspaceBrowseConfiguration | undefined = this.lastCustomBrowseConfiguration.Value;
                if (configValue) {
                    sanitized = configValue;
                    if (sanitized.browsePath.length === 0) {
                        sanitized.browsePath = ["${workspaceFolder}/**"];
                    }
                    break;
                }
                return;
            }

            getOutputChannelLogger().appendLineAtLevel(6, localize("browse.configuration.received", "Custom browse configuration received: {0}", JSON.stringify(sanitized, null, 2)));

            // Separate compiler path and args before sending to language client
            if (util.isString(sanitized.compilerPath)) {
                const compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(
                    providerVersion < Version.v6,
                    sanitized.compilerPath,
                    util.isArrayOfString(sanitized.compilerArgs) ? sanitized.compilerArgs : undefined);
                sanitized.compilerPath = compilerPathAndArgs.compilerPath ?? undefined;
                if (sanitized.compilerPath !== undefined) {
                    void this.addTrustedCompiler(sanitized.compilerPath).catch(logAndReturn.undefined);
                }
                if (providerVersion < Version.v6) {
                    sanitized.compilerArgsLegacy = compilerPathAndArgs.allCompilerArgs;
                    sanitized.compilerArgs = undefined;
                } else {
                    sanitized.compilerArgs = compilerPathAndArgs.allCompilerArgs;
                }
            }

            this.lastCustomBrowseConfiguration.Value = sanitized;
            if (!providerId) {
                this.lastCustomBrowseConfigurationProviderId.setDefault();
            } else {
                this.lastCustomBrowseConfigurationProviderId.Value = providerId;
            }
            break;
        }

        this.browseConfigurationLogging = `Custom browse configuration: \n${JSON.stringify(sanitized, null, 4)}\n`;

        const params: CustomBrowseConfigurationParams = {
            browseConfiguration: sanitized,
            workspaceFolderUri: this.RootUri?.toString()
        };

        void this.languageClient.sendNotification(CustomBrowseConfigurationNotification, params).catch(logAndReturn.undefined);
    }

    private async clearCustomConfigurations(): Promise<void> {
        this.configurationLogging.clear();
        const params: WorkspaceFolderParams = {
            workspaceFolderUri: this.RootUri?.toString()
        };
        await this.ready;
        return this.languageClient.sendNotification(ClearCustomConfigurationsNotification, params);
    }

    private async clearCustomBrowseConfiguration(): Promise<void> {
        this.browseConfigurationLogging = "";
        const params: WorkspaceFolderParams = {
            workspaceFolderUri: this.RootUri?.toString()
        };
        await this.ready;
        return this.languageClient.sendNotification(ClearCustomBrowseConfigurationNotification, params);
    }

    /**
     * command handlers
     */
    public async handleConfigurationSelectCommand(config?: string): Promise<void> {
        await this.ready;
        const configNames: string[] | undefined = this.configuration.ConfigurationNames;
        if (configNames) {
            const index: number = config ? configNames.indexOf(config) : await ui.showConfigurations(configNames);
            if (index < 0) {
                return;
            }
            this.configuration.select(index);
        }
    }

    public async handleConfigurationProviderSelectCommand(): Promise<void> {
        await this.ready;
        const extensionId: string | undefined = await ui.showConfigurationProviders(this.configuration.CurrentConfigurationProvider);
        if (extensionId === undefined) {
            // operation was canceled.
            return;
        }
        await this.configuration.updateCustomConfigurationProvider(extensionId);
        if (extensionId) {
            const provider: CustomConfigurationProvider1 | undefined = getCustomConfigProviders().get(extensionId);
            void this.updateCustomBrowseConfiguration(provider).catch(logAndReturn.undefined);
            void this.updateCustomConfigurations(provider).catch(logAndReturn.undefined);
            telemetry.logLanguageServerEvent("customConfigurationProvider", { "providerId": extensionId });
        } else {
            void this.clearCustomConfigurations().catch(logAndReturn.undefined);
            void this.clearCustomBrowseConfiguration().catch(logAndReturn.undefined);
        }
    }

    public async handleShowActiveCodeAnalysisCommands(): Promise<void> {
        await this.ready;
        const index: number = await ui.showActiveCodeAnalysisCommands();
        switch (index) {
            case 0: return this.CancelCodeAnalysis();
            case 1: return this.PauseCodeAnalysis();
            case 2: return this.ResumeCodeAnalysis();
            case 3: return this.handleShowIdleCodeAnalysisCommands();
        }
    }

    public async handleShowIdleCodeAnalysisCommands(): Promise<void> {
        await this.ready;
        const index: number = await ui.showIdleCodeAnalysisCommands();
        switch (index) {
            case 0: return this.handleRunCodeAnalysisOnActiveFile();
            case 1: return this.handleRunCodeAnalysisOnAllFiles();
            case 2: return this.handleRunCodeAnalysisOnOpenFiles();
        }
    }

    public async handleConfigurationEditCommand(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): Promise<void> {
        await this.ready;
        return this.configuration.handleConfigurationEditCommand(undefined, vscode.window.showTextDocument, viewColumn);
    }

    public async handleConfigurationEditJSONCommand(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): Promise<void> {
        await this.ready;
        return this.configuration.handleConfigurationEditJSONCommand(undefined, vscode.window.showTextDocument, viewColumn);
    }

    public async handleConfigurationEditUICommand(viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active): Promise<void> {
        await this.ready;
        return this.configuration.handleConfigurationEditUICommand(undefined, vscode.window.showTextDocument, viewColumn);
    }

    public async handleAddToIncludePathCommand(path: string): Promise<void> {
        await this.ready;
        return this.configuration.addToIncludePathCommand(path);
    }

    public async handleGoToDirectiveInGroup(next: boolean): Promise<void> {
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (editor) {
            const params: GoToDirectiveInGroupParams = {
                uri: editor.document.uri.toString(),
                position: editor.selection.active,
                next: next
            };
            await this.ready;
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
        if (!editor || !util.isCpp(editor.document)) {
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
        await this.ready;
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
                    // The reason why we cannot use finalInsertionLine is because the line number sent from the result is not correct.
                    // In most cases, the finalInsertionLine is the line of the signature line.
                    newRange = new vscode.Range(initCursorPosition.line, 0, initCursorPosition.line, maxColumn);
                } else {
                    newRange = new vscode.Range(result.finalInsertionLine, 0, result.finalInsertionLine, maxColumn);
                }
            } else {
                newRange = new vscode.Range(result.finalInsertionLine, 0, result.finalInsertionLine, 0);
            }
            edits.push(new vscode.TextEdit(newRange, result.contents));
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

    public async handleRunCodeAnalysisOnActiveFile(): Promise<void> {
        await this.ready;
        return this.languageClient.sendNotification(CodeAnalysisNotification, { scope: CodeAnalysisScope.ActiveFile });
    }

    public async handleRunCodeAnalysisOnOpenFiles(): Promise<void> {
        await this.ready;
        return this.languageClient.sendNotification(CodeAnalysisNotification, { scope: CodeAnalysisScope.OpenFiles });
    }

    public async handleRunCodeAnalysisOnAllFiles(): Promise<void> {
        await this.ready;
        return this.languageClient.sendNotification(CodeAnalysisNotification, { scope: CodeAnalysisScope.AllFiles });
    }

    public async handleRemoveAllCodeAnalysisProblems(): Promise<void> {
        await this.ready;
        if (removeAllCodeAnalysisProblems()) {
            return this.languageClient.sendNotification(CodeAnalysisNotification, { scope: CodeAnalysisScope.ClearSquiggles });
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
                    const formatTextEdits: vscode.TextEdit[] | undefined = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
                        "vscode.executeFormatDocumentProvider", uri, { onChanges: true, preserveFocus: false });
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
        await this.ready;

        // A deep copy is needed because the call to identifiers.splice below can
        // remove elements in identifiersAndUris[...].identifiers.
        const identifiersAndUrisCopy: CodeAnalysisDiagnosticIdentifiersAndUri[] = [];
        for (const identifiersAndUri of identifiersAndUris) {
            identifiersAndUrisCopy.push({ uri: identifiersAndUri.uri, identifiers: [...identifiersAndUri.identifiers] });
        }

        if (removeCodeAnalysisProblems(identifiersAndUris)) {
            // Need to notify the language client of the removed diagnostics so it doesn't re-send them.
            return this.languageClient.sendNotification(RemoveCodeAnalysisProblemsNotification, {
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
        return this.handleRemoveCodeAnalysisProblems(false, identifiersAndUris);
    }

    public async handleCreateDeclarationOrDefinition(isCopyToClipboard: boolean, codeActionRange?: Range): Promise<void> {
        let range: vscode.Range | undefined;
        let uri: vscode.Uri | undefined;
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

        const editorSettings: OtherSettings = new OtherSettings(uri);
        const cppSettings: CppSettings = new CppSettings(uri);

        if (editor) {
            uri = editor.document.uri;
            if (codeActionRange !== undefined) {
                // Request is from a code action command which provides range from code actions args.
                range = makeVscodeRange(codeActionRange);
            } else {
                // Request is from context menu or command palette. Use range from cursor position.
                if (editor.selection.isEmpty) {
                    range = new vscode.Range(editor.selection.active, editor.selection.active);
                } else if (editor.selection.isReversed) {
                    range = new vscode.Range(editor.selection.active, editor.selection.anchor);
                } else {
                    range = new vscode.Range(editor.selection.anchor, editor.selection.active);
                }
            }
        }

        if (uri === undefined || range === undefined || editor === undefined) {
            return;
        }

        let formatParams: FormatParams | undefined;
        if (cppSettings.useVcFormat(editor.document)) {
            const editorConfigSettings: any = getEditorConfigSettings(uri.fsPath);
            formatParams = {
                editorConfigSettings: editorConfigSettings,
                useVcFormat: true,
                insertSpaces: editorConfigSettings.indent_style !== undefined ? editorConfigSettings.indent_style === "space" ? true : false : true,
                tabSize: editorConfigSettings.tab_width !== undefined ? editorConfigSettings.tab_width : 4,
                character: "",
                range: {
                    start: {
                        character: 0,
                        line: 0
                    },
                    end: {
                        character: 0,
                        line: 0
                    }
                },
                onChanges: false,
                uri: ''
            };
        } else {
            formatParams = {
                editorConfigSettings: {},
                useVcFormat: false,
                insertSpaces: editorSettings.editorInsertSpaces !== undefined ? editorSettings.editorInsertSpaces : true,
                tabSize: editorSettings.editorTabSize !== undefined ? editorSettings.editorTabSize : 4,
                character: "",
                range: {
                    start: {
                        character: 0,
                        line: 0
                    },
                    end: {
                        character: 0,
                        line: 0
                    }
                },
                onChanges: false,
                uri: ''
            };
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
            },
            formatParams: formatParams,
            copyToClipboard: isCopyToClipboard
        };

        const result: CreateDeclarationOrDefinitionResult = await this.languageClient.sendRequest(CreateDeclarationOrDefinitionRequest, params);
        // Create/Copy returned no result.
        if (result.workspaceEdits === undefined) {
            // The only condition in which result.edit would be undefined is a
            // server-initiated cancellation, in which case the object is actually
            // a ResponseError. https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#responseMessage
            return;
        }

        // Handle CDD error messaging
        if (result.errorText) {
            let copiedToClipboard: boolean = false;
            if (result.clipboardText && !params.copyToClipboard) {
                await vscode.env.clipboard.writeText(result.clipboardText);
                copiedToClipboard = true;
            }
            void vscode.window.showInformationMessage(result.errorText + (copiedToClipboard ? localize("fallback.clipboard", " Declaration/definition was copied.") : ""));
            return;
        }

        if (result.clipboardText && params.copyToClipboard) {
            return vscode.env.clipboard.writeText(result.clipboardText);
        }

        let workspaceEdits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
        let modifiedDocument: vscode.Uri | undefined;
        let lastEdit: vscode.TextEdit | undefined;
        for (const workspaceEdit of result.workspaceEdits) {
            const uri: vscode.Uri = vscode.Uri.file(workspaceEdit.file);
            // At most, there will only be two text edits:
            // 1.) an edit for: #include header file
            // 2.) an edit for: definition or declaration
            for (const edit of workspaceEdit.edits) {
                let range: vscode.Range = makeVscodeRange(edit.range);
                // Get new lines from an edit for: #include header file.
                if (lastEdit && lastEdit.newText.length < 300 && lastEdit.newText.includes("#include") && lastEdit.range.isEqual(range)) {
                    // Destination file is empty.
                    // The edit positions for #include header file and definition or declaration are the same.
                    const selectionPositionAdjustment = (lastEdit.newText.match(/\n/g) ?? []).length;
                    range = new vscode.Range(new vscode.Position(range.start.line + selectionPositionAdjustment, range.start.character),
                        new vscode.Position(range.end.line + selectionPositionAdjustment, range.end.character));
                }
                lastEdit = new vscode.TextEdit(range, edit.newText);
                workspaceEdits.insert(uri, range.start, edit.newText);
                if (edit.newText.length < 300 && edit.newText.includes("#pragma once")) {
                    // Commit this so that it can be undone separately, to avoid leaving an empty file,
                    // which causes the next refactor to not add the #pragma once.
                    await vscode.workspace.applyEdit(workspaceEdits);
                    workspaceEdits = new vscode.WorkspaceEdit();
                }
            }
            modifiedDocument = uri;
        }

        if (modifiedDocument === undefined || lastEdit === undefined) {
            return;
        }

        // Apply the create declaration/definition text edits.
        await vscode.workspace.applyEdit(workspaceEdits);

        // Move the cursor to the new declaration/definition edit, accounting for \n or \n\n at the start.
        let startLine: number = lastEdit.range.start.line;
        let numNewlines: number = (lastEdit.newText.match(/\n/g) ?? []).length;
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

        const selectionPosition: vscode.Position = new vscode.Position(startLine, 0);
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

    public async handleExtractToFunction(extractAsGlobal: boolean): Promise<void> {
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            return;
        }

        let functionName: string | undefined = await vscode.window.showInputBox({
            title: localize('handle.extract.name', 'Name the extracted function'),
            placeHolder: localize('handle.extract.new.function', 'NewFunction')
        });

        if (functionName === undefined || functionName === "") {
            functionName = "NewFunction";
        }

        const params: ExtractToFunctionParams = {
            uri: editor.document.uri.toString(),
            range: {
                start: {
                    character: editor.selection.start.character,
                    line: editor.selection.start.line
                },
                end: {
                    character: editor.selection.end.character,
                    line: editor.selection.end.line
                }
            },
            extractAsGlobal,
            name: functionName
        };

        const result: WorkspaceEditResult = await this.languageClient.sendRequest(ExtractToFunctionRequest, params);
        if (result.workspaceEdits === undefined) {
            // The only condition in which result.edit would be undefined is a
            // server-initiated cancellation, in which case the object is actually
            // a ResponseError. https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#responseMessage
            return;
        }

        // Handle error messaging
        if (result.errorText) {
            void vscode.window.showErrorMessage(`${localize("handle.extract.error",
                "Extract to function failed: {0}", result.errorText)}`);
            return;
        }

        let workspaceEdits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();

        // NOTE: References to source/header are in reference to the more common case when it's
        // invoked on the source file (alternatively named the first file). When invoked on the header file,
        // the header file operates as if it were the source file (isSourceFile stays true).
        let sourceReplaceEditRange: vscode.Range | undefined;
        let headerReplaceEditRange: vscode.Range | undefined;
        let hasProcessedReplace: boolean = false;
        const sourceFormatUriAndRanges: VsCodeUriAndRange[] = [];
        const headerFormatUriAndRanges: VsCodeUriAndRange[] = [];
        let lineOffset: number = 0;
        let headerFileLineOffset: number = 0;
        let isSourceFile: boolean = true;
        // There will be 4-5 text edits:
        // - A #pragma once added to a new header file (optional)
        // - Add #include for header file (optional)
        // - Add the new function declaration (in the source or header file)
        // - Replace the selected code with the new function call,
        //   plus possibly extra declarations beforehand,
        //   plus possibly extra return value handling afterwards.
        // - Add the new function definition (below the selection)
        for (const workspaceEdit of result.workspaceEdits) {
            if (hasProcessedReplace) {
                isSourceFile = false;
                lineOffset = 0;
            }
            const uri: vscode.Uri = vscode.Uri.file(workspaceEdit.file);
            let nextLineOffset: number = 0;
            for (const edit of workspaceEdit.edits) {
                let range: vscode.Range = makeVscodeRange(edit.range);
                if (!isSourceFile && headerFileLineOffset) {
                    range = new vscode.Range(new vscode.Position(range.start.line + headerFileLineOffset, range.start.character),
                        new vscode.Position(range.end.line + headerFileLineOffset, range.end.character));
                }
                const isReplace: boolean = !range.isEmpty && isSourceFile;
                lineOffset += nextLineOffset;
                nextLineOffset = (edit.newText.match(/\n/g) ?? []).length;

                // Find the editType.
                if (isReplace) {
                    hasProcessedReplace = true;
                    workspaceEdits.replace(uri, range, edit.newText);
                } else {
                    workspaceEdits.insert(uri, range.start, edit.newText);
                    if (edit.newText.length < 300) { // Avoid searching large code edits
                        if (isSourceFile && !hasProcessedReplace && edit.newText.includes("#include")) {
                            continue;
                        }
                        if (edit.newText.includes("#pragma once")) {
                            // Commit this so that it can be undone separately, to avoid leaving an empty file,
                            // which causes the next refactor to not add the #pragma once.
                            await vscode.workspace.applyEdit(workspaceEdits, { isRefactoring: true });
                            headerFileLineOffset = nextLineOffset;
                            workspaceEdits = new vscode.WorkspaceEdit();
                            continue;
                        }
                    }
                }
                const formatRangeStartLine: number = range.start.line + lineOffset;
                let rangeStartLine: number = formatRangeStartLine;
                let rangeStartCharacter: number = 0;
                let startWithNewLine: boolean = true;
                if (edit.newText.startsWith("\r\n\r\n")) {
                    rangeStartCharacter = 4;
                    rangeStartLine += 2;
                } else if (edit.newText.startsWith("\n\n")) {
                    rangeStartCharacter = 2;
                    rangeStartLine += 2;
                } else if (edit.newText.startsWith("\r\n")) {
                    rangeStartCharacter = 2;
                    rangeStartLine += 1;
                } else if (edit.newText.startsWith("\n")) {
                    rangeStartCharacter = 1;
                    rangeStartLine += 1;
                } else {
                    startWithNewLine = false;
                }
                const newFormatRange: vscode.Range = new vscode.Range(
                    new vscode.Position(formatRangeStartLine + (nextLineOffset < 0 ? nextLineOffset : 0), range.start.character),
                    new vscode.Position(formatRangeStartLine + (nextLineOffset < 0 ? 0 : nextLineOffset),
                        isReplace ? range.end.character :
                            ((startWithNewLine ? 0 : range.end.character) + (edit.newText.endsWith("\n") ? 0 : edit.newText.length - rangeStartCharacter))
                    )
                );
                if (isSourceFile) {
                    sourceFormatUriAndRanges.push({ uri, range: newFormatRange });
                } else {
                    headerFormatUriAndRanges.push({ uri, range: newFormatRange });
                }
                if (isReplace || !isSourceFile) {
                    // Handle additional declaration lines added before the new function call.
                    let currentText: string = edit.newText.substring(rangeStartCharacter);
                    let currentTextNextLineStart: number = currentText.indexOf("\n");
                    let currentTextNewFunctionStart: number = currentText.indexOf(functionName);
                    let currentTextNextLineStartUpdated: boolean = false;
                    while (currentTextNextLineStart !== -1 && currentTextNextLineStart < currentTextNewFunctionStart) {
                        ++rangeStartLine;
                        currentText = currentText.substring(currentTextNextLineStart + 1);
                        currentTextNextLineStart = currentText.indexOf("\n");
                        currentTextNewFunctionStart = currentText.indexOf(functionName);
                        currentTextNextLineStartUpdated = true;
                    }
                    rangeStartCharacter = (rangeStartCharacter === 0 && !currentTextNextLineStartUpdated ? range.start.character : 0) +
                        currentTextNewFunctionStart;
                    if (rangeStartCharacter < 0) {
                        // functionName is missing -- unexpected error.
                        void vscode.window.showErrorMessage(`${localize("invalid.edit",
                            "Extract to function failed. An invalid edit was generated: '{0}'", edit.newText)}`);
                        continue;
                    }
                    const replaceEditRange = new vscode.Range(
                        new vscode.Position(rangeStartLine, rangeStartCharacter),
                        new vscode.Position(rangeStartLine, rangeStartCharacter + functionName.length));
                    if (isSourceFile) {
                        sourceReplaceEditRange = replaceEditRange;
                    } else {
                        headerReplaceEditRange = replaceEditRange;
                    }
                    nextLineOffset -= range.end.line - range.start.line;
                }
            }
        }

        if (sourceReplaceEditRange === undefined || sourceFormatUriAndRanges.length === 0) {
            return;
        }

        // Apply the extract to function text edits.
        await vscode.workspace.applyEdit(workspaceEdits, { isRefactoring: true });

        if (headerFormatUriAndRanges.length > 0 && headerReplaceEditRange !== undefined) {
            // The header needs to be open and shown or the formatting will fail
            // (due to issues/requirements in the cpptools process).
            // It also seems strange and undesirable to have the header modified
            // without being opened because otherwise users may not realize that
            // the header had changed (unless they view source control differences).
            await vscode.window.showTextDocument(headerFormatUriAndRanges[0].uri, {
                selection: headerReplaceEditRange, preserveFocus: false
            });
        }

        // Format the new text edits.
        let formatEdits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
        const formatRanges = async (formatUriAndRanges: VsCodeUriAndRange[]) => {
            if (formatUriAndRanges.length === 0) {
                return;
            }
            const formatUriAndRange: VsCodeUriAndRange = formatUriAndRanges[0];
            const isMultipleFormatRanges: boolean = formatUriAndRanges.length > 1;
            const settings: OtherSettings = new OtherSettings(vscode.workspace.getWorkspaceFolder(formatUriAndRange.uri)?.uri);
            const formatOptions: vscode.FormattingOptions = {
                insertSpaces: settings.editorInsertSpaces ?? true,
                tabSize: settings.editorTabSize ?? 4,
                onChanges: isMultipleFormatRanges,
                preserveFocus: true
            };

            const tryFormat = async () => {
                const versionBeforeFormatting: number | undefined = openFileVersions.get(formatUriAndRange.uri.toString());
                if (versionBeforeFormatting === undefined) {
                    return true;
                }

                // Only use document (onChange) formatting when there are multiple ranges.
                const formatTextEdits: vscode.TextEdit[] | undefined = isMultipleFormatRanges ?
                    await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
                        "vscode.executeFormatDocumentProvider", formatUriAndRange.uri, formatOptions) :
                    await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
                        "vscode.executeFormatRangeProvider", formatUriAndRange.uri, formatUriAndRange.range, formatOptions);

                if (!formatTextEdits || formatTextEdits.length === 0 || versionBeforeFormatting === undefined) {
                    return true;
                }
                // Only apply formatting if the document version hasn't changed to prevent
                // stale formatting results from being applied.
                const versionAfterFormatting: number | undefined = openFileVersions.get(formatUriAndRange.uri.toString());
                if (versionAfterFormatting === undefined || versionAfterFormatting > versionBeforeFormatting) {
                    return false;
                }
                formatEdits.set(formatUriAndRange.uri, formatTextEdits);
                return true;
            };
            if (!await tryFormat()) {
                await tryFormat(); // Try again;
            }
        };

        if (headerFormatUriAndRanges.length > 0 && headerReplaceEditRange !== undefined) {
            await formatRanges(headerFormatUriAndRanges);
            if (formatEdits.size > 0) {
                // This showTextDocument is required in order to get the selection to be
                // correct after the formatting edit is applied. It could be a VS Code bug.
                await vscode.window.showTextDocument(headerFormatUriAndRanges[0].uri, {
                    selection: headerReplaceEditRange, preserveFocus: false
                });
                await vscode.workspace.applyEdit(formatEdits, { isRefactoring: true });
                formatEdits = new vscode.WorkspaceEdit();
            }
        }

        // Select the replaced code.
        await vscode.window.showTextDocument(sourceFormatUriAndRanges[0].uri, {
            selection: sourceReplaceEditRange, preserveFocus: false
        });

        await formatRanges(sourceFormatUriAndRanges);
        if (formatEdits.size > 0) {
            await vscode.workspace.applyEdit(formatEdits, { isRefactoring: true });
        }
    }

    public onInterval(): void {
        // These events can be discarded until the language client is ready.
        // Don't queue them up with this.notifyWhenLanguageClientReady calls.
        if (this.innerLanguageClient !== undefined && this.configuration !== undefined) {
            void this.languageClient.sendNotification(IntervalTimerNotification).catch(logAndReturn.undefined);
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

    public async handleReferencesIcon(): Promise<void> {
        await this.ready;

        workspaceReferences.UpdateProgressUICounter(this.model.referencesCommandMode.Value);

        // If the search is find all references, preview partial results.
        // This will cause the language server to send partial results to display
        // in the "Other References" view or channel. Doing a preview should not complete
        // an in-progress request until it is finished or canceled.
        if (this.ReferencesCommandMode === refs.ReferencesCommandMode.Find) {
            void this.languageClient.sendNotification(PreviewReferencesNotification);
        }

    }

    private serverCanceledReferences(): void {
        workspaceReferences.cancelCurrentReferenceRequest(refs.CancellationSender.LanguageServer);
    }

    private handleReferencesProgress(notificationBody: refs.ReportReferencesProgressNotification): void {
        workspaceReferences.handleProgress(notificationBody);
    }

    private processReferencesPreview(referencesResult: refs.ReferencesResult): void {
        workspaceReferences.showResultsInPanelView(referencesResult);
    }

    public setReferencesCommandMode(mode: refs.ReferencesCommandMode): void {
        this.model.referencesCommandMode.Value = mode;
    }

    public async addTrustedCompiler(path: string): Promise<void> {
        if (path === null || path === undefined) {
            return;
        }
        if (trustedCompilerPaths.includes(path)) {
            DebugConfigurationProvider.ClearDetectedBuildTasks();
            return;
        }
        trustedCompilerPaths.push(path);
        compilerDefaults = await this.requestCompiler(path);
        DebugConfigurationProvider.ClearDetectedBuildTasks();
    }

    public getHoverProvider(): HoverProvider | undefined {
        return this.hoverProvider;
    }

    public getCopilotHoverProvider(): CopilotHoverProvider | undefined {
        return this.copilotHoverProvider;
    }

    public filesEncodingChanged(filesEncodingChanged: FilesEncodingChanged): void {
        if (filesEncodingChanged.workspaceFallbackEncoding !== undefined) {
            const lastWorkspaceFallbackEncoding: PersistentState<string> = new PersistentState<string>("CPP.lastWorkspaceFallbackEncoding", "");
            lastWorkspaceFallbackEncoding.Value = filesEncodingChanged.workspaceFallbackEncoding;
        }
        for (const folderFilesEncoding of filesEncodingChanged.foldersFilesEncoding) {
            const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(folderFilesEncoding.uri));
            if (workspaceFolder !== undefined) {
                const lastFilesEncoding: PersistentFolderState<string> = new PersistentFolderState<string>("CPP.lastFilesEncoding", "", workspaceFolder);
                lastFilesEncoding.Value = folderFilesEncoding.filesEncoding;
            }
        }
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

/* eslint-disable @typescript-eslint/no-unused-vars */
class NullClient implements Client {
    private booleanEvent = new vscode.EventEmitter<boolean>();
    private numberEvent = new vscode.EventEmitter<number>();
    private stringEvent = new vscode.EventEmitter<string>();
    private referencesCommandModeEvent = new vscode.EventEmitter<refs.ReferencesCommandMode>();

    readonly ready: Promise<void> = Promise.resolve();

    async enqueue<T>(task: () => Promise<T>) {
        return task();
    }
    public get InitializingWorkspaceChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get IndexingWorkspaceChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
    public get ParsingWorkspaceChanged(): vscode.Event<boolean> { return this.booleanEvent.event; }
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
    TrackedDocuments = new Map<string, vscode.TextDocument>();
    async onDidChangeSettings(event: vscode.ConfigurationChangeEvent): Promise<Record<string, string>> { return {}; }
    onDidOpenTextDocument(document: vscode.TextDocument): void { }
    onDidCloseTextDocument(document: vscode.TextDocument): void { }
    onDidChangeVisibleTextEditors(editors: readonly vscode.TextEditor[]): Promise<void> { return Promise.resolve(); }
    onDidChangeTextEditorVisibleRanges(uri: vscode.Uri): Promise<void> { return Promise.resolve(); }
    onDidChangeTextDocument(textDocumentChangeEvent: vscode.TextDocumentChangeEvent): void { }
    onRegisterCustomConfigurationProvider(provider: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomConfigurations(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    updateCustomBrowseConfiguration(requestingProvider?: CustomConfigurationProvider1): Thenable<void> { return Promise.resolve(); }
    provideCustomConfiguration(docUri: vscode.Uri): Promise<void> { return Promise.resolve(); }
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
    takeOwnership(document: vscode.TextDocument): void { }
    sendDidOpen(document: vscode.TextDocument): Promise<void> { return Promise.resolve(); }
    requestSwitchHeaderSource(rootUri: vscode.Uri, fileName: string): Thenable<string> { return Promise.resolve(""); }
    updateActiveDocumentTextOptions(): void { }
    didChangeActiveEditor(editor?: vscode.TextEditor): Promise<void> { return Promise.resolve(); }
    restartIntelliSenseForFile(document: vscode.TextDocument): Promise<void> { return Promise.resolve(); }
    activate(): void { }
    selectionChanged(selection: Range): void { }
    resetDatabase(): void { }
    promptSelectIntelliSenseConfiguration(sender?: any): Promise<void> { return Promise.resolve(); }
    rescanCompilers(sender?: any): Promise<void> { return Promise.resolve(); }
    deactivate(): void { }
    pauseParsing(): void { }
    resumeParsing(): void { }
    PauseCodeAnalysis(): void { }
    ResumeCodeAnalysis(): void { }
    CancelCodeAnalysis(): void { }
    handleConfigurationSelectCommand(): Promise<void> { return Promise.resolve(); }
    handleConfigurationProviderSelectCommand(): Promise<void> { return Promise.resolve(); }
    handleShowActiveCodeAnalysisCommands(): Promise<void> { return Promise.resolve(); }
    handleShowIdleCodeAnalysisCommands(): Promise<void> { return Promise.resolve(); }
    handleReferencesIcon(): void { }
    handleConfigurationEditCommand(viewColumn?: vscode.ViewColumn): void { }
    handleConfigurationEditJSONCommand(viewColumn?: vscode.ViewColumn): void { }
    handleConfigurationEditUICommand(viewColumn?: vscode.ViewColumn): void { }
    handleAddToIncludePathCommand(path: string): void { }
    handleGoToDirectiveInGroup(next: boolean): Promise<void> { return Promise.resolve(); }
    handleGenerateDoxygenComment(args: DoxygenCodeActionCommandArguments | vscode.Uri | undefined): Promise<void> { return Promise.resolve(); }
    handleRunCodeAnalysisOnActiveFile(): Promise<void> { return Promise.resolve(); }
    handleRunCodeAnalysisOnOpenFiles(): Promise<void> { return Promise.resolve(); }
    handleRunCodeAnalysisOnAllFiles(): Promise<void> { return Promise.resolve(); }
    handleRemoveAllCodeAnalysisProblems(): Promise<void> { return Promise.resolve(); }
    handleRemoveCodeAnalysisProblems(refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> { return Promise.resolve(); }
    handleFixCodeAnalysisProblems(workspaceEdit: vscode.WorkspaceEdit, refreshSquigglesOnSave: boolean, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> { return Promise.resolve(); }
    handleDisableAllTypeCodeAnalysisProblems(code: string, identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): Promise<void> { return Promise.resolve(); }
    handleCreateDeclarationOrDefinition(isCopyToClipboard: boolean, codeActionRange?: Range): Promise<void> { return Promise.resolve(); }
    handleExtractToFunction(extractAsGlobal: boolean): Promise<void> { return Promise.resolve(); }
    onInterval(): void { }
    dispose(): void {
        this.booleanEvent.dispose();
        this.stringEvent.dispose();
    }
    addFileAssociations(fileAssociations: string, languageId: string): void { }
    sendDidChangeSettings(): void { }
    isInitialized(): boolean { return true; }
    getShowConfigureIntelliSenseButton(): boolean { return false; }
    setShowConfigureIntelliSenseButton(show: boolean): void { }
    addTrustedCompiler(path: string): Promise<void> { return Promise.resolve(); }
    getCopilotHoverProvider(): CopilotHoverProvider | undefined { return undefined; }
    getIncludes(uri: vscode.Uri, maxDepth: number): Promise<GetIncludesResult> { return Promise.resolve({} as GetIncludesResult); }
    getChatContext(uri: vscode.Uri, token: vscode.CancellationToken): Promise<ChatContextResult> { return Promise.resolve({} as ChatContextResult); }
    filesEncodingChanged(filesEncodingChanged: FilesEncodingChanged): void { }
    getCompletionContext(file: vscode.Uri, caretOffset: number, featureFlag: CopilotCompletionContextFeatures, maxSnippetCount: number, maxSnippetLength: number, doAggregateSnippets: boolean, token: vscode.CancellationToken): Promise<CopilotCompletionContextResult> { return Promise.resolve({} as CopilotCompletionContextResult); }
}
