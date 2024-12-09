/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import { quote } from 'shell-quote';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as which from 'which';
import { getCachedClangFormatPath, getCachedClangTidyPath, getExtensionFilePath, getRawSetting, isArray, isArrayOfString, isBoolean, isNumber, isObject, isString, isValidMapping, setCachedClangFormatPath, setCachedClangTidyPath } from '../common';
import { isWindows } from '../constants';
import * as telemetry from '../telemetry';
import { cachedEditorConfigLookups, DefaultClient, hasTrustedCompilerPaths } from './client';
import { getEditorConfigSettings, mapIndentationReferenceToEditorConfig, mapIndentToEditorConfig, mapNewOrSameLineToEditorConfig, mapWrapToEditorConfig } from './editorConfig';
import { clients } from './extension';
import { CommentPattern } from './languageConfig';
import { PersistentState } from './persistentState';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface Excludes {
    [key: string]: (boolean | { when: string });
}

export interface Associations {
    [key: string]: string;
}

// Settings that can be undefined have default values assigned in the native code or are meant to return undefined.
export interface WorkspaceFolderSettingsParams {
    uri: string | undefined;
    intelliSenseEngine: string;
    autocomplete: string;
    autocompleteAddParentheses: boolean;
    errorSquiggles: string;
    exclusionPolicy: string;
    preferredPathSeparator: string;
    intelliSenseCachePath: string;
    intelliSenseCacheSize: number;
    intelliSenseMemoryLimit: number;
    dimInactiveRegions: boolean;
    suggestSnippets: boolean;
    legacyCompilerArgsBehavior: boolean;
    defaultSystemIncludePath: string[] | undefined;
    cppFilesExclude: Excludes;
    clangFormatPath: string;
    clangFormatStyle: string | undefined;
    clangFormatFallbackStyle: string | undefined;
    clangFormatSortIncludes: boolean | null;
    codeAnalysisRunAutomatically: boolean;
    codeAnalysisExclude: Excludes;
    clangTidyEnabled: boolean;
    clangTidyPath: string;
    clangTidyConfig: string | undefined;
    clangTidyFallbackConfig: string | undefined;
    clangTidyHeaderFilter: string | null;
    clangTidyArgs: string[];
    clangTidyUseBuildPath: boolean;
    clangTidyChecksEnabled: string[] | undefined;
    clangTidyChecksDisabled: string[] | undefined;
    hover: string;
    markdownInComments: string;
    vcFormatIndentBraces: boolean;
    vcFormatIndentMultiLineRelativeTo: string;
    vcFormatIndentWithinParentheses: string;
    vcFormatIndentPreserveWithinParentheses: boolean;
    vcFormatIndentCaseLabels: boolean;
    vcFormatIndentCaseContents: boolean;
    vcFormatIndentCaseContentsWhenBlock: boolean;
    vcFormatIndentLambdaBracesWhenParameter: boolean;
    vcFormatIndentGotoLabels: string;
    vcFormatIndentPreprocessor: string;
    vcFormatIndentAccesSpecifiers: boolean;
    vcFormatIndentNamespaceContents: boolean;
    vcFormatIndentPreserveComments: boolean;
    vcFormatNewLineScopeBracesOnSeparateLines: boolean;
    vcFormatNewLineBeforeOpenBraceNamespace: string;
    vcFormatNewLineBeforeOpenBraceType: string;
    vcFormatNewLineBeforeOpenBraceFunction: string;
    vcFormatNewLineBeforeOpenBraceBlock: string;
    vcFormatNewLineBeforeOpenBraceLambda: string;
    vcFormatNewLineBeforeCatch: boolean;
    vcFormatNewLineBeforeElse: boolean;
    vcFormatNewLineBeforeWhileInDoWhile: boolean;
    vcFormatNewLineCloseBraceSameLineEmptyType: boolean;
    vcFormatNewLineCloseBraceSameLineEmptyFunction: boolean;
    vcFormatSpaceWithinParameterListParentheses: boolean;
    vcFormatSpaceBetweenEmptyParameterListParentheses: boolean;
    vcFormatSpaceAfterKeywordsInControlFlowStatements: boolean;
    vcFormatSpaceWithinControlFlowStatementParentheses: boolean;
    vcFormatSpaceBeforeLambdaOpenParenthesis: boolean;
    vcFormatSpaceWithinCastParentheses: boolean;
    vcFormatSpaceAfterCastCloseParenthesis: boolean;
    vcFormatSpaceWithinExpressionParentheses: boolean;
    vcFormatSpaceBeforeBlockOpenBrace: boolean;
    vcFormatSpaceBetweenEmptyBraces: boolean;
    vcFormatSpaceBeforeInitializerListOpenBrace: boolean;
    vcFormatSpaceWithinInitializerListBraces: boolean;
    vcFormatSpacePreserveInInitializerList: boolean;
    vcFormatSpaceBeforeOpenSquareBracket: boolean;
    vcFormatSpaceWithinSquareBrackets: boolean;
    vcFormatSpaceBeforeEmptySquareBrackets: boolean;
    vcFormatSpaceBetweenEmptySquareBrackets: boolean;
    vcFormatSpaceGroupSquareBrackets: boolean;
    vcFormatSpaceWithinLambdaBrackets: boolean;
    vcFormatSpaceBetweenEmptyLambdaBrackets: boolean;
    vcFormatSpaceBeforeComma: boolean;
    vcFormatSpaceAfterComma: boolean;
    vcFormatSpaceRemoveAroundMemberOperators: boolean;
    vcFormatSpaceBeforeInheritanceColon: boolean;
    vcFormatSpaceBeforeConstructorColon: boolean;
    vcFormatSpaceRemoveBeforeSemicolon: boolean;
    vcFormatSpaceInsertAfterSemicolon: boolean;
    vcFormatSpaceRemoveAroundUnaryOperator: boolean;
    vcFormatSpaceBeforeFunctionOpenParenthesis: string;
    vcFormatSpaceAroundBinaryOperator: string;
    vcFormatSpaceAroundAssignmentOperator: string;
    vcFormatSpacePointerReferenceAlignment: string;
    vcFormatSpaceAroundTernaryOperator: string;
    vcFormatWrapPreserveBlocks: string;
    doxygenGenerateOnType: boolean;
    doxygenGeneratedStyle: string;
    doxygenSectionTags: string[];
    filesExclude: Excludes;
    filesAutoSaveAfterDelay: boolean;
    filesEncoding: string;
    searchExclude: Excludes;
    editorAutoClosingBrackets: string;
    editorInlayHintsEnabled: boolean;
    editorParameterHintsEnabled: boolean;
    refactoringIncludeHeader: string;
}

export interface SettingsParams {
    filesAssociations: Associations;
    workspaceFallbackEncoding: string;
    maxConcurrentThreads: number | null;
    maxCachedProcesses: number | null;
    maxMemory: number | null;
    maxSymbolSearchResults: number;
    loggingLevel: string;
    workspaceParsingPriority: string;
    workspaceSymbols: string;
    simplifyStructuredComments: boolean;
    intelliSenseUpdateDelay: number;
    experimentalFeatures: boolean;
    enhancedColorization: boolean;
    intellisenseMaxCachedProcesses: number | null;
    intellisenseMaxMemory: number | null;
    referencesMaxConcurrentThreads: number | null;
    referencesMaxCachedProcesses: number | null;
    referencesMaxMemory: number | null;
    codeAnalysisMaxConcurrentThreads: number | null;
    codeAnalysisMaxMemory: number | null;
    codeAnalysisUpdateDelay: number;
    workspaceFolderSettings: WorkspaceFolderSettingsParams[];
    copilotHover: string;
}

function getTarget(): vscode.ConfigurationTarget {
    return vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global;
}

function isValidWhenObject(obj: unknown): obj is { when: string } {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'when' in obj &&
        typeof (obj as { when: unknown }).when === 'string'
    );
}

class Settings {
    private readonly settings: vscode.WorkspaceConfiguration;

