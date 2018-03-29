/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as os from 'os';
import * as process from 'process';
import * as fs from 'fs';
import * as vscode from 'vscode';

import { IConfiguration, IConfigurationSnippet, DebuggerType, MIConfigurations, WindowsConfigurations, WSLConfigurations, PipeTransportConfigurations } from './configurations';
import { parse } from 'jsonc-parser';
import { getOutputChannelLogger, showOutputChannel } from '../logger';

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
    provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return this.provider.getInitialConfigurations(this.type);
    }

    /**
	 * Try to add all missing attributes to the debug configuration being launched.
	 */
    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        // Fail if cppvsdbg type is running on non-Windows
        if (config.type === 'cppvsdbg' && os.platform() !== 'win32') {
            vscode.window.showErrorMessage("Debugger of type: 'cppvsdbg' is only available on Windows. Use type: 'cppdbg' on the current OS platform.");
            return undefined;
        }

        const winDir: string = process.env.WINDIR ? process.env.WINDIR.toLowerCase() : null;
        const winDirAltDirSep: string =  process.env.WINDIR ? process.env.WINDIR.replace('\\', '/').toLowerCase() : null;

        // Help WSL users with using the correct pipeProgram if the one they selected does not exist.
        if (os.platform() === 'win32' &&
            config.pipeTransport &&
            config.pipeTransport.pipeProgram &&
            !fs.existsSync(config.pipeTransport.pipeProgram) &&
            (config.pipeTransport.pipeProgram.toLowerCase().indexOf(winDir) >= 0 || config.pipeTransport.pipeProgram.toLowerCase().indexOf(winDirAltDirSep) >= 0)) {
            const pipeProgramStr: string = config.pipeTransport.pipeProgram.toLowerCase();

            if (process.arch === 'x64') {
                const pathSep: string = checkForFolderInPath(pipeProgramStr, "sysnative");
                if (pathSep) {
                    // User has sysnative but is running VSCode 64 bit. Should be using System32 since sysnative is a 32bit concept.
                    config.pipeTransport.pipeProgram = pipeProgramStr.replace(`${pathSep}sysnative${pathSep}`, `${pathSep}system32${pathSep}`);
                    getOutputChannelLogger().appendLine(`WARNING: 64-bit VSCode should use System32 for the directory for pipeProgram.`);
                    getOutputChannelLogger().appendLine(`pipeProgram has been modified to be: ${config.pipeTransport.pipeProgram}`);
                    showOutputChannel();
                }
            } else if (process.arch === 'ia32') {
                const pathSep: string = checkForFolderInPath(pipeProgramStr, "system32");
                if (pathSep) {
                    // User has System32 but is running VSCode 32 bit. Should be using sysnative
                    config.pipeTransport.pipeProgram = pipeProgramStr.replace(`${pathSep}system32${pathSep}`, `${pathSep}sysnative${pathSep}`);
                    getOutputChannelLogger().appendLine(`WARNING: 32-bit VSCode should use sysnative for the directory for pipeProgram.`);
                    getOutputChannelLogger().appendLine(`pipeProgram has been modified to be: ${config.pipeTransport.pipeProgram}`);
                    showOutputChannel();
                }
            }
        }

        return config;
    }   
}

// Checks to see if the folder name is in the path using both win and unix style path seperators.
// Returns the path seperator it detected if the folder is in the path. 
// Or else it returns empty string to indicate it did not find it in the path.
function checkForFolderInPath(path: string, folder: string): string {
    if (path.indexOf(`/${folder}/`) >= 0) {
        return '/';
    } else if (path.indexOf(`\\${folder}\\`) >= 0) {
        return '\\';
    }

    return "";
}

export class CppVsDbgConfigurationProvider extends CppConfigurationProvider {
    public constructor(provider: IConfigurationAssetProvider) {
        super(provider, DebuggerType.cppvsdbg);
    }
}

export class CppDbgConfigurationProvider extends CppConfigurationProvider {
    public constructor(provider: IConfigurationAssetProvider)    {
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
