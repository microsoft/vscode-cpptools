/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as os from 'os';
import { AttachPicker, RemoteAttachPicker, AttachItemsProvider } from './attachToProcess';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { QuickPickConfigurationProvider, ConfigurationAssetProviderFactory, CppVsDbgConfigurationProvider, CppDbgConfigurationProvider, ConfigurationSnippetProvider, IConfigurationAssetProvider, buildAndDebug } from './configurationProvider';
import { CppdbgDebugAdapterDescriptorFactory, CppvsdbgDebugAdapterDescriptorFactory } from './debugAdapterDescriptorFactory';

// The extension deactivate method is asynchronous, so we handle the disposables ourselves instead of using extensonContext.subscriptions.
const disposables: vscode.Disposable[] = [];

export async function initialize(context: vscode.ExtensionContext): Promise<void> {
    // Activate Process Picker Commands
    const attachItemsProvider: AttachItemsProvider = NativeAttachItemsProviderFactory.Get();
    const attacher: AttachPicker = new AttachPicker(attachItemsProvider);
    disposables.push(vscode.commands.registerCommand('extension.pickNativeProcess', () => attacher.ShowAttachEntries()));
    const remoteAttacher: RemoteAttachPicker = new RemoteAttachPicker();
    disposables.push(vscode.commands.registerCommand('extension.pickRemoteNativeProcess', (any) => remoteAttacher.ShowAttachEntries(any)));

    // Activate ConfigurationProvider
    const configurationProvider: IConfigurationAssetProvider = ConfigurationAssetProviderFactory.getConfigurationProvider();
    // On non-windows platforms, the cppvsdbg debugger will not be registered for initial configurations.
    // This will cause it to not show up on the dropdown list.
    let cppVsDbgProvider: CppVsDbgConfigurationProvider | null = null;
    if (os.platform() === 'win32') {
        cppVsDbgProvider = new CppVsDbgConfigurationProvider(configurationProvider);
        disposables.push(vscode.debug.registerDebugConfigurationProvider('cppvsdbg', new QuickPickConfigurationProvider(cppVsDbgProvider)));
    }
    const cppDbgProvider: CppDbgConfigurationProvider = new CppDbgConfigurationProvider(configurationProvider);
    disposables.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', new QuickPickConfigurationProvider(cppDbgProvider)));

    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.BuildAndDebugFile", async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => { await buildAndDebug(textEditor, cppVsDbgProvider, cppDbgProvider); }));

    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.BuildAndRunFile", async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => { await buildAndDebug(textEditor, cppVsDbgProvider, cppDbgProvider, false); }));

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
