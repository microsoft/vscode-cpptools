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
import * as nls from 'vscode-nls';
import { getActiveSshTarget, initializeSshTargets, selectSshTarget, SshTargetsProvider } from '../SSH/TargetsView/sshTargetsProvider';
import { BaseNode, refreshCppSshTargetsView } from '../SSH/TargetsView/common';
import { setActiveSshTarget, TargetLeafNode } from '../SSH/TargetsView/targetNodes';
import { sshCommandToConfig } from '../SSH/sshCommandToConfig';
import { getSshConfiguration, getSshConfigurationFiles, writeSshConfiguration } from '../SSH/sshHosts';
import { pathAccessible } from '../common';
import * as fs from 'fs';
import { Configuration } from 'ssh-config';

// The extension deactivate method is asynchronous, so we handle the disposables ourselves instead of using extensionContext.subscriptions.
const disposables: vscode.Disposable[] = [];
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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
    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.AddDebugConfiguration", async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => {
        const folder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
        if (!folder) {
            vscode.window.showWarningMessage(localize("add.debug.configuration.not.available.for.single.file", "Add debug configuration is not available for single file."));
        }
        await debugProvider.addDebugConfiguration(textEditor);
    }));

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

    // SSH Targets View
    await initializeSshTargets();
    const sshTargetsProvider: SshTargetsProvider = new SshTargetsProvider();
    disposables.push(vscode.window.registerTreeDataProvider('CppSshTargetsView', sshTargetsProvider));
    disposables.push(vscode.commands.registerCommand('C_Cpp.addSshTarget', addSshTarget));
    disposables.push(vscode.commands.registerCommand('C_Cpp.removeSshTarget', removeSshTarget));
    disposables.push(vscode.commands.registerCommand(refreshCppSshTargetsView, (node?: BaseNode) => sshTargetsProvider.refresh(node)));
    disposables.push(vscode.commands.registerCommand('C_Cpp.setActiveSshTarget', async (node: TargetLeafNode) => {
        await setActiveSshTarget(node.name);
        await vscode.commands.executeCommand(refreshCppSshTargetsView);
    }));
    disposables.push(vscode.commands.registerCommand('C_Cpp.selectSshTarget', selectSshTarget));
    disposables.push(vscode.commands.registerCommand('C_Cpp.selectActiveSshTarget', async () => {
        const name: string | undefined = await selectSshTarget();
        if (name) {
            await setActiveSshTarget(name);
            await vscode.commands.executeCommand(refreshCppSshTargetsView);
        }
    }));
    disposables.push(vscode.commands.registerCommand('C_Cpp.activeSshTarget', getActiveSshTarget));
    vscode.commands.executeCommand('setContext', 'showCppSshTargetsView', true);

    vscode.Disposable.from(...disposables);
}

export function dispose(): void {
    disposables.forEach(d => d.dispose());
}

async function addSshTarget(): Promise<boolean> {
    const name: string | undefined = await vscode.window.showInputBox({
        title: localize('enter.ssh.target.name', 'Enter SSH Target Name'),
        placeHolder: localize('ssh.target.name.place.holder', 'Example: `mySSHTarget`'),
        ignoreFocusOut: true
    });
    if (name === undefined) {
        // Cancelled
        return false;
    }

    const command: string | undefined = await vscode.window.showInputBox({
        title: localize('enter.ssh.connection.command', 'Enter SSH Connection Command'),
        placeHolder: localize('ssh.connection.command.place.holder', 'Example: `ssh hello@microsoft.com -A`'),
        ignoreFocusOut: true
    });
    if (!command) {
        return false;
    }

    const newEntry: { [key: string]: string } = sshCommandToConfig(command, name);

    const targetFile: string | undefined = await vscode.window.showQuickPick(getSshConfigurationFiles().filter(file => pathAccessible(file, fs.constants.W_OK)), { title: localize('select.ssh.config.file', 'Select a SSH configuration file') });
    if (!targetFile) {
        return false;
    }

    const parsed: Configuration = await getSshConfiguration(targetFile, false);
    parsed.prepend(newEntry, true);
    await writeSshConfiguration(targetFile, parsed);
    await vscode.commands.executeCommand(refreshCppSshTargetsView);

    return true;
}

async function removeSshTarget(node: TargetLeafNode): Promise<boolean> {
    const labelYes: string = localize('yes', 'Yes');
    const labelNo: string = localize('no', 'No');
    const confirm: string | undefined = await vscode.window.showInformationMessage(localize('ssh.target.delete.confirmation', 'Are you sure you want to permanamtly delete "{0}"?', node.name), labelYes, labelNo);
    if (!confirm || confirm === labelNo) {
        return false;
    }

    if (await getActiveSshTarget(false) === node.name) {
        await setActiveSshTarget(undefined);
    }

    const parsed: Configuration = await getSshConfiguration(node.sshConfigHostInfo.file, false);
    parsed.remove({ Host: node.name });
    await writeSshConfiguration(node.sshConfigHostInfo.file, parsed);
    await vscode.commands.executeCommand(refreshCppSshTargetsView);

    return true;
}
