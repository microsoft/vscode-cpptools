/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CommentPattern } from './languageConfig';
import { getExtensionFilePath, getCachedClangFormatPath, setCachedClangFormatPath, getCachedClangTidyPath, setCachedClangTidyPath } from '../common';
import * as os from 'os';
import * as which from 'which';
import { execSync } from 'child_process';
import * as semver from 'semver';

function getTarget(): vscode.ConfigurationTarget {
    return (vscode.workspace.workspaceFolders) ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global;
}

class Settings {
    private readonly settings: vscode.WorkspaceConfiguration;

    /**
     * create the Settings object.
     * @param resource The path to a resource to which the settings should apply, or undefined if global settings are desired
     */
    constructor(section: string, resource?: vscode.Uri) {
        this.settings = vscode.workspace.getConfiguration(section, resource ? resource : undefined);
    }

    protected get Section(): vscode.WorkspaceConfiguration { return this.settings; }

    protected getWithFallback<T>(section: string, deprecatedSection: string): T {
        const info: any = this.settings.inspect<T>(section);
        if (info.workspaceFolderValue !== undefined) {
            return info.workspaceFolderValue;
        } else if (info.workspaceValue !== undefined) {
            return info.workspaceValue;
        } else if (info.globalValue !== undefined) {
            return info.globalValue;
        }
        const value: T | undefined = this.settings.get<T>(deprecatedSection);
        if (value !== undefined) {
            return value;
        }
        return info.defaultValue;
    }

    protected getWithNullAsUndefined<T>(section: string): T | undefined {
        const result: T | undefined | null = this.settings.get<T>(section);
        if (result === null) {
            return undefined;
        }
        return result;
    }
}

