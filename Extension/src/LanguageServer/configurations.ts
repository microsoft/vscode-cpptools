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
import { CustomConfigurationProviderCollection, getCustomConfigProviders } from './customProviders';
import { SettingsPanel } from './settingsPanel';
import * as os from 'os';
import escapeStringRegExp = require('escape-string-regexp');
import * as jsonc from 'comment-json';
import * as nls from 'vscode-nls';
import { setTimeout } from 'timers';
import * as which from 'which';
import { WorkspaceBrowseConfiguration } from 'vscode-cpptools';

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
    compilerPathIsExplicit?: boolean;
    compilerArgs?: string[];
    cStandard?: string;
    cStandardIsExplicit?: boolean;
    cppStandard?: string;
    cppStandardIsExplicit?: boolean;
    includePath?: string[];
    macFrameworkPath?: string[];
    windowsSdkVersion?: string;
    defines?: string[];
    intelliSenseMode?: string;
    intelliSenseModeIsExplicit?: boolean;
    compileCommands?: string;
    forcedInclude?: string[];
    configurationProvider?: string;
    mergeConfigurations?: boolean;
    browse?: Browse;
    customConfigurationVariables?: {[key: string]: string};
}

export interface ConfigurationErrors {
    name?: string;
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
    private compileCommandsFile: vscode.Uri | undefined | null = undefined;
    private compileCommandsFileWatchers: fs.FSWatcher[] = [];
    private compileCommandsFileWatcherFallbackTime: Date = new Date(); // Used when file watching fails.
    private defaultCompilerPath: string | null = null;
    private knownCompilers?: KnownCompiler[];
    private defaultCStandard: string | null = null;
    private defaultCppStandard: string | null = null;
    private defaultIncludes: string[] | null = null;
    private defaultFrameworks?: string[];
    private defaultWindowsSdkVersion: string | null = null;
    private vcpkgIncludes: string[] = [];
    private vcpkgPathReady: boolean = false;
    private nodeAddonIncludes: string[] = [];
    private defaultIntelliSenseMode?: string;
    private defaultCustomConfigurationVariables?: { [key: string]: string };
    private readonly configurationGlobPattern: string = "c_cpp_properties.json";
    private disposables: vscode.Disposable[] = [];
    private configurationsChanged = new vscode.EventEmitter<CppProperties>();
    private selectionChanged = new vscode.EventEmitter<number>();
    private compileCommandsChanged = new vscode.EventEmitter<string>();
    private diagnosticCollection: vscode.DiagnosticCollection;
    private prevSquiggleMetrics: Map<string, { [key: string]: number }> = new Map<string, { [key: string]: number }>();
    private rootfs: string | null = null;
    private settingsPanel?: SettingsPanel;
    private lastCustomBrowseConfiguration: PersistentFolderState<WorkspaceBrowseConfiguration | undefined> | undefined;
    private lastCustomBrowseConfigurationProviderId: PersistentFolderState<string | undefined> | undefined;

    // Any time the default settings are parsed and assigned to `this.configurationJson`,
    // we want to track when the default includes have been added to it.
    private configurationIncomplete: boolean = true;

    constructor(rootUri?: vscode.Uri, workspaceFolder?: vscode.WorkspaceFolder) {
        this.rootUri = rootUri;
        const rootPath: string = rootUri ? rootUri.fsPath : "";
        if (workspaceFolder) {
            this.currentConfigurationIndex = new PersistentFolderState<number>("CppProperties.currentConfigurationIndex", -1, workspaceFolder);
            this.lastCustomBrowseConfiguration = new PersistentFolderState<WorkspaceBrowseConfiguration | undefined>("CPP.lastCustomBrowseConfiguration", undefined, workspaceFolder);
            this.lastCustomBrowseConfigurationProviderId = new PersistentFolderState<string | undefined>("CPP.lastCustomBrowseConfigurationProviderId", undefined, workspaceFolder);
        }
        this.configFolder = path.join(rootPath, ".vscode");
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(rootPath);
        this.buildVcpkgIncludePath();
        const userSettings: CppSettings = new CppSettings();
        if (userSettings.addNodeAddonIncludePaths) {
            this.readNodeAddonIncludeLocations(rootPath);
        }
        this.disposables.push(vscode.Disposable.from(this.configurationsChanged, this.selectionChanged, this.compileCommandsChanged));
    }

    public get ConfigurationsChanged(): vscode.Event<CppProperties> { return this.configurationsChanged.event; }
    public get SelectionChanged(): vscode.Event<number> { return this.selectionChanged.event; }
    public get CompileCommandsChanged(): vscode.Event<string> { return this.compileCommandsChanged.event; }
    public get Configurations(): Configuration[] | undefined { return this.configurationJson ? this.configurationJson.configurations : undefined; }
    public get CurrentConfigurationIndex(): number { return this.currentConfigurationIndex === undefined ? 0 : this.currentConfigurationIndex.Value; }
    public get CurrentConfiguration(): Configuration | undefined { return this.Configurations ? this.Configurations[this.CurrentConfigurationIndex] : undefined; }
    public get KnownCompiler(): KnownCompiler[] | undefined { return this.knownCompilers; }

    public get LastCustomBrowseConfiguration(): PersistentFolderState<WorkspaceBrowseConfiguration | undefined> | undefined { return this.lastCustomBrowseConfiguration; }
    public get LastCustomBrowseConfigurationProviderId(): PersistentFolderState<string | undefined> | undefined { return this.lastCustomBrowseConfigurationProviderId; }

    public get CurrentConfigurationProvider(): string | undefined {
        if (this.CurrentConfiguration?.configurationProvider) {
            return this.CurrentConfiguration.configurationProvider;
        }
        return new CppSettings(this.rootUri).defaultConfigurationProvider;
    }

    public get ConfigurationNames(): string[] | undefined {
        const result: string[] = [];
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
        const configFilePath: string = path.join(this.configFolder, "c_cpp_properties.json");
        if (this.rootUri !== null && fs.existsSync(configFilePath)) {
            this.propertiesFile = vscode.Uri.file(configFilePath);
        } else {
            this.propertiesFile = null;
        }

        const settingsPath: string = path.join(this.configFolder, this.configurationGlobPattern);
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

        vscode.workspace.onDidSaveTextDocument((doc: vscode.TextDocument) => {
            // For multi-root, the "onDidSaveTextDocument" will be received once for each project folder.
            // To avoid misleading telemetry (for CMake retention) skip if the notifying folder
            // is not the same workspace folder of the modified document.
            // Exception: if the document does not belong to any of the folders in this workspace,
            // getWorkspaceFolder will return undefined and we report this as "outside".
            // Even in this case make sure we send the telemetry information only once,
            // not for each notifying folder.
            const savedDocWorkspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(doc.uri);
            const notifyingWorkspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(settingsPath));
            if ((!savedDocWorkspaceFolder && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 && notifyingWorkspaceFolder === vscode.workspace.workspaceFolders[0])
               || savedDocWorkspaceFolder === notifyingWorkspaceFolder) {
                let fileType: string | undefined;
                const documentPath: string = doc.uri.fsPath.toLowerCase();
                if (documentPath.endsWith("cmakelists.txt")) {
                    fileType = "CMakeLists";
                } else if (documentPath.endsWith("cmakecache.txt")) {
                    fileType = "CMakeCache";
                } else if (documentPath.endsWith(".cmake")) {
                    fileType = ".cmake";
                }

                if (fileType) {
                    // We consider the changed cmake file as outside if it is not found in any
                    // of the projects folders.
                    telemetry.logLanguageServerEvent("cmakeFileWrite",
                        {
                            filetype: fileType,
                            outside: (savedDocWorkspaceFolder === undefined).toString()
                        });
                }
            }
        });

