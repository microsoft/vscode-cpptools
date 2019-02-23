/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as os from 'os';
import { AttachPicker, RemoteAttachPicker, AttachItemsProvider } from './attachToProcess';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { ConfigurationAssetProviderFactory, CppVsDbgConfigurationProvider, CppDbgConfigurationProvider, ConfigurationSnippetProvider, IConfigurationAssetProvider } from './configurationProvider';
import { CppdbgDebugAdapterDescriptorFactory, CppvsdbgDebugAdapterDescriptorFactory } from './debugAdapterDescriptorFactory';

// The extension deactivate method is asynchronous, so we handle the disposables ourselves instead of using extensonContext.subscriptions.
let disposables: vscode.Disposable[] = [];

export function initialize(context: vscode.ExtensionContext): void {
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
    disposables.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', new CppDbgConfigurationProvider(configurationProvider)));

    configurationProvider.getConfigurationSnippets();

    const launchJsonDocumentSelector: vscode.DocumentSelector = [{
        scheme: 'file',
        language: 'jsonc',
        pattern: '**/launch.json'
    }];

    // ConfigurationSnippetProvider needs to be initiallized after configurationProvider calls getConfigurationSnippets.
    disposables.push(vscode.languages.registerCompletionItemProvider(launchJsonDocumentSelector, new ConfigurationSnippetProvider(configurationProvider)));

    // Register Debug Adapters
    disposables.push(vscode.debug.registerDebugAdapterDescriptorFactory(CppvsdbgDebugAdapterDescriptorFactory.DEBUG_TYPE, new CppvsdbgDebugAdapterDescriptorFactory(context)));
    disposables.push(vscode.debug.registerDebugAdapterDescriptorFactory(CppdbgDebugAdapterDescriptorFactory.DEBUG_TYPE, new CppdbgDebugAdapterDescriptorFactory(context)));

    vscode.Disposable.from(...disposables);
}

export function dispose(): void {
    disposables.forEach(d => d.dispose());
}