export class CppSettings extends Settings {
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
        let path: string | undefined | null = super.Section.get<string>(isFormat ? "clang_format_path" : "clangTidy.path");
        if (!path) {
            const cachedClangPath: string | null | undefined = isFormat ? getCachedClangFormatPath() : getCachedClangTidyPath();
            if (cachedClangPath !== undefined) {
                if (cachedClangPath === null) {
                    return undefined;
                }
                return cachedClangPath;
            }
            const clangStr: string = isFormat ? this.clangFormatStr : this.clangTidyStr;
            const clangName: string = isFormat ? this.clangFormatName : this.clangTidyName;
            const setCachedClangPath: (path: string | null) => void = isFormat ? setCachedClangFormatPath : setCachedClangTidyPath;
            path = which.sync(clangName, { nothrow: true });
            setCachedClangPath(path);
            if (!path) {
                return undefined;
            } else {
                // Attempt to invoke both our own version of clang-* to see if we can successfully execute it, and to get it's version.
                let clangVersion: string;
                try {
                    const exePath: string = getExtensionFilePath(`./LLVM/bin/${clangName}`);
                    const output: string[] = execSync(`${exePath} --version`).toString().split(" ");
                    if (output.length < 3 || output[0] !== clangStr || output[1] !== "version" || !semver.valid(output[2])) {
                        return path;
                    }
                    clangVersion = output[2];
                } catch (e) {
                    // Unable to invoke our own clang-*.  Use the system installed clang-*.
                    return path;
                }

                // Invoke the version on the system to compare versions.  Use ours if it's more recent.
                try {
                    const output: string[] = execSync(`"${path}" --version`).toString().split(" ");
                    if (output.length < 3 || output[0] !== clangStr || output[1] !== "version" || semver.ltr(output[2], clangVersion)) {
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

    public get maxConcurrentThreads(): number | undefined | null { return super.Section.get<number | null>("maxConcurrentThreads"); }
    public get maxCachedProcesses(): number | undefined | null { return super.Section.get<number | null>("maxCachedProcesses"); }
    public get maxMemory(): number | undefined | null { return super.Section.get<number | null>("maxMemory"); }
    public get intelliSenseMaxCachedProcesses(): number | undefined | null { return super.Section.get<number | null>("intelliSense.maxCachedProcesses"); }
    public get intelliSenseMaxMemory(): number | undefined | null { return super.Section.get<number | null>("intelliSense.maxMemory"); }
    public get referencesMaxConcurrentThreads(): number | undefined | null { return super.Section.get<number | null>("references.maxConcurrentThreads"); }
    public get referencesMaxCachedProcesses(): number | undefined | null { return super.Section.get<number | null>("references.maxCachedProcesses"); }
    public get referencesMaxMemory(): number | undefined | null { return super.Section.get<number | null>("references.maxMemory"); }
    public get clangTidyMaxConcurrentThreads(): number | undefined { return super.Section.get<number>("clangTidy.maxConcurrentThreads"); }
    public get clangTidyMaxMemory(): number | undefined { return super.Section.get<number>("clangTidy.maxMemory"); }
    public get clangTidyExclude(): vscode.WorkspaceConfiguration | undefined { return super.Section.get<vscode.WorkspaceConfiguration>("clangTidy.exclude"); }
    public get clangFormatStyle(): string | undefined { return super.Section.get<string>("clang_format_style"); }
    public get clangFormatFallbackStyle(): string | undefined { return super.Section.get<string>("clang_format_fallbackStyle"); }
    public get clangFormatSortIncludes(): string | undefined { return super.Section.get<string>("clang_format_sortIncludes"); }
    public get experimentalFeatures(): string | undefined { return super.Section.get<string>("experimentalFeatures"); }
    public get suggestSnippets(): boolean | undefined { return super.Section.get<boolean>("suggestSnippets"); }
    public get intelliSenseEngine(): string | undefined { return super.Section.get<string>("intelliSenseEngine"); }
    public get intelliSenseEngineFallback(): string | undefined { return super.Section.get<string>("intelliSenseEngineFallback"); }
    public get intelliSenseCachePath(): string | undefined { return super.Section.get<string>("intelliSenseCachePath"); }
    public get intelliSenseCacheSize(): number | undefined { return super.Section.get<number>("intelliSenseCacheSize"); }
    public get intelliSenseMemoryLimit(): number | undefined { return super.Section.get<number>("intelliSenseMemoryLimit"); }
    public get intelliSenseUpdateDelay(): number | undefined { return super.Section.get<number>("intelliSenseUpdateDelay"); }
    public get errorSquiggles(): string | undefined { return super.Section.get<string>("errorSquiggles"); }
    public get inactiveRegionOpacity(): number | undefined { return super.Section.get<number>("inactiveRegionOpacity"); }
    public get inactiveRegionForegroundColor(): string | undefined { return super.Section.get<string>("inactiveRegionForegroundColor"); }
    public get inactiveRegionBackgroundColor(): string | undefined { return super.Section.get<string>("inactiveRegionBackgroundColor"); }
    public get autocomplete(): string | undefined { return super.Section.get<string>("autocomplete"); }
    public get autocompleteAddParentheses(): boolean | undefined { return super.Section.get<boolean>("autocompleteAddParentheses"); }
    public get loggingLevel(): string | undefined { return super.Section.get<string>("loggingLevel"); }
    public get autoAddFileAssociations(): boolean | undefined { return super.Section.get<boolean>("autoAddFileAssociations"); }
    public get workspaceParsingPriority(): string | undefined { return super.Section.get<string>("workspaceParsingPriority"); }
    public get workspaceSymbols(): string | undefined { return super.Section.get<string>("workspaceSymbols"); }
    public get exclusionPolicy(): string | undefined { return super.Section.get<string>("exclusionPolicy"); }
    public get simplifyStructuredComments(): boolean | undefined { return super.Section.get<boolean>("simplifyStructuredComments"); }
    public get commentContinuationPatterns(): (string | CommentPattern)[] | undefined { return super.Section.get<(string | CommentPattern)[]>("commentContinuationPatterns"); }
    public get configurationWarnings(): string | undefined { return super.Section.get<string>("configurationWarnings"); }
    public get preferredPathSeparator(): string | undefined { return super.Section.get<string>("preferredPathSeparator"); }
    public get updateChannel(): string | undefined { return super.Section.get<string>("updateChannel"); }
    public get vcpkgEnabled(): boolean | undefined { return super.Section.get<boolean>("vcpkg.enabled"); }
    public get addNodeAddonIncludePaths(): boolean | undefined { return super.Section.get<boolean>("addNodeAddonIncludePaths"); }
    public get renameRequiresIdentifier(): boolean | undefined { return super.Section.get<boolean>("renameRequiresIdentifier"); }
    public get filesExclude(): vscode.WorkspaceConfiguration | undefined { return super.Section.get<vscode.WorkspaceConfiguration>("files.exclude"); }
    public get defaultIncludePath(): string[] | undefined { return super.Section.get<string[]>("default.includePath"); }
    public get defaultDefines(): string[] | undefined { return super.Section.get<string[]>("default.defines"); }
    public get defaultMacFrameworkPath(): string[] | undefined { return super.Section.get<string[]>("default.macFrameworkPath"); }
    public get defaultWindowsSdkVersion(): string | undefined { return super.Section.get<string>("default.windowsSdkVersion"); }
    public get defaultCompileCommands(): string | undefined { return super.Section.get<string>("default.compileCommands"); }
    public get defaultForcedInclude(): string[] | undefined { return super.Section.get<string[]>("default.forcedInclude"); }
    public get defaultIntelliSenseMode(): string | undefined { return super.Section.get<string>("default.intelliSenseMode"); }
    public get defaultCompilerPath(): string | undefined {
        const result: string | undefined | null = super.Section.get<string | null>("default.compilerPath");
        if (result === null) {
            return undefined;
        }
        return result;
    }
    public get defaultCompilerArgs(): string[] | undefined { return super.Section.get<string[]>("default.compilerArgs"); }
    public get defaultCStandard(): string | undefined { return super.Section.get<string>("default.cStandard"); }
    public get defaultCppStandard(): string | undefined { return super.Section.get<string>("default.cppStandard"); }
    public get defaultConfigurationProvider(): string | undefined { return super.Section.get<string>("default.configurationProvider"); }
    public get defaultBrowsePath(): string[] | undefined { return super.Section.get<string[]>("default.browse.path"); }
    public get defaultDatabaseFilename(): string | undefined { return super.Section.get<string>("default.browse.databaseFilename"); }
    public get defaultLimitSymbolsToIncludedHeaders(): boolean | undefined { return super.Section.get<boolean>("default.browse.limitSymbolsToIncludedHeaders"); }
    public get defaultSystemIncludePath(): string[] | undefined { return super.Section.get<string[]>("default.systemIncludePath"); }
    public get defaultEnableConfigurationSquiggles(): boolean | undefined { return super.Section.get<boolean>("default.enableConfigurationSquiggles"); }
    public get defaultCustomConfigurationVariables(): { [key: string]: string } | undefined { return super.Section.get<{ [key: string]: string }>("default.customConfigurationVariables"); }
    public get useBacktickCommandSubstitution(): boolean | undefined { return super.Section.get<boolean>("debugger.useBacktickCommandSubstitution"); }
    public get codeFolding(): boolean { return super.Section.get<string>("codeFolding") === "Enabled"; }

    public get enhancedColorization(): boolean {
        return super.Section.get<string>("enhancedColorization") === "Enabled"
            && super.Section.get<string>("intelliSenseEngine") === "Default"
            && vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") !== "Default High Contrast";
    }

    public get formattingEngine(): string | undefined {
        return super.Section.get<string>("formatting");
    }

    public get vcFormatIndentBraces(): boolean {
        return super.Section.get<boolean>("vcFormat.indent.braces") === true;
    }

    public get vcFormatIndentMultiLineRelativeTo(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.indent.multiLineRelativeTo")!;
    }

    public get vcFormatIndentWithinParentheses(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.indent.withinParentheses")!;
    }

    public get vcFormatIndentPreserveWithinParentheses(): boolean {
        return super.Section.get<boolean>("vcFormat.indent.preserveWithinParentheses") === true;
    }

    public get vcFormatIndentCaseLabels(): boolean {
        return super.Section.get<boolean>("vcFormat.indent.caseLabels") === true;
    }

    public get vcFormatIndentCaseContents(): boolean {
        return super.Section.get<boolean>("vcFormat.indent.caseContents") === true;
    }

    public get vcFormatIndentCaseContentsWhenBlock(): boolean {
        return super.Section.get<boolean>("vcFormat.indent.caseContentsWhenBlock") === true;
    }

    public get vcFormatIndentLambdaBracesWhenParameter(): boolean {
        return super.Section.get<boolean>("vcFormat.indent.lambdaBracesWhenParameter") === true;
    }

    public get vcFormatIndentGotoLables(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.indent.gotoLabels")!;
    }

    public get vcFormatIndentPreprocessor(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.indent.preprocessor")!;
    }

    public get vcFormatIndentAccessSpecifiers(): boolean {
        return super.Section.get<boolean>("vcFormat.indent.accessSpecifiers") === true;
    }

    public get vcFormatIndentNamespaceContents(): boolean {
        return super.Section.get<boolean>("vcFormat.indent.namespaceContents") === true;
    }

    public get vcFormatIndentPreserveComments(): boolean {
        return super.Section.get<boolean>("vcFormat.indent.preserveComments") === true;
    }

    public get vcFormatNewlineBeforeOpenBraceNamespace(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.newLine.beforeOpenBrace.namespace")!;
    }

    public get vcFormatNewlineBeforeOpenBraceType(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.newLine.beforeOpenBrace.type")!;
    }

    public get vcFormatNewlineBeforeOpenBraceFunction(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.newLine.beforeOpenBrace.function")!;
    }

    public get vcFormatNewlineBeforeOpenBraceBlock(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.newLine.beforeOpenBrace.block")!;
    }

    public get vcFormatNewlineBeforeOpenBraceLambda(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.newLine.beforeOpenBrace.lambda")!;
    }

    public get vcFormatNewlineScopeBracesOnSeparateLines(): boolean {
        return super.Section.get<boolean>("vcFormat.newLine.scopeBracesOnSeparateLines") === true;
    }

    public get vcFormatNewlineCloseBraceSameLineEmptyType(): boolean {
        return super.Section.get<boolean>("vcFormat.newLine.closeBraceSameLine.emptyType") === true;
    }

    public get vcFormatNewlineCloseBraceSameLineEmptyFunction(): boolean {
        return super.Section.get<boolean>("vcFormat.newLine.closeBraceSameLine.emptyFunction") === true;
    }

    public get vcFormatNewlineBeforeCatch(): boolean {
        return super.Section.get<boolean>("vcFormat.newLine.beforeCatch") === true;
    }

    public get vcFormatNewlineBeforeElse(): boolean {
        return super.Section.get<boolean>("vcFormat.newLine.beforeElse") === true;
    }

    public get vcFormatNewlineBeforeWhileInDoWhile(): boolean {
        return super.Section.get<boolean>("vcFormat.newLine.beforeWhileInDoWhile") === true;
    }

    public get vcFormatSpaceBeforeFunctionOpenParenthesis(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.space.beforeFunctionOpenParenthesis")!;
    }

    public get vcFormatSpaceWithinParameterListParentheses(): boolean {
        return super.Section.get<boolean>("vcFormat.space.withinParameterListParentheses") === true;
    }

    public get vcFormatSpaceBetweenEmptyParameterListParentheses(): boolean {
        return super.Section.get<boolean>("vcFormat.space.betweenEmptyParameterListParentheses") === true;
    }

    public get vcFormatSpaceAfterKeywordsInControlFlowStatements(): boolean {
        return super.Section.get<boolean>("vcFormat.space.afterKeywordsInControlFlowStatements") === true;
    }

    public get vcFormatSpaceWithinControlFlowStatementParentheses(): boolean {
        return super.Section.get<boolean>("vcFormat.space.withinControlFlowStatementParentheses") === true;
    }

    public get vcFormatSpaceBeforeLambdaOpenParenthesis(): boolean {
        return super.Section.get<boolean>("vcFormat.space.beforeLambdaOpenParenthesis") === true;
    }

    public get vcFormatSpaceWithinCastParentheses(): boolean {
        return super.Section.get<boolean>("vcFormat.space.withinCastParentheses") === true;
    }

    public get vcFormatSpaceAfterCastCloseParenthesis(): boolean {
        return super.Section.get<boolean>("vcFormat.space.afterCastCloseParenthesis") === true;
    }

    public get vcFormatSpaceWithinExpressionParentheses(): boolean {
        return super.Section.get<boolean>("vcFormat.space.withinExpressionParentheses") === true;
    }

    public get vcFormatSpaceBeforeBlockOpenBrace(): boolean {
        return super.Section.get<boolean>("vcFormat.space.beforeBlockOpenBrace") === true;
    }

    public get vcFormatSpaceBetweenEmptyBraces(): boolean {
        return super.Section.get<boolean>("vcFormat.space.betweenEmptyBraces") === true;
    }

    public get vcFormatSpaceBeforeInitializerListOpenBrace(): boolean {
        return super.Section.get<boolean>("vcFormat.space.beforeInitializerListOpenBrace") === true;
    }

    public get vcFormatSpaceWithinInitializerListBraces(): boolean {
        return super.Section.get<boolean>("vcFormat.space.withinInitializerListBraces") === true;
    }

    public get vcFormatSpacePreserveInInitializerList(): boolean {
        return super.Section.get<boolean>("vcFormat.space.preserveInInitializerList") === true;
    }

    public get vcFormatSpaceBeforeOpenSquareBracket(): boolean {
        return super.Section.get<boolean>("vcFormat.space.beforeOpenSquareBracket") === true;
    }

    public get vcFormatSpaceWithinSquareBrackets(): boolean {
        return super.Section.get<boolean>("vcFormat.space.withinSquareBrackets") === true;
    }

    public get vcFormatSpaceBeforeEmptySquareBrackets(): boolean {
        return super.Section.get<boolean>("vcFormat.space.beforeEmptySquareBrackets") === true;
    }

    public get vcFormatSpaceBetweenEmptySquareBrackets(): boolean {
        return super.Section.get<boolean>("vcFormat.space.betweenEmptySquareBrackets") === true;
    }

    public get vcFormatSpaceGroupSquareBrackets(): boolean {
        return super.Section.get<boolean>("vcFormat.space.groupSquareBrackets") === true;
    }

    public get vcFormatSpaceWithinLambdaBrackets(): boolean {
        return super.Section.get<boolean>("vcFormat.space.withinLambdaBrackets") === true;
    }

    public get vcFormatSpaceBetweenEmptyLambdaBrackets(): boolean {
        return super.Section.get<boolean>("vcFormat.space.betweenEmptyLambdaBrackets") === true;
    }

    public get vcFormatSpaceBeforeComma(): boolean {
        return super.Section.get<boolean>("vcFormat.space.beforeComma") === true;
    }

    public get vcFormatSpaceAfterComma(): boolean {
        return super.Section.get<boolean>("vcFormat.space.afterComma") === true;
    }

    public get vcFormatSpaceRemoveAroundMemberOperators(): boolean {
        return super.Section.get<boolean>("vcFormat.space.removeAroundMemberOperators") === true;
    }

    public get vcFormatSpaceBeforeInheritanceColon(): boolean {
        return super.Section.get<boolean>("vcFormat.space.beforeInheritanceColon") === true;
    }

    public get vcFormatSpaceBeforeConstructorColon(): boolean {
        return super.Section.get<boolean>("vcFormat.space.beforeConstructorColon") === true;
    }

    public get vcFormatSpaceRemoveBeforeSemicolon(): boolean {
        return super.Section.get<boolean>("vcFormat.space.removeBeforeSemicolon") === true;
    }

    public get vcFormatSpaceInsertAfterSemicolon(): boolean {
        return super.Section.get<boolean>("vcFormat.space.insertAfterSemicolon") === true;
    }

    public get vcFormatSpaceRemoveAroundUnaryOperator(): boolean {
        return super.Section.get<boolean>("vcFormat.space.removeAroundUnaryOperator") === true;
    }

    public get vcFormatSpaceAroundBinaryOperator(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.space.aroundBinaryOperator")!;
    }

    public get vcFormatSpaceAroundAssignmentOperator(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.space.aroundAssignmentOperator")!;
    }

    public get vcFormatSpacePointerReferenceAlignment(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.space.pointerReferenceAlignment")!;
    }

    public get vcFormatSpaceAroundTernaryOperator(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.space.aroundTernaryOperator")!;
    }

    public get vcFormatWrapPreserveBlocks(): string {
        // These strings have default values in package.json, so should never be undefined.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return super.Section.get<string>("vcFormat.wrap.preserveBlocks")!;
    }

    public get dimInactiveRegions(): boolean {
        return super.Section.get<boolean>("dimInactiveRegions") === true
            && super.Section.get<string>("intelliSenseEngine") === "Default"
            && vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") !== "Default High Contrast";
    }

    public toggleSetting(name: string, value1: string, value2: string): void {
        const value: string | undefined = super.Section.get<string>(name);
        super.Section.update(name, value === value1 ? value2 : value1, getTarget());
    }

    public update<T>(name: string, value: T): void {
        super.Section.update(name, value);
    }
}

export interface TextMateRuleSettings {
    foreground?: string;
    background?: string;
    fontStyle?: string;
}

export interface TextMateRule {
    scope: any;
    settings: TextMateRuleSettings;
}

export class OtherSettings {
    private resource: vscode.Uri | undefined;

    constructor(resource?: vscode.Uri) {
        if (!resource) {
            resource = undefined;
        }
        this.resource = resource;
    }

    public get editorTabSize(): number | undefined { return vscode.workspace.getConfiguration("editor", this.resource).get<number>("tabSize"); }
    public get editorAutoClosingBrackets(): string | undefined { return vscode.workspace.getConfiguration("editor", this.resource).get<string>("autoClosingBrackets"); }
    public get filesEncoding(): string | undefined { return vscode.workspace.getConfiguration("files", { uri: this.resource, languageId: "cpp" }).get<string>("encoding"); }
    public get filesAssociations(): any { return vscode.workspace.getConfiguration("files").get("associations"); }
    public set filesAssociations(value: any) {
        vscode.workspace.getConfiguration("files").update("associations", value, vscode.ConfigurationTarget.Workspace);
    }
    public get filesExclude(): vscode.WorkspaceConfiguration | undefined { return vscode.workspace.getConfiguration("files", this.resource).get("exclude"); }
    public get searchExclude(): vscode.WorkspaceConfiguration | undefined { return vscode.workspace.getConfiguration("search", this.resource).get("exclude"); }
    public get settingsEditor(): string | undefined { return vscode.workspace.getConfiguration("workbench.settings").get<string>("editor"); }

    public get colorTheme(): string | undefined { return vscode.workspace.getConfiguration("workbench").get<string>("colorTheme"); }

    public getCustomColorToken(colorTokenName: string): string | undefined { return vscode.workspace.getConfiguration("editor.tokenColorCustomizations").get<string>(colorTokenName); }
    public getCustomThemeSpecificColorToken(themeName: string, colorTokenName: string): string | undefined { return vscode.workspace.getConfiguration(`editor.tokenColorCustomizations.[${themeName}]`, this.resource).get<string>(colorTokenName); }

    public get customTextMateRules(): TextMateRule[] | undefined { return vscode.workspace.getConfiguration("editor.tokenColorCustomizations").get<TextMateRule[]>("textMateRules"); }
    public getCustomThemeSpecificTextMateRules(themeName: string): TextMateRule[] | undefined { return vscode.workspace.getConfiguration(`editor.tokenColorCustomizations.[${themeName}]`, this.resource).get<TextMateRule[]>("textMateRules"); }
}

function mapIndentationReferenceToEditorConfig(value: string | undefined): string {
    if (value !== undefined) {
        // Will never actually be undefined, as these settings have default values.
        if (value === "statementBegin") {
            return "statement_begin";
        }
        if (value === "outermostParenthesis") {
            return "outermost_parenthesis";
        }
    }
    return "innermost_parenthesis";
}

function mapIndentToEditorConfig(value: string | undefined): string {
    if (value !== undefined) {
        // Will never actually be undefined, as these settings have default values.
        if (value === "leftmostColumn") {
            return "leftmost_column";
        }
        if (value === "oneLeft") {
            return "one_left";
        }
    }
    return "none";
}

function mapNewOrSameLineToEditorConfig(value: string | undefined): string {
    if (value !== undefined) {
        // Will never actually be undefined, as these settings have default values.
        if (value === "newLine") {
            return "new_line";
        }
        if (value === "sameLine") {
            return "same_line";
        }
    }
    return "ignore";
}

function mapWrapToEditorConfig(value: string | undefined): string {
    if (value !== undefined) {
        // Will never actually be undefined, as these settings have default values.
        if (value === "allOneLineScopes") {
            return "all_one_line_scopes";
        }
        if (value === "oneLiners") {
            return "one_liners";
        }
    }
    return "never";
}

function populateEditorConfig(rootUri: vscode.Uri | undefined, document: vscode.TextDocument): void {
    // Set up a map of setting names and values. Parse through the document line-by-line, looking for
    // existing occurrences to replace. Replaced occurrences are removed from the map. If any remain when
    // done, they are added as a new section at the end of the file. The file is opened with unsaved
    // edits, so the user may edit or undo if we made a mistake.
    const settings: CppSettings = new CppSettings(rootUri);
    const settingMap: Map<string, string> = new Map<string, string>();
    settingMap.set("cpp_indent_braces", settings.vcFormatIndentBraces.toString());
    settingMap.set("cpp_indent_multi_line_relative_to", mapIndentationReferenceToEditorConfig(settings.vcFormatIndentMultiLineRelativeTo));
    settingMap.set("cpp_indent_within_parentheses", settings.vcFormatIndentWithinParentheses.toString());
    settingMap.set("cpp_indent_preserve_within_parentheses", settings.vcFormatIndentPreserveWithinParentheses.toString());
    settingMap.set("cpp_indent_case_labels", settings.vcFormatIndentCaseLabels.toString());
    settingMap.set("cpp_indent_case_contents", settings.vcFormatIndentCaseContents.toString());
    settingMap.set("cpp_indent_case_contents_when_block", settings.vcFormatIndentCaseContentsWhenBlock.toString());
    settingMap.set("cpp_indent_lambda_braces_when_parameter", settings.vcFormatIndentLambdaBracesWhenParameter.toString());
    settingMap.set("cpp_indent_goto_labels", mapIndentToEditorConfig(settings.vcFormatIndentGotoLables));
    settingMap.set("cpp_indent_preprocessor", mapIndentToEditorConfig(settings.vcFormatIndentPreprocessor));
    settingMap.set("cpp_indent_access_specifiers", settings.vcFormatIndentAccessSpecifiers.toString());
    settingMap.set("cpp_indent_namespace_contents", settings.vcFormatIndentNamespaceContents.toString());
    settingMap.set("cpp_indent_preserve_comments", settings.vcFormatIndentPreserveComments.toString());
    settingMap.set("cpp_new_line_before_open_brace_namespace", mapNewOrSameLineToEditorConfig(settings.vcFormatNewlineBeforeOpenBraceNamespace));
    settingMap.set("cpp_new_line_before_open_brace_type", mapNewOrSameLineToEditorConfig(settings.vcFormatNewlineBeforeOpenBraceType));
    settingMap.set("cpp_new_line_before_open_brace_function", mapNewOrSameLineToEditorConfig(settings.vcFormatNewlineBeforeOpenBraceFunction));
    settingMap.set("cpp_new_line_before_open_brace_block", mapNewOrSameLineToEditorConfig(settings.vcFormatNewlineBeforeOpenBraceBlock));
    settingMap.set("cpp_new_line_before_open_brace_lambda", mapNewOrSameLineToEditorConfig(settings.vcFormatNewlineBeforeOpenBraceLambda));
    settingMap.set("cpp_new_line_scope_braces_on_separate_lines", settings.vcFormatNewlineScopeBracesOnSeparateLines.toString());
    settingMap.set("cpp_new_line_close_brace_same_line_empty_type", settings.vcFormatNewlineCloseBraceSameLineEmptyType.toString());
    settingMap.set("cpp_new_line_close_brace_same_line_empty_function", settings.vcFormatNewlineCloseBraceSameLineEmptyFunction.toString());
    settingMap.set("cpp_new_line_before_catch", settings.vcFormatNewlineBeforeCatch.toString().toString());
    settingMap.set("cpp_new_line_before_else", settings.vcFormatNewlineBeforeElse.toString().toString());
    settingMap.set("cpp_new_line_before_while_in_do_while", settings.vcFormatNewlineBeforeWhileInDoWhile.toString());
    settingMap.set("cpp_space_before_function_open_parenthesis", settings.vcFormatSpaceBeforeFunctionOpenParenthesis.toString());
    settingMap.set("cpp_space_within_parameter_list_parentheses", settings.vcFormatSpaceWithinParameterListParentheses.toString());
    settingMap.set("cpp_space_between_empty_parameter_list_parentheses", settings.vcFormatSpaceBetweenEmptyParameterListParentheses.toString());
    settingMap.set("cpp_space_after_keywords_in_control_flow_statements", settings.vcFormatSpaceAfterKeywordsInControlFlowStatements.toString());
    settingMap.set("cpp_space_within_control_flow_statement_parentheses", settings.vcFormatSpaceWithinControlFlowStatementParentheses.toString());
    settingMap.set("cpp_space_before_lambda_open_parenthesis", settings.vcFormatSpaceBeforeLambdaOpenParenthesis.toString());
    settingMap.set("cpp_space_within_cast_parentheses", settings.vcFormatSpaceWithinCastParentheses.toString());
    settingMap.set("cpp_space_after_cast_close_parenthesis", settings.vcFormatSpaceAfterCastCloseParenthesis.toString());
    settingMap.set("cpp_space_within_expression_parentheses", settings.vcFormatSpaceWithinExpressionParentheses.toString());
    settingMap.set("cpp_space_before_block_open_brace", settings.vcFormatSpaceBeforeBlockOpenBrace.toString());
    settingMap.set("cpp_space_between_empty_braces", settings.vcFormatSpaceBetweenEmptyBraces.toString());
    settingMap.set("cpp_space_before_initializer_list_open_brace", settings.vcFormatSpaceBeforeInitializerListOpenBrace.toString());
    settingMap.set("cpp_space_within_initializer_list_braces", settings.vcFormatSpaceWithinInitializerListBraces.toString());
    settingMap.set("cpp_space_preserve_in_initializer_list", settings.vcFormatSpacePreserveInInitializerList.toString());
    settingMap.set("cpp_space_before_open_square_bracket", settings.vcFormatSpaceBeforeOpenSquareBracket.toString());
    settingMap.set("cpp_space_within_square_brackets", settings.vcFormatSpaceWithinSquareBrackets.toString());
    settingMap.set("cpp_space_before_empty_square_brackets", settings.vcFormatSpaceBeforeEmptySquareBrackets.toString());
    settingMap.set("cpp_space_between_empty_square_brackets", settings.vcFormatSpaceBetweenEmptySquareBrackets.toString());
    settingMap.set("cpp_space_group_square_brackets", settings.vcFormatSpaceGroupSquareBrackets.toString());
    settingMap.set("cpp_space_within_lambda_brackets", settings.vcFormatSpaceWithinLambdaBrackets.toString());
    settingMap.set("cpp_space_between_empty_lambda_brackets", settings.vcFormatSpaceBetweenEmptyLambdaBrackets.toString());
    settingMap.set("cpp_space_before_comma", settings.vcFormatSpaceBeforeComma.toString());
    settingMap.set("cpp_space_after_comma", settings.vcFormatSpaceAfterComma.toString());
    settingMap.set("cpp_space_remove_around_member_operators", settings.vcFormatSpaceRemoveAroundMemberOperators.toString());
    settingMap.set("cpp_space_before_inheritance_colon", settings.vcFormatSpaceBeforeInheritanceColon.toString());
    settingMap.set("cpp_space_before_constructor_colon", settings.vcFormatSpaceBeforeConstructorColon.toString());
    settingMap.set("cpp_space_remove_before_semicolon", settings.vcFormatSpaceRemoveBeforeSemicolon.toString());
    settingMap.set("cpp_space_after_semicolon", settings.vcFormatSpaceInsertAfterSemicolon.toString());
    settingMap.set("cpp_space_remove_around_unary_operator", settings.vcFormatSpaceRemoveAroundUnaryOperator.toString());
    settingMap.set("cpp_space_around_binary_operator", settings.vcFormatSpaceAroundBinaryOperator.toString());
    settingMap.set("cpp_space_around_assignment_operator", settings.vcFormatSpaceAroundAssignmentOperator.toString());
    settingMap.set("cpp_space_pointer_reference_alignment", settings.vcFormatSpacePointerReferenceAlignment.toString());
    settingMap.set("cpp_space_around_ternary_operator", settings.vcFormatSpaceAroundTernaryOperator.toString());
    settingMap.set("cpp_wrap_preserve_blocks", mapWrapToEditorConfig(settings.vcFormatWrapPreserveBlocks));

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
    vscode.workspace.applyEdit(edits).then(() => vscode.window.showTextDocument(document));
}

export async function generateEditorConfig(rootUri?: vscode.Uri): Promise<void> {
    let document: vscode.TextDocument;
    if (rootUri) {
        // If a folder is open and '.editorconfig' exists at the root, use that.
        const uri: vscode.Uri = vscode.Uri.joinPath(rootUri, ".editorconfig");
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
    populateEditorConfig(rootUri, document);
}
