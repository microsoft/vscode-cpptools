/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as os from 'os';
import { AttachPicker, RemoteAttachPicker, AttachItemsProvider } from './attachToProcess';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { DebugConfigurationProvider, ConfigurationAssetProviderFactory, ConfigurationSnippetProvider, IConfigurationAssetProvider } from './configurationProvider';
import { CppdbgDebugAdapterDescriptorFactory, CppvsdbgDebugAdapterDescriptorFactory } from './debugAdapterDescriptorFactory';
import { DebuggerType } from './configurations';

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
    const assetProvider: IConfigurationAssetProvider = ConfigurationAssetProviderFactory.getConfigurationProvider();

    // Register DebugConfigurationProviders for "Run and Debug" in Debug Panel.
    // On windows platforms, the cppvsdbg debugger will also be registered for initial configurations.
    let cppVsDebugProvider: DebugConfigurationProvider | null = null;
    if (os.platform() === 'win32') {
        cppVsDebugProvider = new DebugConfigurationProvider(assetProvider, DebuggerType.cppvsdbg);
        disposables.push(vscode.debug.registerDebugConfigurationProvider(DebuggerType.cppvsdbg, cppVsDebugProvider, vscode.DebugConfigurationProviderTriggerKind.Dynamic));
    }
    const cppDebugProvider: DebugConfigurationProvider = new DebugConfigurationProvider(assetProvider, DebuggerType.cppdbg);
    disposables.push(vscode.debug.registerDebugConfigurationProvider(DebuggerType.cppdbg, cppDebugProvider, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

    // Register DebugConfigurationProviders for "Run and Debug" play button.
    const debugProvider: DebugConfigurationProvider = new DebugConfigurationProvider(assetProvider, DebuggerType.all);
    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.BuildAndDebugFile", async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => { await debugProvider.buildAndDebug(textEditor); }));
    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.BuildAndRunFile", async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => { await debugProvider.buildAndRun(textEditor); }));
    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.AddConfiguration", async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => { await debugProvider.addConfiguration(textEditor); }));

    assetProvider.getConfigurationSnippets();

    const launchJsonDocumentSelector: vscode.DocumentSelector = [{
        scheme: 'file',
        language: 'jsonc',
        pattern: '**/launch.json'
    }];

    // ConfigurationSnippetProvider needs to be initiallized after configurationProvider calls getConfigurationSnippets.
    disposables.push(vscode.languages.registerCompletionItemProvider(launchJsonDocumentSelector, new ConfigurationSnippetProvider(assetProvider)));

    // Register Debug Adapters
    disposables.push(vscode.debug.registerDebugAdapterDescriptorFactory(DebuggerType.cppvsdbg , new CppvsdbgDebugAdapterDescriptorFactory(context)));
    disposables.push(vscode.debug.registerDebugAdapterDescriptorFactory(DebuggerType.cppdbg, new CppdbgDebugAdapterDescriptorFactory(context)));

    vscode.Disposable.from(...disposables);
}

export function dispose(): void {
    disposables.forEach(d => d.dispose());
}