    /**
     * Create the Settings object.
     * @param resource The path to a resource to which the settings should apply, or null if global settings are desired. Only provide a resource when accessing settings with a "resource" scope.
     */
    constructor(section: string, public resource?: vscode.Uri) {
        this.settings = vscode.workspace.getConfiguration(section, resource ? resource : null);
    }

    protected get Section(): vscode.WorkspaceConfiguration { return this.settings; }

    // If the setting has an undefined default, look for the workspaceFolder, workspace and global values as well.
    public getArrayOfStringsWithUndefinedDefault(section: string): string[] | undefined;
    public getArrayOfStringsWithUndefinedDefault(section: string, allowNull: boolean): string[] | undefined | null;
    public getArrayOfStringsWithUndefinedDefault(section: string, allowNull: boolean = false): string[] | undefined | null {
        const info: any = this.settings.inspect<string[]>(section);

        if ((allowNull && info.workspaceFolderValue === null) || isArrayOfString(info.workspaceFolderValue)) {
            return info.workspaceFolderValue;
        }

        if ((allowNull && info.workspaceValue === null) || isArrayOfString(info.workspaceValue)) {
            return info.workspaceValue;
        }

        if ((allowNull && info.globalValue === null) || isArrayOfString(info.globalValue)) {
            return info.globalValue;
        }
        return undefined;
    }

    public getStringWithUndefinedDefault(section: string): string | undefined {
        const info: any = this.settings.inspect<string>(section);

        if (isString(info.workspaceFolderValue)) {
            return info.workspaceFolderValue;
        }

        if (isString(info.workspaceValue)) {
            return info.workspaceValue;
        }

        if (isString(info.globalValue)) {
            return info.globalValue;
        }
        return undefined;
    }
}

// If a setting is undefined, a blank string, or null, return undefined instead.
function changeBlankStringToUndefined(input: string | undefined): string | undefined {
    // Although null is not a valid type, user could enter a null anyway.
    return (input === undefined || input === null || input.trim() === "") ? undefined : input;
}

export class CppSettings extends Settings {
    /**
     * Create the CppSettings object.
     * @param resource The path to a resource to which the settings should apply, or null if global settings are desired. Only provide a resource when accessing settings with a "resource" scope.
     */
    constructor(resource?: vscode.Uri) {
        super("C_Cpp", resource);
    }

    private get LLVMExtension(): string {
        return os.platform() === "win32" ? ".exe" : "";
    }

    private get clangFormatStr(): string {
        return "clang-format";
    }

    private get clangTidyStr(): string {
        return "clang-tidy";
    }

    private get clangFormatName(): string {
        return this.clangFormatStr + this.LLVMExtension;
    }

    private get clangTidyName(): string {
        return this.clangTidyStr + this.LLVMExtension;
    }

    public get clangTidyPath(): string | undefined {
        return this.getClangPath(false);
    }

    public get clangFormatPath(): string | undefined {
        return this.getClangPath(true);
    }

    private getClangPath(isFormat: boolean): string | undefined {
        let path: string | undefined = changeBlankStringToUndefined(this.getAsStringOrUndefined(isFormat ? "clang_format_path" : "codeAnalysis.clangTidy.path"));
        if (!path) {
            const cachedClangPath: string | undefined = isFormat ? getCachedClangFormatPath() : getCachedClangTidyPath();
            if (cachedClangPath !== undefined) {
                return cachedClangPath;
            }
            const clangName: string = isFormat ? this.clangFormatName : this.clangTidyName;
            const setCachedClangPath: (path: string) => void = isFormat ? setCachedClangFormatPath : setCachedClangTidyPath;
            const whichPath: string | null = which.sync(clangName, { nothrow: true });
            if (whichPath === null) {
                return undefined;
            }
            path = whichPath;
            setCachedClangPath(path);
            if (!path) {
                return undefined;
            } else {
                // Attempt to invoke both our own version of clang-* to see if we can successfully execute it, and to get its version.
                let bundledVersion: string;
                try {
                    const bundledPath: string = getExtensionFilePath(`./LLVM/bin/${clangName}`);
                    const output: string = execSync(quote([bundledPath, '--version'])).toString();
                    bundledVersion = output.match(/(\d+\.\d+\.\d+)/)?.[1] ?? "";
                    if (!semver.valid(bundledVersion)) {
                        return path;
                    }
                } catch (e) {
                    // Unable to invoke our own clang-*.  Use the system installed clang-*.
                    return path;
                }

                // Invoke the version on the system to compare versions.  Use ours if it's more recent.
                try {
                    const output: string = execSync(`"${path}" --version`).toString();
                    const userVersion = output.match(/(\d+\.\d+\.\d+)/)?.[1] ?? "";
                    if (semver.ltr(userVersion, bundledVersion)) {
                        path = "";
                        setCachedClangPath(path);
                    }
                } catch (e) {
                    path = "";
                    setCachedClangPath(path);
                }
            }
        }
        return path;
    }

