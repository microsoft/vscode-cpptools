/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as jsonc from 'comment-json';
import * as fastGlob from 'fast-glob';
import * as fs from "fs";
import * as os from 'os';
import * as path from 'path';
import { setTimeout } from 'timers';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as which from 'which';
import { logAndReturn, returns } from '../Utility/Async/returns';
import * as util from '../common';
import { isWindows } from '../constants';
import { getOutputChannelLogger } from '../logger';
import * as telemetry from '../telemetry';
import { DefaultClient } from './client';
import { CustomConfigurationProviderCollection, getCustomConfigProviders } from './customProviders';
import { PersistentFolderState } from './persistentState';
import { CppSettings, OtherSettings } from './settings';
import { SettingsPanel } from './settingsPanel';
import { ConfigurationType, getUI } from './ui';
import escapeStringRegExp = require('escape-string-regexp');

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
    env?: { [key: string]: string | string[] };
    version: number;
    enableConfigurationSquiggles?: boolean;
}

export interface Configuration {
    name: string;
    compilerPathInCppPropertiesJson?: string | null;
    compilerPath?: string; // Can be set to null based on the schema, but it will be fixed in parsePropertiesFile.
    compilerPathIsExplicit?: boolean;
    compilerArgs?: string[];
    compilerArgsLegacy?: string[];
    cStandard?: string;
    cStandardIsExplicit?: boolean;
    cppStandard?: string;
    cppStandardIsExplicit?: boolean;
    includePath?: string[];
    macFrameworkPath?: string[];
    windowsSdkVersion?: string;
    dotConfig?: string;
    defines?: string[];
    intelliSenseMode?: string;
    intelliSenseModeIsExplicit?: boolean;
    compileCommandsInCppPropertiesJson?: string[];
    compileCommands?: string[];
    forcedInclude?: string[];
    configurationProviderInCppPropertiesJson?: string;
    configurationProvider?: string;
    mergeConfigurations?: boolean | string;
    browse?: Browse;
    recursiveIncludes?: RecursiveIncludes;
    customConfigurationVariables?: { [key: string]: string };
    recursiveIncludesReduceIsExplicit?: boolean;
    recursiveIncludesPriorityIsExplicit?: boolean;
    recursiveIncludesOrderIsExplicit?: boolean;
}

export interface ConfigurationErrors {
    name?: string;
    compilerPath?: string;
    includePath?: string;
    intelliSenseMode?: string;
    macFrameworkPath?: string;
    forcedInclude?: string;
    compileCommands?: string;
    dotConfig?: string;
    browsePath?: string;
    databaseFilename?: string;
}

export interface Browse {
    path?: string[];
    limitSymbolsToIncludedHeaders?: boolean | string;
    databaseFilename?: string;
}

export interface RecursiveIncludes {
    reduce?: string;
    priority?: string;
    order?: string;
}

export interface KnownCompiler {
    path: string;
    isC: boolean;
    isTrusted: boolean; // May be used in the future for build tasks.
    isCL: boolean;
}

export interface CompilerDefaults {
    compilerPath: string;
    compilerArgs: string[];
    knownCompilers: KnownCompiler[];
    cStandard: string;
    cppStandard: string;
    windowsSdkVersion: string;
    intelliSenseMode: string;
    trustedCompilerFound: boolean;
}

export class CppProperties {
    private client: DefaultClient;
    private rootUri: vscode.Uri | undefined;
    private propertiesFile: vscode.Uri | undefined | null = undefined; // undefined and null values are handled differently
    private readonly configFolder: string;
    private configurationJson?: ConfigurationJson;
    private currentConfigurationIndex: PersistentFolderState<number> | undefined;
    private configFileWatcher: vscode.FileSystemWatcher | null = null;
    private configFileWatcherFallbackTime: Date = new Date(); // Used when file watching fails.
    private compileCommandsFiles: Set<string> = new Set();
    private compileCommandsFileWatchers: fs.FSWatcher[] = [];
    private compileCommandsFileWatcherFallbackTime: Map<string, Date> = new Map<string, Date>(); // Used when file watching fails.
    private defaultCompilerPath: string | null = null;
    private knownCompilers?: KnownCompiler[];
    private defaultCStandard: string | null = null;
    private defaultCppStandard: string | null = null;
    private defaultWindowsSdkVersion: string | null = null;
    private isCppPropertiesJsonVisible: boolean = false;
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
    private settingsPanel?: SettingsPanel;

    // Any time the default settings are parsed and assigned to `this.configurationJson`,
    // we want to track when the default includes have been added to it.
    private configurationIncomplete: boolean = true;
    trustedCompilerFound: boolean = false;

