/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CommentPattern } from './languageConfig';
import { getExtensionFilePath } from '../common';
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
        this.settings = vscode.workspace.getConfiguration(section, resource ? resource : null);
    }

    protected get Section(): vscode.WorkspaceConfiguration { return this.settings; }

    protected getWithFallback<T>(section: string, deprecatedSection: string): T {
        let info: any = this.settings.inspect<T>(section);
        if (info.workspaceFolderValue !== undefined) {
            return info.workspaceFolderValue;
        } else if (info.workspaceValue !== undefined) {
            return info.workspaceValue;
        } else if (info.globalValue !== undefined) {
            return info.globalValue;
        }
        let value: T = this.settings.get<T>(deprecatedSection);
        if (value !== undefined) {
            return value;
        }
        return info.defaultValue;
    }
}

export class CppSettings extends Settings {
    constructor(resource?: vscode.Uri) {
        super("C_Cpp", resource);
    }

    private get clangFormatName(): string {
        switch (os.platform()) {
            case "win32":
                return "clang-format.exe";
            case "linux":
                return "clang-format.darwin";
            case "darwin":
                return "clang-format";
        }
    }

    public get clangFormatPath(): string {
        let clangFormatPath: string = super.Section.get<string>("clang_format_path");
        if (!clangFormatPath) {
            clangFormatPath = which.sync('clang-format', {nothrow: true});
            if (clangFormatPath) {
                // Attempt to invoke both our own version of clang-format to see if we can successfully execute it, and to get it's version.
                let clangFormatVersion: string;
                try {
                    let path: string = getExtensionFilePath("./LLVM/bin/" + this.clangFormatName);
                    let output: string[] = execSync(path + " --version").toString().split(" ");

                    // Compares against our version of clang-format.
                    // This hard-coded version will need to be updated whenever we update our clang-format
                    if (output.length < 3 || output[0] != "clang-format" || output[1] != "version" || !semver.valid(output[2])) {
                        return clangFormatPath;
                    }
                    clangFormatVersion = output[2];
                } catch (e) {
                    // Unable to invoke our own clang-format.  Use the system installed clang-format.
                    return clangFormatPath;
                }

                // Invoke the version on the system to compare versions.  Use ours if it's more recent.
                try {
                    let output: string[] = execSync("\"" + clangFormatPath + "\" --version").toString().split(" ");
                    if (output.length < 3 || output[0] != "clang-format" || output[1] != "version" || semver.ltr(output[2], clangFormatVersion)) {
                        clangFormatPath = "";
                    }
                } catch (e) {
                    clangFormatPath = "";
                }
            }
        }
        return clangFormatPath;
    }

    public get clangFormatStyle(): string { return super.Section.get<string>("clang_format_style"); }
    public get clangFormatFallbackStyle(): string { return super.Section.get<string>("clang_format_fallbackStyle"); }
    public get clangFormatSortIncludes(): string { return super.Section.get<string>("clang_format_sortIncludes"); }
    public get formatting(): string { return super.Section.get<string>("formatting"); }
    public get experimentalFeatures(): string { return super.Section.get<string>("experimentalFeatures"); }
    public get suggestSnippets(): boolean { return super.Section.get<boolean>("suggestSnippets"); }
    public get intelliSenseEngine(): string { return super.Section.get<string>("intelliSenseEngine"); }
    public get intelliSenseEngineFallback(): string { return super.Section.get<string>("intelliSenseEngineFallback"); }
    public get intelliSenseCachePath(): string { return super.Section.get<string>("intelliSenseCachePath"); }
    public get intelliSenseCacheSize(): number { return super.Section.get<number>("intelliSenseCacheSize"); }
    public get errorSquiggles(): string { return super.Section.get<string>("errorSquiggles"); }
    public get inactiveRegionOpacity(): number { return super.Section.get<number>("inactiveRegionOpacity"); }
    public get inactiveRegionForegroundColor(): string { return super.Section.get<string>("inactiveRegionForegroundColor"); }
    public get inactiveRegionBackgroundColor(): string { return super.Section.get<string>("inactiveRegionBackgroundColor"); }
    public get autoComplete(): string { return super.Section.get<string>("autocomplete"); }
    public get loggingLevel(): string { return super.Section.get<string>("loggingLevel"); }
    public get autoAddFileAssociations(): boolean { return super.Section.get<boolean>("autoAddFileAssociations"); }
    public get workspaceParsingPriority(): string { return super.Section.get<string>("workspaceParsingPriority"); }
    public get workspaceSymbols(): string { return super.Section.get<string>("workspaceSymbols"); }
    public get exclusionPolicy(): string { return super.Section.get<string>("exclusionPolicy"); }
    public get commentContinuationPatterns(): (string | CommentPattern)[] { return super.Section.get<(string | CommentPattern)[]>("commentContinuationPatterns"); }
    public get configurationWarnings(): string { return super.Section.get<string>("configurationWarnings"); }
    public get preferredPathSeparator(): string { return super.Section.get<string>("preferredPathSeparator"); }
    public get updateChannel(): string { return super.Section.get<string>("updateChannel"); }
    public get vcpkgEnabled(): boolean { return super.Section.get<boolean>("vcpkg.enabled"); }
    public get renameRequiresIdentifier(): boolean { return super.Section.get<boolean>("renameRequiresIdentifier"); }
    public get defaultIncludePath(): string[] { return super.Section.get<string[]>("default.includePath"); }
    public get defaultDefines(): string[] { return super.Section.get<string[]>("default.defines"); }
    public get defaultMacFrameworkPath(): string[] { return super.Section.get<string[]>("default.macFrameworkPath"); }
    public get defaultWindowsSdkVersion(): string { return super.Section.get<string>("default.windowsSdkVersion"); }
    public get defaultCompileCommands(): string { return super.Section.get<string>("default.compileCommands"); }
    public get defaultForcedInclude(): string[] { return super.Section.get<string[]>("default.forcedInclude"); }
    public get defaultIntelliSenseMode(): string { return super.Section.get<string>("default.intelliSenseMode"); }
    public get defaultCompilerPath(): string { return super.Section.get<string>("default.compilerPath"); }
    public get defaultCompilerArgs(): string[] { return super.Section.get<string[]>("default.compilerArgs"); }
    public get defaultCStandard(): string { return super.Section.get<string>("default.cStandard"); }
    public get defaultCppStandard(): string { return super.Section.get<string>("default.cppStandard"); }
    public get defaultConfigurationProvider(): string { return super.Section.get<string>("default.configurationProvider"); }
    public get defaultBrowsePath(): string[] { return super.Section.get<string[]>("default.browse.path"); }
    public get defaultDatabaseFilename(): string { return super.Section.get<string>("default.browse.databaseFilename"); }
    public get defaultLimitSymbolsToIncludedHeaders(): boolean { return super.Section.get<boolean>("default.browse.limitSymbolsToIncludedHeaders"); }
    public get defaultSystemIncludePath(): string[] { return super.Section.get<string[]>("default.systemIncludePath"); }
    public get defaultEnableConfigurationSquiggles(): boolean { return super.Section.get<boolean>("default.enableConfigurationSquiggles"); }

