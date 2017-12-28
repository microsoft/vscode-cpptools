/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as os from 'os';
import { AttachPicker, RemoteAttachPicker } from './attachToProcess';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { ConfigurationAssetProviderFactory, CppVsDbgConfigurationProvider, CppDbgConfigurationProvider } from './configurationProvider';
import { DebuggerType } from './configurations';
import * as util from '../common';
import * as path from 'path';

// The extension deactivate method is asynchronous, so we handle the disposables ourselves instead of using extensonContext.subscriptions.
let disposables: vscode.Disposable[] = [];

export function activate() {
    // Activate Process Picker Commands
    let attachItemsProvider = NativeAttachItemsProviderFactory.Get();
    let attacher = new AttachPicker(attachItemsProvider);
    disposables.push(vscode.commands.registerCommand('extension.pickNativeProcess', () => attacher.ShowAttachEntries()));
    let remoteAttacher = new RemoteAttachPicker();
    disposables.push(vscode.commands.registerCommand('extension.pickRemoteNativeProcess', (any) => remoteAttacher.ShowAttachEntries(any)));

    // Activate ConfigurationProvider
    let configurationProvider = ConfigurationAssetProviderFactory.getConfigurationProvider();
    // On non-windows platforms, the cppvsdbg debugger will not be registered for initial configurations.
    // This will cause it to not show up on the dropdown list.
    if (os.platform() === 'win32')
    {
        disposables.push(vscode.debug.registerDebugConfigurationProvider('cppvsdbg', new CppVsDbgConfigurationProvider(configurationProvider)));
    }
    disposables.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', new CppDbgConfigurationProvider(configurationProvider)));

    configurationProvider.getConfigurationSnippets();

    disposables.push(vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor));
    onDidChangeActiveTextEditor(vscode.window.activeTextEditor);
}

export function deactivate(): void {
    disposables.forEach(d => d.dispose());
}

function onDidChangeActiveTextEditor(editor: vscode.TextEditor): void {
    if (util.getShowReloadPromptOnce() && editor && editor.document.fileName.endsWith(path.sep + "launch.json"))
        util.showReloadOrWaitPromptOnce();
}