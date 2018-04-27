/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as fs from "fs";
import * as vscode from 'vscode';
import * as util from '../common';
import { PersistentFolderState } from './persistentState';
import { CppSettings } from './settings';
const configVersion: number = 3;

// No properties are set in the config since we want to apply vscode settings first (if applicable).
// That code won't trigger if another value is already set.
// The property defaults are moved down to applyDefaultIncludePathsAndFrameworks.
function getDefaultConfig(): Configuration {
    if (process.platform === 'darwin') {
        return { name: "Mac", browse: {} };
    } else if (process.platform === 'win32') {
        return { name: "Win32", browse: {} };
    } else {
        return { name: "Linux", browse: {} };
    }
}

function getDefaultCppProperties(): ConfigurationJson {
    return {
        configurations: [getDefaultConfig()],
        version: configVersion
    };
}

interface ConfigurationJson {
    configurations: Configuration[];
    version: number;
}

export interface Configuration {
    name: string;
    compilerPath?: string;
    cStandard?: string;
    cppStandard?: string;
    includePath?: string[];
    macFrameworkPath?: string[];
    defines?: string[];
    intelliSenseMode?: string;
    compileCommands?: string;
    forcedInclude?: string[];
    browse?: Browse;
}

export interface Browse {
    path?: string[];
    limitSymbolsToIncludedHeaders?: boolean | string;
    databaseFilename?: string;
}

export interface CompilerDefaults {
    compilerPath: string;
    cStandard: string;
    cppStandard: string;
    includes: string[];
    frameworks: string[];
    intelliSenseMode: string;
}

export class CppProperties {
    private rootUri: vscode.Uri;
    private propertiesFile: vscode.Uri = null;
    private readonly configFolder: string;
    private configurationJson: ConfigurationJson = null;
    private currentConfigurationIndex: PersistentFolderState<number>;
    private configFileWatcher: vscode.FileSystemWatcher = null;
    private configFileWatcherFallbackTime: Date = new Date(); // Used when file watching fails.
    private compileCommandFileWatchers: fs.FSWatcher[] = [];
    private defaultCompilerPath: string = null;
    private defaultCStandard: string = null;
    private defaultCppStandard: string = null;
    private defaultIncludes: string[] = null;
    private defaultFrameworks: string[] = null;
    private vcpkgIncludes: string[] = [];
    private vcpkgPathReady: boolean = false;
    private defaultIntelliSenseMode: string = null;
    private readonly configurationGlobPattern: string = "**/c_cpp_properties.json"; // TODO: probably should be a single file, not all files...
    private disposables: vscode.Disposable[] = [];
    private configurationsChanged = new vscode.EventEmitter<Configuration[]>();
    private selectionChanged = new vscode.EventEmitter<number>();
    private compileCommandsChanged = new vscode.EventEmitter<string>();

    // Any time the default settings are parsed and assigned to `this.configurationJson`,
    // we want to track when the default includes have been added to it.
    private configurationIncomplete: boolean = true;

    constructor(rootUri: vscode.Uri) {
        console.assert(rootUri !== undefined);
        this.rootUri = rootUri;
        let rootPath: string = rootUri ? rootUri.fsPath : "";
        this.currentConfigurationIndex = new PersistentFolderState<number>("CppProperties.currentConfigurationIndex", -1, rootPath);
        this.configFolder = path.join(rootPath, ".vscode");

        let configFilePath: string = path.join(this.configFolder, "c_cpp_properties.json");
        if (fs.existsSync(configFilePath)) {
            this.propertiesFile = vscode.Uri.file(configFilePath);
            this.parsePropertiesFile();
        }
        if (!this.configurationJson) {
            this.resetToDefaultSettings(this.CurrentConfiguration === -1);
        }

        this.configFileWatcher = vscode.workspace.createFileSystemWatcher(path.join(this.configFolder, this.configurationGlobPattern));
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

        this.buildVcpkgIncludePath();

        this.disposables.push(vscode.Disposable.from(this.configurationsChanged, this.selectionChanged, this.compileCommandsChanged));
    }