    public get maxConcurrentThreads(): number | null { return this.getAsNumber("maxConcurrentThreads", true); }
    public get maxMemory(): number | null { return this.getAsNumber("maxMemory", true); }
    public get maxSymbolSearchResults(): number { return this.getAsNumber("maxSymbolSearchResults"); }
    public get maxCachedProcesses(): number | null { return this.getAsNumber("maxCachedProcesses", true); }
    public get intelliSenseMaxCachedProcesses(): number | null { return this.getAsNumber("intelliSense.maxCachedProcesses", true); }
    public get intelliSenseMaxMemory(): number | null { return this.getAsNumber("intelliSense.maxMemory", true); }
    public get referencesMaxConcurrentThreads(): number | null { return this.getAsNumber("references.maxConcurrentThreads", true); }
    public get referencesMaxCachedProcesses(): number | null { return this.getAsNumber("references.maxCachedProcesses", true); }
    public get referencesMaxMemory(): number | null { return this.getAsNumber("references.maxMemory", true); }
    public get codeAnalysisMaxConcurrentThreads(): number | null { return this.getAsNumber("codeAnalysis.maxConcurrentThreads", true); }
    public get codeAnalysisMaxMemory(): number | null { return this.getAsNumber("codeAnalysis.maxMemory", true); }
    public get codeAnalysisUpdateDelay(): number { return this.getAsNumber("codeAnalysis.updateDelay"); }
    public get codeAnalysisExclude(): Excludes { return this.getAsExcludes("codeAnalysis.exclude"); }
    public get codeAnalysisRunAutomatically(): boolean { return this.getAsBoolean("codeAnalysis.runAutomatically"); }
    public get codeAnalysisRunOnBuild(): boolean | undefined { return false; } // return this.getAsBoolean("codeAnalysis.runOnBuild");
    public get clangTidyEnabled(): boolean { return this.getAsBoolean("codeAnalysis.clangTidy.enabled"); }
    public get clangTidyConfig(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("codeAnalysis.clangTidy.config")); }
    public get clangTidyFallbackConfig(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("codeAnalysis.clangTidy.fallbackConfig")); }
    public get clangTidyHeaderFilter(): string | null { return this.getAsString("codeAnalysis.clangTidy.headerFilter", true); }
    public get clangTidyArgs(): string[] | undefined { return this.getAsArrayOfStringsOrUndefined("codeAnalysis.clangTidy.args"); }
    public get clangTidyUseBuildPath(): boolean { return this.getAsBoolean("codeAnalysis.clangTidy.useBuildPath"); }
    public get clangTidyChecksEnabled(): string[] | undefined { return this.getAsArrayOfStringsOrUndefined("codeAnalysis.clangTidy.checks.enabled", true); }
    public get clangTidyChecksDisabled(): string[] | undefined { return this.getAsArrayOfStringsOrUndefined("codeAnalysis.clangTidy.checks.disabled", true); }
    public get clangTidyCodeActionShowDisable(): boolean { return this.getAsBoolean("codeAnalysis.clangTidy.codeAction.showDisable"); }
    public get clangTidyCodeActionShowClear(): string { return this.getAsString("codeAnalysis.clangTidy.codeAction.showClear"); }
    public get clangTidyCodeActionShowDocumentation(): boolean { return this.getAsBoolean("codeAnalysis.clangTidy.codeAction.showDocumentation"); }
    public get clangTidyCodeActionFormatFixes(): boolean { return this.getAsBoolean("codeAnalysis.clangTidy.codeAction.formatFixes"); }
    public addClangTidyChecksDisabled(value: string): void {
        const checks: string[] | undefined = this.clangTidyChecksDisabled;
        if (checks === undefined) {
            return;
        }
        checks.push(value);
        void super.Section.update("codeAnalysis.clangTidy.checks.disabled", checks, vscode.ConfigurationTarget.WorkspaceFolder);
    }
    public get clangFormatStyle(): string | undefined { return changeBlankStringToUndefined(this.getAsString("clang_format_style")); }
    public get clangFormatFallbackStyle(): string | undefined { return changeBlankStringToUndefined(this.getAsString("clang_format_fallbackStyle")); }
    public get clangFormatSortIncludes(): boolean | null { return this.getAsBoolean("clang_format_sortIncludes", true); }
    public get experimentalFeatures(): boolean { return this.getAsString("experimentalFeatures").toLowerCase() === "enabled"; }
    public get suggestSnippets(): boolean { return this.getAsBoolean("suggestSnippets"); }
    public get intelliSenseEngine(): string { return this.getAsString("intelliSenseEngine"); }
    public get intelliSenseCachePath(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("intelliSenseCachePath")); }
    public get intelliSenseCacheSize(): number { return this.getAsNumber("intelliSenseCacheSize"); }
    public get intelliSenseMemoryLimit(): number { return this.getAsNumber("intelliSenseMemoryLimit"); }
    public get intelliSenseUpdateDelay(): number { return this.getAsNumber("intelliSenseUpdateDelay"); }
    public get errorSquiggles(): string { return this.getAsString("errorSquiggles"); }
    public get inactiveRegionOpacity(): number { return this.getAsNumber("inactiveRegionOpacity"); }
    public get inactiveRegionForegroundColor(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("inactiveRegionForegroundColor")); }
    public get inactiveRegionBackgroundColor(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("inactiveRegionBackgroundColor")); }
    public get autocomplete(): string { return this.getAsString("autocomplete"); }
    public get autocompleteAddParentheses(): boolean { return this.getAsBoolean("autocompleteAddParentheses"); }
    public get loggingLevel(): string { return this.getAsString("loggingLevel"); }
    public get autoAddFileAssociations(): boolean { return this.getAsBoolean("autoAddFileAssociations"); }
    public get workspaceParsingPriority(): string { return this.getAsString("workspaceParsingPriority"); }
    public get workspaceSymbols(): string { return this.getAsString("workspaceSymbols"); }
    public get exclusionPolicy(): string { return this.getAsString("exclusionPolicy"); }
    public get refactoringIncludeHeader(): string { return this.getAsString("refactoring.includeHeader"); }
    public get simplifyStructuredComments(): boolean { return this.getAsBoolean("simplifyStructuredComments"); }
    public get doxygenGeneratedCommentStyle(): string { return this.getAsString("doxygen.generatedStyle"); }
    public get doxygenGenerateOnType(): boolean { return this.getAsBoolean("doxygen.generateOnType"); }
    public get commentContinuationPatterns(): (string | CommentPattern)[] {
        const value: any = super.Section.get<any>("commentContinuationPatterns");
        if (this.isArrayOfCommentContinuationPatterns(value)) {
            return value;
        }
        const setting = getRawSetting("C_Cpp.commentContinuationPatterns", true);
        return setting.default;
    }
    public get isConfigurationWarningsEnabled(): boolean { return this.getAsString("configurationWarnings").toLowerCase() === "enabled"; }
    public get preferredPathSeparator(): string { return this.getAsString("preferredPathSeparator"); }
    public get updateChannel(): string { return this.getAsString("updateChannel"); }
    public get vcpkgEnabled(): boolean { return this.getAsBoolean("vcpkg.enabled"); }
    public get addNodeAddonIncludePaths(): boolean { return this.getAsBoolean("addNodeAddonIncludePaths"); }
    public get renameRequiresIdentifier(): boolean { return this.getAsBoolean("renameRequiresIdentifier"); }
    public get filesExclude(): Excludes { return this.getAsExcludes("files.exclude"); }
    public get defaultIncludePath(): string[] | undefined { return this.getArrayOfStringsWithUndefinedDefault("default.includePath"); }
    public get defaultDefines(): string[] | undefined { return this.getArrayOfStringsWithUndefinedDefault("default.defines"); }
    public get defaultDotconfig(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("default.dotConfig")); }
    public get defaultMacFrameworkPath(): string[] | undefined { return this.getArrayOfStringsWithUndefinedDefault("default.macFrameworkPath"); }
    public get defaultWindowsSdkVersion(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("default.windowsSdkVersion")); }
    public get defaultCompileCommands(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("default.compileCommands")); }
    public get defaultForcedInclude(): string[] | undefined { return this.getArrayOfStringsWithUndefinedDefault("default.forcedInclude"); }
    public get defaultIntelliSenseMode(): string | undefined { return this.getAsStringOrUndefined("default.intelliSenseMode"); }
    public get defaultCompilerPath(): string | null { return this.getAsString("default.compilerPath", true); }

    public set defaultCompilerPath(value: string) {
        const defaultCompilerPathStr: string = "default.compilerPath";
        const compilerPathInfo: any = this.Section.inspect(defaultCompilerPathStr);
        let target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global;
        if (this.resource !== undefined || compilerPathInfo.workspaceFolderValue !== undefined) {
            target = vscode.ConfigurationTarget.WorkspaceFolder;
        } else if (compilerPathInfo.workspaceValue !== undefined) {
            target = vscode.ConfigurationTarget.Workspace;
        }
        void this.Section.update(defaultCompilerPathStr, value, target);
        if (this.resource !== undefined && !hasTrustedCompilerPaths()) {
            // Also set the user/remote compiler path if no other path has been trusted yet.
            void this.Section.update(defaultCompilerPathStr, value, vscode.ConfigurationTarget.Global);
            clients.forEach(client => {
                if (client instanceof DefaultClient) {
                    client.setShowConfigureIntelliSenseButton(false);
                }
            });
        }
    }
    public get defaultCompilerArgs(): string[] | undefined { return this.getArrayOfStringsWithUndefinedDefault("default.compilerArgs"); }
    public get defaultCStandard(): string | undefined { return this.getAsStringOrUndefined("default.cStandard"); }
    public get defaultCppStandard(): string | undefined { return this.getAsStringOrUndefined("default.cppStandard"); }
    public get defaultConfigurationProvider(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("default.configurationProvider")); }
    public get defaultMergeConfigurations(): boolean | undefined { return this.getAsBooleanOrUndefined("default.mergeConfigurations"); }
    public get defaultBrowsePath(): string[] | undefined { return this.getArrayOfStringsWithUndefinedDefault("default.browse.path"); }
    public get defaultDatabaseFilename(): string | undefined { return changeBlankStringToUndefined(this.getAsStringOrUndefined("default.browse.databaseFilename")); }
    public get defaultLimitSymbolsToIncludedHeaders(): boolean { return this.getAsBoolean("default.browse.limitSymbolsToIncludedHeaders"); }
    public get defaultSystemIncludePath(): string[] | undefined { return this.getArrayOfStringsWithUndefinedDefault("default.systemIncludePath"); }
    public get defaultEnableConfigurationSquiggles(): boolean { return this.getAsBoolean("default.enableConfigurationSquiggles"); }
    public get defaultCustomConfigurationVariables(): Associations | undefined { return this.getAsAssociations("default.customConfigurationVariables", true) ?? undefined; }
    public get useBacktickCommandSubstitution(): boolean { return this.getAsBoolean("debugger.useBacktickCommandSubstitution"); }
    public get codeFolding(): boolean { return this.getAsString("codeFolding").toLowerCase() === "enabled"; }
    public get isCaseSensitiveFileSupportEnabled(): boolean { return !isWindows || this.getAsString("caseSensitiveFileSupport").toLowerCase() === "enabled"; }
    public get doxygenSectionTags(): string[] { return this.getAsArrayOfStrings("doxygen.sectionTags"); }
    public get hover(): string { return this.getAsString("hover"); }
    public get markdownInComments(): string { return this.getAsString("markdownInComments"); }
    public get legacyCompilerArgsBehavior(): boolean { return this.getAsBoolean("legacyCompilerArgsBehavior"); }
    public get inlayHintsAutoDeclarationTypes(): boolean { return this.getAsBoolean("inlayHints.autoDeclarationTypes.enabled"); }
    public get inlayHintsAutoDeclarationTypesShowOnLeft(): boolean { return this.getAsBoolean("inlayHints.autoDeclarationTypes.showOnLeft"); }
    public get inlayHintsParameterNames(): boolean { return this.getAsBoolean("inlayHints.parameterNames.enabled"); }
    public get inlayHintsParameterNamesSuppressName(): boolean { return this.getAsBoolean("inlayHints.parameterNames.suppressWhenArgumentContainsName"); }
    public get inlayHintsParameterNamesHideLeadingUnderscores(): boolean { return this.getAsBoolean("inlayHints.parameterNames.hideLeadingUnderscores"); }
    public get inlayHintsReferenceOperator(): boolean { return this.getAsBoolean("inlayHints.referenceOperator.enabled"); }
    public get inlayHintsReferenceOperatorShowSpace(): boolean { return this.getAsBoolean("inlayHints.referenceOperator.showSpace"); }
    public get isEnhancedColorizationEnabled(): boolean {
        return this.getAsString("enhancedColorization").toLowerCase() === "enabled"
            && this.intelliSenseEngine.toLowerCase() === "default"
            && vscode.workspace.getConfiguration("workbench").get<any>("colorTheme") !== "Default High Contrast";
    }
    public get copilotHover(): string {
        if (!(vscode as any).lm) {
            return "disabled";
        }
        const val = super.Section.get<any>("copilotHover");
        if (val === undefined) {
            return "default";
        }
        return val as string;
    }

    public get formattingEngine(): string { return this.getAsString("formatting"); }
    public get vcFormatIndentBraces(): boolean { return this.getAsBoolean("vcFormat.indent.braces"); }
    public get vcFormatIndentMultiLineRelativeTo(): string { return this.getAsString("vcFormat.indent.multiLineRelativeTo"); }
    public get vcFormatIndentWithinParentheses(): string { return this.getAsString("vcFormat.indent.withinParentheses"); }
    public get vcFormatIndentPreserveWithinParentheses(): boolean { return this.getAsBoolean("vcFormat.indent.preserveWithinParentheses"); }
    public get vcFormatIndentCaseLabels(): boolean { return this.getAsBoolean("vcFormat.indent.caseLabels"); }
    public get vcFormatIndentCaseContents(): boolean { return this.getAsBoolean("vcFormat.indent.caseContents"); }
    public get vcFormatIndentCaseContentsWhenBlock(): boolean { return this.getAsBoolean("vcFormat.indent.caseContentsWhenBlock"); }
    public get vcFormatIndentLambdaBracesWhenParameter(): boolean { return this.getAsBoolean("vcFormat.indent.lambdaBracesWhenParameter"); }
    public get vcFormatIndentGotoLabels(): string { return this.getAsString("vcFormat.indent.gotoLabels"); }
    public get vcFormatIndentPreprocessor(): string { return this.getAsString("vcFormat.indent.preprocessor"); }
    public get vcFormatIndentAccessSpecifiers(): boolean { return this.getAsBoolean("vcFormat.indent.accessSpecifiers"); }
    public get vcFormatIndentNamespaceContents(): boolean { return this.getAsBoolean("vcFormat.indent.namespaceContents"); }
    public get vcFormatIndentPreserveComments(): boolean { return this.getAsBoolean("vcFormat.indent.preserveComments"); }
    public get vcFormatNewlineBeforeOpenBraceNamespace(): string { return this.getAsString("vcFormat.newLine.beforeOpenBrace.namespace"); }
    public get vcFormatNewlineBeforeOpenBraceType(): string { return this.getAsString("vcFormat.newLine.beforeOpenBrace.type"); }
    public get vcFormatNewlineBeforeOpenBraceFunction(): string { return this.getAsString("vcFormat.newLine.beforeOpenBrace.function"); }
    public get vcFormatNewlineBeforeOpenBraceBlock(): string { return this.getAsString("vcFormat.newLine.beforeOpenBrace.block"); }
    public get vcFormatNewlineBeforeOpenBraceLambda(): string { return this.getAsString("vcFormat.newLine.beforeOpenBrace.lambda"); }
    public get vcFormatNewlineScopeBracesOnSeparateLines(): boolean { return this.getAsBoolean("vcFormat.newLine.scopeBracesOnSeparateLines"); }
    public get vcFormatNewlineCloseBraceSameLineEmptyType(): boolean { return this.getAsBoolean("vcFormat.newLine.closeBraceSameLine.emptyType"); }
    public get vcFormatNewlineCloseBraceSameLineEmptyFunction(): boolean { return this.getAsBoolean("vcFormat.newLine.closeBraceSameLine.emptyFunction"); }
    public get vcFormatNewlineBeforeCatch(): boolean { return this.getAsBoolean("vcFormat.newLine.beforeCatch"); }
    public get vcFormatNewlineBeforeElse(): boolean { return this.getAsBoolean("vcFormat.newLine.beforeElse"); }
    public get vcFormatNewlineBeforeWhileInDoWhile(): boolean { return this.getAsBoolean("vcFormat.newLine.beforeWhileInDoWhile"); }
    public get vcFormatSpaceBeforeFunctionOpenParenthesis(): string { return this.getAsString("vcFormat.space.beforeFunctionOpenParenthesis"); }
    public get vcFormatSpaceWithinParameterListParentheses(): boolean { return this.getAsBoolean("vcFormat.space.withinParameterListParentheses"); }
    public get vcFormatSpaceBetweenEmptyParameterListParentheses(): boolean { return this.getAsBoolean("vcFormat.space.betweenEmptyParameterListParentheses"); }
    public get vcFormatSpaceAfterKeywordsInControlFlowStatements(): boolean { return this.getAsBoolean("vcFormat.space.afterKeywordsInControlFlowStatements"); }
    public get vcFormatSpaceWithinControlFlowStatementParentheses(): boolean { return this.getAsBoolean("vcFormat.space.withinControlFlowStatementParentheses"); }
    public get vcFormatSpaceBeforeLambdaOpenParenthesis(): boolean { return this.getAsBoolean("vcFormat.space.beforeLambdaOpenParenthesis"); }
    public get vcFormatSpaceWithinCastParentheses(): boolean { return this.getAsBoolean("vcFormat.space.withinCastParentheses"); }
    public get vcFormatSpaceAfterCastCloseParenthesis(): boolean { return this.getAsBoolean("vcFormat.space.afterCastCloseParenthesis"); }
    public get vcFormatSpaceWithinExpressionParentheses(): boolean { return this.getAsBoolean("vcFormat.space.withinExpressionParentheses"); }
    public get vcFormatSpaceBeforeBlockOpenBrace(): boolean { return this.getAsBoolean("vcFormat.space.beforeBlockOpenBrace"); }
    public get vcFormatSpaceBetweenEmptyBraces(): boolean { return this.getAsBoolean("vcFormat.space.betweenEmptyBraces"); }
    public get vcFormatSpaceBeforeInitializerListOpenBrace(): boolean { return this.getAsBoolean("vcFormat.space.beforeInitializerListOpenBrace"); }
    public get vcFormatSpaceWithinInitializerListBraces(): boolean { return this.getAsBoolean("vcFormat.space.withinInitializerListBraces"); }
    public get vcFormatSpacePreserveInInitializerList(): boolean { return this.getAsBoolean("vcFormat.space.preserveInInitializerList"); }
    public get vcFormatSpaceBeforeOpenSquareBracket(): boolean { return this.getAsBoolean("vcFormat.space.beforeOpenSquareBracket"); }
    public get vcFormatSpaceWithinSquareBrackets(): boolean { return this.getAsBoolean("vcFormat.space.withinSquareBrackets"); }
    public get vcFormatSpaceBeforeEmptySquareBrackets(): boolean { return this.getAsBoolean("vcFormat.space.beforeEmptySquareBrackets"); }
    public get vcFormatSpaceBetweenEmptySquareBrackets(): boolean { return this.getAsBoolean("vcFormat.space.betweenEmptySquareBrackets"); }
    public get vcFormatSpaceGroupSquareBrackets(): boolean { return this.getAsBoolean("vcFormat.space.groupSquareBrackets"); }
    public get vcFormatSpaceWithinLambdaBrackets(): boolean { return this.getAsBoolean("vcFormat.space.withinLambdaBrackets"); }
    public get vcFormatSpaceBetweenEmptyLambdaBrackets(): boolean { return this.getAsBoolean("vcFormat.space.betweenEmptyLambdaBrackets"); }
    public get vcFormatSpaceBeforeComma(): boolean { return this.getAsBoolean("vcFormat.space.beforeComma"); }
    public get vcFormatSpaceAfterComma(): boolean { return this.getAsBoolean("vcFormat.space.afterComma"); }
    public get vcFormatSpaceRemoveAroundMemberOperators(): boolean { return this.getAsBoolean("vcFormat.space.removeAroundMemberOperators"); }
    public get vcFormatSpaceBeforeInheritanceColon(): boolean { return this.getAsBoolean("vcFormat.space.beforeInheritanceColon"); }
    public get vcFormatSpaceBeforeConstructorColon(): boolean { return this.getAsBoolean("vcFormat.space.beforeConstructorColon"); }
    public get vcFormatSpaceRemoveBeforeSemicolon(): boolean { return this.getAsBoolean("vcFormat.space.removeBeforeSemicolon"); }
    public get vcFormatSpaceInsertAfterSemicolon(): boolean { return this.getAsBoolean("vcFormat.space.insertAfterSemicolon"); }
    public get vcFormatSpaceRemoveAroundUnaryOperator(): boolean { return this.getAsBoolean("vcFormat.space.removeAroundUnaryOperator"); }
    public get vcFormatSpaceAroundBinaryOperator(): string { return this.getAsString("vcFormat.space.aroundBinaryOperator"); }
    public get vcFormatSpaceAroundAssignmentOperator(): string { return this.getAsString("vcFormat.space.aroundAssignmentOperator"); }
    public get vcFormatSpacePointerReferenceAlignment(): string { return this.getAsString("vcFormat.space.pointerReferenceAlignment"); }
    public get vcFormatSpaceAroundTernaryOperator(): string { return this.getAsString("vcFormat.space.aroundTernaryOperator"); }
    public get vcFormatWrapPreserveBlocks(): string { return this.getAsString("vcFormat.wrap.preserveBlocks"); }
    public get dimInactiveRegions(): boolean {
        return this.getAsBoolean("dimInactiveRegions")
            && this.intelliSenseEngine.toLowerCase() === "default" && vscode.workspace.getConfiguration("workbench").get<any>("colorTheme") !== "Default High Contrast";
    }
    public get sshTargetsView(): string { return this.getAsString("sshTargetsView"); }

    // Returns the value of a setting as a string with proper type validation and checks for valid enum values while returning an undefined value if necessary.
    private getAsStringOrUndefined(settingName: string): string | undefined {
        const value: any = super.Section.get<any>(settingName);
        const setting = getRawSetting("C_Cpp." + settingName, true);
        if (setting.default !== undefined) {
            console.error(`Default value for ${settingName} is expected to be undefined.`);
        }

        if (setting.enum !== undefined) {
            if (this.isValidEnum(setting.enum, value)) {
                return value;
            }
        } else if (isString(value)) {
            return value;
        }

        return undefined;
    }

    // Returns the value of a setting as a boolean with proper type validation and checks for valid enum values while returning an undefined value if necessary.
    private getAsBooleanOrUndefined(settingName: string): boolean | undefined {
        const value: any = super.Section.get<any>(settingName);
        const setting = getRawSetting("C_Cpp." + settingName, true);
        if (setting.default !== undefined) {
            console.error(`Default value for ${settingName} is expected to be undefined.`);
        }

        if (isBoolean(value)) {
            return value;
        }

        return undefined;
    }

    private isValidDefault(isValid: (x: any) => boolean, value: any, allowNull: boolean): boolean {
        return isValid(value) || (allowNull && value === null);
    }

    // Returns the value of a setting as a boolean with proper type validation.
    private getAsBoolean(settingName: string): boolean;
    private getAsBoolean(settingName: string, allowNull: boolean): boolean | null;
    private getAsBoolean(settingName: string, allowNull: boolean = false): boolean | null {
        const value: any = super.Section.get<any>(settingName);
        const setting = getRawSetting("C_Cpp." + settingName, true);
        if (!this.isValidDefault(isBoolean, setting.default, allowNull)) {
            console.error(`Default value for ${settingName} is expected to be boolean${allowNull ? ' or null' : ''}.`);
        }

        if (allowNull && value === null) {
            return null;
        }

        if (isBoolean(value)) {
            return value;
        }
        return setting.default;
    }

    // Returns the value of a setting as a string with proper type validation and checks for valid enum values.
    private getAsString(settingName: string): string;
    private getAsString(settingName: string, allowNull: boolean): string | null;
    private getAsString(settingName: string, allowNull: boolean = false): string | null {
        const value: any = super.Section.get<any>(settingName);
        const setting = getRawSetting("C_Cpp." + settingName, true);
        if (!this.isValidDefault(isString, setting.default, allowNull)) {
            console.error(`Default value for ${settingName} is expected to be string${allowNull ? ' or null' : ''}.`);
        }

        if (allowNull && value === null) {
            return null;
        }

        if (setting.enum !== undefined) {
            if (settingName === "loggingLevel" && isString(value) && isNumber(Number(value)) && Number(value) >= 0) {
                return value;
            }
            if (this.isValidEnum(setting.enum, value)) {
                return value;
            }
        } else if (isString(value)) {
            return value;
        }
        return setting.default as string;
    }

    // Returns the value of a setting as a number with proper type validation and checks if value falls within the specified range.
    private getAsNumber(settingName: string): number;
    private getAsNumber(settingName: string, allowNull: boolean): number | null;
    private getAsNumber(settingName: string, allowNull: boolean = false): number | null {
        const value: any = super.Section.get<any>(settingName);
        const setting = getRawSetting("C_Cpp." + settingName, true);
        if (!this.isValidDefault(isNumber, setting.default, allowNull)) {
            console.error(`Default value for ${settingName} is expected to be number${allowNull ? ' or null' : ''}.`);
        }

        if (allowNull && value === null) {
            return null;
        }
        // Validates the value is a number and clamps it to the specified range. Allows for undefined maximum or minimum values.
        if (isNumber(value)) {
            if (setting.minimum !== undefined && value < setting.minimum) {
                return setting.minimum;
            }
            if (setting.maximum !== undefined && value > setting.maximum) {
                return setting.maximum;
            }
            return value;
        }
        return setting.default as number;
    }

    private getAsArrayOfStringsOrUndefined(settingName: string, allowUndefinedEnums: boolean = false): string[] | undefined {
        const value: any = super.Section.get(settingName);
        const setting = getRawSetting("C_Cpp." + settingName, true);
        if (setting.default !== undefined) {
            console.error(`Default value for ${settingName} is expected to be undefined.`);
        }

        if (isArrayOfString(value)) {
            if (setting.items.enum && !allowUndefinedEnums) {
                if (!value.every(x => this.isValidEnum(setting.items.enum, x))) {
                    return setting.default;
                }
            }
            return value;
        }
        return setting.default as string[];
    }

    // Returns the value of a setting as an array of strings with proper type validation and checks for valid enum values.
    private getAsArrayOfStrings(settingName: string, allowUndefinedEnums: boolean = false): string[] {
        const value: any = super.Section.get(settingName);
        const setting = getRawSetting("C_Cpp." + settingName, true);
        if (!isArrayOfString(setting.default)) {
            console.error(`Default value for ${settingName} is expected to be string[].`);
        }

        if (isArrayOfString(value)) {
            if (setting.items.enum && !allowUndefinedEnums) {
                if (!value.every(x => this.isValidEnum(setting.items.enum, x))) {
                    return setting.default;
                }
            }
            return value;
        }
        return setting.default as string[];
    }

    private getAsExcludes(settingName: string): Excludes;
    private getAsExcludes(settingName: string, allowNull: boolean): Excludes | null;
    private getAsExcludes(settingName: string, allowNull: boolean = false): Excludes | null {
        const value: any = super.Section.get(settingName);
        const setting = getRawSetting("C_Cpp." + settingName, true);
        if (!this.isValidDefault(x => isValidMapping(x, isString, val => isBoolean(val) || isValidWhenObject(val)), setting.default, allowNull)) {
            console.error(`Default value for ${settingName} is expected to be Excludes${allowNull ? ' or null' : ''}.`);
        }

        if (allowNull && value === null) {
            return null;
        }
        if (isValidMapping(value, isString, val => isBoolean(val) || isValidWhenObject(val))) {
            return value as Excludes;
        }
        return setting.default as Excludes;
    }

    private getAsAssociations(settingName: string): Associations;
    private getAsAssociations(settingName: string, allowNull: boolean): Associations | null;
    private getAsAssociations(settingName: string, allowNull: boolean = false): Associations | null {
        const value: any = super.Section.get<any>(settingName);
        const setting = getRawSetting("C_Cpp." + settingName, true);
        if (!this.isValidDefault(x => isValidMapping(x, isString, isString), setting.default, allowNull)) {
            console.error(`Default value for ${settingName} is expected to be Associations${allowNull ? ' or null' : ''}.`);
        }

        if (allowNull && value === null) {
            return null;
        }
        if (isValidMapping(value, isString, isString)) {
            return value as Associations;
        }
        return setting.default as Associations;
    }

    // Checks a given enum value against a list of valid enum values from package.json.
    private isValidEnum(enumDescription: any, value: any): value is string {
        if (isString(value) && isArray(enumDescription) && enumDescription.length > 0) {
            return enumDescription.some(x => x.toLowerCase() === value.toLowerCase());
        }
        return false;
    }

    private isArrayOfCommentContinuationPatterns(x: any): x is (string | CommentPattern)[] {
        return isArray(x) && x.every(y => isString(y) || this.isCommentPattern(y));
    }

    private isCommentPattern(x: any): x is CommentPattern {
        return isObject(x) && isString(x.begin) && isString(x.continue);
    }

    public toggleSetting(name: string, value1: string, value2: string): void {
        const value: string = this.getAsString(name);
        void super.Section.update(name, value?.toLowerCase() === value1.toLowerCase() ? value2 : value1, getTarget());
    }

    public update<T>(name: string, value: T): void {
        void super.Section.update(name, value);
    }

    public populateEditorConfig(document: vscode.TextDocument): void {
        // Set up a map of setting names and values. Parse through the document line-by-line, looking for
        // existing occurrences to replace. Replaced occurrences are removed from the map. If any remain when
        // done, they are added as a new section at the end of the file. The file is opened with unsaved
        // edits, so the user may edit or undo if we made a mistake.
        const settingMap: Map<string, string> = new Map<string, string>();
        settingMap.set("cpp_indent_braces", this.vcFormatIndentBraces.toString());
        settingMap.set("cpp_indent_multi_line_relative_to", mapIndentationReferenceToEditorConfig(this.vcFormatIndentMultiLineRelativeTo));
        settingMap.set("cpp_indent_within_parentheses", this.vcFormatIndentWithinParentheses.toString());
        settingMap.set("cpp_indent_preserve_within_parentheses", this.vcFormatIndentPreserveWithinParentheses.toString());
        settingMap.set("cpp_indent_case_labels", this.vcFormatIndentCaseLabels.toString());
        settingMap.set("cpp_indent_case_contents", this.vcFormatIndentCaseContents.toString());
        settingMap.set("cpp_indent_case_contents_when_block", this.vcFormatIndentCaseContentsWhenBlock.toString());
        settingMap.set("cpp_indent_lambda_braces_when_parameter", this.vcFormatIndentLambdaBracesWhenParameter.toString());
        settingMap.set("cpp_indent_goto_labels", mapIndentToEditorConfig(this.vcFormatIndentGotoLabels));
        settingMap.set("cpp_indent_preprocessor", mapIndentToEditorConfig(this.vcFormatIndentPreprocessor));
        settingMap.set("cpp_indent_access_specifiers", this.vcFormatIndentAccessSpecifiers.toString());
        settingMap.set("cpp_indent_namespace_contents", this.vcFormatIndentNamespaceContents.toString());
        settingMap.set("cpp_indent_preserve_comments", this.vcFormatIndentPreserveComments.toString());
        settingMap.set("cpp_new_line_before_open_brace_namespace", mapNewOrSameLineToEditorConfig(this.vcFormatNewlineBeforeOpenBraceNamespace));
        settingMap.set("cpp_new_line_before_open_brace_type", mapNewOrSameLineToEditorConfig(this.vcFormatNewlineBeforeOpenBraceType));
        settingMap.set("cpp_new_line_before_open_brace_function", mapNewOrSameLineToEditorConfig(this.vcFormatNewlineBeforeOpenBraceFunction));
        settingMap.set("cpp_new_line_before_open_brace_block", mapNewOrSameLineToEditorConfig(this.vcFormatNewlineBeforeOpenBraceBlock));
        settingMap.set("cpp_new_line_before_open_brace_lambda", mapNewOrSameLineToEditorConfig(this.vcFormatNewlineBeforeOpenBraceLambda));
        settingMap.set("cpp_new_line_scope_braces_on_separate_lines", this.vcFormatNewlineScopeBracesOnSeparateLines.toString());
        settingMap.set("cpp_new_line_close_brace_same_line_empty_type", this.vcFormatNewlineCloseBraceSameLineEmptyType.toString());
        settingMap.set("cpp_new_line_close_brace_same_line_empty_function", this.vcFormatNewlineCloseBraceSameLineEmptyFunction.toString());
        settingMap.set("cpp_new_line_before_catch", this.vcFormatNewlineBeforeCatch.toString().toString());
        settingMap.set("cpp_new_line_before_else", this.vcFormatNewlineBeforeElse.toString().toString());
        settingMap.set("cpp_new_line_before_while_in_do_while", this.vcFormatNewlineBeforeWhileInDoWhile.toString());
        settingMap.set("cpp_space_before_function_open_parenthesis", this.vcFormatSpaceBeforeFunctionOpenParenthesis.toString());
        settingMap.set("cpp_space_within_parameter_list_parentheses", this.vcFormatSpaceWithinParameterListParentheses.toString());
        settingMap.set("cpp_space_between_empty_parameter_list_parentheses", this.vcFormatSpaceBetweenEmptyParameterListParentheses.toString());
        settingMap.set("cpp_space_after_keywords_in_control_flow_statements", this.vcFormatSpaceAfterKeywordsInControlFlowStatements.toString());
        settingMap.set("cpp_space_within_control_flow_statement_parentheses", this.vcFormatSpaceWithinControlFlowStatementParentheses.toString());
        settingMap.set("cpp_space_before_lambda_open_parenthesis", this.vcFormatSpaceBeforeLambdaOpenParenthesis.toString());
        settingMap.set("cpp_space_within_cast_parentheses", this.vcFormatSpaceWithinCastParentheses.toString());
        settingMap.set("cpp_space_after_cast_close_parenthesis", this.vcFormatSpaceAfterCastCloseParenthesis.toString());
        settingMap.set("cpp_space_within_expression_parentheses", this.vcFormatSpaceWithinExpressionParentheses.toString());
        settingMap.set("cpp_space_before_block_open_brace", this.vcFormatSpaceBeforeBlockOpenBrace.toString());
        settingMap.set("cpp_space_between_empty_braces", this.vcFormatSpaceBetweenEmptyBraces.toString());
        settingMap.set("cpp_space_before_initializer_list_open_brace", this.vcFormatSpaceBeforeInitializerListOpenBrace.toString());
        settingMap.set("cpp_space_within_initializer_list_braces", this.vcFormatSpaceWithinInitializerListBraces.toString());
        settingMap.set("cpp_space_preserve_in_initializer_list", this.vcFormatSpacePreserveInInitializerList.toString());
        settingMap.set("cpp_space_before_open_square_bracket", this.vcFormatSpaceBeforeOpenSquareBracket.toString());
        settingMap.set("cpp_space_within_square_brackets", this.vcFormatSpaceWithinSquareBrackets.toString());
        settingMap.set("cpp_space_before_empty_square_brackets", this.vcFormatSpaceBeforeEmptySquareBrackets.toString());
        settingMap.set("cpp_space_between_empty_square_brackets", this.vcFormatSpaceBetweenEmptySquareBrackets.toString());
        settingMap.set("cpp_space_group_square_brackets", this.vcFormatSpaceGroupSquareBrackets.toString());
        settingMap.set("cpp_space_within_lambda_brackets", this.vcFormatSpaceWithinLambdaBrackets.toString());
        settingMap.set("cpp_space_between_empty_lambda_brackets", this.vcFormatSpaceBetweenEmptyLambdaBrackets.toString());
        settingMap.set("cpp_space_before_comma", this.vcFormatSpaceBeforeComma.toString());
        settingMap.set("cpp_space_after_comma", this.vcFormatSpaceAfterComma.toString());
        settingMap.set("cpp_space_remove_around_member_operators", this.vcFormatSpaceRemoveAroundMemberOperators.toString());
        settingMap.set("cpp_space_before_inheritance_colon", this.vcFormatSpaceBeforeInheritanceColon.toString());
        settingMap.set("cpp_space_before_constructor_colon", this.vcFormatSpaceBeforeConstructorColon.toString());
        settingMap.set("cpp_space_remove_before_semicolon", this.vcFormatSpaceRemoveBeforeSemicolon.toString());
        settingMap.set("cpp_space_after_semicolon", this.vcFormatSpaceInsertAfterSemicolon.toString());
        settingMap.set("cpp_space_remove_around_unary_operator", this.vcFormatSpaceRemoveAroundUnaryOperator.toString());
        settingMap.set("cpp_space_around_binary_operator", this.vcFormatSpaceAroundBinaryOperator.toString());
        settingMap.set("cpp_space_around_assignment_operator", this.vcFormatSpaceAroundAssignmentOperator.toString());
        settingMap.set("cpp_space_pointer_reference_alignment", this.vcFormatSpacePointerReferenceAlignment.toString());
        settingMap.set("cpp_space_around_ternary_operator", this.vcFormatSpaceAroundTernaryOperator.toString());
        settingMap.set("cpp_wrap_preserve_blocks", mapWrapToEditorConfig(this.vcFormatWrapPreserveBlocks));
        const edits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
        let isInWildcardSection: boolean = false;
        let trailingBlankLines: number = 0;
        // Cycle through lines using document.lineAt(), to avoid issues mapping edits back to lines.
        for (let i: number = 0; i < document.lineCount; ++i) {
            let textLine: vscode.TextLine = document.lineAt(i);
            if (textLine.range.end.character === 0) {
                trailingBlankLines++;
                continue;
            }
            trailingBlankLines = 0;
            // Keep track of whether we left off in a wildcard section, so we don't output a redundant one.
            let text: string = textLine.text.trim();
            if (text.startsWith("[")) {
                isInWildcardSection = text.startsWith("[*]");
                continue;
            }
            for (const setting of settingMap) {
                if (text.startsWith(setting[0])) {
                    // The next character must be white space or '=', otherwise it's a partial match.
                    if (text.length > setting[0].length) {
                        const c: string = text[setting[0].length];
                        if (c !== '=' && c.trim() !== "") {
                            continue;
                        }
                    }
                    edits.replace(document.uri, textLine.range, setting[0] + "=" + setting[1]);
                    // Because we're going to remove this setting from the map,
                    // scan ahead to update any other sections it may need to be updated in.
                    for (let j: number = i + 1; j < document.lineCount; ++j) {
                        textLine = document.lineAt(j);
                        text = textLine.text.trim();
                        if (text.startsWith(setting[0])) {
                            // The next character must be white space or '=', otherwise it's a partial match.
                            if (text.length > setting[0].length) {
                                const c: string = text[setting[0].length];
                                if (c !== '=' && c.trim() !== "") {
                                    continue;
                                }
                            }
                            edits.replace(document.uri, textLine.range, setting[0] + "=" + setting[1]);
                        }
                    }
                    settingMap.delete(setting[0]);
                    break;
                }
            }
            if (settingMap.size === 0) {
                break;
            }
        }
        if (settingMap.size > 0) {
            let remainingSettingsText: string = "";
            if (document.lineCount > 0) {
                while (++trailingBlankLines < 2) {
                    remainingSettingsText += "\n";
                }
            }
            if (!isInWildcardSection) {
                remainingSettingsText += "[*]\n";
            }
            for (const setting of settingMap) {
                remainingSettingsText += setting[0] + "=" + setting[1] + "\n";
            }
            const lastPosition: vscode.Position = document.lineAt(document.lineCount - 1).range.end;
            edits.insert(document.uri, lastPosition, remainingSettingsText);
        }
        void vscode.workspace.applyEdit(edits).then(() => vscode.window.showTextDocument(document));
    }

    public async generateEditorConfig(): Promise<void> {
        let document: vscode.TextDocument;
        if (this.resource) {
            // If a folder is open and '.editorconfig' exists at the root, use that.
            const uri: vscode.Uri = vscode.Uri.joinPath(this.resource, ".editorconfig");
            const edits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
            edits.createFile(uri, { ignoreIfExists: true, overwrite: false });
            try {
                await vscode.workspace.applyEdit(edits);
                document = await vscode.workspace.openTextDocument(uri);
            } catch (e) {
                document = await vscode.workspace.openTextDocument();
            }
        } else {
            document = await vscode.workspace.openTextDocument();
        }
        this.populateEditorConfig(document);
    }

    // If formattingEngine is set to "default", searches for .editorconfig with vcFormat
    // entries, or a .clang-format file, to determine which settings to use.
    // This is intentionally not async to avoid races due to multiple entrancy.
    public useVcFormat(document: vscode.TextDocument): boolean {
        if (this.formattingEngine !== "default") {
            return this.formattingEngine.toLowerCase() === "vcformat";
        }
        if (this.clangFormatStyle && this.clangFormatStyle !== "file") {
            // If a clang-format style other than file is specified, don't try to switch to vcFormat.
            return false;
        }
        const cachedValue: boolean | undefined = cachedEditorConfigLookups.get(document.uri.fsPath);
        if (cachedValue !== undefined) {
            return cachedValue;
        }
        let foundEditorConfigWithVcFormatSettings: boolean = false;
        const findConfigFile: (parentPath: string) => boolean = (parentPath: string) => {
            const editorConfigPath: string = path.join(parentPath, ".editorconfig");
            if (fs.existsSync(editorConfigPath)) {
                const editorConfigSettings: any = getEditorConfigSettings(document.uri.fsPath);
                const keys: string[] = Object.keys(editorConfigSettings);
                for (let i: number = 0; i < keys.length; ++i) {
                    if (keys[i].startsWith("cpp_")) {
                        const cppCheck: string = keys[i].substring(4);
                        if (cppCheck.startsWith("indent_") || cppCheck.startsWith("new_line_") ||
                            cppCheck.startsWith("space_") || cppCheck.startsWith("wrap_")) {
                            foundEditorConfigWithVcFormatSettings = true;
                            const didEditorConfigNotice: PersistentState<boolean> = new PersistentState<boolean>("Cpp.didEditorConfigNotice", false);
                            if (!didEditorConfigNotice.Value) {
                                void vscode.window.showInformationMessage(localize({ key: "editorconfig.default.behavior", comment: ["Single-quotes are used here, as this message is displayed in a context that does not render markdown. Do not change them to back-ticks. Do not change the contents of the single-quoted text."] },
                                    "Code formatting is using settings from .editorconfig instead of .clang-format. For more information, see the documentation for the 'default' value of the 'C_Cpp.formatting' setting."));
                                didEditorConfigNotice.Value = true;
                            }
                            return true;
                        }
                    }
                }
                switch (typeof editorConfigSettings.root) {
                    case "boolean":
                        return editorConfigSettings.root;
                    case "string":
                        return editorConfigSettings.root.toLowerCase() === "true";
                    default:
                        return false;
                }
            }
            const clangFormatPath1: string = path.join(parentPath, ".clang-format");
            if (fs.existsSync(clangFormatPath1)) {
                return true;
            }
            const clangFormatPath2: string = path.join(parentPath, "_clang-format");
            return fs.existsSync(clangFormatPath2);
        };
        // Scan parent paths to see which we find first, ".clang-format" or ".editorconfig"
        const fsPath: string = document.uri.fsPath;
        let parentPath: string = path.dirname(fsPath);
        let currentParentPath: string;
        do {
            currentParentPath = parentPath;
            if (findConfigFile(currentParentPath)) {
                cachedEditorConfigLookups.set(document.uri.fsPath, foundEditorConfigWithVcFormatSettings);
                return foundEditorConfigWithVcFormatSettings;
            }
            parentPath = path.dirname(parentPath);
        } while (parentPath !== currentParentPath);
        cachedEditorConfigLookups.set(document.uri.fsPath, false);
        return false;
    }
}

