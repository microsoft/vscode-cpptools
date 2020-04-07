/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as fs from "fs";
import * as vscode from 'vscode';
import * as util from '../common';
import * as telemetry from '../telemetry';
import { PersistentFolderState } from './persistentState';
import { CppSettings, OtherSettings } from './settings';
import { ABTestSettings, getABTestSettings } from '../abTesting';
import { getCustomConfigProviders } from './customProviders';
import { SettingsPanel } from './settingsPanel';
import * as os from 'os';
import escapeStringRegExp = require('escape-string-regexp');
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const configVersion: number = 4;

type Environment = { [key: string]: string | string[] };

// No properties are set in the config since we want to apply vscode settings first (if applicable).
// That code won't trigger if another value is already set.
// The property defaults are moved down to applyDefaultIncludePathsAndFrameworks.
function getDefaultConfig(): Configuration {
    if (process.platform === 'darwin') {
        return { name: "Mac" };
    } else if (process.platform === 'win32') {
        return { name: "Win32" };
    } else {
        return { name: "Linux" };
    }
}

function getDefaultCppProperties(): ConfigurationJson {
    return {
        configurations: [getDefaultConfig()],
        version: configVersion
    };
}

export interface ConfigurationJson {
    configurations: Configuration[];
    env?: {[key: string]: string | string[]};
    version: number;
    enableConfigurationSquiggles?: boolean;
}

export interface Configuration {
    name: string;
    compilerPath?: string;
    compilerArgs?: string[];
    cStandard?: string;
    cppStandard?: string;
    includePath?: string[];
    macFrameworkPath?: string[];
    windowsSdkVersion?: string;
    defines?: string[];
    intelliSenseMode?: string;
    compileCommands?: string;
    forcedInclude?: string[];
    configurationProvider?: string;
    browse?: Browse;
}

export interface ConfigurationErrors {
    compilerPath?: string;
    includePath?: string;
    intelliSenseMode?: string;
    macFrameworkPath?: string;
    forcedInclude?: string;
    compileCommands?: string;
    browsePath?: string;
    databaseFilename?: string;
}

export interface Browse {
    path?: string[];
    limitSymbolsToIncludedHeaders?: boolean | string;
    databaseFilename?: string;
}

export interface KnownCompiler {
    path: string;
    isC: boolean;
}

export interface CompilerDefaults {
    compilerPath: string;
    compilerArgs: string[];
    knownCompilers: KnownCompiler[];
    cStandard: string;
    cppStandard: string;
    includes: string[];
    frameworks: string[];
    windowsSdkVersion: string;
    intelliSenseMode: string;
    rootfs: string;
}

export class CppProperties {
    private rootUri: vscode.Uri | undefined;
    private propertiesFile: vscode.Uri | undefined | null = undefined; // undefined and null values are handled differently
    private readonly configFolder: string;
    private configurationJson?: ConfigurationJson;
    private currentConfigurationIndex: PersistentFolderState<number> | undefined;
    private configFileWatcher: vscode.FileSystemWatcher | null = null;
    private configFileWatcherFallbackTime: Date = new Date(); // Used when file watching fails.
    private compileCommandFileWatchers: fs.FSWatcher[] = [];
    private defaultCompilerPath: string | null = null;
    private knownCompilers?: KnownCompiler[];
    private defaultCStandard: string | null = null;
    private defaultCppStandard: string | null = null;
    private defaultIncludes: string[] | null = null;
    private defaultFrameworks?: string[];
    private defaultWindowsSdkVersion: string | null = null;
    private vcpkgIncludes: string[] = [];
    private vcpkgPathReady: boolean = false;
    private defaultIntelliSenseMode?: string;
    private readonly configurationGlobPattern: string = "c_cpp_properties.json";
    private disposables: vscode.Disposable[] = [];
    private configurationsChanged = new vscode.EventEmitter<Configuration[]>();
    private selectionChanged = new vscode.EventEmitter<number>();
    private compileCommandsChanged = new vscode.EventEmitter<string>();
    private diagnosticCollection: vscode.DiagnosticCollection;
    private prevSquiggleMetrics: Map<string, { [key: string]: number }> = new Map<string, { [key: string]: number }>();
    private rootfs: string | null = null;
    private settingsPanel?: SettingsPanel;

    // Any time the default settings are parsed and assigned to `this.configurationJson`,
    // we want to track when the default includes have been added to it.
    private configurationIncomplete: boolean = true;

    constructor(rootUri?: vscode.Uri, workspaceFolder?: vscode.WorkspaceFolder) {
        this.rootUri = rootUri;
        let rootPath: string = rootUri ? rootUri.fsPath : "";
        if (workspaceFolder) {
            this.currentConfigurationIndex = new PersistentFolderState<number>("CppProperties.currentConfigurationIndex", -1, workspaceFolder);
        }
        this.configFolder = path.join(rootPath, ".vscode");
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(rootPath);
        this.buildVcpkgIncludePath();
        this.disposables.push(vscode.Disposable.from(this.configurationsChanged, this.selectionChanged, this.compileCommandsChanged));
    }

    public get ConfigurationsChanged(): vscode.Event<Configuration[]> { return this.configurationsChanged.event; }
    public get SelectionChanged(): vscode.Event<number> { return this.selectionChanged.event; }
    public get CompileCommandsChanged(): vscode.Event<string> { return this.compileCommandsChanged.event; }
    public get Configurations(): Configuration[] | undefined { return this.configurationJson ? this.configurationJson.configurations : undefined; }
    public get CurrentConfigurationIndex(): number { return this.currentConfigurationIndex === undefined ? 0 : this.currentConfigurationIndex.Value; }
    public get CurrentConfiguration(): Configuration | undefined { return this.Configurations ? this.Configurations[this.CurrentConfigurationIndex] : undefined; }
    public get KnownCompiler(): KnownCompiler[] | undefined { return this.knownCompilers; }

    public get CurrentConfigurationProvider(): string | undefined {
        if (this.CurrentConfiguration?.configurationProvider) {
            return this.CurrentConfiguration.configurationProvider;
        }
        return new CppSettings(this.rootUri).defaultConfigurationProvider;
    }

    public get ConfigurationNames(): string[] | undefined {
        let result: string[] = [];
        if (this.configurationJson) {
            this.configurationJson.configurations.forEach((config: Configuration) => {
                result.push(config.name);
            });
        }
        return result;
    }

