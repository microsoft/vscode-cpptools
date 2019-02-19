/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as debugUtils from './utils';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getBuildTasks, BuildTaskDefinition } from '../LanguageServer/extension';
import * as util from '../common';
import * as fs from 'fs';

import { IConfiguration, IConfigurationSnippet, DebuggerType, MIConfigurations, WindowsConfigurations, WSLConfigurations, PipeTransportConfigurations } from './configurations';
import { parse } from 'jsonc-parser';

interface MenuItem extends vscode.QuickPickItem {
    compilerPath: string;
}

abstract class CppConfigurationProvider implements vscode.DebugConfigurationProvider {
    private type: DebuggerType;
    private provider: IConfigurationAssetProvider;

    public constructor(provider: IConfigurationAssetProvider, type: DebuggerType) {
        this.provider = provider;
        this.type = type;
    }

    /**
	 * Returns a list of initial debug configurations based on contextual information, e.g. package.json or folder.
	 */
    async provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration[]> {
        return new Promise<vscode.DebugConfiguration[]>(async (resolve, reject) => {
            const tasks: vscode.Task[] = await getBuildTasks();
            if (!tasks.length) {
                return this.provider.getInitialConfigurations(this.type);
            }

            let menuItems: MenuItem[] = tasks.map<MenuItem>(task => {
                let definition: BuildTaskDefinition = task.definition as BuildTaskDefinition;
                return {label: task.name, compilerPath: definition.compilerPath};
            });

            vscode.window.showQuickPick(menuItems, {placeHolder: "Select a task to build the active file."}).then(async selection => {
                let rawTasksJson: any = await util.getRawTasksJson();

                // Ensure that the task exists in the user's task.json. Task will not be found otherwise.
                if (!rawTasksJson.tasks) {
                    rawTasksJson.tasks = new Array();
                }
                if (!rawTasksJson.tasks.find(task => task.label === selection.label)) {
                    const foundTask: vscode.Task = tasks.find((task: vscode.Task) => { return task.name === selection.label; });
                    let definition: BuildTaskDefinition = foundTask.definition as BuildTaskDefinition;
                    delete definition.compilerPath; // TODO add desired properties to empty object, don't delete.
                    rawTasksJson.tasks.push(foundTask.definition);
                    util.writeFileText(util.getTasksJsonPath(), JSON.stringify(rawTasksJson, null, 2));
                }

                // Configure the default configuration for the selected task.
                let defaultConfig: any = this.provider.getInitialConfigurations(this.type)[0];
                defaultConfig.program = "${fileDirname}/${fileBasenameNoExtension}";
                defaultConfig.preLaunchTask = selection.label;
                defaultConfig.externalConsole = false;

                const compilerBaseName: string = path.basename(selection.compilerPath);
                if (!compilerBaseName.startsWith("clang")) {
                    defaultConfig.name = "(gdb) Build Active File and Launch";
                    resolve(defaultConfig);
                }
                
                defaultConfig.name = "(lldb) Build Active File and Launch";
                defaultConfig.MIMode = "lldb";
                delete defaultConfig.setupCommands;
                let index: number = compilerBaseName.indexOf('-');
                let lldbMIPath: string = path.dirname(selection.compilerPath) + '/lldb-mi';
                if (index !== -1) {
                    const versionStr: string = compilerBaseName.substr(index);
                    lldbMIPath += versionStr;
                }
                fs.stat(lldbMIPath, (err, stats: fs.Stats) => {
                    if (stats && stats.isFile) {
                        defaultConfig.miDebuggerPath = lldbMIPath;
                    } else {
                        defaultConfig.miDebuggerPath = '/usr/bin/lldb-mi';
                    }
                    resolve(defaultConfig);
                });
            });
        });
    }

    /**
	 * Try to add all missing attributes to the debug configuration being launched.
	 */
    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        if (config) {
            // Fail if cppvsdbg type is running on non-Windows
            if (config.type === 'cppvsdbg' && os.platform() !== 'win32') {
                vscode.window.showErrorMessage("Debugger of type: 'cppvsdbg' is only available on Windows. Use type: 'cppdbg' on the current OS platform.");
                return undefined;
            }

            // Modify WSL config for OpenDebugAD7
            if (os.platform() === 'win32' &&
                config.pipeTransport &&
                config.pipeTransport.pipeProgram) {
                let replacedPipeProgram: string = null;
                const pipeProgramStr: string = config.pipeTransport.pipeProgram.toLowerCase().trim();

                // OpenDebugAD7 is a 32-bit process. Make sure the WSL pipe transport is using the correct program.
                replacedPipeProgram = debugUtils.ArchitectureReplacer.checkAndReplaceWSLPipeProgram(pipeProgramStr, debugUtils.ArchType.ia32);

                // If pipeProgram does not get replaced and there is a pipeCwd, concatenate with pipeProgramStr and attempt to replace.
                if (!replacedPipeProgram && !path.isAbsolute(pipeProgramStr) && config.pipeTransport.pipeCwd) {
                    const pipeCwdStr: string = config.pipeTransport.pipeCwd.toLowerCase().trim();
                    const newPipeProgramStr: string = path.join(pipeCwdStr, pipeProgramStr);

                    replacedPipeProgram = debugUtils.ArchitectureReplacer.checkAndReplaceWSLPipeProgram(newPipeProgramStr, debugUtils.ArchType.ia32);
                }

                if (replacedPipeProgram) {
                    config.pipeTransport.pipeProgram = replacedPipeProgram;
                }
            }
        }
        // if config or type is not specified, return null to trigger VS Code to open a configuration file https://github.com/Microsoft/vscode/issues/54213 
        return config && config.type ? config : null;
    }
}