export class OtherSettings {
    private resource: vscode.Uri | undefined;

    constructor(resource?: vscode.Uri) {
        if (!resource) {
            resource = undefined;
        }
        this.resource = resource;
    }

    private logValidationError(sectionName: string, settingName: string, error: string): void {
        telemetry.logLanguageServerEvent("settingsValidation", { setting: sectionName + '.' + settingName, error });
    }

    private getAsString(sectionName: string, settingName: string, resource: any, defaultValue: string): string {
        const section = vscode.workspace.getConfiguration(sectionName, resource);
        const value = section.get<any>(settingName);
        if (isString(value)) {
            return value;
        }
        const setting = section.inspect<any>(settingName);

        if (setting?.defaultValue === undefined || setting.defaultValue === null) {
            this.logValidationError(sectionName, settingName, "no default value");
            return defaultValue;
        }
        return setting.defaultValue;
    }

    private getAsBoolean(sectionName: string, settingName: string, resource: any, defaultValue: boolean): boolean {
        const section = vscode.workspace.getConfiguration(sectionName, resource);
        const value = section.get<any>(settingName);
        if (isBoolean(value)) {
            return value;
        }
        const setting = section.inspect<any>(settingName);
        if (setting?.defaultValue === undefined || setting.defaultValue === null) {
            this.logValidationError(sectionName, settingName, "no default value");
            return defaultValue;
        }
        return setting.defaultValue;
    }