    public get ConfigurationsChanged(): vscode.Event<Configuration[]> { return this.configurationsChanged.event; }
    public get SelectionChanged(): vscode.Event<number> { return this.selectionChanged.event; }
    public get CompileCommandsChanged(): vscode.Event<string> { return this.compileCommandsChanged.event; }
    public get Configurations(): Configuration[] { return this.configurationJson.configurations; }
    public get CurrentConfiguration(): number { return this.currentConfigurationIndex.Value; }

    public get ConfigurationNames(): string[] {
        let result: string[] = [];
        this.configurationJson.configurations.forEach((config: Configuration) => result.push(config.name));
        return result;
    }

    public set CompilerDefaults(compilerDefaults: CompilerDefaults) {
        this.defaultCompilerPath = compilerDefaults.compilerPath;
        this.defaultCStandard = compilerDefaults.cStandard;
        this.defaultCppStandard = compilerDefaults.cppStandard;
        this.defaultIncludes = compilerDefaults.includes;
        this.defaultFrameworks = compilerDefaults.frameworks;
        this.defaultIntelliSenseMode = compilerDefaults.intelliSenseMode;

        // defaultPaths is only used when there isn't a c_cpp_properties.json, but we don't send the configuration changed event
        // to the language server until the default include paths and frameworks have been sent.
        this.handleConfigurationChange();
    }

    private onConfigurationsChanged(): void {
        this.configurationsChanged.fire(this.Configurations);
    }

    private onSelectionChanged(): void {
        this.selectionChanged.fire(this.CurrentConfiguration);
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
        if (resetIndex || this.CurrentConfiguration < 0 ||
            this.CurrentConfiguration >= this.configurationJson.configurations.length) {
            this.currentConfigurationIndex.Value = this.getConfigIndexForPlatform(this.configurationJson);
        }
        this.configurationIncomplete = true;
    }

     private applyDefaultIncludePathsAndFrameworks(): void {
        if (this.configurationIncomplete && this.defaultIncludes && this.defaultFrameworks && this.vcpkgPathReady) {
            let configuration: Configuration = this.configurationJson.configurations[this.CurrentConfiguration];
            let settings: CppSettings = new CppSettings(this.rootUri);

            // Anything that has a vscode setting for it will be resolved in updateServerOnFolderSettingsChange.
            // So if a property is currently unset, but has a vscode setting, don't set it yet, otherwise the linkage
            // to the setting will be lost if this configuration is saved into a c_cpp_properties.json file.

            // Only add settings from the default compiler if user hasn't explicitly set the corresponding VS Code setting.

            if (!settings.defaultIncludePath) {
                // We don't add system includes to the includePath anymore. The language server has this information.
                configuration.includePath = ["${workspaceFolder}"].concat(this.vcpkgIncludes);
            }
            if (!settings.defaultBrowsePath) {
                // We don't add system includes to the includePath anymore. The language server has this information.
                configuration.browse.path = ["${workspaceFolder}"].concat(this.vcpkgIncludes);
            }
            if (!settings.defaultDefines) {
                configuration.defines = (process.platform === 'win32') ? ["_DEBUG", "UNICODE", "_UNICODE"] : [];
            }
            if (!settings.defaultMacFrameworkPath && process.platform === 'darwin') {
                configuration.macFrameworkPath = this.defaultFrameworks;
            }
            if (!settings.defaultCompilerPath && this.defaultCompilerPath) {
                configuration.compilerPath = this.defaultCompilerPath;
            }
            if (!settings.defaultCStandard && this.defaultCStandard) {
                configuration.cStandard = this.defaultCStandard;
            }
            if (!settings.defaultCppStandard && this.defaultCppStandard) {
                configuration.cppStandard = this.defaultCppStandard;
            }
            if (!settings.defaultIntelliSenseMode) {
                configuration.intelliSenseMode = this.defaultIntelliSenseMode;
            }
            this.configurationIncomplete = false;
        }
    }

