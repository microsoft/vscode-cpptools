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
const configVersion: number = 3;

let defaultSettings: string = `{
    "configurations": [
        {
            "name": "Mac",
            "includePath": [
                "/usr/include",
                "/usr/local/include",
                "$\{workspaceRoot\}"
            ],
            "defines": [],
            "intelliSenseMode": "clang-x64",
            "browse": {
                "path": [
                    "/usr/include",
                    "/usr/local/include",
                    "$\{workspaceRoot\}"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            },
            "macFrameworkPath": [
                "/System/Library/Frameworks",
                "/Library/Frameworks"
            ]
        },
        {
            "name": "Linux",
            "includePath": [
                "/usr/include",
                "/usr/local/include",
                "$\{workspaceRoot\}"
            ],
            "defines": [],
            "intelliSenseMode": "clang-x64",
            "browse": {
                "path": [
                    "/usr/include",
                    "/usr/local/include",
                    "$\{workspaceRoot\}"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            }
        },
        {
            "name": "Win32",
            "includePath": [
                "C:/Program Files (x86)/Microsoft Visual Studio 14.0/VC/include",
                "$\{workspaceRoot\}"
            ],
            "defines": [
                "_DEBUG",
                "UNICODE"
            ],
            "intelliSenseMode": "msvc-x64",
            "browse": {
                "path": [
                    "C:/Program Files (x86)/Microsoft Visual Studio 14.0/VC/include/*",
                    "$\{workspaceRoot\}"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            }
        }
    ],
    "version": ${configVersion}
}
`;

export interface Browse {
    path?: string[];
    limitSymbolsToIncludedHeaders?: boolean;
    databaseFilename?: string;
}

export interface Configuration {
    name: string;
    includePath?: string[];
    macFrameworkPath?: string[];
    defines?: string[];
    intelliSenseMode?: string;
    compileCommands?: string;
    browse?: Browse;
}

export interface DefaultPaths {
    includes: string[];
    frameworks: string[];
}

interface ConfigurationJson {
    configurations: Configuration[];
    version: number;
}

export class CppProperties {
    private propertiesFile: vscode.Uri = null;
    private readonly configFolder: string;
    private configurationJson: ConfigurationJson = null;
    private currentConfigurationIndex: PersistentFolderState<number>;
    private configFileWatcher: vscode.FileSystemWatcher = null;
    private configFileWatcherFallbackTime: Date = new Date(); // Used when file watching fails.
    private compileCommandFileWatchers: fs.FSWatcher[] = [];
    private defaultIncludes: string[] = null;
    private defaultFrameworks: string[] = null;
    private readonly configurationGlobPattern: string = "**/c_cpp_properties.json"; // TODO: probably should be a single file, not all files...
    private disposables: vscode.Disposable[] = [];
    private configurationsChanged = new vscode.EventEmitter<Configuration[]>();
    private selectionChanged = new vscode.EventEmitter<number>();
    private compileCommandsChanged = new vscode.EventEmitter<string>();

    // Any time the `defaultSettings` are parsed and assigned to `this.configurationJson`,
    // we want to track when the default includes have been added to it.
    private configurationIncomplete: boolean = true;