    private getAsNumber(sectionName: string, settingName: string, resource: any, defaultValue: number, minimum?: number, maximum?: number): number {
        const section = vscode.workspace.getConfiguration(sectionName, resource);
        const value = section.get<any>(settingName);
        // Validates the value is a number and clamps it to the specified range. Allows for undefined maximum or minimum values.
        if (isNumber(value)) {
            if (minimum !== undefined && value < minimum) {
                return minimum;
            }
            if (maximum !== undefined && value > maximum) {
                return maximum;
            }
            return value;
        }
        const setting = section.inspect<any>(settingName);
        if (setting?.defaultValue === undefined || setting.defaultValue === null) {
            this.logValidationError(sectionName, settingName, "no default value");
            return defaultValue;
        }
        return setting.defaultValue;
    }

    private getAsAssociations(sectionName: string, settingName: string, defaultValue: Associations, resource?: any): Associations {
        const section = vscode.workspace.getConfiguration(sectionName, resource);
        const value = section.get<any>(settingName);
        if (isValidMapping(value, isString, isString)) {
            return value as Associations;
        }
        const setting = section.inspect<any>(settingName);
        if (setting?.defaultValue === undefined || setting.defaultValue === null) {
            this.logValidationError(sectionName, settingName, "no default value");
        }
        return setting?.defaultValue ?? defaultValue;
    }

