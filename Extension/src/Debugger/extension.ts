/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as os from 'os';
import { AttachPicker, RemoteAttachPicker, AttachItemsProvider } from './attachToProcess';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { ConfigurationAssetProviderFactory, CppVsDbgConfigurationProvider, CppDbgConfigurationProvider, ConfigurationSnippetProvider, IConfigurationAssetProvider } from './configurationProvider';
import * as util from '../common';
import * as path from 'path';

// The extension deactivate method is asynchronous, so we handle the disposables ourselves instead of using extensonContext.subscriptions.
let disposables: vscode.Disposable[] = [];

export function initialize() {
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
    if (os.platform() === 'win32')
    {
        disposables.push(vscode.debug.registerDebugConfigurationProvider('cppvsdbg', new CppVsDbgConfigurationProvider(configurationProvider)));
    }
    disposables.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', new CppDbgConfigurationProvider(configurationProvider)));

    configurationProvider.getConfigurationSnippets();

    const launchJsonDocumentSelector: vscode.DocumentSelector = [{
        language: 'jsonc',
        pattern: '**/launch.json'
    }];
    // ConfigurationSnippetProvider needs to be initiallized after configurationProvider calls getConfigurationSnippets.
    disposables.push(vscode.languages.registerCompletionItemProvider(launchJsonDocumentSelector, new ConfigurationSnippetProvider(configurationProvider)));

    disposables.push(vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor));
    onDidChangeActiveTextEditor(vscode.window.activeTextEditor);

    // Activate Adapter Commands 
    registerAdapterExecutableCommands();

    vscode.Disposable.from(...disposables);
}

export function dispose(): void {
    disposables.forEach(d => d.dispose());
}

function onDidChangeActiveTextEditor(editor: vscode.TextEditor): void {
    if (util.getShowReloadPromptOnce() && editor && editor.document.fileName.endsWith(path.sep + "launch.json")) {
        util.showReloadOrWaitPromptOnce();
    }
}

// Registers adapterExecutableCommands for cppdbg and cppvsdbg. If it is not ready, it will prompt waiting for the download.
// 
// Note: util.extensionContext.extensionPath is needed for the commands because VsCode does not support relative paths for adapterExecutableComand
function registerAdapterExecutableCommands(): void {
    disposables.push(vscode.commands.registerCommand('extension.cppdbgAdapterExecutableCommand', () => {
        return util.checkInstallLockFile().then(ready => {
            if (ready)
            {
                let command: string = path.join(util.extensionContext.extensionPath, './debugAdapters/OpenDebugAD7');

                // Windows has the exe in debugAdapters/bin.
                if (os.platform() === 'win32')
                {
                    command = path.join(util.extensionContext.extensionPath, "./debugAdapters/bin/OpenDebugAD7.exe");
                }

                return {
                    command: command
                };
            }
            else {
                util.showReloadOrWaitPromptOnce();
                // TODO: VsCode displays null return as "Cannot find executable 'null'". Fix if they have a way to not display their prompt.
                return null;
            }
        });
    }));

    disposables.push(vscode.commands.registerCommand('extension.cppvsdbgAdapterExecutableCommand', () => {
        if (os.platform() != 'win32')
        {
            vscode.window.showErrorMessage("Debugger type 'cppvsdbg' is not avaliable for non-Windows machines.");
            return null;
        }
        else {
            return util.checkInstallLockFile().then(ready => {
                if (ready)
                {
                    return {
                        command: path.join(util.extensionContext.extensionPath, './debugAdapters/vsdbg/bin/vsdbg.exe'),
                        args: ['--interpreter=vscode']
                    };
                }
                else {
                    util.showReloadOrWaitPromptOnce();
                    // TODO: VsCode displays null return as "Cannot find executable 'null'". Fix if they have a way to not display their prompt.
                    return null;
                }
            });
        }
    }));
}
