/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as os from 'os';
import { AttachPicker, RemoteAttachPicker, AttachItemsProvider } from './attachToProcess';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { QuickPickConfigurationProvider, ConfigurationAssetProviderFactory, CppVsDbgConfigurationProvider, CppDbgConfigurationProvider, ConfigurationSnippetProvider, IConfigurationAssetProvider } from './configurationProvider';
import { CppdbgDebugAdapterDescriptorFactory, CppvsdbgDebugAdapterDescriptorFactory } from './debugAdapterDescriptorFactory';
import { getBuildTasks, BuildTaskDefinition, getClients } from '../LanguageServer/extension';
import * as path from 'path';
import * as util from '../common';
import * as fs from 'fs';

// The extension deactivate method is asynchronous, so we handle the disposables ourselves instead of using extensonContext.subscriptions.
let disposables: vscode.Disposable[] = [];

interface MenuItem extends vscode.QuickPickItem {
    preLaunchTask: vscode.Task;
}

export function initialize(): void {
    // Activate Process Picker Commands
    let attachItemsProvider: AttachItemsProvider = NativeAttachItemsProviderFactory.Get();
    let attacher: AttachPicker = new AttachPicker(attachItemsProvider);
    disposables.push(vscode.commands.registerCommand('extension.pickNativeProcess', () => attacher.ShowAttachEntries()));
    let remoteAttacher: RemoteAttachPicker = new RemoteAttachPicker();
    disposables.push(vscode.commands.registerCommand('extension.pickRemoteNativeProcess', (any) => remoteAttacher.ShowAttachEntries(any)));

    // Activate ConfigurationProvider
    let configurationProvider: IConfigurationAssetProvider = ConfigurationAssetProviderFactory.getConfigurationProvider();
    // On non-windows platforms, the cppvsdbg debugger will not be registered for initial configurations.
    // This will cause it to not show up on the dropdown list.
    if (os.platform() === 'win32') {
        disposables.push(vscode.debug.registerDebugConfigurationProvider('cppvsdbg', new CppVsDbgConfigurationProvider(configurationProvider)));
    }
    const provider: CppDbgConfigurationProvider = new CppDbgConfigurationProvider(configurationProvider);
    disposables.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', new QuickPickConfigurationProvider(provider)));

    // disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.BuildAndDebugActiveFile", async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => {
    //     let configs: vscode.DebugConfiguration[] = provider.provideDebugConfigurations(vscode.workspace.getWorkspaceFolder(textEditor.document.uri));
    //     let defaultConfigIndex: number = configs.findIndex(config => { return config.name.indexOf(" Launch") !== -1; });
    //     if (defaultConfigIndex !== -1) {
    //         configs.splice(defaultConfigIndex);
    //     }
    //     configs.map<MenuItem>(config => {
    //         return { label: config.name, configuration: config };
    //     });
    //     // if (!isCppSourceFile(textEditor.document.uri)) {
    //     //     vscode.window.showErrorMessage("Can only build/debug C/C++ source files"); // TODO figure out message.
    //     // }
    //     // provider.provideDebugConfigurations();
    //     if (!textEditor) {
    //         return;
    //     }
    //         const buildTasks: vscode.Task[] = await getBuildTasks();
    //         if (!buildTasks.length) {
    //             return;
    //         }

    //         let menuItems: MenuItem[] = buildTasks.map<MenuItem>(task => {
    //             let definition: BuildTaskDefinition = task.definition as BuildTaskDefinition;
    //             return {label: path.basename(definition.compilerPath) + " Build and Debug active file", preLaunchTask: task};
    //         });
    //         vscode.window.showQuickPick(menuItems, {placeHolder: "Select a debug configuration"}).then(async selection => {
    //             if (!selection) {
    //                 return;
    //             }

    //             let rawTasksJson: any = await util.getRawTasksJson();

    //             // Ensure that the task exists in the user's task.json. Task will not be found otherwise.
    //             if (!rawTasksJson.tasks) {
    //                 rawTasksJson.tasks = new Array();
    //             }
    //             // Find or create the task which should be created based on the selected "debug configuration"
    //             let selectedTask: vscode.Task = rawTasksJson.tasks.find(task => {
    //                 return task.label === selection.preLaunchTask.name;
    //             });
    //             if (!selectedTask) {
    //                 selectedTask = buildTasks.find((task: vscode.Task) => {
    //                     return task.name === selection.preLaunchTask.name;
    //                 });
    //                 let definition: BuildTaskDefinition = selectedTask.definition as BuildTaskDefinition;
    //                 delete definition.compilerPath; // TODO add desired properties to empty object, don't delete.
    //                 rawTasksJson.tasks.push(selectedTask.definition);
    //                 await util.writeFileText(util.getTasksJsonPath(), JSON.stringify(rawTasksJson, null, 2));
    //             }

    //             // Configure the default configuration for the selected task.
    //             const target: vscode.WorkspaceFolder = vscode.workspace.getWorkspaceFolder(getClients().ActiveClient.RootUri);
    //             let defaultConfig: any = provider.provideDebugConfigurations(target);
    //             defaultConfig.program = "${fileDirname}/${fileBasenameNoExtension}"; // TODO add exeName to BuildTaskDefinition and use here
    //             defaultConfig.preLaunchTask = selectedTask.name;
    //             defaultConfig.externalConsole = false;
    //             defaultConfig.name = "Build and Debug active file";

    //             if (!selection.preLaunchTask.name.startsWith("clang")) {
    //                 vscode.debug.startDebugging(target, defaultConfig);
    //                 return;
    //             }

    //             defaultConfig.MIMode = "lldb";
    //             delete defaultConfig.setupCommands;
    //             const compilerBaseName: string = path.basename(selection.preLaunchTask.definition.compilerPath);
    //             let index: number = compilerBaseName.indexOf('-');
    //             let lldbMIPath: string = path.dirname(selection.preLaunchTask.definition.compilerPath) + '/lldb-mi'; // TODO should be 'lldb' for Mac
    //             if (index !== -1) {
    //                 const versionStr: string = compilerBaseName.substr(index);
    //                 lldbMIPath += versionStr;
    //             }
    //             fs.stat(lldbMIPath, (err, stats: fs.Stats) => {
    //                 if (stats && stats.isFile) {
    //                     defaultConfig.miDebuggerPath = lldbMIPath;
    //                 } else {
    //                     defaultConfig.miDebuggerPath = '/usr/bin/lldb-mi';
    //                 }
    //                 const target: vscode.WorkspaceFolder = vscode.workspace.getWorkspaceFolder(getClients().ActiveClient.RootUri);
    //                 vscode.debug.startDebugging(target, defaultConfig);
    //             });
    //         });
    //     }));

    configurationProvider.getConfigurationSnippets();

    const launchJsonDocumentSelector: vscode.DocumentSelector = [{
        scheme: 'file',
        language: 'jsonc',
        pattern: '**/launch.json'
    }];

    // ConfigurationSnippetProvider needs to be initiallized after configurationProvider calls getConfigurationSnippets.
    disposables.push(vscode.languages.registerCompletionItemProvider(launchJsonDocumentSelector, new ConfigurationSnippetProvider(configurationProvider)));

    // Register Debug Adapters
    disposables.push(vscode.debug.registerDebugAdapterDescriptorFactory(CppvsdbgDebugAdapterDescriptorFactory.DEBUG_TYPE, new CppvsdbgDebugAdapterDescriptorFactory()));
    disposables.push(vscode.debug.registerDebugAdapterDescriptorFactory(CppdbgDebugAdapterDescriptorFactory.DEBUG_TYPE, new CppdbgDebugAdapterDescriptorFactory()));

    vscode.Disposable.from(...disposables);
}

export function dispose(): void {
    disposables.forEach(d => d.dispose());
}