        this.handleConfigurationChange();
    }

    public get VcpkgInstalled(): boolean {
        return this.vcpkgIncludes.length > 0;
    }

    private onConfigurationsChanged(): void {
        if (this.Configurations) {
            this.configurationsChanged.fire(this);
        }
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
            const index: number | undefined = this.getConfigIndexForPlatform(this.configurationJson);
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
            const configuration: Configuration | undefined = this.CurrentConfiguration;
            if (configuration) {
                this.applyDefaultConfigurationValues(configuration);
                this.configurationIncomplete = false;
            }
        }
    }

    private applyDefaultConfigurationValues(configuration: Configuration): void {
        const settings: CppSettings = new CppSettings(this.rootUri);
        // default values for "default" config settings is null.
        const isUnset: (input: any) => boolean = (input: any) => input === null || input === undefined;

        // Anything that has a vscode setting for it will be resolved in updateServerOnFolderSettingsChange.
        // So if a property is currently unset, but has a vscode setting, don't set it yet, otherwise the linkage
        // to the setting will be lost if this configuration is saved into a c_cpp_properties.json file.

        // Only add settings from the default compiler if user hasn't explicitly set the corresponding VS Code setting.

        const rootFolder: string = "${workspaceFolder}/**";
        const defaultFolder: string = "${default}";
        // We don't add system includes to the includePath anymore. The language server has this information.
        if (isUnset(settings.defaultIncludePath)) {
            configuration.includePath = [rootFolder].concat(this.vcpkgIncludes);
        } else {
            configuration.includePath = [defaultFolder];
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
        if (isUnset(settings.defaultCustomConfigurationVariables) || settings.defaultCustomConfigurationVariables === {}) {
            configuration.customConfigurationVariables = this.defaultCustomConfigurationVariables;
        }
    }

    private get ExtendedEnvironment(): Environment {
        const result: Environment = {};
        if (this.configurationJson?.env) {
            Object.assign(result, this.configurationJson.env);
        }

        result["workspaceFolderBasename"] = this.rootUri ? path.basename(this.rootUri.fsPath) : "";
        result["execPath"] = process.execPath;
        result["pathSeparator"] = (os.platform() === 'win32') ? "\\" : "/";
        return result;
    }

    private async buildVcpkgIncludePath(): Promise<void> {
        try {
            // Check for vcpkgRoot and include relevent paths if found.
            const vcpkgRoot: string = util.getVcpkgRoot();
            if (vcpkgRoot) {
                const list: string[] = await util.readDir(vcpkgRoot);
                if (list !== undefined) {
                    // For every *directory* in the list (non-recursive). Each directory is basically a platform.
                    list.forEach((entry) => {
                        if (entry !== "vcpkg") {
                            const pathToCheck: string = path.join(vcpkgRoot, entry);
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

    public nodeAddonIncludesFound(): number {
        return this.nodeAddonIncludes.length;
    }

    private async readNodeAddonIncludeLocations(rootPath: string): Promise<void> {
        let error: Error | undefined;
        let pdjFound: boolean = false;
        let packageJson: any;
        try {
            packageJson = JSON.parse(await fs.promises.readFile(path.join(rootPath, "package.json"), "utf8"));
            pdjFound = true;
        } catch (errJS) {
            const err: Error = errJS as Error;
            error = err;
        }

        if (!error) {
            try {
                const pathToNode: string = which.sync("node");
                const nodeAddonMap: [string, string][] = [
                    ["node-addon-api", `"${pathToNode}" --no-warnings -p "require('node-addon-api').include"`],
                    ["nan", `"${pathToNode}" --no-warnings -e "require('nan')"`]
                ];
                // Yarn (2) PnP support
                const pathToYarn: string | null = which.sync("yarn", { nothrow: true });
                if (pathToYarn && await util.checkDirectoryExists(path.join(rootPath, ".yarn/cache"))) {
                    nodeAddonMap.push(
                        ["node-addon-api", `"${pathToYarn}" node --no-warnings -p "require('node-addon-api').include"`],
                        ["nan", `"${pathToYarn}" node --no-warnings -e "require('nan')"`]
                    );
                }

                for (const [dep, execCmd] of nodeAddonMap) {
                    if (dep in packageJson.dependencies) {
                        try {
                            let stdout: string | void = await util.execChildProcess(execCmd, rootPath);
                            if (!stdout) {
                                continue;
                            }
                            // cleanup newlines
                            if (stdout[stdout.length - 1] === "\n") {
                                stdout = stdout.slice(0, -1);
                            }
                            // node-addon-api returns a quoted string, e.g., '"/home/user/dir/node_modules/node-addon-api"'.
                            if (stdout[0] === "\"" && stdout[stdout.length - 1] === "\"") {
                                stdout = stdout.slice(1, -1);
                            }

                            // at this time both node-addon-api and nan return their own directory so this test is not really
                            // needed. but it does future proof the code.
                            if (!await util.checkDirectoryExists(stdout)) {
                                // nan returns a path relative to rootPath causing the previous check to fail because this code
                                // is executing in vscode's working directory.
                                stdout = path.join(rootPath, stdout);
                                if (!await util.checkDirectoryExists(stdout)) {
                                    error = new Error(`${dep} directory ${stdout} doesn't exist`);
                                    stdout = '';
                                }
                            }
                            if (stdout) {
                                this.nodeAddonIncludes.push(stdout);
                            }
                        } catch (errJS) {
                            const err: Error = errJS as Error;
                            console.log('readNodeAddonIncludeLocations', err.message);
                        }
                    }
                }
            } catch (errJS) {
                const e: Error = errJS as Error;
                error = e;
            }
        }
        if (error) {
            if (pdjFound) {
                // only log an error if package.json exists.
                console.log('readNodeAddonIncludeLocations', error.message);
            }
        } else {
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
            return "linux-gcc-x64";
        } else if (name === "Mac") {
            return "macos-clang-x64";
        } else if (name === "Win32") {
            return "windows-msvc-x64";
        } else if (process.platform === 'win32') {
            // Custom configs default to the OS's preference.
            return "windows-msvc-x64";
        } else if (process.platform === 'darwin') {
            return "macos-clang-x64";
        } else {
            return "linux-gcc-x64";
        }
    }

    private validateIntelliSenseMode(configuration: Configuration): string {
        // Validate whether IntelliSenseMode is compatible with compiler.
        // Do not validate if compiler path is not set or intelliSenseMode is not set.
        if (configuration.compilerPath === undefined ||
            configuration.compilerPath === "" ||
            configuration.compilerPath === "${default}" ||
            configuration.intelliSenseMode === undefined ||
            configuration.intelliSenseMode === "" ||
            configuration.intelliSenseMode === "${default}") {
            return "";
        }
        const resolvedCompilerPath: string = this.resolvePath(configuration.compilerPath, true);
        const compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(resolvedCompilerPath);

        const isValid: boolean = ((compilerPathAndArgs.compilerName.toLowerCase() === "cl.exe" || compilerPathAndArgs.compilerName.toLowerCase() === "cl") === configuration.intelliSenseMode.includes("msvc")
            // We can't necessarily determine what host compiler nvcc will use, without parsing command line args (i.e. for -ccbin)
            // to determine if the user has set it to something other than the default. So, we don't squiggle IntelliSenseMode when using nvcc.
            || (compilerPathAndArgs.compilerName.toLowerCase() === "nvcc.exe") || (compilerPathAndArgs.compilerName.toLowerCase() === "nvcc"));
        if (isValid) {
            return "";
        } else {
            return localize("incompatible.intellisense.mode", "IntelliSense mode {0} is incompatible with compiler path.", configuration.intelliSenseMode);
        }
    }

    public addToIncludePathCommand(path: string): void {
        this.handleConfigurationEditCommand(() => {
            this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
            const config: Configuration | undefined = this.CurrentConfiguration;
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
                    const config: Configuration | undefined = this.CurrentConfiguration;
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
                const settings: CppSettings = new CppSettings(this.rootUri);
                if (providerId) {
                    settings.update("default.configurationProvider", providerId);
                } else {
                    settings.update("default.configurationProvider", undefined); // delete the setting
                }
                const config: Configuration | undefined = this.CurrentConfiguration;
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
            const config: Configuration | undefined = this.CurrentConfiguration;
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

    private resolveDefaultsDictionary(entries: { [key: string]: string }, defaultValue: { [key: string]: string } | undefined, env: Environment): { [key: string]: string } {
        const result: { [key: string]: string } = {};
        for (const property in entries) {
            if (property === "${default}") {
                if (defaultValue) {
                    for (const defaultProperty in defaultValue) {
                        if (!(defaultProperty in entries)) {
                            result[defaultProperty] = util.resolveVariables(defaultValue[defaultProperty], env);
                        }
                    }
                }
            } else {
                result[property] = util.resolveVariables(entries[property], env);
            }
        }
        return result;
    }

    private resolve(entries: string[] | undefined, defaultValue: string[] | undefined, env: Environment): string[] {
        let result: string[] = [];
        if (entries) {
            entries = this.resolveDefaults(entries, defaultValue);
            entries.forEach(entry => {
                const entriesResolved: string[] = [];
                const entryResolved: string = util.resolveVariables(entry, env, entriesResolved);
                result = result.concat(entriesResolved.length === 0 ? entryResolved : entriesResolved);
            });
        }
        return result;
    }

    private resolveAndSplit(paths: string[] | undefined, defaultValue: string[] | undefined, env: Environment): string[] {
        let result: string[] = [];
        if (paths) {
            paths = this.resolveDefaults(paths, defaultValue);
            paths.forEach(entry => {
                const entries: string[] = util.resolveVariables(entry, env).split(util.envDelimiter).filter(e => e);
                result = result.concat(entries);
            });
        }
        return result;
    }

    private updateConfigurationString(property: string | undefined | null, defaultValue: string | undefined | null, env: Environment, acceptBlank?: boolean): string | undefined {
        if (property === null || property === undefined || property === "${default}") {
            property = defaultValue;
        }
        if (property === null || property === undefined || (acceptBlank !== true && property === "")) {
            return undefined;
        }
        return util.resolveVariables(property, env);
    }

    private updateConfigurationStringArray(property: string[] | undefined, defaultValue: string[] | undefined, env: Environment): string[] | undefined {
        if (property) {
            return this.resolve(property, defaultValue, env);
        }
        if (!property && defaultValue) {
            return this.resolve(defaultValue, [], env);
        }
        return property;
    }

    private updateConfigurationPathsArray(paths: string[] | undefined, defaultValue: string[] | undefined, env: Environment): string[] | undefined {
        if (paths) {
            return this.resolveAndSplit(paths, defaultValue, env);
        }
        if (!paths && defaultValue) {
            return this.resolveAndSplit(defaultValue, [], env);
        }
        return paths;
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

    private updateConfigurationBoolean(property: boolean | undefined | null, defaultValue: boolean | undefined | null): boolean | undefined {
        if (property === null || property === undefined) {
            property = defaultValue;
        }

        if (property === null) {
            return undefined;
        }

        return property;
    }

    private updateConfigurationStringDictionary(property: { [key: string]: string } | undefined, defaultValue: { [key: string]: string } | undefined, env: Environment): { [key: string]: string } | undefined {
        if (!property || property === {}) {
            property = defaultValue;
        }
        if (!property || property === {}) {
            return undefined;
        }
        return this.resolveDefaultsDictionary(property, defaultValue, env);
    }

    private updateServerOnFolderSettingsChange(): void {
        if (!this.configurationJson) {
            return;
        }
        const settings: CppSettings = new CppSettings(this.rootUri);
        const userSettings: CppSettings = new CppSettings();
        const env: Environment = this.ExtendedEnvironment;
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            const configuration: Configuration = this.configurationJson.configurations[i];

            configuration.includePath = this.updateConfigurationPathsArray(configuration.includePath, settings.defaultIncludePath, env);
            // in case includePath is reset below
            const origIncludePath: string[] | undefined = configuration.includePath;
            if (userSettings.addNodeAddonIncludePaths) {
                const includePath: string[] = origIncludePath || [];
                configuration.includePath = includePath.concat(this.nodeAddonIncludes.filter(i => includePath.indexOf(i) < 0));
            }
            configuration.defines = this.updateConfigurationStringArray(configuration.defines, settings.defaultDefines, env);
            configuration.macFrameworkPath = this.updateConfigurationPathsArray(configuration.macFrameworkPath, settings.defaultMacFrameworkPath, env);
            configuration.windowsSdkVersion = this.updateConfigurationString(configuration.windowsSdkVersion, settings.defaultWindowsSdkVersion, env);
            configuration.forcedInclude = this.updateConfigurationPathsArray(configuration.forcedInclude, settings.defaultForcedInclude, env);
            configuration.compileCommands = this.updateConfigurationString(configuration.compileCommands, settings.defaultCompileCommands, env);
            configuration.compilerArgs = this.updateConfigurationStringArray(configuration.compilerArgs, settings.defaultCompilerArgs, env);
            configuration.cStandard = this.updateConfigurationString(configuration.cStandard, settings.defaultCStandard, env);
            configuration.cppStandard = this.updateConfigurationString(configuration.cppStandard, settings.defaultCppStandard, env);
            configuration.intelliSenseMode = this.updateConfigurationString(configuration.intelliSenseMode, settings.defaultIntelliSenseMode, env);
            configuration.intelliSenseModeIsExplicit = configuration.intelliSenseModeIsExplicit || settings.defaultIntelliSenseMode !== "";
            configuration.cStandardIsExplicit = configuration.cStandardIsExplicit || settings.defaultCStandard !== "";
            configuration.cppStandardIsExplicit = configuration.cppStandardIsExplicit || settings.defaultCppStandard !== "";
            configuration.mergeConfigurations = this.updateConfigurationBoolean(configuration.mergeConfigurations, settings.defaultMergeConfigurations);
            if (!configuration.compileCommands) {
                // compile_commands.json already specifies a compiler. compilerPath overrides the compile_commands.json compiler so
                // don't set a default when compileCommands is in use.
                configuration.compilerPath = this.updateConfigurationString(configuration.compilerPath, settings.defaultCompilerPath, env, true);
                configuration.compilerPathIsExplicit = configuration.compilerPathIsExplicit || settings.defaultCompilerPath !== undefined;
                if (configuration.compilerPath === undefined) {
                    if (!!this.defaultCompilerPath) {
                        // If no config value yet set for these, pick up values from the defaults, but don't consider them explicit.
                        configuration.compilerPath = this.defaultCompilerPath;
                        if (!configuration.cStandard && !!this.defaultCStandard) {
                            configuration.cStandard = this.defaultCStandard;
                            configuration.cStandardIsExplicit = false;
                        }
                        if (!configuration.cppStandard && !!this.defaultCppStandard) {
                            configuration.cppStandard = this.defaultCppStandard;
                            configuration.cppStandardIsExplicit = false;
                        }
                        if (!configuration.intelliSenseMode && !!this.defaultIntelliSenseMode) {
                            configuration.intelliSenseMode = this.defaultIntelliSenseMode;
                            configuration.intelliSenseModeIsExplicit = false;
                        }
                        if (!configuration.windowsSdkVersion && !!this.defaultWindowsSdkVersion) {
                            configuration.windowsSdkVersion = this.defaultWindowsSdkVersion;
                        }
                        if (!origIncludePath && !!this.defaultIncludes) {
                            const includePath: string[] = configuration.includePath || [];
                            configuration.includePath = includePath.concat(this.defaultIncludes);
                        }
                        if (!configuration.macFrameworkPath && !!this.defaultFrameworks) {
                            configuration.macFrameworkPath = this.defaultFrameworks;
                        }
                    }
                }
            } else {
                // However, if compileCommands are used and compilerPath is explicitly set, it's still necessary to resolve variables in it.
                if (configuration.compilerPath === "${default}") {
                    configuration.compilerPath = settings.defaultCompilerPath;
                }
                if (configuration.compilerPath === null) {
                    configuration.compilerPath = undefined;
                    configuration.compilerPathIsExplicit = true;
                } else if (configuration.compilerPath !== undefined) {
                    configuration.compilerPath = util.resolveVariables(configuration.compilerPath, env);
                    configuration.compilerPathIsExplicit = true;
                } else {
                    configuration.compilerPathIsExplicit = false;
                }
            }

            configuration.customConfigurationVariables = this.updateConfigurationStringDictionary(configuration.customConfigurationVariables, settings.defaultCustomConfigurationVariables, env);
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
                configuration.browse.path = this.updateConfigurationPathsArray(configuration.browse.path, settings.defaultBrowsePath, env);
            }

            configuration.browse.limitSymbolsToIncludedHeaders = this.updateConfigurationStringOrBoolean(configuration.browse.limitSymbolsToIncludedHeaders, settings.defaultLimitSymbolsToIncludedHeaders, env);
            configuration.browse.databaseFilename = this.updateConfigurationString(configuration.browse.databaseFilename, settings.defaultDatabaseFilename, env);

            if (i === this.CurrentConfigurationIndex) {
                // If there is no c_cpp_properties.json, there are no relevant C_Cpp.default.* settings set,
                // and there is only 1 registered custom config provider, default to using that provider.
                const providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
                const hasEmptyConfiguration: boolean = !this.propertiesFile
                    && !settings.defaultCompilerPath
                    && settings.defaultCompilerPath !== ""
                    && !settings.defaultIncludePath
                    && !settings.defaultDefines
                    && !settings.defaultMacFrameworkPath
                    && settings.defaultWindowsSdkVersion === ""
                    && !settings.defaultForcedInclude
                    && settings.defaultCompileCommands === ""
                    && !settings.defaultCompilerArgs
                    && settings.defaultCStandard === ""
                    && settings.defaultCppStandard === ""
                    && settings.defaultIntelliSenseMode === ""
                    && settings.defaultConfigurationProvider === "";

                // Only keep a cached custom browse config if there is an empty configuration,
                // or if a specified provider ID has not changed.
                let keepCachedBrowseConfig: boolean = true;
                if (hasEmptyConfiguration) {
                    if (providers.size === 1) {
                        providers.forEach(provider => { configuration.configurationProvider = provider.extensionId; });
                        if (this.lastCustomBrowseConfigurationProviderId !== undefined) {
                            keepCachedBrowseConfig = configuration.configurationProvider === this.lastCustomBrowseConfigurationProviderId.Value;
                        }
                    } else if (this.lastCustomBrowseConfigurationProviderId !== undefined
                        && !!this.lastCustomBrowseConfigurationProviderId.Value) {
                        // Use the last configuration provider we received a browse config from as the provider ID.
                        configuration.configurationProvider = this.lastCustomBrowseConfigurationProviderId.Value;
                    }
                } else if (this.lastCustomBrowseConfigurationProviderId !== undefined) {
                    keepCachedBrowseConfig = configuration.configurationProvider === this.lastCustomBrowseConfigurationProviderId.Value;
                }
                if (!keepCachedBrowseConfig && this.lastCustomBrowseConfiguration !== undefined) {
                    this.lastCustomBrowseConfiguration.Value = undefined;
                }
            }
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
            this.compileCommandsFileWatchers.forEach((watcher: fs.FSWatcher) => watcher.close());
            this.compileCommandsFileWatchers = []; // reset it
            const filePaths: Set<string> = new Set<string>();
            this.configurationJson.configurations.forEach(c => {
                if (c.compileCommands) {
                    const fileSystemCompileCommandsPath: string = this.resolvePath(c.compileCommands, os.platform() === "win32");
                    if (fs.existsSync(fileSystemCompileCommandsPath)) {
                        filePaths.add(fileSystemCompileCommandsPath);
                    }
                }
            });
            try {
                filePaths.forEach((path: string) => {
                    this.compileCommandsFileWatchers.push(fs.watch(path, (event: string, filename: string) => {
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
    public handleConfigurationEditCommand(onBeforeOpen: (() => void) | undefined, showDocument: (document: vscode.TextDocument, column?: vscode.ViewColumn) => void, viewColumn?: vscode.ViewColumn): void {
        const otherSettings: OtherSettings = new OtherSettings(this.rootUri);
        if (otherSettings.settingsEditor === "ui") {
            this.handleConfigurationEditUICommand(onBeforeOpen, showDocument, viewColumn);
        } else {
            this.handleConfigurationEditJSONCommand(onBeforeOpen, showDocument, viewColumn);
        }
    }

    // onBeforeOpen will be called after c_cpp_properties.json have been created (if it did not exist), but before the document is opened.
    public async handleConfigurationEditJSONCommand(onBeforeOpen: (() => void) | undefined, showDocument: (document: vscode.TextDocument, column?: vscode.ViewColumn) => void, viewColumn?: vscode.ViewColumn): Promise<void> {
        await this.ensurePropertiesFile();
        console.assert(this.propertiesFile);
        if (onBeforeOpen) {
            onBeforeOpen();
        }
        // Directly open the json file
        if (this.propertiesFile) {
            const document: vscode.TextDocument = await vscode.workspace.openTextDocument(this.propertiesFile);
            if (showDocument) {
                showDocument(document, viewColumn);
            }
        }
    }

    private ensureSettingsPanelInitlialized(): void {
        if (this.settingsPanel === undefined) {
            const settings: CppSettings = new CppSettings(this.rootUri);
            this.settingsPanel = new SettingsPanel();
            this.settingsPanel.setKnownCompilers(this.knownCompilers, settings.preferredPathSeparator);
            this.settingsPanel.SettingsPanelActivated(() => {
                if (this.settingsPanel?.initialized) {
                    this.onSettingsPanelActivated();
                }
            });
            this.settingsPanel.ConfigValuesChanged(() => this.saveConfigurationUI());
            this.settingsPanel.ConfigSelectionChanged(() => this.onConfigSelectionChanged());
            this.settingsPanel.AddConfigRequested((e) => this.onAddConfigRequested(e));
            this.disposables.push(this.settingsPanel);
        }
    }

    // onBeforeOpen will be called after c_cpp_properties.json have been created (if it did not exist), but before the document is opened.
    public async handleConfigurationEditUICommand(onBeforeOpen: (() => void) | undefined, showDocument: (document: vscode.TextDocument, column?: vscode.ViewColumn) => void, viewColumn?: vscode.ViewColumn): Promise<void> {
        await this.ensurePropertiesFile();
        if (this.propertiesFile) {
            if (onBeforeOpen) {
                onBeforeOpen();
            }
            if (this.parsePropertiesFile()) {
                this.ensureSettingsPanelInitlialized();
                if (this.settingsPanel) {
                    const configNames: string[] | undefined = this.ConfigurationNames;
                    if (configNames && this.configurationJson) {
                        // Use the active configuration as the default selected configuration to load on UI editor
                        this.settingsPanel.selectedConfigIndex = this.CurrentConfigurationIndex;
                        this.settingsPanel.createOrShow(configNames,
                            this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex],
                            this.getErrorsForConfigUI(this.settingsPanel.selectedConfigIndex),
                            viewColumn);
                    }
                }
            } else {
                // Parse failed, open json file
                const document: vscode.TextDocument = await vscode.workspace.openTextDocument(this.propertiesFile);
                if (showDocument) {
                    showDocument(document, viewColumn);
                }
            }
        }
    }

    private async onSettingsPanelActivated(): Promise<void> {
        if (this.configurationJson) {
            await this.ensurePropertiesFile();
            if (this.propertiesFile) {
                if (this.parsePropertiesFile()) {
                    const configNames: string[] | undefined = this.ConfigurationNames;
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
        }
    }

    private saveConfigurationUI(): void {
        this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
        if (this.settingsPanel && this.configurationJson) {
            const config: Configuration = this.settingsPanel.getLastValuesFromConfigUI();
            this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex] = config;
            this.settingsPanel.updateErrors(this.getErrorsForConfigUI(this.settingsPanel.selectedConfigIndex));
            this.writeToJson();
        }
    }

    private onConfigSelectionChanged(): void {
        const configNames: string[] | undefined = this.ConfigurationNames;
        if (configNames && this.settingsPanel && this.configurationJson) {
            this.settingsPanel.updateConfigUI(configNames,
                this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex],
                this.getErrorsForConfigUI(this.settingsPanel.selectedConfigIndex));
        }
    }

    private onAddConfigRequested(configName: string): void {
        this.parsePropertiesFile(); // Clear out any modifications we may have made internally.

        // Create default config and add to list of configurations
        const newConfig: Configuration = { name: configName };
        this.applyDefaultConfigurationValues(newConfig);
        const configNames: string[] | undefined = this.ConfigurationNames;
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

    public handleConfigurationChange(): void {
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
                    const index: number | undefined = this.getConfigIndexForPlatform(this.configurationJson);
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
        if (this.propertiesFile && await util.checkFileExists(this.propertiesFile.fsPath)) {
            return;
        } else {
            try {
                if  (!await util.checkDirectoryExists(this.configFolder)) {
                    fs.mkdirSync(this.configFolder);
                }

                const fullPathToFile: string = path.join(this.configFolder, "c_cpp_properties.json");
                // Since the properties files does not exist, there will be exactly 1 configuration.
                // If we have decided to use a custom config provider, propagate that to the new config.
                const settings: CppSettings = new CppSettings(this.rootUri);
                let providerId: string | undefined = settings.defaultConfigurationProvider;
                if (this.configurationJson) {
                    if (!providerId) {
                        providerId = this.configurationJson.configurations[0].configurationProvider;
                    }
                    this.resetToDefaultSettings(true);
                }
                this.applyDefaultIncludePathsAndFrameworks();
                if (providerId) {
                    if (this.configurationJson) {
                        this.configurationJson.configurations[0].configurationProvider = providerId;
                    }
                }

                await util.writeFileText(fullPathToFile, jsonc.stringify(this.configurationJson, null, 4));

                this.propertiesFile = vscode.Uri.file(path.join(this.configFolder, "c_cpp_properties.json"));

            } catch (errJS) {
                const err: Error = errJS as Error;
                const failedToCreate: string = localize("failed.to.create.config.folder", 'Failed to create "{0}"', this.configFolder);
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
            const readResults: string = fs.readFileSync(this.propertiesFile.fsPath, 'utf8');
            if (readResults === "") {
                return false; // Repros randomly when the file is initially created. The parse will get called again after the file is written.
            }

            // Try to use the same configuration as before the change.
            const newJson: ConfigurationJson = jsonc.parse(readResults);
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
                const index: number | undefined = this.getConfigIndexForPlatform(newJson);
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
                const newId: string | undefined = getCustomConfigProviders().checkId(this.configurationJson.configurations[i].configurationProvider);
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
                delete this.configurationJson.env['execPath'];
                delete this.configurationJson.env['pathSeparator'];
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
                if ((<any>e).knownCompilers !== undefined) {
                    delete (<any>e).knownCompilers;
                    dirty = true;
                }
            });

            for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
                if ((this.configurationJson.configurations[i].compilerPathIsExplicit !== undefined)
                    || (this.configurationJson.configurations[i].cStandardIsExplicit !== undefined)
                    || (this.configurationJson.configurations[i].cppStandardIsExplicit !== undefined)
                    || (this.configurationJson.configurations[i].intelliSenseModeIsExplicit !== undefined)) {
                    dirty = true;
                    break;
                }
            }

            if (dirty) {
                try {
                    this.writeToJson();
                } catch (err) {
                    // Ignore write errors, the file may be under source control. Updated settings will only be modified in memory.
                    vscode.window.showWarningMessage(localize('update.properties.failed', 'Attempt to update "{0}" failed (do you have write access?)', this.propertiesFile.fsPath));
                    success = false;
                }
            }

            this.configurationJson.configurations.forEach(e => {
                e.compilerPathIsExplicit = e.compilerPath !== undefined;
                e.cStandardIsExplicit = e.cStandard !== undefined;
                e.cppStandardIsExplicit = e.cppStandard !== undefined;
                e.intelliSenseModeIsExplicit = e.intelliSenseMode !== undefined;
            });

        } catch (errJS) {
            const err: Error = errJS as Error;
            const failedToParse: string = localize("failed.to.parse.properties", 'Failed to parse "{0}"', this.propertiesFile.fsPath);
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
        const errors: ConfigurationErrors = {};
        if (!this.configurationJson) {
            return errors;
        }
        const isWindows: boolean = os.platform() === 'win32';
        const config: Configuration = this.configurationJson.configurations[configIndex];

        // Check if config name is unique.
        errors.name = this.isConfigNameUnique(config.name);

        // Validate compilerPath
        let resolvedCompilerPath: string | undefined = this.resolvePath(config.compilerPath, isWindows);
        const compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(resolvedCompilerPath);
        if (resolvedCompilerPath
            // Don't error cl.exe paths because it could be for an older preview build.
            && compilerPathAndArgs.compilerName.toLowerCase() !== "cl.exe"
            && compilerPathAndArgs.compilerName.toLowerCase() !== "cl") {
            resolvedCompilerPath = resolvedCompilerPath.trim();

            // Error when the compiler's path has spaces without quotes but args are used.
            // Except, exclude cl.exe paths because it could be for an older preview build.
            const compilerPathNeedsQuotes: boolean =
                (compilerPathAndArgs.additionalArgs && compilerPathAndArgs.additionalArgs.length > 0) &&
                !resolvedCompilerPath.startsWith('"') &&
                compilerPathAndArgs.compilerPath !== undefined &&
                compilerPathAndArgs.compilerPath.includes(" ");

            const compilerPathErrors: string[] = [];
            if (compilerPathNeedsQuotes) {
                compilerPathErrors.push(localize("path.with.spaces", 'Compiler path with spaces and arguments is missing double quotes " around the path.'));
            }

            // Get compiler path without arguments before checking if it exists
            resolvedCompilerPath = compilerPathAndArgs.compilerPath;
            if (resolvedCompilerPath) {
                let pathExists: boolean = true;
                const existsWithExeAdded: (path: string) => boolean = (path: string) => isWindows && !path.startsWith("/") && fs.existsSync(path + ".exe");
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
                    const message: string = localize('cannot.find', "Cannot find: {0}", resolvedCompilerPath);
                    compilerPathErrors.push(message);
                } else if (compilerPathAndArgs.compilerPath === "") {
                    const message: string = localize("cannot.resolve.compiler.path", "Invalid input, cannot resolve compiler path");
                    compilerPathErrors.push(message);
                } else if (!util.checkFileExistsSync(resolvedCompilerPath)) {
                    const message: string = localize("path.is.not.a.file", "Path is not a file: {0}", resolvedCompilerPath);
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
        errors.forcedInclude = this.validatePath(config.forcedInclude, false, true);
        errors.compileCommands = this.validatePath(config.compileCommands, false);
        errors.databaseFilename = this.validatePath((config.browse ? config.browse.databaseFilename : undefined), false);

        // Validate intelliSenseMode
        if (isWindows) {
            const intelliSenesModeError: string = this.validateIntelliSenseMode(config);
            if (intelliSenesModeError.length > 0) {
                errors.intelliSenseMode = intelliSenesModeError;
            }
        }

        return errors;
    }

    private validatePath(input: string | string[] | undefined, isDirectory: boolean = true, skipRelativePaths: boolean = false): string | undefined {
        if (!input) {
            return undefined;
        }

        const isWindows: boolean = os.platform() === 'win32';
        let errorMsg: string | undefined;
        const errors: string[] = [];
        let paths: string[] = [];

        if (util.isString(input)) {
            paths.push(input);
        } else {
            paths = input;
        }

        // Resolve and split any environment variables
        paths = this.resolveAndSplit(paths, undefined, this.ExtendedEnvironment);

        for (const p of paths) {
            let pathExists: boolean = true;
            let resolvedPath: string = this.resolvePath(p, isWindows);
            if (!resolvedPath) {
                continue;
            }

            // Check if resolved path exists
            if (!fs.existsSync(resolvedPath)) {
                if (skipRelativePaths && !path.isAbsolute(resolvedPath)) {
                    continue;
                } else if (!this.rootUri) {
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
                const message: string = localize('cannot.find', "Cannot find: {0}", resolvedPath);
                errors.push(message);
                continue;
            }

            // Check if path is a directory or file
            if (isDirectory && !util.checkDirectoryExistsSync(resolvedPath)) {
                const message: string = localize("path.is.not.a.directory", "Path is not a directory: {0}", resolvedPath);
                errors.push(message);
            } else if (!isDirectory && !util.checkFileExistsSync(resolvedPath)) {
                const message: string = localize("path.is.not.a.file", "Path is not a file: {0}", resolvedPath);
                errors.push(message);
            }
        }

        if (errors.length > 0) {
            errorMsg = errors.join('\n');
        }

        return errorMsg;
    }

    private isConfigNameUnique(configName: string): string | undefined {
        let errorMsg: string | undefined;
        // TODO: make configName non-case sensitive.
        const occurrences: number | undefined = this.ConfigurationNames?.filter(function (name): boolean { return name === configName; }).length;
        if (occurrences && occurrences > 1) {
            errorMsg = localize('duplicate.name', "{0} is a duplicate. The configuration name should be unique.", configName);
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
            const diagnostics: vscode.Diagnostic[] = new Array<vscode.Diagnostic>();

            // Get the text of the current configuration.
            let curText: string = document.getText();

            // Replace all \<escape character> with \\<character>, except for \"
            // Otherwise, the JSON.parse result will have the \<escape character> missing.
            const configurationsText: string = util.escapeForSquiggles(curText);
            const configurations: ConfigurationJson = jsonc.parse(configurationsText);
            const currentConfiguration: Configuration = configurations.configurations[this.CurrentConfigurationIndex];

            let curTextStartOffset: number = 0;
            if (!currentConfiguration.name) {
                return;
            }

            // Get env text
            let envText: string = "";
            const envStart: number = curText.search(/\"env\"\s*:\s*\{/);
            const envEnd: number = envStart === -1 ? -1 : curText.indexOf("},", envStart);
            envText = curText.substr(envStart, envEnd);
            const envTextStartOffSet: number = envStart + 1;

            // Check if all config names are unique.
            let allConfigText: string = curText;
            let allConfigTextOffset: number = envTextStartOffSet;
            const nameRegex: RegExp = new RegExp(`{\\s*"name"\\s*:\\s*".*"`);
            let configStart: number = allConfigText.search(new RegExp(nameRegex));
            let configNameStart: number;
            let configNameEnd: number;
            let configName: string;
            const configNames: Map<string, vscode.Range[]> = new Map<string, []>();
            let dupErrorMsg: string;
            while (configStart !== -1) {
                allConfigText = allConfigText.substr(configStart);
                allConfigTextOffset += configStart;
                configNameStart = allConfigText.indexOf('"', allConfigText.indexOf(':') + 1) + 1;
                configNameEnd = allConfigText.indexOf('"', configNameStart);
                configName = allConfigText.substr(configNameStart, configNameEnd - configNameStart);
                const newRange: vscode.Range = new vscode.Range(0, allConfigTextOffset + configNameStart, 0, allConfigTextOffset + configNameEnd);
                const allRanges: vscode.Range[] | undefined = configNames.get(configName);
                if (allRanges) {
                    allRanges.push(newRange);
                    configNames.set(configName, allRanges);
                } else {
                    configNames.set(configName, [newRange]);
                }
                allConfigText = allConfigText.substr(configNameEnd + 1);
                allConfigTextOffset += configNameEnd + 1;
                configStart = allConfigText.search(new RegExp(nameRegex));
            }
            for (const [configName, allRanges] of configNames) {
                if (allRanges && allRanges.length > 1) {
                    dupErrorMsg = localize('duplicate.name', "{0} is a duplicate. The configuration name should be unique.", configName);
                    allRanges.forEach(nameRange => {
                        const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                            new vscode.Range(document.positionAt(nameRange.start.character),
                                document.positionAt(nameRange.end.character)),
                            dupErrorMsg, vscode.DiagnosticSeverity.Warning);
                        diagnostics.push(diagnostic);
                    });
                }
            }

            // Get current config text
            configStart = curText.search(new RegExp(`{\\s*"name"\\s*:\\s*"${escapeStringRegExp(currentConfiguration.name)}"`));
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
            const newSquiggleMetrics: { [key: string]: number } = { PathNonExistent: 0, PathNotAFile: 0, PathNotADirectory: 0, CompilerPathMissingQuotes: 0, CompilerModeMismatch: 0 };
            const isWindows: boolean = os.platform() === 'win32';

            // TODO: Add other squiggles.

            // Check if intelliSenseMode and compilerPath are compatible
            if (isWindows) {
                // cl.exe is only available on Windows
                const intelliSenseModeStart: number = curText.search(/\s*\"intelliSenseMode\"\s*:\s*\"/);
                if (intelliSenseModeStart !== -1) {
                    const intelliSenseModeValueStart: number = curText.indexOf('"', curText.indexOf(":", intelliSenseModeStart));
                    const intelliSenseModeValueEnd: number = intelliSenseModeStart === -1 ? -1 : curText.indexOf('"', intelliSenseModeValueStart + 1) + 1;

                    const intelliSenseModeError: string = this.validateIntelliSenseMode(currentConfiguration);
                    if (intelliSenseModeError.length > 0) {
                        const message: string = intelliSenseModeError;
                        const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
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
            let compilerPath: string | undefined;
            for (const pathArray of [ (currentConfiguration.browse ? currentConfiguration.browse.path : undefined),
                currentConfiguration.includePath, currentConfiguration.macFrameworkPath ]) {
                if (pathArray) {
                    for (const curPath of pathArray) {
                        paths.push(`${curPath}`);
                    }
                }
            }
            // Skip the relative forcedInclude files.
            if (currentConfiguration.forcedInclude) {
                for (const file of currentConfiguration.forcedInclude) {
                    const resolvedFilePath: string = this.resolvePath(file, isWindows);
                    if (path.isAbsolute(resolvedFilePath)) {
                        paths.push(`${file}`);
                    }
                }
            }
            if (currentConfiguration.compileCommands) {
                paths.push(`${currentConfiguration.compileCommands}`);
            }

            if (currentConfiguration.compilerPath) {
                // Unlike other cases, compilerPath may not start or end with " due to trimming of whitespace and the possibility of compiler args.
                compilerPath = currentConfiguration.compilerPath;
            }

            // Resolve and split any environment variables
            paths = this.resolveAndSplit(paths, undefined, this.ExtendedEnvironment);
            compilerPath = util.resolveVariables(compilerPath, this.ExtendedEnvironment).trim();
            compilerPath = this.resolvePath(compilerPath, isWindows);

            // Get the start/end for properties that are file-only.
            const forcedIncludeStart: number = curText.search(/\s*\"forcedInclude\"\s*:\s*\[/);
            const forcedeIncludeEnd: number = forcedIncludeStart === -1 ? -1 : curText.indexOf("]", forcedIncludeStart);
            const compileCommandsStart: number = curText.search(/\s*\"compileCommands\"\s*:\s*\"/);
            const compileCommandsEnd: number = compileCommandsStart === -1 ? -1 : curText.indexOf('"', curText.indexOf('"', curText.indexOf(":", compileCommandsStart)) + 1);
            const compilerPathStart: number = curText.search(/\s*\"compilerPath\"\s*:\s*\"/);
            const compilerPathValueStart: number = curText.indexOf('"', curText.indexOf(":", compilerPathStart));
            const compilerPathEnd: number = compilerPathStart === -1 ? -1 : curText.indexOf('"', compilerPathValueStart + 1) + 1;
            const processedPaths: Set<string> = new Set<string>();

            // Validate compiler paths
            let compilerPathNeedsQuotes: boolean = false;
            let compilerMessage: string | undefined;
            const compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(compilerPath);
            const compilerLowerCase: string = compilerPathAndArgs.compilerName.toLowerCase();
            const isClCompiler: boolean = compilerLowerCase === "cl" || compilerLowerCase === "cl.exe";
            // Don't squiggle for invalid cl and cl.exe paths.
            if (compilerPathAndArgs.compilerPath && !isClCompiler) {
                // Squiggle when the compiler's path has spaces without quotes but args are used.
                compilerPathNeedsQuotes = (compilerPathAndArgs.additionalArgs && compilerPathAndArgs.additionalArgs.length > 0)
                    && !compilerPath.startsWith('"')
                    && compilerPathAndArgs.compilerPath.includes(" ");
                compilerPath = compilerPathAndArgs.compilerPath;
                // Don't squiggle if compiler path is resolving with environment path.
                if (compilerPathNeedsQuotes || (compilerPath && !which.sync(compilerPath, { nothrow: true }))) {
                    if (compilerPathNeedsQuotes) {
                        compilerMessage = localize("path.with.spaces", 'Compiler path with spaces and arguments is missing double quotes " around the path.');
                        newSquiggleMetrics.CompilerPathMissingQuotes++;
                    } else if (!util.checkFileExistsSync(compilerPath)) {
                        compilerMessage = localize("path.is.not.a.file", "Path is not a file: {0}", compilerPath);
                        newSquiggleMetrics.PathNotAFile++;
                    }
                }
            }
            const isWSL: boolean = isWindows && compilerPath.startsWith("/");
            let compilerPathExists: boolean = true;
            if (this.rootUri && !isClCompiler) {
                const checkPathExists: any = util.checkPathExistsSync(compilerPath, this.rootUri.fsPath + path.sep, isWindows, isWSL, true);
                compilerPathExists = checkPathExists.pathExists;
                compilerPath = checkPathExists.path;
            }
            if (!compilerPathExists) {
                compilerMessage = localize('cannot.find2', "Cannot find \"{0}\".", compilerPath);
                newSquiggleMetrics.PathNonExistent++;
            }
            if (compilerMessage) {
                const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                    new vscode.Range(document.positionAt(curTextStartOffset + compilerPathValueStart),
                        document.positionAt(curTextStartOffset + compilerPathEnd)),
                    compilerMessage, vscode.DiagnosticSeverity.Warning);
                diagnostics.push(diagnostic);
            }

            // Validate paths
            for (const curPath of paths) {
                if (processedPaths.has(curPath)) {
                    // Avoid duplicate squiggles for the same line.
                    // Squiggles for the same path on different lines are already handled below.
                    continue;
                }
                processedPaths.add(curPath);
                // Resolve special path cases.
                if (curPath === "${default}") {
                    // TODO: Add squiggles for when the C_Cpp.default.* paths are invalid.
                    continue;
                }

                let resolvedPath: string = this.resolvePath(curPath, isWindows);
                if (!resolvedPath) {
                    continue;
                }
                let pathExists: boolean = true;
                if (this.rootUri) {
                    const checkPathExists: any = util.checkPathExistsSync(resolvedPath, this.rootUri.fsPath + path.sep, isWindows, isWSL, false);
                    pathExists = checkPathExists.pathExists;
                    resolvedPath = checkPathExists.path;
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
                const pattern: RegExp = new RegExp(`"[^"]*?(?<="|;)${escapedPath}(?="|;).*?"`, "g");
                const configMatches: string[] | null = curText.match(pattern);
                if (configMatches) {
                    let curOffset: number = 0;
                    let endOffset: number = 0;
                    for (const curMatch of configMatches) {
                        curOffset = curText.substr(endOffset).search(pattern) + endOffset;
                        endOffset = curOffset + curMatch.length;
                        if (curOffset >= compilerPathStart && curOffset <= compilerPathEnd) {
                            continue;
                        }
                        let message: string;
                        if (!pathExists) {
                            if (curOffset >= forcedIncludeStart && curOffset <= forcedeIncludeEnd
                                && !path.isAbsolute(resolvedPath)) {
                                continue; // Skip the error, because it could be resolved recursively.
                            }
                            message = localize('cannot.find2', "Cannot find \"{0}\".", resolvedPath);
                            newSquiggleMetrics.PathNonExistent++;
                        } else {
                            // Check for file versus path mismatches.
                            if ((curOffset >= forcedIncludeStart && curOffset <= forcedeIncludeEnd) ||
                                (curOffset >= compileCommandsStart && curOffset <= compileCommandsEnd)) {
                                if (util.checkFileExistsSync(resolvedPath)) {
                                    continue;
                                }
                                message = localize("path.is.not.a.file", "Path is not a file: {0}", resolvedPath);
                                newSquiggleMetrics.PathNotAFile++;
                            } else {
                                if (util.checkDirectoryExistsSync(resolvedPath)) {
                                    continue;
                                }
                                message = localize("path.is.not.a.directory", "Path is not a directory: {0}", resolvedPath);
                                newSquiggleMetrics.PathNotADirectory++;
                            }
                        }
                        const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                            new vscode.Range(document.positionAt(curTextStartOffset + curOffset),
                                document.positionAt(curTextStartOffset + endOffset)),
                            message, vscode.DiagnosticSeverity.Warning);
                        diagnostics.push(diagnostic);
                    }
                } else if (envText) {
                    const envMatches: string[] | null = envText.match(pattern);
                    if (envMatches) {
                        let curOffset: number = 0;
                        let endOffset: number = 0;
                        for (const curMatch of envMatches) {
                            curOffset = envText.substr(endOffset).search(pattern) + endOffset;
                            endOffset = curOffset + curMatch.length;
                            let message: string;
                            if (!pathExists) {
                                message = localize('cannot.find2', "Cannot find \"{0}\".", resolvedPath);
                                newSquiggleMetrics.PathNonExistent++;
                                const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                                    new vscode.Range(document.positionAt(envTextStartOffSet + curOffset),
                                        document.positionAt(envTextStartOffSet + endOffset)),
                                    message, vscode.DiagnosticSeverity.Warning);
                                diagnostics.push(diagnostic);
                            }
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
            const changedSquiggleMetrics: { [key: string]: number } = {};
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
                const config: Configuration = this.configurationJson.configurations[i];
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
            const settings: CppSettings = new CppSettings(this.rootUri);
            for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
                const config: Configuration = this.configurationJson.configurations[i];

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
        // Set aside IsExplicit values, and restore them after writing.
        const savedCompilerPathIsExplicit: boolean[] = [];
        const savedCStandardIsExplicit: boolean[] = [];
        const savedCppStandardIsExplicit: boolean[] = [];
        const savedIntelliSenseModeIsExplicit: boolean[] = [];

        if (this.configurationJson) {
            this.configurationJson.configurations.forEach(e => {
                savedCompilerPathIsExplicit.push(!!e.compilerPathIsExplicit);
                if (e.compilerPathIsExplicit !== undefined) {
                    delete e.compilerPathIsExplicit;
                }
                savedCStandardIsExplicit.push(!!e.cStandardIsExplicit);
                if (e.cStandardIsExplicit !== undefined) {
                    delete e.cStandardIsExplicit;
                }
                savedCppStandardIsExplicit.push(!!e.cppStandardIsExplicit);
                if (e.cppStandardIsExplicit !== undefined) {
                    delete e.cppStandardIsExplicit;
                }
                savedIntelliSenseModeIsExplicit.push(!!e.intelliSenseModeIsExplicit);
                if (e.intelliSenseModeIsExplicit !== undefined) {
                    delete e.intelliSenseModeIsExplicit;
                }
            });
        }

        console.assert(this.propertiesFile);
        if (this.propertiesFile) {
            fs.writeFileSync(this.propertiesFile.fsPath, jsonc.stringify(this.configurationJson, null, 4));
        }

        if (this.configurationJson) {
            for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
                this.configurationJson.configurations[i].compilerPathIsExplicit = savedCompilerPathIsExplicit[i];
                this.configurationJson.configurations[i].cStandardIsExplicit = savedCStandardIsExplicit[i];
                this.configurationJson.configurations[i].cppStandardIsExplicit = savedCppStandardIsExplicit[i];
                this.configurationJson.configurations[i].intelliSenseModeIsExplicit = savedIntelliSenseModeIsExplicit[i];
            }
        }
    }

    public checkCppProperties(): void {
        // Check for change properties in case of file watcher failure.
        const propertiesFile: string = path.join(this.configFolder, "c_cpp_properties.json");
        fs.stat(propertiesFile, (err, stats) => {
            if (err) {
                if (err.code === "ENOENT" && this.propertiesFile) {
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

    public checkCompileCommands(): void {
        // Check for changes in case of file watcher failure.
        const compileCommands: string | undefined = this.CurrentConfiguration?.compileCommands;
        if (!compileCommands) {
            return;
        }
        const compileCommandsFile: string | undefined = this.resolvePath(compileCommands, os.platform() === "win32");
        fs.stat(compileCommandsFile, (err, stats) => {
            if (err) {
                if (err.code === "ENOENT" && this.compileCommandsFile) {
                    this.compileCommandsFileWatchers = []; // reset file watchers
                    this.onCompileCommandsChanged(compileCommandsFile);
                    this.compileCommandsFile = null; // File deleted
                }
            } else if (stats.mtime > this.compileCommandsFileWatcherFallbackTime) {
                this.compileCommandsFileWatcherFallbackTime = new Date();
                this.onCompileCommandsChanged(compileCommandsFile);
                this.compileCommandsFile = vscode.Uri.file(compileCommandsFile); // File created.
            }
        });
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];

        this.compileCommandsFileWatchers.forEach((watcher: fs.FSWatcher) => watcher.close());
        this.compileCommandsFileWatchers = []; // reset it

        this.diagnosticCollection.dispose();
    }
}