    public get enhancedColorization(): boolean {
        return super.Section.get<string>("enhancedColorization") === "Enabled"
            && super.Section.get<string>("intelliSenseEngine") === "Default"
            && vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") !== "Default High Contrast";
    }

    public get dimInactiveRegions(): boolean {
        return super.Section.get<boolean>("dimInactiveRegions")
        && super.Section.get<string>("intelliSenseEngine") === "Default"
            && vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") !== "Default High Contrast";
    }

    public toggleSetting(name: string, value1: string, value2: string): void {
        let value: string = super.Section.get<string>(name);
        super.Section.update(name, value === value1 ? value2 : value1, getTarget());
    }

    public update<T>(name: string, value: T): void {
        super.Section.update(name, value);
    }
}

export interface TextMateRuleSettings {
    foreground: string | undefined;
    background: string | undefined;
    fontStyle: string | undefined;
}

export interface TextMateRule {
    scope: any;
    settings: TextMateRuleSettings;
}

export class OtherSettings {
    private resource: vscode.Uri;

    constructor(resource?: vscode.Uri) {
        if (!resource) {
            resource = null;
        }
        this.resource = resource;
    }

    public get editorTabSize(): number { return vscode.workspace.getConfiguration("editor", this.resource).get<number>("tabSize"); }
    public get filesAssociations(): any { return vscode.workspace.getConfiguration("files", null).get("associations"); }
    public set filesAssociations(value: any) {
        vscode.workspace.getConfiguration("files", null).update("associations", value, vscode.ConfigurationTarget.Workspace);
    }
    public get filesExclude(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration("files", this.resource).get("exclude"); }
    public get searchExclude(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration("search", this.resource).get("exclude"); }
    public get settingsEditor(): string { return vscode.workspace.getConfiguration("workbench.settings").get<string>("editor"); }

    public get colorTheme(): string { return vscode.workspace.getConfiguration("workbench").get<string>("colorTheme"); }

    public getCustomColorToken(colorTokenName: string): string { return vscode.workspace.getConfiguration("editor.tokenColorCustomizations").get<string>(colorTokenName); }
    public getCustomThemeSpecificColorToken(themeName: string, colorTokenName: string): string { return vscode.workspace.getConfiguration(`editor.tokenColorCustomizations.[${themeName}]`, this.resource).get<string>(colorTokenName); }

    public get customTextMateRules(): TextMateRule[] { return vscode.workspace.getConfiguration("editor.tokenColorCustomizations").get<TextMateRule[]>("textMateRules"); }
    public getCustomThemeSpecificTextMateRules(themeName: string): TextMateRule[] { return vscode.workspace.getConfiguration(`editor.tokenColorCustomizations.[${themeName}]`, this.resource).get<TextMateRule[]>("textMateRules"); }
}