    constructor(client: DefaultClient, rootUri?: vscode.Uri, workspaceFolder?: vscode.WorkspaceFolder) {
        this.client = client;
        this.rootUri = rootUri;
        const rootPath: string = rootUri ? rootUri.fsPath : "";
        if (workspaceFolder) {
            this.currentConfigurationIndex = new PersistentFolderState<number>("CppProperties.currentConfigurationIndex", -1, workspaceFolder);
        }
        this.configFolder = path.join(rootPath, ".vscode");
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection(rootPath);
        void this.buildVcpkgIncludePath();
        const userSettings: CppSettings = new CppSettings();
        if (userSettings.addNodeAddonIncludePaths) {
            void this.readNodeAddonIncludeLocations(rootPath);
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

    public setupConfigurations(): void {

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
            this.handleConfigurationChange();
        });

        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.fsPath === settingsPath && this.isCppPropertiesJsonVisible) {
                void this.handleSquiggles().catch(logAndReturn.undefined);
            }
        });

        vscode.window.onDidChangeVisibleTextEditors((editors) => {
            const wasVisible: boolean = this.isCppPropertiesJsonVisible;
            editors.forEach(editor => {
                if (editor.document.uri.fsPath === settingsPath) {
                    this.isCppPropertiesJsonVisible = true;
                    if (!wasVisible) {
                        void this.handleSquiggles().catch(logAndReturn.undefined);
                    }
                }
            });
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
    }
    public set CompilerDefaults(compilerDefaults: CompilerDefaults) {
        this.defaultCompilerPath = compilerDefaults.trustedCompilerFound ? compilerDefaults.compilerPath : null;
        this.knownCompilers = compilerDefaults.knownCompilers;
        this.defaultCStandard = compilerDefaults.cStandard;
        this.defaultCppStandard = compilerDefaults.cppStandard;
        this.defaultWindowsSdkVersion = compilerDefaults.windowsSdkVersion;
        this.defaultIntelliSenseMode = compilerDefaults.intelliSenseMode !== "" ? compilerDefaults.intelliSenseMode : undefined;
        this.trustedCompilerFound = compilerDefaults.trustedCompilerFound;
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
        void this.handleSquiggles().catch(logAndReturn.undefined);
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

    private async applyDefaultIncludePathsAndFrameworks() {
        if (this.configurationIncomplete && this.vcpkgPathReady) {
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
        if ((isUnset(settings.defaultWindowsSdkVersion) || settings.defaultWindowsSdkVersion === "") && this.defaultWindowsSdkVersion && process.platform === 'win32') {
            configuration.windowsSdkVersion = this.defaultWindowsSdkVersion;
        }
        if (isUnset(settings.defaultCompilerPath) && this.defaultCompilerPath &&
            (isUnset(settings.defaultCompileCommands) || settings.defaultCompileCommands?.length === 0) &&
            (isUnset(configuration.compileCommands) || configuration.compileCommands?.length === 0)) {
            // compile_commands.json already specifies a compiler. compilerPath overrides the compile_commands.json compiler so
            // don't set a default when compileCommands is in use.

            // if the compiler is a cl.exe compiler, replace the full path with the "cl.exe" string.
            const compiler: string = path.basename(this.defaultCompilerPath).toLowerCase();

            if (compiler === "cl.exe") {
                configuration.compilerPath = "cl.exe";
            } else {
                configuration.compilerPath = this.defaultCompilerPath;
            }
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
        if (!settings.defaultCustomConfigurationVariables || Object.keys(settings.defaultCustomConfigurationVariables).length === 0) {
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
        result["/"] = (os.platform() === 'win32') ? "\\" : "/";
        result["userHome"] = os.homedir();
        if (util.getVcpkgRoot()) {
            result["vcpkgRoot"] = util.getVcpkgRoot();
        }
        return result;
    }

    private async buildVcpkgIncludePath(): Promise<void> {
        try {
            // Check for vcpkgRoot and include relevant paths if found.
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
        } catch (error) { /*ignore*/ } finally {
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
                            let stdout: string = await util.execChildProcess(execCmd, rootPath);
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
        const resolvedCompilerPath: string = this.resolvePath(configuration.compilerPath, false, false);
        const settings: CppSettings = new CppSettings(this.rootUri);
        const compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(!!settings.legacyCompilerArgsBehavior, resolvedCompilerPath);

        const isValid: boolean = (compilerPathAndArgs.compilerName.toLowerCase() === "cl.exe" || compilerPathAndArgs.compilerName.toLowerCase() === "cl") === configuration.intelliSenseMode.includes("msvc")
            // We can't necessarily determine what host compiler nvcc will use, without parsing command line args (i.e. for -ccbin)
            // to determine if the user has set it to something other than the default. So, we don't squiggle IntelliSenseMode when using nvcc.
            || (compilerPathAndArgs.compilerName.toLowerCase() === "nvcc.exe") || (compilerPathAndArgs.compilerName.toLowerCase() === "nvcc");
        if (isValid) {
            return "";
        } else {
            return localize("incompatible.intellisense.mode", "IntelliSense mode {0} is incompatible with compiler path.", configuration.intelliSenseMode);
        }
    }

    public addToIncludePathCommand(path: string): void {
        void this.handleConfigurationEditCommand(() => {
            this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
            const config: Configuration | undefined = this.CurrentConfiguration;
            if (config) {
                telemetry.logLanguageServerEvent("addToIncludePath");
                if (config.includePath === undefined) {
                    config.includePath = ["${default}"];
                }
                config.includePath.splice(config.includePath.length, 0, path);
                this.writeToJson();
            }
            // Any time parsePropertiesFile is called, configurationJson gets
            // reverted to an unprocessed state and needs to be reprocessed.
            this.handleConfigurationChange();
        }, () => { }).catch(logAndReturn.undefined);
    }

    public async updateCompilerPathIfSet(path: string): Promise<void> {
        if (!this.propertiesFile) {
            // Properties file does not exist.
            return;
        }
        return this.handleConfigurationEditJSONCommand(() => {
            this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
            const config: Configuration | undefined = this.CurrentConfiguration;
            // Update compiler path if it's already set.
            if (config && config.compilerPath !== undefined) {
                config.compilerPath = path;
                this.writeToJson();
            }
            // Any time parsePropertiesFile is called, configurationJson gets
            // reverted to an unprocessed state and needs to be reprocessed.
            this.handleConfigurationChange();
        }, returns.undefined);
    }

    public async updateCustomConfigurationProvider(providerId: string): Promise<void> {
        if (!this.propertiesFile) {
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
            return;
        }

        return this.handleConfigurationEditJSONCommand(() => {
            this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
            const config: Configuration | undefined = this.CurrentConfiguration;
            if (config) {
                if (providerId) {
                    config.configurationProvider = providerId;
                } else {
                    delete config.configurationProvider;
                }
                this.writeToJson();
            }
            // Any time parsePropertiesFile is called, configurationJson gets
            // reverted to an unprocessed state and needs to be reprocessed.
            this.handleConfigurationChange();
        }, returns.undefined);

    }

    public setCompileCommands(path: string): Promise<void> {
        return this.handleConfigurationEditJSONCommand(() => {
            this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
            const config: Configuration | undefined = this.CurrentConfiguration;
            if (config) {
                config.compileCommands = [path];
                this.writeToJson();
            }
            // Any time parsePropertiesFile is called, configurationJson gets
            // reverted to an unprocessed state and needs to be reprocessed.
            this.handleConfigurationChange();
        }, returns.undefined);
    }

    public select(index: number): Configuration | undefined {
        if (this.configurationJson) {
            if (index === this.configurationJson.configurations.length) {
                void this.handleConfigurationEditUICommand(() => { }, vscode.window.showTextDocument).catch(logAndReturn.undefined);
                return;
            }
            if (index === this.configurationJson.configurations.length + 1) {
                void this.handleConfigurationEditJSONCommand(() => { }, vscode.window.showTextDocument).catch(logAndReturn.undefined);
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

    private resolveAndSplit(paths: string[] | undefined, defaultValue: string[] | undefined, env: Environment, assumeRelative: boolean = true, glob: boolean = false): string[] {
        const resolvedVariables: string[] = [];
        if (paths === undefined) {
            return resolvedVariables;
        }
        paths = this.resolveDefaults(paths, defaultValue);
        paths.forEach(entry => {
            const resolvedVariable: string = util.resolveVariables(entry, env);
            if (resolvedVariable.includes("env:")) {
                // Do not futher try to resolve a "${env:VAR}"
                resolvedVariables.push(resolvedVariable);
            } else {
                const entries: string[] = resolvedVariable.split(path.delimiter).map(e => glob ? this.resolvePath(e, false, assumeRelative) : e).filter(e => e);
                resolvedVariables.push(...entries);
            }
        });
        if (!glob) {
            return resolvedVariables;
        }
        const resolvedGlob: string[] = [];
        for (let res of resolvedVariables) {
            let counter: number = 0;
            let slashFound: boolean = false;
            const lastIndex: number = res.length - 1;
            // Detect all wildcard variations by looking at last character in the path first.
            for (let i: number = lastIndex; i >= 0; i--) {
                if (res[i] === '*') {
                    counter++;
                } else if (res[i] === '/' || (isWindows && res[i] === '\\')) {
                    counter++;
                    slashFound = true;
                    break;
                } else {
                    break;
                }
            }
            let suffix: string = '';
            if (slashFound) {
                suffix = res.slice(res.length - counter);
                res = res.slice(0, res.length - counter);
            }
            let normalized = res;
            let cwd: string = this.rootUri?.fsPath ?? '';
            if (isWindows) {
                normalized = res.replace(/\\/g, '/');
                cwd = cwd.replace(/\\/g, '/');
            }
            const isGlobPattern: boolean = normalized.includes('*');
            if (isGlobPattern) {
                // fastGlob silently strips non-found paths. Limit that behavior to dynamic paths only.
                const matches: string[] = fastGlob.isDynamicPattern(normalized) ?
                    fastGlob.sync(normalized, { onlyDirectories: true, cwd, suppressErrors: true, deep: 15 }) : [res];
                resolvedGlob.push(...matches.map(s => s + suffix));
                if (resolvedGlob.length === 0) {
                    resolvedGlob.push(normalized);
                }
            } else {
                resolvedGlob.push(normalized + suffix);
            }
        }
        return resolvedGlob;
    }

    private updateConfigurationString(property: string | undefined | null, defaultValue: string | undefined | null, env?: Environment, acceptBlank?: boolean): string | undefined {
        if (property === null || property === undefined || property === "${default}") {
            property = defaultValue;
        }
        if (property === null || property === undefined || (acceptBlank !== true && property === "")) {
            return undefined;
        }
        if (env === undefined) {
            return property;
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

    private updateConfigurationPathsArray(paths: string[] | undefined, defaultValue: string[] | undefined, env: Environment, assumeRelative: boolean = true): string[] | undefined {
        if (paths) {
            return this.resolveAndSplit(paths, defaultValue, env, assumeRelative, true);
        }
        if (!paths && defaultValue) {
            return this.resolveAndSplit(defaultValue, [], env, assumeRelative, true);
        }
        return paths;
    }

    private updateConfigurationBoolean(property: boolean | string | undefined | null, defaultValue: boolean | undefined | null): boolean | undefined {
        if (property === null || property === undefined || property === "${default}") {
            property = defaultValue;
        }

        if (property === null) {
            return undefined;
        }

        return property === true || property === "true";
    }

    private updateConfigurationStringDictionary(property: { [key: string]: string } | undefined, defaultValue: { [key: string]: string } | undefined, env: Environment): { [key: string]: string } | undefined {
        if (!property || Object.keys(property).length === 0) {
            property = defaultValue;
        }
        if (!property || Object.keys(property).length === 0) {
            return undefined;
        }
        return this.resolveDefaultsDictionary(property, defaultValue, env);
    }

    private getDotconfigDefines(dotConfigPath: string): string[] {
        if (dotConfigPath !== undefined) {
            const path: string = this.resolvePath(dotConfigPath);
            try {
                const configContent: string[] = fs.readFileSync(path, "utf-8").split("\n");
                return configContent.filter(i => !i.startsWith("#") && i !== "");
            } catch (errJS) {
                const err: Error = errJS as Error;
                getOutputChannelLogger().appendLine(`Invalid input, cannot resolve .config path: ${err.message}`);
            }
        }

        return [];
    }

    private configProviderAutoSelected: boolean = false;
    public get ConfigProviderAutoSelected(): boolean {
        return this.configProviderAutoSelected;
    }

    private updateServerOnFolderSettingsChange(): void {
        this.configProviderAutoSelected = false;
        if (!this.configurationJson) {
            return;
        }
        const settings: CppSettings = new CppSettings(this.rootUri);
        const userSettings: CppSettings = new CppSettings();
        const env: Environment = this.ExtendedEnvironment;
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            const configuration: Configuration = this.configurationJson.configurations[i];
            configuration.compilerPathInCppPropertiesJson = configuration.compilerPath;
            configuration.compileCommandsInCppPropertiesJson = configuration.compileCommands;
            configuration.configurationProviderInCppPropertiesJson = configuration.configurationProvider;
            configuration.includePath = this.updateConfigurationPathsArray(configuration.includePath, settings.defaultIncludePath, env);
            // in case includePath is reset below
            const origIncludePath: string[] | undefined = configuration.includePath;
            if (userSettings.addNodeAddonIncludePaths) {
                const includePath: string[] = origIncludePath || [];
                configuration.includePath = includePath.concat(this.nodeAddonIncludes.filter(i => includePath.indexOf(i) < 0));
            }
            configuration.defines = this.updateConfigurationStringArray(configuration.defines, settings.defaultDefines, env);

            // in case we have dotConfig
            configuration.dotConfig = this.updateConfigurationString(configuration.dotConfig, settings.defaultDotconfig, env);
            if (configuration.dotConfig !== undefined) {
                configuration.defines = configuration.defines || [];
                configuration.defines = configuration.defines.concat(this.getDotconfigDefines(configuration.dotConfig));
            }

            configuration.macFrameworkPath = this.updateConfigurationStringArray(configuration.macFrameworkPath, settings.defaultMacFrameworkPath, env);
            configuration.windowsSdkVersion = this.updateConfigurationString(configuration.windowsSdkVersion, settings.defaultWindowsSdkVersion, env);
            configuration.forcedInclude = this.updateConfigurationPathsArray(configuration.forcedInclude, settings.defaultForcedInclude, env, false);
            configuration.compileCommands = this.updateConfigurationStringArray(configuration.compileCommands, settings.defaultCompileCommands, env);
            configuration.compilerArgs = this.updateConfigurationStringArray(configuration.compilerArgs, settings.defaultCompilerArgs, env);
            configuration.cStandard = this.updateConfigurationString(configuration.cStandard, settings.defaultCStandard, env);
            configuration.cppStandard = this.updateConfigurationString(configuration.cppStandard, settings.defaultCppStandard, env);
            configuration.intelliSenseMode = this.updateConfigurationString(configuration.intelliSenseMode, settings.defaultIntelliSenseMode, env);
            configuration.intelliSenseModeIsExplicit = configuration.intelliSenseModeIsExplicit || settings.defaultIntelliSenseMode !== "";
            configuration.cStandardIsExplicit = configuration.cStandardIsExplicit || settings.defaultCStandard !== "";
            configuration.cppStandardIsExplicit = configuration.cppStandardIsExplicit || settings.defaultCppStandard !== "";
            configuration.mergeConfigurations = this.updateConfigurationBoolean(configuration.mergeConfigurations, settings.defaultMergeConfigurations);
            if (!configuration.recursiveIncludes) {
                configuration.recursiveIncludes = {};
            }
            configuration.recursiveIncludes.reduce = this.updateConfigurationString(configuration.recursiveIncludes.reduce, settings.defaultRecursiveIncludesReduce);
            configuration.recursiveIncludesReduceIsExplicit = configuration.recursiveIncludesReduceIsExplicit || settings.defaultRecursiveIncludesReduce !== "";
            configuration.recursiveIncludes.priority = this.updateConfigurationString(configuration.recursiveIncludes.priority, settings.defaultRecursiveIncludesPriority);
            configuration.recursiveIncludesPriorityIsExplicit = configuration.recursiveIncludesPriorityIsExplicit || settings.defaultRecursiveIncludesPriority !== "";
            configuration.recursiveIncludes.order = this.updateConfigurationString(configuration.recursiveIncludes.order, settings.defaultRecursiveIncludesOrder);
            configuration.recursiveIncludesOrderIsExplicit = configuration.recursiveIncludesOrderIsExplicit || settings.defaultRecursiveIncludesOrder !== "";
            if (!configuration.compileCommands) {
                // compile_commands.json already specifies a compiler. compilerPath overrides the compile_commands.json compiler so
                // don't set a default when compileCommands is in use.
                configuration.compilerPath = this.updateConfigurationString(configuration.compilerPath, settings.defaultCompilerPath, env, true);
                configuration.compilerPathIsExplicit = configuration.compilerPathIsExplicit || settings.defaultCompilerPath !== null;
                if (configuration.compilerPath === undefined) {
                    if (!!this.defaultCompilerPath && this.trustedCompilerFound) {
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
                    }
                } else {
                    // add compiler to list of trusted compilers
                    if (i === this.CurrentConfigurationIndex) {
                        void this.client.addTrustedCompiler(configuration.compilerPath).catch(logAndReturn.undefined);
                    }
                }
            } else {
                // However, if compileCommands are used and compilerPath is explicitly set, it's still necessary to resolve variables in it.
                if (configuration.compilerPath === "${default}") {
                    configuration.compilerPath = settings.defaultCompilerPath ?? undefined;
                    configuration.compilerPathIsExplicit = true;
                }
                if (configuration.compilerPath) {
                    configuration.compilerPath = util.resolveVariables(configuration.compilerPath, env);
                    configuration.compilerPathIsExplicit = true;
                } else if (configuration.compilerPathIsExplicit === undefined) {
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
                }
                // Otherwise, if the browse path is not set, let the native process populate it
                // with include paths, including any parsed from compilerArgs.
            } else {
                configuration.browse.path = this.updateConfigurationPathsArray(configuration.browse.path, settings.defaultBrowsePath, env);
            }

            configuration.browse.limitSymbolsToIncludedHeaders = this.updateConfigurationBoolean(configuration.browse.limitSymbolsToIncludedHeaders, settings.defaultLimitSymbolsToIncludedHeaders);
            configuration.browse.databaseFilename = this.updateConfigurationString(configuration.browse.databaseFilename, settings.defaultDatabaseFilename, env);

            if (i === this.CurrentConfigurationIndex) {
                // If there is no c_cpp_properties.json, there are no relevant C_Cpp.default.* settings set,
                // and there is only 1 registered custom config provider, default to using that provider.
                const providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
                const hasEmptyConfiguration: boolean = !this.propertiesFile
                    && !settings.defaultIncludePath
                    && !settings.defaultDefines
                    && !settings.defaultMacFrameworkPath
                    && !settings.defaultWindowsSdkVersion
                    && !settings.defaultForcedInclude
                    && !settings.defaultCompileCommands
                    && !settings.defaultCompilerArgs
                    && !settings.defaultCStandard
                    && !settings.defaultCppStandard
                    && settings.defaultIntelliSenseMode === ""
                    && !settings.defaultConfigurationProvider;

                // Only keep a cached custom browse config if there is an empty configuration,
                // or if a specified provider ID has not changed.
                let keepCachedBrowseConfig: boolean = true;
                if (hasEmptyConfiguration) {
                    if (providers.size === 1) {
                        providers.forEach(provider => { configuration.configurationProvider = provider.extensionId; });
                        this.configProviderAutoSelected = true;
                        if (this.client.lastCustomBrowseConfigurationProviderId !== undefined) {
                            keepCachedBrowseConfig = configuration.configurationProvider === this.client.lastCustomBrowseConfigurationProviderId.Value;
                        }
                    } else if (providers.size > 1) {
                        keepCachedBrowseConfig = false;
                    }
                } else if (this.client.lastCustomBrowseConfigurationProviderId !== undefined) {
                    keepCachedBrowseConfig = configuration.configurationProvider === this.client.lastCustomBrowseConfigurationProviderId.Value;
                }
                if (!keepCachedBrowseConfig && this.client.lastCustomBrowseConfiguration !== undefined) {
                    this.client.lastCustomBrowseConfiguration.Value = undefined;
                    if (this.client.lastCustomBrowseConfigurationProviderId) {
                        this.client.lastCustomBrowseConfigurationProviderId.Value = undefined;
                    }
                }

                const showButtonSender: string = "configChange";
                if (configuration.configurationProvider !== undefined) {
                    const configType: ConfigurationType = this.configProviderAutoSelected ? ConfigurationType.AutoConfigProvider : ConfigurationType.ConfigProvider;
                    void getUI().ShowConfigureIntelliSenseButton(false, this.client, configType, showButtonSender);
                } else if (configuration.compileCommands !== undefined) {
                    void getUI().ShowConfigureIntelliSenseButton(false, this.client, ConfigurationType.CompileCommands, showButtonSender);
                } else if (configuration.compilerPath !== undefined) {
                    const configType: ConfigurationType = configuration.compilerPathIsExplicit ? ConfigurationType.CompilerPath : ConfigurationType.AutoCompilerPath;
                    void getUI().ShowConfigureIntelliSenseButton(false, this.client, configType, showButtonSender);
                }
            }

            /*
             * Ensure all paths are absolute
             */
            if (configuration.macFrameworkPath) {
                configuration.macFrameworkPath = configuration.macFrameworkPath.map((path: string) => this.resolvePath(path));
            }

            if (configuration.dotConfig) {
                configuration.dotConfig = this.resolvePath(configuration.dotConfig);
            }

            if (configuration.compileCommands) {
                configuration.compileCommands = configuration.compileCommands.map((path: string) => this.resolvePath(path));
                configuration.compileCommands.forEach((path: string) => {
                    if (!this.compileCommandsFileWatcherFallbackTime.has(path)) {
                        // Start tracking the fallback time for a new path.
                        this.compileCommandsFileWatcherFallbackTime.set(path, new Date());
                    }
                });
            }

            if (configuration.forcedInclude) {
                configuration.forcedInclude = configuration.forcedInclude.map((path: string) => this.resolvePath(path, true, false));
            }

            if (configuration.includePath) {
                configuration.includePath = configuration.includePath.map((path: string) => this.resolvePath(path, false));
            }
        }

        this.clearStaleCompileCommandsFileWatcherFallbackTimes();
        this.updateCompileCommandsFileWatchers();
        if (!this.configurationIncomplete) {
            this.onConfigurationsChanged();
        }
    }

    private clearStaleCompileCommandsFileWatcherFallbackTimes(): void {
        // We need to keep track of relevant timestamps, so we cannot simply clear all entries.
        // Instead, we clear entries that are no longer relevant.
        const trackedCompileCommandsPaths: Set<string> = new Set();
        this.configurationJson?.configurations.forEach((config: Configuration) => {
            config.compileCommands?.forEach((path: string) => {
                const compileCommandsFile = this.resolvePath(path);
                if (compileCommandsFile.length > 0) {
                    trackedCompileCommandsPaths.add(compileCommandsFile);
                }
            });
        });

        for (const path of this.compileCommandsFileWatcherFallbackTime.keys()) {
            if (!trackedCompileCommandsPaths.has(path)) {
                this.compileCommandsFileWatcherFallbackTime.delete(path);
            }
        }
    }

    private compileCommandsFileWatcherTimer?: NodeJS.Timeout;
    private compileCommandsFileWatcherFiles: Set<string> = new Set<string>();

    // Dispose existing and loop through cpp and populate with each file (exists or not) as you go.
    // paths are expected to have variables resolved already
    public updateCompileCommandsFileWatchers(): void {
        if (this.configurationJson) {
            this.compileCommandsFileWatchers.forEach((watcher: fs.FSWatcher) => watcher.close());
            this.compileCommandsFileWatchers = []; // reset it
            const filePaths: Set<string> = new Set<string>();
            this.configurationJson.configurations.forEach(c => {
                c.compileCommands?.forEach((path: string) => {
                    const compileCommandsFile: string = this.resolvePath(path);
                    if (fs.existsSync(compileCommandsFile)) {
                        filePaths.add(compileCommandsFile);
                    }
                });
            });
            try {
                filePaths.forEach((path: string) => {
                    this.compileCommandsFileWatchers.push(fs.watch(path, () => {
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
    public async handleConfigurationEditCommand(onBeforeOpen: (() => void) | undefined, showDocument: ((document: vscode.TextDocument, column?: vscode.ViewColumn) => Thenable<vscode.TextEditor>) | (() => void), viewColumn?: vscode.ViewColumn): Promise<void> {
        const otherSettings: OtherSettings = new OtherSettings(this.rootUri);
        if (otherSettings.workbenchSettingsEditor === "ui") {
            await this.handleConfigurationEditUICommand(onBeforeOpen, showDocument, viewColumn);
        } else {
            await this.handleConfigurationEditJSONCommand(onBeforeOpen, showDocument, viewColumn);
        }
    }

    // onBeforeOpen will be called after c_cpp_properties.json have been created (if it did not exist), but before the document is opened.
    public async handleConfigurationEditJSONCommand(onBeforeOpen: (() => void) | undefined, showDocument: ((document: vscode.TextDocument, column?: vscode.ViewColumn) => Thenable<vscode.TextEditor>) | (() => void), viewColumn?: vscode.ViewColumn): Promise<void> {
        await this.ensurePropertiesFile();
        console.assert(this.propertiesFile);
        if (onBeforeOpen) {
            onBeforeOpen();
        }
        // Directly open the json file
        if (this.propertiesFile) {
            const document: vscode.TextDocument = await vscode.workspace.openTextDocument(this.propertiesFile);
            if (showDocument) {
                await showDocument(document, viewColumn);
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
                    void this.onSettingsPanelActivated().catch(logAndReturn.undefined);
                }
            });
            this.settingsPanel.ConfigValuesChanged(() => this.saveConfigurationUI());
            this.settingsPanel.ConfigSelectionChanged(() => this.onConfigSelectionChanged());
            this.settingsPanel.AddConfigRequested((e) => this.onAddConfigRequested(e));
            this.disposables.push(this.settingsPanel);
        }
    }

    // onBeforeOpen will be called after c_cpp_properties.json have been created (if it did not exist), but before the document is opened.
    public async handleConfigurationEditUICommand(onBeforeOpen: (() => void) | undefined, showDocument: ((document: vscode.TextDocument, column?: vscode.ViewColumn) => Thenable<vscode.TextEditor>) | (() => void), viewColumn?: vscode.ViewColumn): Promise<void> {
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
                    void showDocument(document, viewColumn);
                }
            }
            // Any time parsePropertiesFile is called, configurationJson gets
            // reverted to an unprocessed state and needs to be reprocessed.
            this.handleConfigurationChange();
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
                        void vscode.workspace.openTextDocument(this.propertiesFile).then(undefined, logAndReturn.undefined);
                    }
                }
                // Any time parsePropertiesFile is called, configurationJson gets
                // reverted to an unprocessed state and needs to be reprocessed.
                this.handleConfigurationChange();
            }
        }
    }

    private trimPathWhitespace(paths: string[] | undefined): string[] | undefined {
        if (paths === undefined) {
            return undefined;
        }
        const trimmedPaths = [];
        for (const value of paths) {
            const fullPath = this.resolvePath(value);
            if (fs.existsSync(fullPath.trim()) && !fs.existsSync(fullPath)) {
                trimmedPaths.push(value.trim());
            } else {
                trimmedPaths.push(value);
            }
        }
        return trimmedPaths;
    }

    private saveConfigurationUI(): void {
        this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
        if (this.settingsPanel && this.configurationJson) {
            const config: Configuration = this.settingsPanel.getLastValuesFromConfigUI();
            this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex] = config;
            this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex].includePath = this.trimPathWhitespace(this.configurationJson.configurations[this.settingsPanel.selectedConfigIndex].includePath);
            this.settingsPanel.updateErrors(this.getErrorsForConfigUI(this.settingsPanel.selectedConfigIndex));
            this.writeToJson();
        }
        // Any time parsePropertiesFile is called, configurationJson gets
        // reverted to an unprocessed state and needs to be reprocessed.
        this.handleConfigurationChange();
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
        // Any time parsePropertiesFile is called, configurationJson gets
        // reverted to an unprocessed state and needs to be reprocessed.
        this.handleConfigurationChange();
    }

    public handleConfigurationChange(): void {
        if (this.propertiesFile === undefined) {
            return; // Occurs when propertiesFile hasn't been checked yet.
        }
        this.configFileWatcherFallbackTime = new Date();
        if (this.parsePropertiesFile() && this.configurationJson) {
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

        if (!this.configurationJson) {
            this.resetToDefaultSettings(true); // I don't think there's a case where this will be hit anymore.
        }

        void this.applyDefaultIncludePathsAndFrameworks().catch(logAndReturn.undefined);
        this.updateServerOnFolderSettingsChange();
    }

    private async ensurePropertiesFile(): Promise<void> {
        if (this.propertiesFile && await util.checkFileExists(this.propertiesFile.fsPath)) {
            return;
        } else {
            try {
                if (!await util.checkDirectoryExists(this.configFolder)) {
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
                void this.applyDefaultIncludePathsAndFrameworks().catch(logAndReturn.undefined);
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
                void vscode.window.showErrorMessage(`${failedToCreate}: ${err.message}`);
            }
        }
        return;
    }

    private forceCompileCommandsAsArray(compileCommandsInCppPropertiesJson: any): string[] | undefined {
        if (util.isString(compileCommandsInCppPropertiesJson) && compileCommandsInCppPropertiesJson.length > 0) {
            return [compileCommandsInCppPropertiesJson];
        } else if (util.isArrayOfString(compileCommandsInCppPropertiesJson)) {
            const filteredArray: string[] = compileCommandsInCppPropertiesJson.filter(value => value.length > 0);
            if (filteredArray.length > 0) {
                return filteredArray;
            }
        }
        return undefined;
    }

    private parsePropertiesFile(): boolean {
        if (!this.propertiesFile) {
            this.configurationJson = undefined;
            return false;
        }
        let success: boolean = true;
        try {
            const readResults: string = fs.readFileSync(this.propertiesFile.fsPath, 'utf8');
            if (readResults === "") {
                return false; // Repros randomly when the file is initially created. The parse will get called again after the file is written.
            }

            // Try to use the same configuration as before the change.
            // TODO?: Handle when jsonc.parse() throws an exception due to invalid JSON contents.
            const newJson: ConfigurationJson = jsonc.parse(readResults, undefined, true) as any;
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

            // Special sanitization of the newly parsed configuration file happens here:
            for (let i: number = 0; i < newJson.configurations.length; i++) {
                // Configuration.compileCommands is allowed to be defined as a string in the schema, but we send an array to the language server.
                // For having a predictable behavior, we convert it here to an array of strings.
                newJson.configurations[i].compileCommands = this.forceCompileCommandsAsArray(<any>newJson.configurations[i].compileCommands);

                // `compilerPath` is allowed to be set to null in the schema so that empty string is not the default value (which has another meaning).
                // If we detect this, we treat it as undefined.
                if (newJson.configurations[i].compilerPath === null) {
                    delete newJson.configurations[i].compilerPath;
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
                delete this.configurationJson.env.workspaceRoot;
                delete this.configurationJson.env.workspaceFolder;
                delete this.configurationJson.env.workspaceFolderBasename;
                delete this.configurationJson.env.execPath;
                delete this.configurationJson.env.pathSeparator;
                delete this.configurationJson.env.default;
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
                    void vscode.window.showErrorMessage(localize("unknown.properties.version", 'Unknown version number found in c_cpp_properties.json. Some features may not work as expected.'));
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
                    || (this.configurationJson.configurations[i].intelliSenseModeIsExplicit !== undefined)
                    || (this.configurationJson.configurations[i].recursiveIncludesReduceIsExplicit !== undefined)
                    || (this.configurationJson.configurations[i].recursiveIncludesPriorityIsExplicit !== undefined)
                    || (this.configurationJson.configurations[i].recursiveIncludesOrderIsExplicit !== undefined)) {
                    dirty = true;
                    break;
                }
            }

            if (dirty) {
                try {
                    this.writeToJson();
                } catch (err) {
                    // Ignore write errors, the file may be under source control. Updated settings will only be modified in memory.
                    void vscode.window.showWarningMessage(localize('update.properties.failed', 'Attempt to update "{0}" failed (do you have write access?)', this.propertiesFile.fsPath));
                    success = false;
                }
            }

            this.configurationJson.configurations.forEach(e => {
                e.compilerPathIsExplicit = e.compilerPath !== undefined;
                e.cStandardIsExplicit = e.cStandard !== undefined;
                e.cppStandardIsExplicit = e.cppStandard !== undefined;
                e.intelliSenseModeIsExplicit = e.intelliSenseMode !== undefined;
                e.recursiveIncludesReduceIsExplicit = e.recursiveIncludes?.reduce !== undefined;
                e.recursiveIncludesPriorityIsExplicit = e.recursiveIncludes?.priority !== undefined;
                e.recursiveIncludesOrderIsExplicit = e.recursiveIncludes?.order !== undefined;
            });

        } catch (errJS) {
            const err: Error = errJS as Error;
            const failedToParse: string = localize("failed.to.parse.properties", 'Failed to parse "{0}"', this.propertiesFile.fsPath);
            void vscode.window.showErrorMessage(`${failedToParse}: ${err.message}`);
            success = false;
        }

        return success;
    }

    private resolvePath(input_path: string | undefined | null, replaceAsterisks: boolean = true, assumeRelative: boolean = true): string {
        if (!input_path || input_path === "${default}") {
            return "";
        }

        let result: string = "";

        // first resolve variables
        result = util.resolveVariables(input_path, this.ExtendedEnvironment);
        if (this.rootUri) {
            if (result.includes("${workspaceFolder}")) {
                result = result.replace("${workspaceFolder}", this.rootUri.fsPath);
            }
            if (result.includes("${workspaceRoot}")) {
                result = result.replace("${workspaceRoot}", this.rootUri.fsPath);
            }
        }

        if (replaceAsterisks && result.includes("*")) {
            result = result.replace(/\*/g, "");
        }

        if (assumeRelative) {
            let quoted = false;
            if (result.startsWith('"') && result.endsWith('"')) {
                quoted = true;
                result = result.slice(1, -1);
            }
            // On Windows, isAbsolute does not handle root paths without a slash, such as "C:"
            const isWindowsRootPath: boolean = process.platform === 'win32' && /^[a-zA-Z]:$/.test(result);
            // Make sure all paths result to an absolute path.
            // Do not add the root path to an unresolved env variable.
            if (!isWindowsRootPath && !result.includes("env:") && !path.isAbsolute(result) && this.rootUri) {
                result = path.join(this.rootUri.fsPath, result);
            }
            if (quoted) {
                result = `"${result}"`;
            }
        }

        return result;
    }

    /**
     * Get the compilerPath and args from a compilerPath string that has already passed through
     * `this.resolvePath`. If there are errors processing the path, those will also be returned.
     *
     * @param resolvedCompilerPath a compilerPath string that has already been resolved.
     * @param rootUri the workspace folder URI, if any.
     */
    public static validateCompilerPath(resolvedCompilerPath: string, rootUri?: vscode.Uri): util.CompilerPathAndArgs {
        if (!resolvedCompilerPath) {
            return { compilerName: '', allCompilerArgs: [], compilerArgsFromCommandLineInPath: [] };
        }
        resolvedCompilerPath = resolvedCompilerPath.trim();

        const settings = new CppSettings(rootUri);
        const compilerPathAndArgs = util.extractCompilerPathAndArgs(!!settings.legacyCompilerArgsBehavior, resolvedCompilerPath, undefined, rootUri?.fsPath);
        const compilerLowerCase: string = compilerPathAndArgs.compilerName.toLowerCase();
        const isCl: boolean = compilerLowerCase === "cl" || compilerLowerCase === "cl.exe";
        const telemetry: { [key: string]: number } = {};

        // Don't error cl.exe paths because it could be for an older preview build.
        if (!isCl && compilerPathAndArgs.compilerPath) {
            const compilerPathMayNeedQuotes: boolean = !resolvedCompilerPath.startsWith('"') && resolvedCompilerPath.includes(" ") && compilerPathAndArgs.compilerArgsFromCommandLineInPath.length > 0;
            let pathExists: boolean = true;
            const existsWithExeAdded: (path: string) => boolean = (path: string) => isWindows && !path.startsWith("/") && fs.existsSync(path + ".exe");

            resolvedCompilerPath = compilerPathAndArgs.compilerPath;
            if (!fs.existsSync(resolvedCompilerPath)) {
                if (existsWithExeAdded(resolvedCompilerPath)) {
                    resolvedCompilerPath += ".exe";
                } else {
                    const pathLocation = which.sync(resolvedCompilerPath, { nothrow: true });
                    if (pathLocation) {
                        resolvedCompilerPath = pathLocation;
                        compilerPathAndArgs.compilerPath = pathLocation;
                    } else if (rootUri) {
                        // Test if it was a relative path.
                        const absolutePath: string = rootUri.fsPath + path.sep + resolvedCompilerPath;
                        if (!fs.existsSync(absolutePath)) {
                            if (existsWithExeAdded(absolutePath)) {
                                resolvedCompilerPath = absolutePath + ".exe";
                            } else {
                                pathExists = false;
                            }
                        } else {
                            resolvedCompilerPath = absolutePath;
                        }
                    }
                }
            }

            const compilerPathErrors: string[] = [];
            if (compilerPathMayNeedQuotes && !pathExists) {
                compilerPathErrors.push(localize("path.with.spaces", 'Compiler path with spaces could not be found. If this was intended to include compiler arguments, surround the compiler path with double quotes (").'));
                telemetry.CompilerPathMissingQuotes = 1;
            }

            if (!pathExists) {
                const message: string = localize('cannot.find', "Cannot find: {0}", resolvedCompilerPath);
                compilerPathErrors.push(message);
                telemetry.PathNonExistent = 1;
            } else if (!util.checkExecutableWithoutExtensionExistsSync(resolvedCompilerPath)) {
                const message: string = localize("path.is.not.a.file", "Path is not a file: {0}", resolvedCompilerPath);
                compilerPathErrors.push(message);
                telemetry.PathNotAFile = 1;
            }

            if (compilerPathErrors.length > 0) {
                compilerPathAndArgs.error = compilerPathErrors.join('\n');
            }
        }
        compilerPathAndArgs.telemetry = telemetry;
        return compilerPathAndArgs;
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
        let resolvedCompilerPath: string | undefined | null;
        // Validate compilerPath
        if (!resolvedCompilerPath) {
            resolvedCompilerPath = this.resolvePath(config.compilerPath, false, false);
        }
        const compilerPathAndArgs: util.CompilerPathAndArgs = CppProperties.validateCompilerPath(resolvedCompilerPath, this.rootUri);
        errors.compilerPath = compilerPathAndArgs.error;

        // Validate paths (directories)
        errors.includePath = this.validatePath(config.includePath, { globPaths: true });
        errors.macFrameworkPath = this.validatePath(config.macFrameworkPath);
        errors.browsePath = this.validatePath(config.browse ? config.browse.path : undefined);

        // Validate files
        errors.forcedInclude = this.validatePath(config.forcedInclude, { isDirectory: false, assumeRelative: false });
        errors.compileCommands = this.validatePath(config.compileCommands, { isDirectory: false });
        errors.dotConfig = this.validatePath(config.dotConfig, { isDirectory: false });
        errors.databaseFilename = this.validatePath(config.browse ? config.browse.databaseFilename : undefined, { isDirectory: false });

        // Validate intelliSenseMode
        if (isWindows) {
            const intelliSenesModeError: string = this.validateIntelliSenseMode(config);
            if (intelliSenesModeError.length > 0) {
                errors.intelliSenseMode = intelliSenesModeError;
            }
        }

        return errors;
    }

    private validatePath(input: string | string[] | undefined, { isDirectory = true, assumeRelative = true, globPaths = false } = {}): string | undefined {
        if (!input) {
            return undefined;
        }

        let errorMsg: string | undefined;
        const errors: string[] = [];
        let paths: string[] = [];

        if (util.isString(input)) {
            paths.push(input);
        } else {
            paths = input;
        }

        // Resolve and split any environment variables
        paths = this.resolveAndSplit(paths, undefined, this.ExtendedEnvironment, assumeRelative, globPaths);

        for (const p of paths) {
            let pathExists: boolean = true;
            let quotedPath: boolean = false;
            let resolvedPath: string = this.resolvePath(p);
            if (!resolvedPath) {
                continue;
            }

            // Check if resolved path exists
            if (!fs.existsSync(resolvedPath)) {
                if (resolvedPath.match(/".*"/) !== null) {
                    pathExists = false;
                    quotedPath = true;
                } else if (assumeRelative && !path.isAbsolute(resolvedPath)) {
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
                let message: string = localize('cannot.find', "Cannot find: {0}", resolvedPath);
                if (quotedPath) {
                    message += '. ' + localize('wrapped.with.quotes', 'Do not add extra quotes around paths.');
                }
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

    private async handleSquiggles(): Promise<void> {
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
        if ((this.configurationJson.enableConfigurationSquiggles === false) ||
            (this.configurationJson.enableConfigurationSquiggles === undefined && !settings.defaultEnableConfigurationSquiggles)) {
            this.diagnosticCollection.clear();
            return;
        }
        const document = await vscode.workspace.openTextDocument(this.propertiesFile);

        const diagnostics: vscode.Diagnostic[] = new Array<vscode.Diagnostic>();

        // Get the text of the current configuration.
        let curText: string = document.getText();

        // Replace all \<escape character> with \\<character>, except for \"
        // Otherwise, the JSON.parse result will have the \<escape character> missing.
        const configurationsText: string = util.escapeForSquiggles(curText);
        // TODO?: Handle when jsonc.parse() throws an exception due to invalid JSON contents.
        const configurations: ConfigurationJson = jsonc.parse(configurationsText, undefined, true) as any;
        const currentConfiguration: Configuration = configurations.configurations[this.CurrentConfigurationIndex];

        // Configuration.compileCommands is allowed to be defined as a string in the schema, but we send an array to the language server.
        // For having a predictable behavior, we convert it here to an array of strings.
        // Squiggles are still handled for both cases.
        currentConfiguration.compileCommands = this.forceCompileCommandsAsArray(<any>currentConfiguration.compileCommands);

        let curTextStartOffset: number = 0;
        if (!currentConfiguration.name) {
            return;
        }

        // Get env text
        let envText: string = "";
        const envStart: number = curText.search(/\"env\"\s*:\s*\{/);
        if (envStart >= 0) {
            const envEnd: number = curText.indexOf("},", envStart);
            if (envEnd >= 0) {
                envText = curText.substring(envStart, envEnd);
            }
        }
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
            allConfigText = allConfigText.substring(configStart);
            allConfigTextOffset += configStart;
            configNameStart = allConfigText.indexOf('"', allConfigText.indexOf(':') + 1) + 1;
            configNameEnd = allConfigText.indexOf('"', configNameStart);
            configName = allConfigText.substring(configNameStart, configNameEnd);
            const newRange: vscode.Range = new vscode.Range(0, allConfigTextOffset + configNameStart, 0, allConfigTextOffset + configNameEnd);
            const allRanges: vscode.Range[] | undefined = configNames.get(configName);
            if (allRanges) {
                allRanges.push(newRange);
                configNames.set(configName, allRanges);
            } else {
                configNames.set(configName, [newRange]);
            }
            allConfigText = allConfigText.substring(configNameEnd + 1);
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
        curText = curText.substring(curTextStartOffset); // Remove earlier configs.
        const nameEnd: number = curText.indexOf(":");
        curTextStartOffset += nameEnd + 1;
        curText = curText.substring(nameEnd + 1);
        const nextNameStart: number = curText.search(new RegExp('"name"\\s*:\\s*"'));
        if (nextNameStart !== -1) {
            curText = curText.substring(0, nextNameStart + 6); // Remove later configs.
            const nextNameStart2: number = curText.search(new RegExp('\\s*}\\s*,\\s*{\\s*"name"'));
            if (nextNameStart2 === -1) {
                telemetry.logLanguageServerEvent("ConfigSquiggles", { "error": "next config name not first" });
                return;
            }
            curText = curText.substring(0, nextNameStart2);
        }
        if (this.prevSquiggleMetrics.get(currentConfiguration.name) === undefined) {
            this.prevSquiggleMetrics.set(currentConfiguration.name, { PathNonExistent: 0, PathNotAFile: 0, PathNotADirectory: 0, CompilerPathMissingQuotes: 0, CompilerModeMismatch: 0, MultiplePathsNotAllowed: 0, MultiplePathsShouldBeSeparated: 0 });
        }
        const newSquiggleMetrics: { [key: string]: number } = { PathNonExistent: 0, PathNotAFile: 0, PathNotADirectory: 0, CompilerPathMissingQuotes: 0, CompilerModeMismatch: 0, MultiplePathsNotAllowed: 0, MultiplePathsShouldBeSeparated: 0 };
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
        const paths: string[] = [];
        for (const pathArray of [currentConfiguration.browse ? currentConfiguration.browse.path : undefined, currentConfiguration.includePath, currentConfiguration.macFrameworkPath]) {
            if (pathArray) {
                for (const curPath of pathArray) {
                    paths.push(`${curPath}`);
                }
            }
        }
        // Skip the relative forcedInclude files.
        if (currentConfiguration.forcedInclude) {
            for (const file of currentConfiguration.forcedInclude) {
                const resolvedFilePath: string = this.resolvePath(file);
                if (path.isAbsolute(resolvedFilePath)) {
                    paths.push(`${file}`);
                }
            }
        }

        currentConfiguration.compileCommands?.forEach((file: string) => {
            paths.push(`${file}`);
        });

        // Get the start/end for properties that are file-only.
        const forcedIncludeStart: number = curText.search(/\s*\"forcedInclude\"\s*:\s*\[/);
        const forcedeIncludeEnd: number = forcedIncludeStart === -1 ? -1 : curText.indexOf("]", forcedIncludeStart);
        const compileCommandsStart: number = curText.search(/\s*\"compileCommands\"\s*:\s*\"/);
        const compileCommandsEnd: number = compileCommandsStart === -1 ? -1 : curText.indexOf('"', curText.indexOf('"', curText.indexOf(":", compileCommandsStart)) + 1);
        const compileCommandsArrayStart: number = curText.search(/\s*\"compileCommands\"\s*:\s*\[/);
        const compileCommandsArrayEnd: number = compileCommandsArrayStart === -1 ? -1 : curText.indexOf("]", curText.indexOf("[", curText.indexOf(":", compileCommandsArrayStart)) + 1);
        const compilerPathStart: number = curText.search(/\s*\"compilerPath\"\s*:\s*\"/);
        const compilerPathValueStart: number = curText.indexOf('"', curText.indexOf(":", compilerPathStart));
        const compilerPathEnd: number = compilerPathStart === -1 ? -1 : curText.indexOf('"', compilerPathValueStart + 1) + 1;
        const dotConfigStart: number = curText.search(/\s*\"dotConfig\"\s*:\s*\"/);
        const dotConfigValueStart: number = curText.indexOf('"', curText.indexOf(":", dotConfigStart));
        const dotConfigEnd: number = dotConfigStart === -1 ? -1 : curText.indexOf('"', dotConfigValueStart + 1) + 1;
        const processedPaths: Set<string> = new Set<string>();

        // Validate compiler paths
        const resolvedCompilerPath = this.resolvePath(currentConfiguration.compilerPath, false, false);
        const compilerPathAndArgs: util.CompilerPathAndArgs = CppProperties.validateCompilerPath(resolvedCompilerPath, this.rootUri);
        if (compilerPathAndArgs.error) {
            const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                new vscode.Range(document.positionAt(curTextStartOffset + compilerPathValueStart), document.positionAt(curTextStartOffset + compilerPathEnd)),
                compilerPathAndArgs.error,
                vscode.DiagnosticSeverity.Warning);
            diagnostics.push(diagnostic);
        }
        if (compilerPathAndArgs.telemetry) {
            for (const o of Object.keys(compilerPathAndArgs.telemetry)) {
                newSquiggleMetrics[o] = compilerPathAndArgs.telemetry[o];
            }
        }

        // validate .config path
        let dotConfigPath: string | undefined;
        let dotConfigPathExists: boolean = true;
        let dotConfigMessage: string | undefined;

        dotConfigPath = currentConfiguration.dotConfig;
        dotConfigPath = this.resolvePath(dotConfigPath).trim();
        // does not try resolve if the dotConfig property is empty
        dotConfigPath = dotConfigPath !== '' ? dotConfigPath : undefined;

        if (dotConfigPath && this.rootUri) {
            const checkPathExists: any = util.checkPathExistsSync(dotConfigPath, this.rootUri.fsPath + path.sep, isWindows, true);
            dotConfigPathExists = checkPathExists.pathExists;
            dotConfigPath = checkPathExists.path;
        }
        if (!dotConfigPathExists) {
            dotConfigMessage = localize('cannot.find', "Cannot find: {0}", dotConfigPath);
            newSquiggleMetrics.PathNonExistent++;
        } else if (dotConfigPath && !util.checkFileExistsSync(dotConfigPath)) {
            dotConfigMessage = localize("path.is.not.a.file", "Path is not a file: {0}", dotConfigPath);
            newSquiggleMetrics.PathNotAFile++;
        }

        if (dotConfigMessage) {
            const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                new vscode.Range(document.positionAt(curTextStartOffset + dotConfigValueStart),
                    document.positionAt(curTextStartOffset + dotConfigEnd)),
                dotConfigMessage, vscode.DiagnosticSeverity.Warning);
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

            // Escape the path string for literal use in a regular expression
            // Need to escape any quotes to match the original text
            let escapedPath: string = curPath.replace(/"/g, '\\"');
            escapedPath = escapedPath.replace(/[-\"\/\\^$*+?.()|[\]{}]/g, '\\$&');

            // Create a pattern to search for the path with either a quote or semicolon immediately before and after,
            // and extend that pattern to the next quote before and next quote after it.
            const pattern: RegExp = new RegExp(`"[^"]*?(?<="|;)${escapedPath}(?="|;).*?"`, "g");
            const configMatches: string[] | null = curText.match(pattern);

            const expandedPaths: string[] = this.resolveAndSplit([curPath], undefined, this.ExtendedEnvironment, true, true);
            const incorrectExpandedPaths: string[] = [];

            if (expandedPaths.length <= 0) {
                continue;
            }

            if (this.rootUri) {
                for (const [index, expandedPath] of expandedPaths.entries()) {
                    if (expandedPath.includes("${workspaceFolder}")) {
                        expandedPaths[index] = this.resolvePath(expandedPath, false);
                    } else {
                        expandedPaths[index] = this.resolvePath(expandedPath);
                    }

                    const checkPathExists: any = util.checkPathExistsSync(expandedPaths[index], this.rootUri.fsPath + path.sep, isWindows, false);
                    if (!checkPathExists.pathExists) {
                        // If there are multiple paths, store any non-existing paths to squiggle later on.
                        incorrectExpandedPaths.push(expandedPaths[index]);
                    }
                }
            }

            const pathExists: boolean = incorrectExpandedPaths.length === 0;

            for (const [index, expandedPath] of expandedPaths.entries()) {
                // Normalize path separators.
                if (path.sep === "/") {
                    expandedPaths[index] = expandedPath.replace(/\\/g, path.sep);
                } else {
                    expandedPaths[index] = expandedPath.replace(/\//g, path.sep);
                }
            }

            // Iterate through the text and apply squiggles.

            let globPath: boolean = false;
            const asteriskPosition = curPath.indexOf("*");
            if (asteriskPosition !== -1) {
                if (asteriskPosition !== curPath.length - 1 && asteriskPosition !== curPath.length - 2) {
                    globPath = true;
                } else if (asteriskPosition === curPath.length - 2) {
                    if (curPath[asteriskPosition + 1] !== '*') {
                        globPath = true;
                    }
                }
            }

            if (configMatches && !globPath) {
                let curOffset: number = 0;
                let endOffset: number = 0;
                for (const curMatch of configMatches) {
                    curOffset = curText.substring(endOffset).search(pattern) + endOffset;
                    endOffset = curOffset + curMatch.length;
                    if (curOffset >= compilerPathStart && curOffset <= compilerPathEnd) {
                        continue;
                    }
                    let message: string = "";
                    if (!pathExists) {
                        if (curOffset >= forcedIncludeStart && curOffset <= forcedeIncludeEnd
                            && !path.isAbsolute(expandedPaths[0])) {
                            continue; // Skip the error, because it could be resolved recursively.
                        }
                        let badPath = "";
                        if (incorrectExpandedPaths.length > 0) {
                            badPath = incorrectExpandedPaths.map(s => `"${s}"`).join(', ');
                        } else {
                            badPath = `"${expandedPaths[0]}"`;
                        }
                        message = localize('cannot.find', "Cannot find: {0}", badPath);
                        if (incorrectExpandedPaths.some(p => p.match(/".*"/) !== null)) {
                            message += '.\n' + localize('wrapped.with.quotes', 'Do not add extra quotes around paths.');
                        }
                        newSquiggleMetrics.PathNonExistent++;
                    } else {
                        // Check for file versus path mismatches.
                        if (curOffset >= forcedIncludeStart && curOffset <= forcedeIncludeEnd) {
                            if (expandedPaths.length > 1) {
                                message = localize("multiple.paths.not.allowed", "Multiple paths are not allowed.");
                                newSquiggleMetrics.MultiplePathsNotAllowed++;
                            } else {
                                const resolvedPath = this.resolvePath(expandedPaths[0]);
                                if (util.checkFileExistsSync(resolvedPath)) {
                                    continue;
                                }

                                message = localize("path.is.not.a.file", "Path is not a file: {0}", expandedPaths[0]);
                                newSquiggleMetrics.PathNotAFile++;
                            }
                        } else if ((curOffset >= compileCommandsStart && curOffset <= compileCommandsEnd) ||
                            (curOffset >= compileCommandsArrayStart && curOffset <= compileCommandsArrayEnd)) {
                            if (expandedPaths.length > 1) {
                                message = localize("multiple.paths.should.be.separate.entries", "Multiple paths should be separate entries in an array.");
                                newSquiggleMetrics.MultiplePathsShouldBeSeparated++;
                            } else {
                                const resolvedPath = this.resolvePath(expandedPaths[0]);
                                if (util.checkFileExistsSync(resolvedPath)) {
                                    continue;
                                }

                                message = localize("path.is.not.a.file", "Path is not a file: {0}", expandedPaths[0]);
                                newSquiggleMetrics.PathNotAFile++;
                            }
                        } else {
                            const mismatchedPaths: string[] = [];
                            for (const expandedPath of expandedPaths) {
                                const resolvedPath = this.resolvePath(expandedPath);
                                if (!util.checkDirectoryExistsSync(resolvedPath)) {
                                    mismatchedPaths.push(expandedPath);
                                }
                            }

                            let badPath = "";
                            if (mismatchedPaths.length > 1) {
                                badPath = mismatchedPaths.map(s => `"${s}"`).join(', ');
                                message = localize('paths.are.not.directories', "Paths are not directories: {0}", badPath);
                                newSquiggleMetrics.PathNotADirectory++;
                            } else if (mismatchedPaths.length === 1) {
                                badPath = `"${mismatchedPaths[0]}"`;
                                message = localize('path.is.not.a.directory', "Path is not a directory: {0}", badPath);
                                newSquiggleMetrics.PathNotADirectory++;
                            } else {
                                continue;
                            }
                        }
                    }
                    const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                        new vscode.Range(document.positionAt(curTextStartOffset + curOffset),
                            document.positionAt(curTextStartOffset + endOffset)),
                        message, vscode.DiagnosticSeverity.Warning);
                    diagnostics.push(diagnostic);
                }
            } else if (envText) {
                // TODO: This never matches. https://github.com/microsoft/vscode-cpptools/issues/9140
                const envMatches: string[] | null = envText.match(pattern);
                if (envMatches) {
                    let curOffset: number = 0;
                    let endOffset: number = 0;
                    for (const curMatch of envMatches) {
                        curOffset = envText.substring(endOffset).search(pattern) + endOffset;
                        endOffset = curOffset + curMatch.length;
                        let message: string;
                        if (!pathExists) {
                            message = localize('cannot.find', "Cannot find: {0}", expandedPaths[0]);
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
        if (newSquiggleMetrics.MultiplePathsNotAllowed !== this.prevSquiggleMetrics.get(currentConfiguration.name)?.MultiplePathsNotAllowed) {
            changedSquiggleMetrics.MultiplePathsNotAllowed = newSquiggleMetrics.MultiplePathsNotAllowed;
        }
        if (newSquiggleMetrics.MultiplePathsShouldBeSeparated !== this.prevSquiggleMetrics.get(currentConfiguration.name)?.MultiplePathsShouldBeSeparated) {
            changedSquiggleMetrics.MultiplePathsShouldBeSeparated = newSquiggleMetrics.MultiplePathsShouldBeSeparated;
        }
        if (Object.keys(changedSquiggleMetrics).length > 0) {
            telemetry.logLanguageServerEvent("ConfigSquiggles", undefined, changedSquiggleMetrics);
        }
        this.prevSquiggleMetrics.set(currentConfiguration.name, newSquiggleMetrics);
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
        const savedRecursiveIncludesReduceIsExplicit: boolean[] = [];
        const savedRecursiveIncludesPriorityIsExplicit: boolean[] = [];
        const savedRecursiveIncludesOrderIsExplicit: boolean[] = [];

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
                savedRecursiveIncludesReduceIsExplicit.push(!!e.recursiveIncludesReduceIsExplicit);
                if (e.recursiveIncludesReduceIsExplicit !== undefined) {
                    delete e.recursiveIncludesReduceIsExplicit;
                }
                savedRecursiveIncludesPriorityIsExplicit.push(!!e.recursiveIncludesPriorityIsExplicit);
                if (e.recursiveIncludesPriorityIsExplicit !== undefined) {
                    delete e.recursiveIncludesPriorityIsExplicit;
                }
                savedRecursiveIncludesOrderIsExplicit.push(!!e.recursiveIncludesOrderIsExplicit);
                if (e.recursiveIncludesOrderIsExplicit !== undefined) {
                    delete e.recursiveIncludesOrderIsExplicit;
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
                this.configurationJson.configurations[i].recursiveIncludesReduceIsExplicit = savedRecursiveIncludesReduceIsExplicit[i];
                this.configurationJson.configurations[i].recursiveIncludesPriorityIsExplicit = savedRecursiveIncludesPriorityIsExplicit[i];
                this.configurationJson.configurations[i].recursiveIncludesOrderIsExplicit = savedRecursiveIncludesOrderIsExplicit[i];
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
        const compileCommands: string[] | undefined = this.CurrentConfiguration?.compileCommands;
        if (!compileCommands) {
            return;
        }
        compileCommands.forEach((path: string) => {
            const compileCommandsFile: string | undefined = this.resolvePath(path);
            fs.stat(compileCommandsFile, (err, stats) => {
                if (err) {
                    if (err.code === "ENOENT" && this.compileCommandsFiles.has(compileCommandsFile)) {
                        this.compileCommandsFileWatchers.forEach((watcher: fs.FSWatcher) => watcher.close());
                        this.compileCommandsFileWatchers = []; // reset file watchers
                        this.onCompileCommandsChanged(compileCommandsFile);
                        this.compileCommandsFiles.delete(compileCommandsFile); // File deleted
                    }
                } else {
                    const compileCommandsLastChanged: Date | undefined = this.compileCommandsFileWatcherFallbackTime.get(compileCommandsFile);
                    if (!this.compileCommandsFiles.has(compileCommandsFile) ||
                        (compileCommandsLastChanged !== undefined && stats.mtime > compileCommandsLastChanged)) {
                        this.compileCommandsFileWatcherFallbackTime.set(compileCommandsFile, new Date());
                        this.onCompileCommandsChanged(compileCommandsFile);
                        this.compileCommandsFiles.add(compileCommandsFile); // File created.
                    }
                }
            });
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