export class CppVsDbgConfigurationProvider extends CppConfigurationProvider {
    public constructor(provider: IConfigurationAssetProvider) {
        super(provider, DebuggerType.cppvsdbg);
    }
}

export class CppDbgConfigurationProvider extends CppConfigurationProvider {
    public constructor(provider: IConfigurationAssetProvider) {
        super(provider, DebuggerType.cppdbg);
    }
}

export interface IConfigurationAssetProvider {
    getInitialConfigurations(debuggerType: DebuggerType): any;
    getConfigurationSnippets(): vscode.CompletionItem[];
}

export class ConfigurationAssetProviderFactory {
    public static getConfigurationProvider(): IConfigurationAssetProvider {
        switch (os.platform()) {
            case 'win32':
                return new WindowsConfigurationProvider();
            case 'darwin':
                return new OSXConfigurationProvider();
            case 'linux':
                return new LinuxConfigurationProvider();
            default:
                throw new Error("Unexpected OS type");
        }
    }
}

abstract class DefaultConfigurationProvider implements IConfigurationAssetProvider {
    configurations: IConfiguration[];

    public getInitialConfigurations(debuggerType: DebuggerType): any {
        let configurationSnippet: IConfigurationSnippet[] = [];

        // Only launch configurations are initial configurations
        this.configurations.forEach(configuration => {
            configurationSnippet.push(configuration.GetLaunchConfiguration());
        });

        let initialConfigurations: any = configurationSnippet.filter(snippet => snippet.debuggerType === debuggerType && snippet.isInitialConfiguration)
            .map(snippet => JSON.parse(snippet.bodyText));

        // If configurations is empty, then it will only have an empty configurations array in launch.json. Users can still add snippets.
        return initialConfigurations;
    }

    public getConfigurationSnippets(): vscode.CompletionItem[] {
        let completionItems: vscode.CompletionItem[] = [];

        this.configurations.forEach(configuration => {
            completionItems.push(convertConfigurationSnippetToCompetionItem(configuration.GetLaunchConfiguration()));
            completionItems.push(convertConfigurationSnippetToCompetionItem(configuration.GetAttachConfiguration()));
        });

        return completionItems;
    }
}

class WindowsConfigurationProvider extends DefaultConfigurationProvider {
    private executable: string = "a.exe";
    private pipeProgram: string = "<full path to pipe program such as plink.exe>";
    private MIMode: string = 'gdb';
    private setupCommandsBlock: string = `"setupCommands": [
    {
        "description": "Enable pretty-printing for gdb",
        "text": "-enable-pretty-printing",
        "ignoreFailures": true
    }
]`;

    constructor() {
        super();
        this.configurations = [
            new MIConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock),
            new PipeTransportConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock),
            new WindowsConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock),
            new WSLConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock),
        ];
    }
}

class OSXConfigurationProvider extends DefaultConfigurationProvider {
    private MIMode: string = 'lldb';
    private executable: string = "a.out";
    private pipeProgram: string = "/usr/bin/ssh";

    constructor() {
        super();
        this.configurations = [
            new MIConfigurations(this.MIMode, this.executable, this.pipeProgram),
        ];
    }
}

class LinuxConfigurationProvider extends DefaultConfigurationProvider {
    private MIMode: string = 'gdb';
    private setupCommandsBlock: string = `"setupCommands": [
    {
        "description": "Enable pretty-printing for gdb",
        "text": "-enable-pretty-printing",
        "ignoreFailures": true
    }
]`;
    private executable: string = "a.out";
    private pipeProgram: string = "/usr/bin/ssh";

    constructor() {
        super();
        this.configurations = [
            new MIConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock),
            new PipeTransportConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock)
        ];
    }
}

function convertConfigurationSnippetToCompetionItem(snippet: IConfigurationSnippet): vscode.CompletionItem {
    let item: vscode.CompletionItem = new vscode.CompletionItem(snippet.label, vscode.CompletionItemKind.Snippet);

    item.insertText = snippet.bodyText;

    return item;
}

export class ConfigurationSnippetProvider implements vscode.CompletionItemProvider {
    private provider: IConfigurationAssetProvider;
    private snippets: vscode.CompletionItem[];

    constructor(provider: IConfigurationAssetProvider) {
        this.provider = provider;
        this.snippets = this.provider.getConfigurationSnippets();
    }
    public resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken): Thenable<vscode.CompletionItem> {
        return Promise.resolve(item);
    }

    // This function will only provide completion items via the Add Configuration Button
    // There are two cases where the configuration array has nothing or has some items.
    // 1. If it has nothing, insert a snippet the user selected.
    // 2. If there are items, the Add Configuration button will append it to the start of the configuration array. This function inserts a comma at the end of the snippet.
    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Thenable<vscode.CompletionList> {
        let items: vscode.CompletionItem[] = this.snippets;

        const launch: any = parse(document.getText());
        // Check to see if the array is empty, so any additional inserted snippets will need commas.
        if (launch.configurations.length !== 0) {
            items = [];

            // Make a copy of each snippet since we are adding a comma to the end of the insertText.
            this.snippets.forEach((item) => items.push(Object.assign({}, item)));

            items.map((item) => {
                item.insertText = item.insertText + ','; // Add comma 
            });
        }

        return Promise.resolve(new vscode.CompletionList(items, true));
    }
}