    private async buildVcpkgIncludePath(): Promise<void> {
        try {
            // Check for vcpkg instance and include relevent paths if found.
            if (await util.checkFileExists(util.getVcpkgPathDescriptorFile())) {
                let vcpkgRoot: string = await util.readFileText(util.getVcpkgPathDescriptorFile());
                let vcpkgInstallPath: string = path.join(vcpkgRoot.trim(), "/vcpkg/installed");
                if (await util.checkDirectoryExists(vcpkgInstallPath)) {
                    let list: string[] = await util.readDir(vcpkgInstallPath);
                    // For every *directory* in the list (non-recursive)
                    list.forEach((entry) => {
                        if (entry !== "vcpkg") {
                            let pathToCheck: string = path.join(vcpkgInstallPath, entry);
                            if (fs.existsSync(pathToCheck)) {
                                let p: string = path.join(pathToCheck, "include");
                                if (fs.existsSync(p)) {
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

    private getConfigIndexForPlatform(config: any): number {
        if (this.configurationJson.configurations.length > 3) {
            return this.configurationJson.configurations.length - 1; // Default to the last custom configuration.
        }
        let nodePlatform: NodeJS.Platform = process.platform;
        let plat: string;
        if (nodePlatform === 'linux') {
            plat = "Linux";
        } else if (nodePlatform === 'darwin') {
            plat = "Mac";
        } else if (nodePlatform === 'win32') {
            plat = "Win32";
        }
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            if (config.configurations[i].name === plat) {
                return i;
            }
        }
        return this.configurationJson.configurations.length - 1;
    }

    private getIntelliSenseModeForPlatform(name: string): string {
        // Do the built-in configs first.
        if (name === "Linux" || name === "Mac") {
            return "clang-x64";
        } else if (name === "Win32") {
            return "msvc-x64";
        } else {
            // Custom configs default to the OS's preference.
            let nodePlatform: NodeJS.Platform = process.platform;
            if (nodePlatform === 'linux' || nodePlatform === 'darwin') {
                return "clang-x64";
            }
        }
        return "msvc-x64";
    }

    private includePathConverted(): boolean {
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            if (this.configurationJson.configurations[i].browse === undefined || this.configurationJson.configurations[i].browse.path === undefined) {
                return false;
            }
        }
        return true;
    }

    public addToIncludePathCommand(path: string): void {
        this.handleConfigurationEditCommand((document: vscode.TextDocument) => {
            this.parsePropertiesFile(); // Clear out any modifications we may have made internally.
            let config: Configuration = this.configurationJson.configurations[this.CurrentConfiguration];
            if (config.includePath === undefined) {
                config.includePath = ["${default}"];
            }
            config.includePath.splice(config.includePath.length, 0, path);
            fs.writeFileSync(this.propertiesFile.fsPath, JSON.stringify(this.configurationJson, null, 4));
            this.updateServerOnFolderSettingsChange();
        });
    }

    public select(index: number): Configuration {
        if (index === this.configurationJson.configurations.length) {
            this.handleConfigurationEditCommand(vscode.window.showTextDocument);
            return;
        }
        this.currentConfigurationIndex.Value = index;
        this.onSelectionChanged();
    }

    private resolveDefaults(entries: string[], defaultValue: string[]): string[] {
        let result: string[] = [];
        entries.forEach(entry => {
            if (entry === "${default}") {
                result = result.concat(defaultValue);
            } else {
                result.push(entry);
            }
        });
        return result;
    }

    private resolveAndSplit(paths: string[] | undefined, defaultValue: string[]): string[] {
        let result: string[] = [];
        if (paths) {
            paths.forEach(entry => {
                let entries: string[] = util.resolveVariables(entry).split(";").filter(e => e);
                entries = this.resolveDefaults(entries, defaultValue);
                result = result.concat(entries);
            });
        }
        return result;
    }

    private resolveVariables(input: string | boolean, defaultValue: string | boolean): string | boolean {
        if (input === undefined || input === "${default}") {
            input = defaultValue;
        }
        if (typeof input === "boolean") {
            return input;
        }
        return util.resolveVariables(input);
    }

    private updateConfiguration(property: string[], defaultValue: string[]): string[];
    private updateConfiguration(property: string, defaultValue: string): string;
    private updateConfiguration(property: string | boolean, defaultValue: boolean): boolean;
    private updateConfiguration(property, defaultValue): any {
        if (typeof property === "string" || typeof defaultValue === "string") {
            return this.resolveVariables(property, defaultValue);
        } else if (typeof property === "boolean" || typeof defaultValue === "boolean") {
            return this.resolveVariables(property, defaultValue);
        } else if (property instanceof Array || defaultValue instanceof Array) {
            if (property) {
                return this.resolveAndSplit(property, defaultValue);
            } else if (property === undefined && defaultValue) {
                return this.resolveAndSplit(defaultValue, []);
            }
        }
        return property;
    }

    private updateServerOnFolderSettingsChange(): void {
        let settings: CppSettings = new CppSettings(this.rootUri);
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            let configuration: Configuration = this.configurationJson.configurations[i];

            configuration.includePath = this.updateConfiguration(configuration.includePath, settings.defaultIncludePath);
            configuration.defines = this.updateConfiguration(configuration.defines, settings.defaultDefines);
            configuration.macFrameworkPath = this.updateConfiguration(configuration.macFrameworkPath, settings.defaultMacFrameworkPath);
            configuration.forcedInclude = this.updateConfiguration(configuration.forcedInclude, settings.defaultForcedInclude);
            configuration.compileCommands = this.updateConfiguration(configuration.compileCommands, settings.defaultCompileCommands);
            configuration.compilerPath = this.updateConfiguration(configuration.compilerPath, settings.defaultCompilerPath);
            configuration.cStandard = this.updateConfiguration(configuration.cStandard, settings.defaultCStandard);
            configuration.cppStandard = this.updateConfiguration(configuration.cppStandard, settings.defaultCppStandard);
            configuration.intelliSenseMode = this.updateConfiguration(configuration.intelliSenseMode, settings.defaultIntelliSenseMode);

            if (!configuration.browse) {
                configuration.browse = {};
            }
            configuration.browse.path = this.updateConfiguration(configuration.browse.path, settings.defaultBrowsePath);
            configuration.browse.limitSymbolsToIncludedHeaders = this.updateConfiguration(configuration.browse.limitSymbolsToIncludedHeaders, settings.defaultLimitSymbolsToIncludedHeaders);
            configuration.browse.databaseFilename = this.updateConfiguration(configuration.browse.databaseFilename, settings.defaultDatabaseFilename);
        }

        this.updateCompileCommandsFileWatchers();
        if (!this.configurationIncomplete) {
            this.onConfigurationsChanged();
        }
    }

    // Dispose existing and loop through cpp and populate with each file (exists or not) as you go.
    // paths are expected to have variables resolved already
    public updateCompileCommandsFileWatchers(): void {
        this.compileCommandFileWatchers.forEach((watcher: fs.FSWatcher) => watcher.close());
        this.compileCommandFileWatchers = []; //reset it
        let filePaths: Set<string> = new Set<string>();
        this.configurationJson.configurations.forEach(c => {
            if (c.compileCommands !== undefined && fs.existsSync(c.compileCommands)) {
                filePaths.add(c.compileCommands);
            }
        });
        try {
            filePaths.forEach((path: string) => {
                this.compileCommandFileWatchers.push(fs.watch(path, (event: string, filename: string) => {
                    if (event !== "rename") {
                        this.onCompileCommandsChanged(path);
                    }
                }));
            });
        } catch (e) {
            // The file watcher limit is hit.
            // TODO: Check if the compile commands file has a higher timestamp during the interval timer.
        }
    }

    public handleConfigurationEditCommand(onSuccess: (document: vscode.TextDocument) => void): void {
        if (this.propertiesFile && fs.existsSync(this.propertiesFile.fsPath)) {
            vscode.workspace.openTextDocument(this.propertiesFile).then((document: vscode.TextDocument) => {
                onSuccess(document);
            });
        } else {
            fs.mkdir(this.configFolder, (e: NodeJS.ErrnoException) => {
                if (!e || e.code === 'EEXIST') {
                    let dirPathEscaped: string = this.configFolder.replace("#", "%23");
                    let fullPathToFile: string = path.join(dirPathEscaped, "c_cpp_properties.json");
                    let filePath: vscode.Uri = vscode.Uri.parse("untitled:" + fullPathToFile);
                    vscode.workspace.openTextDocument(filePath).then((document: vscode.TextDocument) => {
                        let edit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                        if (this.configurationJson === undefined) {
                            this.resetToDefaultSettings(true);
                        }
                        this.applyDefaultIncludePathsAndFrameworks();
                        edit.insert(document.uri, new vscode.Position(0, 0), JSON.stringify(this.configurationJson, null, 4));
                        vscode.workspace.applyEdit(edit).then((status) => {
                            // Fix for issue 163
                            // https://github.com/Microsoft/vscppsamples/issues/163
                            // Save the file to disk so that when the user tries to re-open the file it exists.
                            // Before this fix the file existed but was unsaved, so we went through the same
                            // code path and reapplied the edit.
                            document.save().then(() => {
                                this.propertiesFile = vscode.Uri.file(path.join(this.configFolder, "c_cpp_properties.json"));
                                vscode.workspace.openTextDocument(this.propertiesFile).then((document: vscode.TextDocument) => {
                                    onSuccess(document);
                                });
                            });
                        });
                    });
                }
            });
        }
    }

    private handleConfigurationChange(): void {
        this.configFileWatcherFallbackTime = new Date();
        if (this.propertiesFile) {
            this.parsePropertiesFile();
            // parsePropertiesFile can fail, but it won't overwrite an existing configurationJson in the event of failure.
            // this.configurationJson should only be undefined here if we have never successfully parsed the propertiesFile.
            if (this.configurationJson !== undefined) {
                if (this.CurrentConfiguration < 0 ||
                    this.CurrentConfiguration >= this.configurationJson.configurations.length) {
                    // If the index is out of bounds (during initialization or due to removal of configs), fix it.
                    this.currentConfigurationIndex.Value = this.getConfigIndexForPlatform(this.configurationJson);
                }
            }
        }

        if (this.configurationJson === undefined) {
            this.resetToDefaultSettings(true);  // I don't think there's a case where this will be hit anymore.
        }

        this.applyDefaultIncludePathsAndFrameworks();
        this.updateServerOnFolderSettingsChange();
    }

    private parsePropertiesFile(): void {
        try {
            let readResults: string = fs.readFileSync(this.propertiesFile.fsPath, 'utf8');
            if (readResults === "") {
                return; // Repros randomly when the file is initially created. The parse will get called again after the file is written.
            }

            // Try to use the same configuration as before the change.
            let newJson: ConfigurationJson = JSON.parse(readResults);
            if (!newJson || !newJson.configurations || newJson.configurations.length === 0) {
                throw { message: "Invalid configuration file. There must be at least one configuration present in the array." };
            }
            if (!this.configurationIncomplete && this.configurationJson && this.configurationJson.configurations &&
                this.CurrentConfiguration >= 0 && this.CurrentConfiguration < this.configurationJson.configurations.length) {
                for (let i: number = 0; i < newJson.configurations.length; i++) {
                    if (newJson.configurations[i].name === this.configurationJson.configurations[this.CurrentConfiguration].name) {
                        this.currentConfigurationIndex.Value = i;
                        break;
                    }
                }
            }
            this.configurationJson = newJson;
            if (this.CurrentConfiguration < 0 || this.CurrentConfiguration >= newJson.configurations.length) {
                this.currentConfigurationIndex.Value = this.getConfigIndexForPlatform(newJson);
            }

            // Warning: There is a chance that this is incorrect in the event that the c_cpp_properties.json file was created before
            // the system includes were available.
            this.configurationIncomplete = false;

            // Update intelliSenseMode, compilerPath, cStandard, and cppStandard with the defaults if they're missing.
            // If VS Code settings exist for these properties, don't add them to c_cpp_properties.json
            let dirty: boolean = false;
            let settings: CppSettings = new CppSettings(this.rootUri);
            for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
                let config: Configuration = this.configurationJson.configurations[i];
                if (config.intelliSenseMode === undefined && !settings.defaultIntelliSenseMode) {
                    dirty = true;
                    config.intelliSenseMode = this.getIntelliSenseModeForPlatform(config.name);
                }
                // Don't set the default if compileCommands exist, until it is fixed to have the correct value.
                if (config.compilerPath === undefined && this.defaultCompilerPath && !config.compileCommands && !settings.defaultCompilerPath) {
                    config.compilerPath = this.defaultCompilerPath;
                    dirty = true;
                }
                if (!config.cStandard && this.defaultCStandard && !settings.defaultCStandard) {
                    config.cStandard = this.defaultCStandard;
                    dirty = true;
                }
                if (!config.cppStandard && this.defaultCppStandard && !settings.defaultCppStandard) {
                    config.cppStandard = this.defaultCppStandard;
                    dirty = true;
                }
            }

            if (this.configurationJson.version !== configVersion) {
                dirty = true;
                if (this.configurationJson.version === undefined) {
                    this.updateToVersion2();
                }

                if (this.configurationJson.version === 2) {
                    this.updateToVersion3();
                } else {
                    this.configurationJson.version = configVersion;
                    vscode.window.showErrorMessage('Unknown version number found in c_cpp_properties.json. Some features may not work as expected.');
                }
            }

            if (dirty) {
                try {
                    fs.writeFileSync(this.propertiesFile.fsPath, JSON.stringify(this.configurationJson, null, 4));
                } catch {
                    // Ignore write errors, the file may be under source control. Updated settings will only be modified in memory.
                    vscode.window.showWarningMessage('Attempt to update "' + this.propertiesFile.fsPath + '" failed (do you have write access?)');
                }
            }
        } catch (err) {
            vscode.window.showErrorMessage('Failed to parse "' + this.propertiesFile.fsPath + '": ' + err.message);
            throw err;
        }
    }

    private updateToVersion2(): void {
        this.configurationJson.version = 2;
        if (!this.includePathConverted()) {
            for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
                let config: Configuration = this.configurationJson.configurations[i];
                if (config.browse === undefined) {
                    config.browse = {};
                }
                if (config.browse.path === undefined && (this.defaultIncludes !== undefined || config.includePath !== undefined)) {
                    config.browse.path = (config.includePath === undefined) ? this.defaultIncludes.slice(0) : config.includePath.slice(0);
                }
            }
        }
    }

    private updateToVersion3(): void {
        this.configurationJson.version = 3;
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            let config: Configuration = this.configurationJson.configurations[i];
            // Look for Mac configs and extra configs on Mac systems
            if (config.name === "Mac" || (process.platform === "darwin" && config.name !== "Win32" && config.name !== "Linux")) {
                if (config.macFrameworkPath === undefined) {
                    config.macFrameworkPath = [
                        "/System/Library/Frameworks",
                        "/Library/Frameworks"
                    ];
                }
            }
        }
    }

    public checkCppProperties(): void {
        // Check for change properties in case of file watcher failure.
        let propertiesFile: string = path.join(this.configFolder, "c_cpp_properties.json");
        fs.stat(propertiesFile, (err, stats) => {
            if (err) {
                if (this.propertiesFile !== null) {
                    this.propertiesFile = null; // File deleted.
                    this.resetToDefaultSettings(true);
                    this.handleConfigurationChange();
                }
            } else if (stats.mtime > this.configFileWatcherFallbackTime) {
                if (this.propertiesFile === null) {
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
        this.compileCommandFileWatchers = []; //reset it
    }
}