    public set CompilerDefaults(compilerDefaults: CompilerDefaults) {
        this.defaultCompilerPath = compilerDefaults.compilerPath;
        this.knownCompilers = compilerDefaults.knownCompilers;
        this.defaultCStandard = compilerDefaults.cStandard;
        this.defaultCppStandard = compilerDefaults.cppStandard;
        this.defaultIncludes = compilerDefaults.includes;
        this.defaultFrameworks = compilerDefaults.frameworks;
        this.defaultWindowsSdkVersion = compilerDefaults.windowsSdkVersion;
        this.defaultIntelliSenseMode = compilerDefaults.intelliSenseMode;
        this.rootfs = compilerDefaults.rootfs;

        // defaultPaths is only used when there isn't a c_cpp_properties.json, but we don't send the configuration changed event
        // to the language server until the default include paths and frameworks have been sent.
        let configFilePath: string = path.join(this.configFolder, "c_cpp_properties.json");
        if (this.rootUri !== null && fs.existsSync(configFilePath)) {
            this.propertiesFile = vscode.Uri.file(configFilePath);
        } else {
            this.propertiesFile = null;
        }

        let settingsPath: string = path.join(this.configFolder, this.configurationGlobPattern);
        this.configFileWatcher = vscode.workspace.createFileSystemWatcher(settingsPath);
        this.disposables.push(this.configFileWatcher);
        this.configFileWatcher.onDidCreate((uri) => {
            this.propertiesFile = uri;
            this.handleConfigurationChange();
        });

        this.configFileWatcher.onDidDelete(() => {
            this.propertiesFile = null;
            this.resetToDefaultSettings(true);
            this.handleConfigurationChange();
        });

        this.configFileWatcher.onDidChange(() => {
            // If the file is one of the textDocument's vscode is tracking, we need to wait for an
            // onDidChangeTextDocument event, or we may get old/cached contents when we open it.
            let alreadyTracking: boolean = false;
            for (let i: number = 0; i < vscode.workspace.textDocuments.length; i++) {
                if (vscode.workspace.textDocuments[i].uri.fsPath === settingsPath) {
                    alreadyTracking = true;
                    break;
                }
            }
            if (!alreadyTracking) {
                this.handleConfigurationChange();
            }
        });

        vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
            if (e.document.uri.fsPath === settingsPath) {
                this.handleConfigurationChange();
            }
        });

        this.handleConfigurationChange();
    }

    public get VcpkgInstalled(): boolean {
        return this.vcpkgIncludes.length > 0;
    }

    private onConfigurationsChanged(): void {
        this.configurationsChanged.fire(this.Configurations);
    }

    private onSelectionChanged(): void {
        this.selectionChanged.fire(this.CurrentConfigurationIndex);
        this.handleSquiggles();
    }

    private onCompileCommandsChanged(path: string): void {
        this.compileCommandsChanged.fire(path);
    }

    public onDidChangeSettings(): void {
        // Default settings may have changed in a way that affects the configuration.
        // Just send another message since the language server will sort out whether anything important changed or not.
        if (!this.propertiesFile) {
            this.resetToDefaultSettings(true);
            this.handleConfigurationChange();
        } else if (!this.configurationIncomplete) {
            this.handleConfigurationChange();
        }
    }

    private resetToDefaultSettings(resetIndex: boolean): void {
        this.configurationJson = getDefaultCppProperties();
        if (resetIndex || this.CurrentConfigurationIndex < 0 ||
            this.CurrentConfigurationIndex >= this.configurationJson.configurations.length) {
            let index: number | undefined = this.getConfigIndexForPlatform(this.configurationJson);
            if (this.currentConfigurationIndex !== undefined) {
                if (index === undefined) {
                    this.currentConfigurationIndex.setDefault();
                } else {
                    this.currentConfigurationIndex.Value = index;
                }
            }
        }
        this.configurationIncomplete = true;
    }

    private applyDefaultIncludePathsAndFrameworks(): void {
        if (this.configurationIncomplete && this.defaultIncludes && this.defaultFrameworks && this.vcpkgPathReady) {
            let configuration: Configuration | undefined = this.CurrentConfiguration;
            if (configuration) {
                this.applyDefaultConfigurationValues(configuration);
                this.configurationIncomplete = false;
            }
        }
    }

    private applyDefaultConfigurationValues(configuration: Configuration): void {
        let settings: CppSettings = new CppSettings(this.rootUri);
        // default values for "default" config settings is null.
        let isUnset: (input: any) => boolean = (input: any) => input === null || input === undefined;

        // Anything that has a vscode setting for it will be resolved in updateServerOnFolderSettingsChange.
        // So if a property is currently unset, but has a vscode setting, don't set it yet, otherwise the linkage
        // to the setting will be lost if this configuration is saved into a c_cpp_properties.json file.

        // Only add settings from the default compiler if user hasn't explicitly set the corresponding VS Code setting.

        if (isUnset(settings.defaultIncludePath)) {
            // We don't add system includes to the includePath anymore. The language server has this information.
            let abTestSettings: ABTestSettings = getABTestSettings();
            let rootFolder: string = abTestSettings.UseRecursiveIncludes ? "${workspaceFolder}/**" : "${workspaceFolder}";
            configuration.includePath = [rootFolder].concat(this.vcpkgIncludes);
        }
        // browse.path is not set by default anymore. When it is not set, the includePath will be used instead.
        if (isUnset(settings.defaultDefines)) {
            configuration.defines = (process.platform === 'win32') ? ["_DEBUG", "UNICODE", "_UNICODE"] : [];
        }
        if (isUnset(settings.defaultMacFrameworkPath) && process.platform === 'darwin') {
            configuration.macFrameworkPath = this.defaultFrameworks;
        }
        if ((isUnset(settings.defaultWindowsSdkVersion) || settings.defaultWindowsSdkVersion === "") && this.defaultWindowsSdkVersion && process.platform === 'win32') {
            configuration.windowsSdkVersion = this.defaultWindowsSdkVersion;
        }
        if (isUnset(settings.defaultCompilerPath) && this.defaultCompilerPath &&
            (isUnset(settings.defaultCompileCommands) || settings.defaultCompileCommands === "") && !configuration.compileCommands) {
            // compile_commands.json already specifies a compiler. compilerPath overrides the compile_commands.json compiler so
            // don't set a default when compileCommands is in use.
            configuration.compilerPath = this.defaultCompilerPath;
        }
        if ((isUnset(settings.defaultCStandard) || settings.defaultCStandard === "") && this.defaultCStandard) {
            configuration.cStandard = this.defaultCStandard;
        }
        if ((isUnset(settings.defaultCppStandard) || settings.defaultCppStandard === "") && this.defaultCppStandard) {
            configuration.cppStandard = this.defaultCppStandard;
        }
        if (isUnset(settings.defaultIntelliSenseMode) || settings.defaultIntelliSenseMode === "") {
            configuration.intelliSenseMode = this.defaultIntelliSenseMode;
        }
    }

    private get ExtendedEnvironment(): Environment {
        let result: Environment = {};
        if (this.configurationJson?.env) {
            Object.assign(result, this.configurationJson.env);
        }

        result["workspaceFolderBasename"] = this.rootUri ? path.basename(this.rootUri.fsPath) : "";
        return result;
    }

    private async buildVcpkgIncludePath(): Promise<void> {
        try {
            // Check for vcpkgRoot and include relevent paths if found.
            let vcpkgRoot: string = util.getVcpkgRoot();
            if (vcpkgRoot) {
                let list: string[] = await util.readDir(vcpkgRoot);
                if (list !== undefined) {
                    // For every *directory* in the list (non-recursive). Each directory is basically a platform.
                    list.forEach((entry) => {
                        if (entry !== "vcpkg") {
                            let pathToCheck: string = path.join(vcpkgRoot, entry);
                            if (fs.existsSync(pathToCheck)) {
                                let p: string = path.join(pathToCheck, "include");
                                if (fs.existsSync(p)) {
                                    p = p.replace(/\\/g, "/");
                                    p = p.replace(vcpkgRoot, "${vcpkgRoot}");
                                    this.vcpkgIncludes.push(p);
                                }
                            }
                        }
                    });
                }
            }
        } catch (error) {} finally {
            this.vcpkgPathReady = true;
            this.handleConfigurationChange();
        }
    }

    private getConfigIndexForPlatform(config: any): number | undefined {
        if (!this.configurationJson) {
            return undefined;
        }
        let plat: string;
        if (process.platform === 'darwin') {
            plat = "Mac";
        } else if (process.platform === 'win32') {
            plat = "Win32";
        } else {
            plat = "Linux";
        }
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            if (config.configurations[i].name === plat) {
                return i;
            }
        }
        return this.configurationJson.configurations.length - 1;
    }

    private getIntelliSenseModeForPlatform(name?: string): string {
        // Do the built-in configs first.
        if (name === "Linux") {
            return "gcc-x64";
        } else if (name === "Mac") {
            return "clang-x64";
        } else if (name === "Win32") {
            return "msvc-x64";
        } else if (process.platform === 'win32') {
            // Custom configs default to the OS's preference.
            return "msvc-x64";
        } else if (process.platform === 'darwin') {
            return "clang-x64";
        } else {
            return "gcc-x64";
        }
    }

    private isCompilerIntelliSenseModeCompatible(configuration: Configuration): boolean {
        // Ignore if compiler path is not set or intelliSenseMode is not set.
        if (configuration.compilerPath === undefined ||
            configuration.compilerPath === "" ||
            configuration.compilerPath === "${default}" ||
            configuration.intelliSenseMode === undefined ||
            configuration.intelliSenseMode === "" ||
            configuration.intelliSenseMode === "${default}") {
            return true;
        }
        let resolvedCompilerPath: string = this.resolvePath(configuration.compilerPath, true);
        let compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(resolvedCompilerPath);
        let isMsvc: boolean = configuration.intelliSenseMode.startsWith("msvc");
        let isCl: boolean = compilerPathAndArgs.compilerName === "cl.exe";

        // For now, we can only validate msvc mode and cl.exe combinations.
        // Verify cl.exe arch matches intelliSenseMode arch or compilerPath is only cl.exe.
        if (isMsvc && isCl) {
            let msvcArch: string = configuration.intelliSenseMode.split('-')[1];
            let compilerPathDir: string = path.dirname(resolvedCompilerPath);
            return compilerPathDir.endsWith(msvcArch) || compilerPathAndArgs.compilerPath === "cl.exe";
        }
        // All other combinations are valid if intelliSenseMode is not msvc and compiler is not cl.exe.
        return !isMsvc && !isCl;
    }

    public addToIncludePathCommand(path: string): void {
        this.handleConfigurationEditCommand(() => {
            this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
            let config: Configuration | undefined = this.CurrentConfiguration;
            if (config) {
                telemetry.logLanguageServerEvent("addToIncludePath");
                if (config.includePath === undefined) {
                    config.includePath = ["${default}"];
                }
                config.includePath.splice(config.includePath.length, 0, path);
                this.writeToJson();
                this.handleConfigurationChange();
            }
        }, () => {});
    }

    public updateCustomConfigurationProvider(providerId: string): Thenable<void> {
        return new Promise<void>((resolve) => {
            if (this.propertiesFile) {
                this.handleConfigurationEditJSONCommand(() => {
                    this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
                    let config: Configuration | undefined = this.CurrentConfiguration;
                    if (config) {
                        if (providerId) {
                            config.configurationProvider = providerId;
                        } else {
                            delete config.configurationProvider;
                        }
                        this.writeToJson();
                        this.handleConfigurationChange();
                    }
                    resolve();
                }, () => {});
            } else {
                let settings: CppSettings = new CppSettings(this.rootUri);
                if (providerId) {
                    settings.update("default.configurationProvider", providerId);
                } else {
                    settings.update("default.configurationProvider", undefined); // delete the setting
                }
                let config: Configuration | undefined = this.CurrentConfiguration;
                if (config) {
                    config.configurationProvider = providerId;
                }
                resolve();
            }
        });
    }

    public setCompileCommands(path: string): void {
        this.handleConfigurationEditJSONCommand(() => {
            this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
            let config: Configuration | undefined = this.CurrentConfiguration;
            if (config) {
                config.compileCommands = path;
                this.writeToJson();
                this.handleConfigurationChange();
            }
        }, () => {});
    }

    public select(index: number): Configuration | undefined {
        if (this.configurationJson) {
            if (index === this.configurationJson.configurations.length) {
                this.handleConfigurationEditUICommand(() => {}, vscode.window.showTextDocument);
                return;
            }
            if (index === this.configurationJson.configurations.length + 1) {
                this.handleConfigurationEditJSONCommand(() => {}, vscode.window.showTextDocument);
                return;
            }
        }

        if (this.currentConfigurationIndex !== undefined) {
            this.currentConfigurationIndex.Value = index;
        }
        this.onSelectionChanged();
    }

    private resolveDefaults(entries: string[], defaultValue?: string[]): string[] {
        let result: string[] = [];
        entries.forEach(entry => {
            if (entry === "${default}") {
                // package.json default values for string[] properties is null.
                // If no default is set, return an empty array instead of an array with `null` in it.
                if (defaultValue) {
                    result = result.concat(defaultValue);
                }
            } else {
                result.push(entry);
            }
        });
        return result;
    }

    private resolveAndSplit(paths: string[] | undefined, defaultValue: string[] | undefined, env: Environment): string[] {
        let result: string[] = [];
        if (paths) {
            paths = this.resolveDefaults(paths, defaultValue);
            let delimiter: string = (process.platform === 'win32') ? ";" : ":";
            paths.forEach(entry => {
                let entries: string[] = util.resolveVariables(entry, env).split(delimiter).filter(e => e);
                result = result.concat(entries);
            });
        }
        return result;
    }

    private updateConfigurationString(property: string | undefined | null, defaultValue: string | undefined | null, env: Environment, acceptBlank?: boolean): string | undefined {
        if (!property || property === "${default}") {
            property = defaultValue;
        }
        if (!property || (acceptBlank !== true && property === "")) {
            return undefined;
        }
        return util.resolveVariables(property, env);
    }

    private updateConfigurationStringArray(property: string[] | undefined, defaultValue: string[] | undefined, env: Environment): string[] | undefined {
        if (property) {
            return this.resolveAndSplit(property, defaultValue, env);
        }
        if (!property && defaultValue) {
            return this.resolveAndSplit(defaultValue, [], env);
        }
        return property;
    }

    private updateConfigurationStringOrBoolean(property: string | boolean | undefined | null, defaultValue: boolean | undefined | null, env: Environment): string | boolean | undefined {
        if (!property || property === "${default}") {
            property = defaultValue;
        }
        if (!property || property === "") {
            return undefined;
        }
        if (typeof property === "boolean") {
            return property;
        }
        return util.resolveVariables(property, env);
    }

    private updateServerOnFolderSettingsChange(): void {
        if (!this.configurationJson) {
            return;
        }
        let settings: CppSettings = new CppSettings(this.rootUri);
        let env: Environment = this.ExtendedEnvironment;
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            let configuration: Configuration = this.configurationJson.configurations[i];

            configuration.includePath = this.updateConfigurationStringArray(configuration.includePath, settings.defaultIncludePath, env);
            configuration.defines = this.updateConfigurationStringArray(configuration.defines, settings.defaultDefines, env);
            configuration.macFrameworkPath = this.updateConfigurationStringArray(configuration.macFrameworkPath, settings.defaultMacFrameworkPath, env);
            configuration.windowsSdkVersion = this.updateConfigurationString(configuration.windowsSdkVersion, settings.defaultWindowsSdkVersion, env);
            configuration.forcedInclude = this.updateConfigurationStringArray(configuration.forcedInclude, settings.defaultForcedInclude, env);
            configuration.compileCommands = this.updateConfigurationString(configuration.compileCommands, settings.defaultCompileCommands, env);
            configuration.compilerPath = this.updateConfigurationString(configuration.compilerPath, settings.defaultCompilerPath, env, true);
            configuration.compilerArgs = this.updateConfigurationStringArray(configuration.compilerArgs, settings.defaultCompilerArgs, env);
            configuration.cStandard = this.updateConfigurationString(configuration.cStandard, settings.defaultCStandard, env);
            configuration.cppStandard = this.updateConfigurationString(configuration.cppStandard, settings.defaultCppStandard, env);
            configuration.intelliSenseMode = this.updateConfigurationString(configuration.intelliSenseMode, settings.defaultIntelliSenseMode, env);
            configuration.configurationProvider = this.updateConfigurationString(configuration.configurationProvider, settings.defaultConfigurationProvider, env);

            if (!configuration.browse) {
                configuration.browse = {};
            }

            if (!configuration.browse.path) {
                if (settings.defaultBrowsePath) {
                    configuration.browse.path = settings.defaultBrowsePath;
                } else if (configuration.includePath) {
                    // If the user doesn't set browse.path, copy the includePath over. Make sure ${workspaceFolder} is in there though...
                    configuration.browse.path = configuration.includePath.slice(0);
                    if (configuration.includePath.findIndex((value: string, index: number) =>
                        !!value.match(/^\$\{(workspaceRoot|workspaceFolder)\}(\\\*{0,2}|\/\*{0,2})?$/g)) === -1
                    ) {
                        configuration.browse.path.push("${workspaceFolder}");
                    }
                }
            } else {
                configuration.browse.path = this.updateConfigurationStringArray(configuration.browse.path, settings.defaultBrowsePath, env);
            }

            configuration.browse.limitSymbolsToIncludedHeaders = this.updateConfigurationStringOrBoolean(configuration.browse.limitSymbolsToIncludedHeaders, settings.defaultLimitSymbolsToIncludedHeaders, env);
            configuration.browse.databaseFilename = this.updateConfigurationString(configuration.browse.databaseFilename, settings.defaultDatabaseFilename, env);
        }

        this.updateCompileCommandsFileWatchers();
        if (!this.configurationIncomplete) {
            this.onConfigurationsChanged();
        }
    }

    private compileCommandsFileWatcherTimer?: NodeJS.Timer;
    private compileCommandsFileWatcherFiles: Set<string> = new Set<string>();

    // Dispose existing and loop through cpp and populate with each file (exists or not) as you go.
    // paths are expected to have variables resolved already
    public updateCompileCommandsFileWatchers(): void {
        if (this.configurationJson) {
            this.compileCommandFileWatchers.forEach((watcher: fs.FSWatcher) => watcher.close());
            this.compileCommandFileWatchers = []; // reset it
            let filePaths: Set<string> = new Set<string>();
            this.configurationJson.configurations.forEach(c => {
                if (c.compileCommands) {
                    let fileSystemCompileCommandsPath: string = this.resolvePath(c.compileCommands, os.platform() === "win32");
                    if (fs.existsSync(fileSystemCompileCommandsPath)) {
                        filePaths.add(fileSystemCompileCommandsPath);
                    }
                }
            });
            try {
                filePaths.forEach((path: string) => {
                    this.compileCommandFileWatchers.push(fs.watch(path, (event: string, filename: string) => {
                        if (event === "rename") {
                            return;
                        }
                        // Wait 1 second after a change to allow time for the write to finish.
                        if (this.compileCommandsFileWatcherTimer) {
                            clearInterval(this.compileCommandsFileWatcherTimer);
                        }
                        this.compileCommandsFileWatcherFiles.add(path);
                        this.compileCommandsFileWatcherTimer = setTimeout(() => {
                            this.compileCommandsFileWatcherFiles.forEach((path: string) => {
                                this.onCompileCommandsChanged(path);
                            });
                            if (this.compileCommandsFileWatcherTimer) {
                                clearInterval(this.compileCommandsFileWatcherTimer);
                            }
                            this.compileCommandsFileWatcherFiles.clear();
                            this.compileCommandsFileWatcherTimer = undefined;
                        }, 1000);
                    }));
                });
            } catch (e) {
                // The file watcher limit is hit.
                // TODO: Check if the compile commands file has a higher timestamp during the interval timer.
            }
        }
    }

    // onBeforeOpen will be called after c_cpp_properties.json have been created (if it did not exist), but before the document is opened.
    public handleConfigurationEditCommand(onBeforeOpen: (() => void) | undefined, showDocument: (document: vscode.TextDocument) => void): void {
        let otherSettings: OtherSettings = new OtherSettings(this.rootUri);
        if (otherSettings.settingsEditor === "ui") {
            this.handleConfigurationEditUICommand(onBeforeOpen, showDocument);
        } else {
            this.handleConfigurationEditJSONCommand(onBeforeOpen, showDocument);
        }
    }

    // onBeforeOpen will be called after c_cpp_properties.json have been created (if it did not exist), but before the document is opened.
    public handleConfigurationEditJSONCommand(onBeforeOpen: (() => void) | undefined, showDocument: (document: vscode.TextDocument) => void): void {
        this.ensurePropertiesFile().then(() => {
            console.assert(this.propertiesFile);
            if (onBeforeOpen) {
                onBeforeOpen();
            }
            // Directly open the json file
            if (this.propertiesFile) {
                vscode.workspace.openTextDocument(this.propertiesFile).then((document: vscode.TextDocument) => {
                    if (showDocument) {
                        showDocument(document);
                    }
                });
            }
        });
    }

    private ensureSettingsPanelInitlialized(): void {
        if (this.settingsPanel === undefined) {
            let settings: CppSettings = new CppSettings(this.rootUri);
            this.settingsPanel = new SettingsPanel();
            this.settingsPanel.setKnownCompilers(this.knownCompilers, settings.preferredPathSeparator);
            this.settingsPanel.SettingsPanelActivated(() => this.onSettingsPanelActivated());
            this.settingsPanel.ConfigValuesChanged(() => this.saveConfigurationUI());
            this.settingsPanel.ConfigSelectionChanged(() => this.onConfigSelectionChanged());
            this.settingsPanel.AddConfigRequested((e) => this.onAddConfigRequested(e));
            this.disposables.push(this.settingsPanel);
        }
    }

    // onBeforeOpen will be called after c_cpp_properties.json have been created (if it did not exist), but before the document is opened.
    public handleConfigurationEditUICommand(onBeforeOpen: (() => void) | undefined, showDocument: (document: vscode.TextDocument) => void): void {
        this.ensurePropertiesFile().then(() => {
            if (this.propertiesFile) {
                if (onBeforeOpen) {
                    onBeforeOpen();
                }
                if (this.parsePropertiesFile()) {
                    this.ensureSettingsPanelInitlialized();
                    if (this.settingsPanel) {
                        let configNames: string[] | undefined = this.ConfigurationNames;
                        if (configNames && this.configurationJson) {
                            // Use the active configuration as the default selected configuration to load on UI editor
                            this.settingsPanel.selectedConfigIndex = this.CurrentConfigurationIndex;
                            this.settingsPanel.createOrShow(configNames,
                                this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex],
                                this.getErrorsForConfigUI(this.settingsPanel.selectedConfigIndex));
                        }
                    }
                } else {
                    // Parse failed, open json file
                    vscode.workspace.openTextDocument(this.propertiesFile).then((document: vscode.TextDocument) => {
                        if (showDocument) {
                            showDocument(document);
                        }
                    });
                }
            }
        });
    }

    private onSettingsPanelActivated(): void {
        if (this.configurationJson) {
            this.ensurePropertiesFile().then(() => {
                if (this.propertiesFile) {
                    if (this.parsePropertiesFile()) {
                        let configNames: string[] | undefined = this.ConfigurationNames;
                        if (configNames && this.settingsPanel && this.configurationJson) {
                            // The settings UI became visible or active.
                            // Ensure settingsPanel has copy of latest current configuration
                            if (this.settingsPanel.selectedConfigIndex >= this.configurationJson.configurations.length) {
                                this.settingsPanel.selectedConfigIndex = this.CurrentConfigurationIndex;
                            }
                            this.settingsPanel.updateConfigUI(configNames,
                                this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex],
                                this.getErrorsForConfigUI(this.settingsPanel.selectedConfigIndex));
                        } else {
                            // Parse failed, open json file
                            vscode.workspace.openTextDocument(this.propertiesFile);
                        }
                    }
                }
            });
        }
    }

    private saveConfigurationUI(): void {
        this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
        if (this.settingsPanel && this.configurationJson) {
            let config: Configuration = this.settingsPanel.getLastValuesFromConfigUI();
            this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex] = config;
            this.settingsPanel.updateErrors(this.getErrorsForConfigUI(this.settingsPanel.selectedConfigIndex));
            this.writeToJson();
        }
    }

    private onConfigSelectionChanged(): void {
        let configNames: string[] | undefined = this.ConfigurationNames;
        if (configNames && this.settingsPanel && this.configurationJson) {
            this.settingsPanel.updateConfigUI(configNames,
                this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex],
                this.getErrorsForConfigUI(this.settingsPanel.selectedConfigIndex));
        }
    }

    private onAddConfigRequested(configName: string): void {
        this.parsePropertiesFile(); // Clear out any modifications we may have made internally.

        // Create default config and add to list of configurations
        let newConfig: Configuration = { name: configName };
        this.applyDefaultConfigurationValues(newConfig);
        let configNames: string[] | undefined = this.ConfigurationNames;
        if (configNames && this.settingsPanel && this.configurationJson) {
            this.configurationJson.configurations.push(newConfig);

            // Update UI
            this.settingsPanel.selectedConfigIndex = this.configurationJson.configurations.length - 1;
            this.settingsPanel.updateConfigUI(configNames,
                this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex],
                null);

            // Save new config to file
            this.writeToJson();
        }
    }

    private handleConfigurationChange(): void {
        if (this.propertiesFile === undefined) {
            return; // Occurs when propertiesFile hasn't been checked yet.
        }
        this.configFileWatcherFallbackTime = new Date();
        if (this.propertiesFile) {
            this.parsePropertiesFile();
            // parsePropertiesFile can fail, but it won't overwrite an existing configurationJson in the event of failure.
            // this.configurationJson should only be undefined here if we have never successfully parsed the propertiesFile.
            if (this.configurationJson) {
                if (this.CurrentConfigurationIndex < 0 ||
                    this.CurrentConfigurationIndex >= this.configurationJson.configurations.length) {
                    // If the index is out of bounds (during initialization or due to removal of configs), fix it.
                    let index: number | undefined = this.getConfigIndexForPlatform(this.configurationJson);
                    if (this.currentConfigurationIndex !== undefined) {
                        if (!index) {
                            this.currentConfigurationIndex.setDefault();
                        } else {
                            this.currentConfigurationIndex.Value = index;
                        }
                    }
                }
            }
        }

        if (!this.configurationJson) {
            this.resetToDefaultSettings(true);  // I don't think there's a case where this will be hit anymore.
        }

        this.applyDefaultIncludePathsAndFrameworks();
        this.updateServerOnFolderSettingsChange();
    }

    private async ensurePropertiesFile(): Promise<void> {
        if (this.propertiesFile && fs.existsSync(this.propertiesFile.fsPath)) {
            return;
        } else {
            try {
                if  (!fs.existsSync(this.configFolder)) {
                    fs.mkdirSync(this.configFolder);
                }

                let fullPathToFile: string = path.join(this.configFolder, "c_cpp_properties.json");
                if (this.configurationJson) {
                    this.resetToDefaultSettings(true);
                }
                this.applyDefaultIncludePathsAndFrameworks();
                let settings: CppSettings = new CppSettings(this.rootUri);
                if (settings.defaultConfigurationProvider) {
                    if (this.configurationJson) {
                        this.configurationJson.configurations.forEach(config => {
                            config.configurationProvider = settings.defaultConfigurationProvider ? settings.defaultConfigurationProvider : undefined;
                        });
                    }
                    settings.update("default.configurationProvider", undefined); // delete the setting
                }

                await util.writeFileText(fullPathToFile, JSON.stringify(this.configurationJson, null, 4));

                this.propertiesFile = vscode.Uri.file(path.join(this.configFolder, "c_cpp_properties.json"));

            } catch (err) {
                let failedToCreate: string = localize("failed.to.create.config.folder", 'Failed to create "{0}"', this.configFolder);
                vscode.window.showErrorMessage(`${failedToCreate}: ${err.message}`);
            }
        }
        return;
    }

    private parsePropertiesFile(): boolean {
        if (!this.propertiesFile) {
            return false;
        }
        let success: boolean = true;
        try {
            let readResults: string = fs.readFileSync(this.propertiesFile.fsPath, 'utf8');
            if (readResults === "") {
                return false; // Repros randomly when the file is initially created. The parse will get called again after the file is written.
            }

            // Try to use the same configuration as before the change.
            let newJson: ConfigurationJson = JSON.parse(readResults);
            if (!newJson || !newJson.configurations || newJson.configurations.length === 0) {
                throw { message: localize("invalid.configuration.file", "Invalid configuration file. There must be at least one configuration present in the array.") };
            }
            if (!this.configurationIncomplete && this.configurationJson && this.configurationJson.configurations &&
                this.CurrentConfigurationIndex >= 0 && this.CurrentConfigurationIndex < this.configurationJson.configurations.length) {
                for (let i: number = 0; i < newJson.configurations.length; i++) {
                    if (newJson.configurations[i].name === this.configurationJson.configurations[this.CurrentConfigurationIndex].name) {
                        if (this.currentConfigurationIndex !== undefined) {
                            this.currentConfigurationIndex.Value = i;
                        }
                        break;
                    }
                }
            }
            this.configurationJson = newJson;
            if (this.CurrentConfigurationIndex < 0 || this.CurrentConfigurationIndex >= newJson.configurations.length) {
                let index: number | undefined = this.getConfigIndexForPlatform(newJson);
                if (this.currentConfigurationIndex !== undefined) {
                    if (index === undefined) {
                        this.currentConfigurationIndex.setDefault();
                    } else {
                        this.currentConfigurationIndex.Value = index;
                    }
                }
            }

            let dirty: boolean = false;
            for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
                let newId: string | undefined = getCustomConfigProviders().checkId(this.configurationJson.configurations[i].configurationProvider);
                if (newId !== this.configurationJson.configurations[i].configurationProvider) {
                    dirty = true;
                    this.configurationJson.configurations[i].configurationProvider = newId;
                }
            }

            // Remove disallowed variable overrides
            if (this.configurationJson.env) {
                delete this.configurationJson.env['workspaceRoot'];
                delete this.configurationJson.env['workspaceFolder'];
                delete this.configurationJson.env['workspaceFolderBasename'];
                delete this.configurationJson.env['default'];
            }

            // Warning: There is a chance that this is incorrect in the event that the c_cpp_properties.json file was created before
            // the system includes were available.
            this.configurationIncomplete = false;

            if (this.configurationJson.version !== configVersion) {
                dirty = true;
                if (this.configurationJson.version === undefined) {
                    this.updateToVersion2();
                }

                if (this.configurationJson.version === 2) {
                    this.updateToVersion3();
                }

                if (this.configurationJson.version === 3) {
                    this.updateToVersion4();
                } else {
                    this.configurationJson.version = configVersion;
                    vscode.window.showErrorMessage(localize("unknown.properties.version", 'Unknown version number found in c_cpp_properties.json. Some features may not work as expected.'));
                }
            }

            this.configurationJson.configurations.forEach(e => {
                if ((<any>e).knownCompilers) {
                    delete (<any>e).knownCompilers;
                    dirty = true;
                }
            });

            if (dirty) {
                try {
                    this.writeToJson();
                } catch (err) {
                    // Ignore write errors, the file may be under source control. Updated settings will only be modified in memory.
                    vscode.window.showWarningMessage(localize('update.properties.failed', 'Attempt to update "{0}" failed (do you have write access?)', this.propertiesFile.fsPath));
                    success = false;
                }
            }

        } catch (err) {
            let failedToParse: string = localize("failed.to.parse.properties", 'Failed to parse "{0}"', this.propertiesFile.fsPath);
            vscode.window.showErrorMessage(`${failedToParse}: ${err.message}`);
            success = false;
        }

        if (success) {
            this.handleSquiggles();
        }

        return success;
    }

    private resolvePath(path: string | undefined, isWindows: boolean): string {
        if (!path || path === "${default}") {
            return "";
        }

        let result: string = "";

        // first resolve variables
        result = util.resolveVariables(path, this.ExtendedEnvironment);
        if (this.rootUri) {
            if (result.includes("${workspaceFolder}")) {
                result = result.replace("${workspaceFolder}", this.rootUri.fsPath);
            }
            if (result.includes("${workspaceRoot}")) {
                result = result.replace("${workspaceRoot}", this.rootUri.fsPath);
            }
        }
        if (result.includes("${vcpkgRoot}") && util.getVcpkgRoot()) {
            result = result.replace("${vcpkgRoot}", util.getVcpkgRoot());
        }
        if (result.includes("*")) {
            result = result.replace(/\*/g, "");
        }

        // resolve WSL paths
        if (isWindows && result.startsWith("/")) {
            const mntStr: string = "/mnt/";
            if (result.length > "/mnt/c/".length && result.substr(0, mntStr.length) === mntStr) {
                result = result.substr(mntStr.length);
                result = result.substr(0, 1) + ":" + result.substr(1);
            } else if (this.rootfs && this.rootfs.length > 0) {
                result = this.rootfs + result.substr(1);
                // TODO: Handle WSL symlinks.
            }
        }

        return result;
    }

    private getErrorsForConfigUI(configIndex: number): ConfigurationErrors {
        let errors: ConfigurationErrors = {};
        if (!this.configurationJson) {
            return errors;
        }
        const isWindows: boolean = os.platform() === 'win32';
        let config: Configuration = this.configurationJson.configurations[configIndex];

        // Validate compilerPath
        let resolvedCompilerPath: string | undefined = this.resolvePath(config.compilerPath, isWindows);
        let compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(resolvedCompilerPath);
        if (resolvedCompilerPath &&
            // Don't error cl.exe paths because it could be for an older preview build.
            !(isWindows && compilerPathAndArgs.compilerName === "cl.exe")) {
            resolvedCompilerPath = resolvedCompilerPath.trim();

            // Error when the compiler's path has spaces without quotes but args are used.
            // Except, exclude cl.exe paths because it could be for an older preview build.
            let compilerPathNeedsQuotes: boolean =
                (compilerPathAndArgs.additionalArgs && compilerPathAndArgs.additionalArgs.length > 0) &&
                !resolvedCompilerPath.startsWith('"') &&
                compilerPathAndArgs.compilerPath !== undefined &&
                compilerPathAndArgs.compilerPath.includes(" ");

            let compilerPathErrors: string[] = [];
            if (compilerPathNeedsQuotes) {
                compilerPathErrors.push(localize("path.with.spaces", 'Compiler path with spaces and arguments is missing double quotes " around the path.'));
            }

            // Get compiler path without arguments before checking if it exists
            resolvedCompilerPath = compilerPathAndArgs.compilerPath;
            if (resolvedCompilerPath) {
                let pathExists: boolean = true;
                let existsWithExeAdded: (path: string) => boolean = (path: string) => isWindows && !path.startsWith("/") && fs.existsSync(path + ".exe");
                if (!fs.existsSync(resolvedCompilerPath)) {
                    if (existsWithExeAdded(resolvedCompilerPath)) {
                        resolvedCompilerPath += ".exe";
                    } else if (!this.rootUri) {
                        pathExists = false;
                    } else {
                        // Check again for a relative path.
                        const relativePath: string = this.rootUri.fsPath + path.sep + resolvedCompilerPath;
                        if (!fs.existsSync(relativePath)) {
                            if (existsWithExeAdded(resolvedCompilerPath)) {
                                resolvedCompilerPath += ".exe";
                            } else {
                                pathExists = false;
                            }
                        } else {
                            resolvedCompilerPath = relativePath;
                        }
                    }
                }

                if (!pathExists) {
                    let message: string = localize('cannot.find', "Cannot find: {0}", resolvedCompilerPath);
                    compilerPathErrors.push(message);
                } else if (compilerPathAndArgs.compilerPath === "") {
                    let message: string = localize("cannot.resolve.compiler.path", "Invalid input, cannot resolve compiler path");
                    compilerPathErrors.push(message);
                } else if (!util.checkFileExistsSync(resolvedCompilerPath)) {
                    let message: string = localize("path.is.not.a.file", "Path is not a file: {0}", resolvedCompilerPath);
                    compilerPathErrors.push(message);
                }

                if (compilerPathErrors.length > 0) {
                    errors.compilerPath = compilerPathErrors.join('\n');
                }
            }
        }

        // Validate paths (directories)
        errors.includePath = this.validatePath(config.includePath);
        errors.macFrameworkPath = this.validatePath(config.macFrameworkPath);
        errors.browsePath = this.validatePath(config.browse ? config.browse.path : undefined);

        // Validate files
        errors.forcedInclude = this.validatePath(config.forcedInclude, false);
        errors.compileCommands = this.validatePath(config.compileCommands, false);
        errors.databaseFilename = this.validatePath((config.browse ? config.browse.databaseFilename : undefined), false);

        // Validate intelliSenseMode
        if (isWindows && !this.isCompilerIntelliSenseModeCompatible(config)) {
            errors.intelliSenseMode = localize("incompatible.intellisense.mode", "IntelliSense mode {0} is incompatible with compiler path.", config.intelliSenseMode);
        }

        return errors;
    }

    private validatePath(input: string | string[] | undefined, isDirectory: boolean = true): string | undefined {
        if (!input) {
            return undefined;
        }

        const isWindows: boolean = os.platform() === 'win32';
        let errorMsg: string | undefined;
        let errors: string[] = [];
        let paths: string[] = [];

        if (util.isString(input)) {
            paths.push(input);
        } else {
            paths = input;
        }

        // Resolve and split any environment variables
        paths = this.resolveAndSplit(paths, undefined, this.ExtendedEnvironment);

        for (let p of paths) {
            let pathExists: boolean = true;
            let resolvedPath: string = this.resolvePath(p, isWindows);
            if (!resolvedPath) {
                continue;
            }

            // Check if resolved path exists
            if (!fs.existsSync(resolvedPath)) {
                if (!this.rootUri) {
                    pathExists = false;
                } else {
                    // Check for relative path if resolved path does not exists
                    const relativePath: string = this.rootUri.fsPath + path.sep + resolvedPath;
                    if (!fs.existsSync(relativePath)) {
                        pathExists = false;
                    } else {
                        resolvedPath = relativePath;
                    }
                }
            }

            if (!pathExists) {
                let message: string = localize('cannot.find', "Cannot find: {0}", resolvedPath);
                errors.push(message);
                continue;
            }

            // Check if path is a directory or file
            if (isDirectory && !util.checkDirectoryExistsSync(resolvedPath)) {
                let message: string = localize("path.is.not.a.directory", "Path is not a directory: {0}", resolvedPath);
                errors.push(message);
            } else if (!isDirectory && !util.checkFileExistsSync(resolvedPath)) {
                let message: string = localize("path.is.not.a.file", "Path is not a file: {0}", resolvedPath);
                errors.push(message);
            }
        }

        if (errors.length > 0) {
            errorMsg = errors.join('\n');
        }

        return errorMsg;
    }

    private handleSquiggles(): void {
        if (!this.propertiesFile) {
            return;
        }

        // Disable squiggles if
        // this.configurationJson.enableConfigurationSquiggles is false OR
        // this.configurationJson.enableConfigurationSquiggles is undefined and settings.defaultEnableConfigurationSquiggles is false.
        const settings: CppSettings = new CppSettings(this.rootUri);
        if (!this.configurationJson) {
            return;
        }
        if ((this.configurationJson.enableConfigurationSquiggles !== undefined && !this.configurationJson.enableConfigurationSquiggles) ||
            (this.configurationJson.enableConfigurationSquiggles === undefined && !settings.defaultEnableConfigurationSquiggles)) {
            this.diagnosticCollection.clear();
            return;
        }
        vscode.workspace.openTextDocument(this.propertiesFile).then((document: vscode.TextDocument) => {
            let diagnostics: vscode.Diagnostic[] = new Array<vscode.Diagnostic>();

            // Get the text of the current configuration.
            let curText: string = document.getText();

            // Replace all \<escape character> with \\<character>, except for \"
            // Otherwise, the JSON.parse result will have the \<escape character> missing.
            let configurationsText: string = util.escapeForSquiggles(curText);
            let configurations: ConfigurationJson = JSON.parse(configurationsText);
            let currentConfiguration: Configuration = configurations.configurations[this.CurrentConfigurationIndex];

            let curTextStartOffset: number = 0;
            if (!currentConfiguration.name) {
                return;
            }

            // Get env text
            let envText: string;
            const envStart: number = curText.search(/\"env\"\s*:\s*\{/);
            const envEnd: number = envStart === -1 ? -1 : curText.indexOf("},", envStart);
            envText = curText.substr(envStart, envEnd);
            const envTextStartOffSet: number = envStart + 1;

            // Get current config text
            const configStart: number = curText.search(new RegExp(`{\\s*"name"\\s*:\\s*"${escapeStringRegExp(currentConfiguration.name)}"`));
            if (configStart === -1) {
                telemetry.logLanguageServerEvent("ConfigSquiggles", { "error": "config name not first" });
                return;
            }
            curTextStartOffset = configStart + 1;
            curText = curText.substr(curTextStartOffset); // Remove earlier configs.
            const nameEnd: number = curText.indexOf(":");
            curTextStartOffset += nameEnd + 1;
            curText = curText.substr(nameEnd + 1);
            const nextNameStart: number = curText.search(new RegExp('"name"\\s*:\\s*"'));
            if (nextNameStart !== -1) {
                curText = curText.substr(0, nextNameStart + 6); // Remove later configs.
                const nextNameStart2: number = curText.search(new RegExp('\\s*}\\s*,\\s*{\\s*"name"'));
                if (nextNameStart2 === -1) {
                    telemetry.logLanguageServerEvent("ConfigSquiggles", { "error": "next config name not first" });
                    return;
                }
                curText = curText.substr(0, nextNameStart2);
            }
            if (this.prevSquiggleMetrics.get(currentConfiguration.name) === undefined) {
                this.prevSquiggleMetrics.set(currentConfiguration.name, { PathNonExistent: 0, PathNotAFile: 0, PathNotADirectory: 0, CompilerPathMissingQuotes: 0, CompilerModeMismatch: 0 });
            }
            let newSquiggleMetrics: { [key: string]: number } = { PathNonExistent: 0, PathNotAFile: 0, PathNotADirectory: 0, CompilerPathMissingQuotes: 0, CompilerModeMismatch: 0 };
            const isWindows: boolean = os.platform() === 'win32';

            // TODO: Add other squiggles.

            // Check if intelliSenseMode and compilerPath are compatible
            if (isWindows) {
                // cl.exe is only available on Windows
                const intelliSenseModeStart: number = curText.search(/\s*\"intelliSenseMode\"\s*:\s*\"/);
                if (intelliSenseModeStart !== -1) {
                    const intelliSenseModeValueStart: number = curText.indexOf('"', curText.indexOf(":", intelliSenseModeStart));
                    const intelliSenseModeValueEnd: number = intelliSenseModeStart === -1 ? -1 : curText.indexOf('"', intelliSenseModeValueStart + 1) + 1;

                    if (!this.isCompilerIntelliSenseModeCompatible(currentConfiguration)) {
                        let message: string = localize("incompatible.intellisense.mode", "IntelliSense mode {0} is incompatible with compiler path.", currentConfiguration.intelliSenseMode);
                        let diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                            new vscode.Range(document.positionAt(curTextStartOffset + intelliSenseModeValueStart),
                                document.positionAt(curTextStartOffset + intelliSenseModeValueEnd)),
                            message, vscode.DiagnosticSeverity.Warning);
                        diagnostics.push(diagnostic);
                        newSquiggleMetrics.CompilerModeMismatch++;
                    }
                }
            }

            // Check for path-related squiggles.
            let paths: string[] = [];
            for (let pathArray of [ (currentConfiguration.browse ? currentConfiguration.browse.path : undefined),
                currentConfiguration.includePath, currentConfiguration.macFrameworkPath, currentConfiguration.forcedInclude ]) {
                if (pathArray) {
                    for (let curPath of pathArray) {
                        paths.push(`${curPath}`);
                    }
                }
            }
            if (currentConfiguration.compileCommands) {
                paths.push(`${currentConfiguration.compileCommands}`);
            }

            if (currentConfiguration.compilerPath) {
                // Unlike other cases, compilerPath may not start or end with " due to trimming of whitespace and the possibility of compiler args.
                paths.push(`${currentConfiguration.compilerPath}`);
            }

            // Resolve and split any environment variables
            paths = this.resolveAndSplit(paths, undefined, this.ExtendedEnvironment);

            // Get the start/end for properties that are file-only.
            const forcedIncludeStart: number = curText.search(/\s*\"forcedInclude\"\s*:\s*\[/);
            const forcedeIncludeEnd: number = forcedIncludeStart === -1 ? -1 : curText.indexOf("]", forcedIncludeStart);
            const compileCommandsStart: number = curText.search(/\s*\"compileCommands\"\s*:\s*\"/);
            const compileCommandsEnd: number = compileCommandsStart === -1 ? -1 : curText.indexOf('"', curText.indexOf('"', curText.indexOf(":", compileCommandsStart)) + 1);
            const compilerPathStart: number = curText.search(/\s*\"compilerPath\"\s*:\s*\"/);
            const compilerPathEnd: number = compilerPathStart === -1 ? -1 : curText.indexOf('"', curText.indexOf('"', curText.indexOf(":", compilerPathStart)) + 1) + 1;

            // Validate paths
            for (let curPath of paths) {
                const isCompilerPath: boolean = curPath === currentConfiguration.compilerPath;
                // Resolve special path cases.
                if (curPath === "${default}") {
                    // TODO: Add squiggles for when the C_Cpp.default.* paths are invalid.
                    continue;
                }

                let resolvedPath: string = this.resolvePath(curPath, isWindows);
                if (!resolvedPath) {
                    continue;
                }

                let compilerPathNeedsQuotes: boolean = false;
                if (isCompilerPath) {
                    resolvedPath = resolvedPath.trim();
                    let compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(resolvedPath);
                    if (isWindows && compilerPathAndArgs.compilerName === "cl.exe") {
                        continue; // Don't squiggle invalid cl.exe paths because it could be for an older preview build.
                    }
                    if (compilerPathAndArgs.compilerPath === undefined) {
                        continue;
                    }
                    // Squiggle when the compiler's path has spaces without quotes but args are used.
                    compilerPathNeedsQuotes = (compilerPathAndArgs.additionalArgs && compilerPathAndArgs.additionalArgs.length > 0)
                        && !resolvedPath.startsWith('"')
                        && compilerPathAndArgs.compilerPath.includes(" ");
                    resolvedPath = compilerPathAndArgs.compilerPath;
                }

                const isWSL: boolean = isWindows && resolvedPath.startsWith("/");
                let pathExists: boolean = true;
                let existsWithExeAdded: (path: string) => boolean = (path: string) => isCompilerPath && isWindows && !isWSL && fs.existsSync(path + ".exe");
                if (!fs.existsSync(resolvedPath)) {
                    if (existsWithExeAdded(resolvedPath)) {
                        resolvedPath += ".exe";
                    } else if (!this.rootUri) {
                        pathExists = false;
                    } else {
                        // Check again for a relative path.
                        const relativePath: string = this.rootUri.fsPath + path.sep + resolvedPath;
                        if (!fs.existsSync(relativePath)) {
                            if (existsWithExeAdded(resolvedPath)) {
                                resolvedPath += ".exe";
                            } else {
                                pathExists = false;
                            }
                        } else {
                            resolvedPath = relativePath;
                        }
                    }
                }

                // Normalize path separators.
                if (path.sep === "/") {
                    resolvedPath = resolvedPath.replace(/\\/g, path.sep);
                } else {
                    resolvedPath = resolvedPath.replace(/\//g, path.sep);
                }

                // Iterate through the text and apply squiggles.

                // Escape the path string for literal use in a regular expression
                // Need to escape any quotes to match the original text
                let escapedPath: string = curPath.replace(/\"/g, '\\\"');
                escapedPath = escapedPath.replace(/[-\"\/\\^$*+?.()|[\]{}]/g, '\\$&');

                // Create a pattern to search for the path with either a quote or semicolon immediately before and after,
                // and extend that pattern to the next quote before and next quote after it.
                let pattern: RegExp = new RegExp(`"[^"]*?(?<="|;)${escapedPath}(?="|;).*?"`, "g");
                let configMatches: string[] | null = curText.match(pattern);
                if (configMatches) {
                    let curOffset: number = 0;
                    let endOffset: number = 0;
                    for (let curMatch of configMatches) {
                        curOffset = curText.substr(endOffset).search(pattern) + endOffset;
                        endOffset = curOffset + curMatch.length;
                        let message: string;
                        if (!pathExists) {
                            message = localize('cannot.find2', "Cannot find \"{0}\".", resolvedPath);
                            newSquiggleMetrics.PathNonExistent++;
                        } else {
                            // Check for file versus path mismatches.
                            if ((curOffset >= forcedIncludeStart && curOffset <= forcedeIncludeEnd) ||
                                (curOffset >= compileCommandsStart && curOffset <= compileCommandsEnd) ||
                                (curOffset >= compilerPathStart && curOffset <= compilerPathEnd)) {
                                if (compilerPathNeedsQuotes) {
                                    message = localize("path.with.spaces", 'Compiler path with spaces and arguments is missing double quotes " around the path.');
                                    newSquiggleMetrics.CompilerPathMissingQuotes++;
                                } else {
                                    if (util.checkFileExistsSync(resolvedPath)) {
                                        continue;
                                    }
                                    message = localize("path.is.not.a.file", "Path is not a file: {0}", resolvedPath);
                                    newSquiggleMetrics.PathNotAFile++;
                                }
                            } else {
                                if (util.checkDirectoryExistsSync(resolvedPath)) {
                                    continue;
                                }
                                message =  localize("path.is.not.a.directory", "Path is not a directory: {0}", resolvedPath);
                                newSquiggleMetrics.PathNotADirectory++;
                            }
                        }
                        let diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                            new vscode.Range(document.positionAt(curTextStartOffset + curOffset),
                                document.positionAt(curTextStartOffset + endOffset)),
                            message, vscode.DiagnosticSeverity.Warning);
                        diagnostics.push(diagnostic);
                    }
                } else if (envText) {
                    let envMatches: string[] | null = envText.match(pattern);
                    if (envMatches) {
                        let curOffset: number = 0;
                        let endOffset: number = 0;
                        for (let curMatch of envMatches) {
                            curOffset = envText.substr(endOffset).search(pattern) + endOffset;
                            endOffset = curOffset + curMatch.length;
                            let message: string;
                            if (!pathExists) {
                                message = localize('cannot.find2', "Cannot find \"{0}\".", resolvedPath);
                                newSquiggleMetrics.PathNonExistent++;
                            } else {
                                if (util.checkDirectoryExistsSync(resolvedPath)) {
                                    continue;
                                }
                                message = localize("path.is.not.a.directory2", "Path is not a directory: \"{0}\"", resolvedPath);
                                newSquiggleMetrics.PathNotADirectory++;
                            }
                            let diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                                new vscode.Range(document.positionAt(envTextStartOffSet + curOffset),
                                    document.positionAt(envTextStartOffSet + endOffset)),
                                message, vscode.DiagnosticSeverity.Warning);
                            diagnostics.push(diagnostic);
                        }
                    }
                }
            }

            if (diagnostics.length !== 0) {
                this.diagnosticCollection.set(document.uri, diagnostics);
            } else {
                this.diagnosticCollection.clear();
            }

            // Send telemetry on squiggle changes.
            let changedSquiggleMetrics: { [key: string]: number } = {};
            if (newSquiggleMetrics.PathNonExistent !== this.prevSquiggleMetrics.get(currentConfiguration.name)?.PathNonExistent) {
                changedSquiggleMetrics.PathNonExistent = newSquiggleMetrics.PathNonExistent;
            }
            if (newSquiggleMetrics.PathNotAFile !== this.prevSquiggleMetrics.get(currentConfiguration.name)?.PathNotAFile) {
                changedSquiggleMetrics.PathNotAFile = newSquiggleMetrics.PathNotAFile;
            }
            if (newSquiggleMetrics.PathNotADirectory !== this.prevSquiggleMetrics.get(currentConfiguration.name)?.PathNotADirectory) {
                changedSquiggleMetrics.PathNotADirectory = newSquiggleMetrics.PathNotADirectory;
            }
            if (newSquiggleMetrics.CompilerPathMissingQuotes !== this.prevSquiggleMetrics.get(currentConfiguration.name)?.CompilerPathMissingQuotes) {
                changedSquiggleMetrics.CompilerPathMissingQuotes = newSquiggleMetrics.CompilerPathMissingQuotes;
            }
            if (newSquiggleMetrics.CompilerModeMismatch !== this.prevSquiggleMetrics.get(currentConfiguration.name)?.CompilerModeMismatch) {
                changedSquiggleMetrics.CompilerModeMismatch = newSquiggleMetrics.CompilerModeMismatch;
            }
            if (Object.keys(changedSquiggleMetrics).length > 0) {
                telemetry.logLanguageServerEvent("ConfigSquiggles", undefined, changedSquiggleMetrics);
            }
            this.prevSquiggleMetrics.set(currentConfiguration.name, newSquiggleMetrics);
        });
    }

    private updateToVersion2(): void {
        if (this.configurationJson) {
            this.configurationJson.version = 2;
            // no-op. We don't automatically populate the browse.path anymore.
            // We use includePath if browse.path is not present which is what this code used to do.
        }
    }

    private updateToVersion3(): void {
        if (this.configurationJson) {
            this.configurationJson.version = 3;
            for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
                let config: Configuration = this.configurationJson.configurations[i];
                // Look for Mac configs and extra configs on Mac systems
                if (config.name === "Mac" || (process.platform === 'darwin' && config.name !== "Win32" && config.name !== "Linux")) {
                    if (config.macFrameworkPath === undefined) {
                        config.macFrameworkPath = [
                            "/System/Library/Frameworks",
                            "/Library/Frameworks"
                        ];
                    }
                }
            }
        }
    }

    private updateToVersion4(): void {
        if (this.configurationJson) {
            this.configurationJson.version = 4;
            // Update intelliSenseMode, compilerPath, cStandard, and cppStandard with the defaults if they're missing.
            // If VS Code settings exist for these properties, don't add them to c_cpp_properties.json
            let settings: CppSettings = new CppSettings(this.rootUri);
            for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
                let config: Configuration = this.configurationJson.configurations[i];

                if (config.intelliSenseMode === undefined && !settings.defaultIntelliSenseMode) {
                    config.intelliSenseMode = this.getIntelliSenseModeForPlatform(config.name);
                }
                // Don't set the default if compileCommands exist, until it is fixed to have the correct value.
                if (config.compilerPath === undefined && this.defaultCompilerPath && !config.compileCommands && !settings.defaultCompilerPath) {
                    config.compilerPath = this.defaultCompilerPath;
                }
                if (!config.cStandard && this.defaultCStandard && !settings.defaultCStandard) {
                    config.cStandard = this.defaultCStandard;
                }
                if (!config.cppStandard && this.defaultCppStandard && !settings.defaultCppStandard) {
                    config.cppStandard = this.defaultCppStandard;
                }
            }
        }
    }

    private writeToJson(): void {
        console.assert(this.propertiesFile);
        if (this.propertiesFile) {
            fs.writeFileSync(this.propertiesFile.fsPath, JSON.stringify(this.configurationJson, null, 4));
        }
    }

    public checkCppProperties(): void {
        // Check for change properties in case of file watcher failure.
        let propertiesFile: string = path.join(this.configFolder, "c_cpp_properties.json");
        fs.stat(propertiesFile, (err, stats) => {
            if (err) {
                if (this.propertiesFile) {
                    this.propertiesFile = null; // File deleted.
                    this.resetToDefaultSettings(true);
                    this.handleConfigurationChange();
                }
            } else if (stats.mtime > this.configFileWatcherFallbackTime) {
                if (!this.propertiesFile) {
                    this.propertiesFile = vscode.Uri.file(propertiesFile); // File created.
                }
                this.handleConfigurationChange();
            }
        });
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];

        this.compileCommandFileWatchers.forEach((watcher: fs.FSWatcher) => watcher.close());
        this.compileCommandFileWatchers = []; // reset it

        this.diagnosticCollection.dispose();
    }
}