    private getAsExcludes(sectionName: string, settingName: string, defaultValue: Excludes, resource?: any): Excludes {
        const section = vscode.workspace.getConfiguration(sectionName, resource);
        const value = section.get<any>(settingName);
        if (isValidMapping(value, isString, (val) => isBoolean(val) || isValidWhenObject(val))) {
            return value as Excludes;
        }
        const setting = section.inspect<any>(settingName);
        if (setting?.defaultValue === undefined || setting.defaultValue === null) {
            this.logValidationError(sectionName, settingName, "no default value");
        }
        return setting?.defaultValue ?? defaultValue;
    }

    // All default values are obtained from the VS Code settings UI. Please update the default values as needed.
    public get editorTabSize(): number { return this.getAsNumber("editor", "tabSize", this.resource, 4, 1); }
    public get editorInsertSpaces(): boolean { return this.getAsBoolean("editor", "insertSpaces", this.resource, true); }
    public get editorAutoClosingBrackets(): string { return this.getAsString("editor", "autoClosingBrackets", this.resource, "languageDefined"); }
    public get filesEncoding(): string { return this.getAsString("files", "encoding", { uri: this.resource, languageId: "cpp" }, "utf8"); }
    public get filesAssociations(): Associations { return this.getAsAssociations("files", "associations", {}); }
    public set filesAssociations(value: any) { void vscode.workspace.getConfiguration("files").update("associations", value, vscode.ConfigurationTarget.Workspace); }
    private readonly defaultFilesExcludes = {
        "**/.git": true,
        "**/.svn": true,
        "**/.hg": true,
        "**/CVS": true,
        "**/.DS_Store": true,
        "**/Thumbs.db": true
    };
    public get filesExclude(): Excludes { return this.getAsExcludes("files", "exclude", this.defaultFilesExcludes, this.resource); }
    public get filesAutoSaveAfterDelay(): boolean { return this.getAsString("files", "autoSave", this.resource, "off") === "afterDelay"; }
    public get editorInlayHintsEnabled(): boolean { return this.getAsString("editor.inlayHints", "enabled", this.resource, "on") !== "off"; }
    public get editorParameterHintsEnabled(): boolean { return this.getAsBoolean("editor.parameterHints", "enabled", this.resource, true); }
    private readonly defaultSearchExcludes = {
        "**/node_modules": true,
        "**/bower_components": true,
        "**/*.code-search": true
    };
    public get searchExclude(): Excludes { return this.getAsExcludes("search", "exclude", this.defaultSearchExcludes, this.resource); }
    public get workbenchSettingsEditor(): string { return this.getAsString("workbench.settings", "editor", this.resource, "ui"); }
}