    constructor(rootPath: string) {
        console.assert(rootPath !== undefined);
        this.currentConfigurationIndex = new PersistentFolderState<number>("CppProperties.currentConfigurationIndex", -1, rootPath);
        this.configFolder = path.join(rootPath, ".vscode");
        this.resetToDefaultSettings(this.currentConfigurationIndex.Value === -1);

        let configFilePath: string = path.join(this.configFolder, "c_cpp_properties.json");
        if (fs.existsSync(configFilePath)) {
            this.propertiesFile = vscode.Uri.file(configFilePath);
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

    public set DefaultPaths(paths: DefaultPaths) {
        this.defaultIncludes = paths.includes;
        this.defaultFrameworks = paths.frameworks;

        // defaultPaths is only used when there isn't a c_cpp_properties.json, but we don't send the configuration changed event
        // to the language server until the default include paths and frameworks have been sent.
        this.handleConfigurationChange();
    }

    private onConfigurationsChanged() {
        this.configurationsChanged.fire(this.Configurations);
    }

    private onSelectionChanged() {
        this.selectionChanged.fire(this.CurrentConfiguration);
    }

    private onCompileCommandsChanged(path: string) {
        this.compileCommandsChanged.fire(path);
    }

    private resetToDefaultSettings(resetIndex: boolean) {
        this.configurationJson = JSON.parse(defaultSettings);
        if (resetIndex || this.CurrentConfiguration < 0 ||
            this.CurrentConfiguration >= this.configurationJson.configurations.length) {
            this.currentConfigurationIndex.Value = this.getConfigIndexForPlatform(this.configurationJson);
        }
        this.configurationIncomplete = true;
    }

    private applyDefaultIncludePathsAndFrameworks() {
        if (this.configurationIncomplete && this.defaultIncludes !== undefined && this.defaultFrameworks !== undefined) {
            this.configurationJson.configurations[this.CurrentConfiguration].includePath = this.defaultIncludes;
            this.configurationJson.configurations[this.CurrentConfiguration].browse.path = this.defaultIncludes;
            if (process.platform == 'darwin') {
                this.configurationJson.configurations[this.CurrentConfiguration].macFrameworkPath = this.defaultFrameworks;
            }
            this.configurationIncomplete = false;
        }
    }

    private getConfigIndexForPlatform(config: any): number {
        if (this.configurationJson.configurations.length > 3) {
            return this.configurationJson.configurations.length - 1; // Default to the last custom configuration.
        }
        let nodePlatform: NodeJS.Platform = process.platform;
        let plat: string;
        if (nodePlatform == 'linux') {
            plat = "Linux";
        } else if (nodePlatform == 'darwin') {
            plat = "Mac";
        } else if (nodePlatform == 'win32') {
            plat = "Win32";
        }
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            if (config.configurations[i].name == plat) {
                return i;
            }
        }
        return this.configurationJson.configurations.length - 1;
    }

    private getIntelliSenseModeForPlatform(name: string): string {
        // Do the built-in configs first.
        if (name == "Linux" || name == "Mac") {
            return "clang-x64";
        } else if (name == "Win32") {
            return "msvc-x64";
        } else {
            // Custom configs default to the OS's preference.
            let nodePlatform: NodeJS.Platform = process.platform;
            if (nodePlatform == 'linux' || nodePlatform == 'darwin') {
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

    public addToIncludePathCommand(path: string) {
        this.handleConfigurationEditCommand((document: vscode.TextDocument) => {
            let config: Configuration = this.configurationJson.configurations[this.CurrentConfiguration];
            config.includePath.splice(config.includePath.length, 0, path);
            fs.writeFileSync(this.propertiesFile.fsPath, JSON.stringify(this.configurationJson, null, 4));
            this.updateServerOnFolderSettingsChange();
        });
    }

    public select(index: number): Configuration {
        if (index == this.configurationJson.configurations.length) {
            this.handleConfigurationEditCommand(vscode.window.showTextDocument);
            return;
        }
        this.currentConfigurationIndex.Value = index;
        this.onSelectionChanged();
    }

    private updateServerOnFolderSettingsChange() {
        for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
            if (this.configurationJson.configurations[i].includePath !== undefined) {
                for (let j: number = 0; j < this.configurationJson.configurations[i].includePath.length; j++) {
                    this.configurationJson.configurations[i].includePath[j] = util.resolveVariables(this.configurationJson.configurations[i].includePath[j]);
                }
            }
            if (this.configurationJson.configurations[i].browse !== undefined && this.configurationJson.configurations[i].browse.path !== undefined) {
                for (let j: number = 0; j < this.configurationJson.configurations[i].browse.path.length; j++) {
                    this.configurationJson.configurations[i].browse.path[j] = util.resolveVariables(this.configurationJson.configurations[i].browse.path[j]);
                }
            }
            if (this.configurationJson.configurations[i].macFrameworkPath !== undefined) {
                for (let j: number = 0; j < this.configurationJson.configurations[i].macFrameworkPath.length; j++) {
                    this.configurationJson.configurations[i].macFrameworkPath[j] = util.resolveVariables(this.configurationJson.configurations[i].macFrameworkPath[j]);
                }
            }
            if (this.configurationJson.configurations[i].compileCommands !== undefined) {
                this.configurationJson.configurations[i].compileCommands = util.resolveVariables(this.configurationJson.configurations[i].compileCommands);
            }
        }

        this.updateCompileCommandsFileWatchers();
        if (!this.configurationIncomplete) {
            this.onConfigurationsChanged();
        }
    }

    // Dispose existing and loop through cpp and populate with each file (exists or not) as you go.
    // paths are expected to have variables resolved already
    public updateCompileCommandsFileWatchers() {
        this.compileCommandFileWatchers.forEach((watcher: fs.FSWatcher) => watcher.close());
        this.compileCommandFileWatchers = []; //reset it
        let filePaths: Set<string> = new Set<string>();
        this.configurationJson.configurations.forEach(c => {
            if (c.compileCommands !== undefined && fs.existsSync(c.compileCommands)) {
                filePaths.add(c.compileCommands);
            }
        });
        filePaths.forEach((path: string) => {
            this.compileCommandFileWatchers.push(fs.watch(path, (event: string, filename: string) => {
                if (event != "rename") {
                    this.onCompileCommandsChanged(path);
                }
            }));
        });
    }

    public handleConfigurationEditCommand(onSuccess: (document: vscode.TextDocument) => void) {
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

    private handleConfigurationChange() {
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

    private parsePropertiesFile() {
        try {
            let readResults: string = fs.readFileSync(this.propertiesFile.fsPath, 'utf8');
            if (readResults == "") {
                return; // Repros randomly when the file is initially created. The parse will get called again after the file is written.
            }

            // Try to use the same configuration as before the change.
            let newJson: ConfigurationJson = JSON.parse(readResults);
            if (!this.configurationIncomplete && newJson.configurations && this.configurationJson) {
                for (let i: number = 0; i < newJson.configurations.length; i++) {
                    if (newJson.configurations[i].name === this.configurationJson.configurations[this.CurrentConfiguration].name) {
                        this.currentConfigurationIndex.Value = i;
                        break;
                    }
                }
            }
            this.configurationJson = newJson;

            // Warning: There is a chance that this is incorrect in the event that the c_cpp_properties.json file was created before
            // the system includes were available.
            this.configurationIncomplete = false;

            let dirty: boolean = false;
            for (let i: number = 0; i < this.configurationJson.configurations.length; i++) {
                let config: Configuration = this.configurationJson.configurations[i];
                if (config.intelliSenseMode === undefined) {
                    dirty = true;
                    config.intelliSenseMode = this.getIntelliSenseModeForPlatform(config.name);
                }
            }

            if (this.configurationJson.version != configVersion) {
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
                fs.writeFileSync(this.propertiesFile.fsPath, JSON.stringify(this.configurationJson, null, 4));
            }
        } catch (err) {
            vscode.window.showErrorMessage('Failed to parse "' + this.propertiesFile.fsPath + '": ' + err.message);
            throw err;
        }
    }

    private updateToVersion2() {
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

    private updateToVersion3() {
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

    public checkCppProperties() {
        // Check for change properties in case of file watcher failure.
        let propertiesFile: string = path.join(this.configFolder, "c_cpp_properties.json");
        fs.stat(propertiesFile, (err, stats) => {
            if (err) {
                if (this.propertiesFile != null) {
                    this.propertiesFile = null; // File deleted.
                    this.resetToDefaultSettings(true);
                    this.handleConfigurationChange();
                }
            } else if (stats.mtime > this.configFileWatcherFallbackTime) {
                if (this.propertiesFile == null) {
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
