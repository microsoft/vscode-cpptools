/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as chokidar from 'chokidar';
import * as os from 'os';
import { Configuration } from 'ssh-config';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { CppSettings } from '../LanguageServer/settings';
import { BaseNode, addSshTargetCmd, refreshCppSshTargetsViewCmd } from '../SSH/TargetsView/common';
import { SshTargetsProvider, getActiveSshTarget, initializeSshTargets, selectSshTarget } from '../SSH/TargetsView/sshTargetsProvider';
import { TargetLeafNode, setActiveSshTarget } from '../SSH/TargetsView/targetNodes';
import { sshCommandToConfig } from '../SSH/sshCommandToConfig';
import { getSshConfiguration, getSshConfigurationFiles, parseFailures, writeSshConfiguration } from '../SSH/sshHosts';
import { pathAccessible } from '../common';
import { getSshChannel } from '../logger';
import { AttachItemsProvider, AttachPicker, RemoteAttachPicker } from './attachToProcess';
import { ConfigurationAssetProviderFactory, ConfigurationSnippetProvider, DebugConfigurationProvider, IConfigurationAssetProvider } from './configurationProvider';
import { DebuggerType } from './configurations';
import { CppdbgDebugAdapterDescriptorFactory, CppvsdbgDebugAdapterDescriptorFactory } from './debugAdapterDescriptorFactory';
import { NativeAttachItemsProviderFactory } from './nativeAttach';

// The extension deactivate method is asynchronous, so we handle the disposables ourselves instead of using extensionContext.subscriptions.
const disposables: vscode.Disposable[] = [];
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

let sshTargetsViewEnabled: boolean = false;
let sshTargetsViewSetting: string | undefined;
let sshConfigWatcher: chokidar.FSWatcher | undefined;

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
    // On Windows platforms, the cppvsdbg debugger will also be registered for initial configurations.
    let cppVsDebugProvider: DebugConfigurationProvider | null = null;
    if (os.platform() === 'win32') {
        cppVsDebugProvider = new DebugConfigurationProvider(assetProvider, DebuggerType.cppvsdbg);
        disposables.push(vscode.debug.registerDebugConfigurationProvider(DebuggerType.cppvsdbg, cppVsDebugProvider, vscode.DebugConfigurationProviderTriggerKind.Dynamic));
    }
    const cppDebugProvider: DebugConfigurationProvider = new DebugConfigurationProvider(assetProvider, DebuggerType.cppdbg);
    disposables.push(vscode.debug.registerDebugConfigurationProvider(DebuggerType.cppdbg, cppDebugProvider, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

    // Register DebugConfigurationProviders for "Run and Debug" play button.
    const debugProvider: DebugConfigurationProvider = new DebugConfigurationProvider(assetProvider, DebuggerType.all);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.BuildAndDebugFile", async (textEditor: vscode.TextEditor, _edit: vscode.TextEditorEdit, ..._args: any[]) => { await debugProvider.buildAndDebug(textEditor); }));
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.BuildAndRunFile", async (textEditor: vscode.TextEditor, _edit: vscode.TextEditorEdit, ..._args: any[]) => { await debugProvider.buildAndRun(textEditor); }));
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.AddDebugConfiguration", async (textEditor: vscode.TextEditor, _edit: vscode.TextEditorEdit, ..._args: any[]) => {
        const folder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
        if (!folder) {
            void vscode.window.showWarningMessage(localize("add.debug.configuration.not.available.for.single.file", "Add debug configuration is not available for single file."));
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
    disposables.push(vscode.debug.registerDebugAdapterDescriptorFactory(DebuggerType.cppvsdbg, new CppvsdbgDebugAdapterDescriptorFactory(context)));
    disposables.push(vscode.debug.registerDebugAdapterDescriptorFactory(DebuggerType.cppdbg, new CppdbgDebugAdapterDescriptorFactory(context)));

    // SSH Targets View
    await initializeSshTargets();
    const sshTargetsProvider: SshTargetsProvider = new SshTargetsProvider();
    disposables.push(vscode.window.registerTreeDataProvider('CppSshTargetsView', sshTargetsProvider));
    disposables.push(vscode.commands.registerCommand(addSshTargetCmd, () => enableSshTargetsViewAndRun(addSshTargetImpl)));
    disposables.push(vscode.commands.registerCommand('C_Cpp.removeSshTarget', (node?: BaseNode) => enableSshTargetsViewAndRun(removeSshTargetImpl, node)));
    disposables.push(vscode.commands.registerCommand(refreshCppSshTargetsViewCmd, (node?: BaseNode) => enableSshTargetsViewAndRun((node?: BaseNode) => sshTargetsProvider.refresh(node), node)));
    disposables.push(vscode.commands.registerCommand('C_Cpp.setActiveSshTarget', async (node: TargetLeafNode) => {
        await enableSshTargetsView();
        await setActiveSshTarget(node.name);
        await vscode.commands.executeCommand(refreshCppSshTargetsViewCmd);
    }));
    disposables.push(vscode.commands.registerCommand('C_Cpp.selectSshTarget', () => enableSshTargetsViewAndRun(selectSshTarget)));
    disposables.push(vscode.commands.registerCommand('C_Cpp.selectActiveSshTarget', async () => {
        await enableSshTargetsView();
        const name: string | undefined = await selectSshTarget();
        if (name) {
            await setActiveSshTarget(name);
            await vscode.commands.executeCommand(refreshCppSshTargetsViewCmd);
        }
    }));
    disposables.push(vscode.commands.registerCommand('C_Cpp.activeSshTarget', () => enableSshTargetsViewAndRun(getActiveSshTarget)));
    disposables.push(vscode.commands.registerCommand('C_Cpp.sshTerminal', (node: TargetLeafNode) => enableSshTargetsViewAndRun(sshTerminal, node)));
    disposables.push(sshTargetsProvider);

    // Decide if we should show the SSH Targets View.
    sshTargetsViewSetting = new CppSettings().sshTargetsView;
    // Active SSH Target initialized in initializeSshTargets()
    if (sshTargetsViewSetting === 'enabled' || (sshTargetsViewSetting === 'default' && await getActiveSshTarget(false))) {
        // Don't wait
        void enableSshTargetsView();
    }

    disposables.push(vscode.workspace.onDidChangeConfiguration(async (e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration('C_Cpp.sshTargetsView')) {
            sshTargetsViewSetting = new CppSettings().sshTargetsView;
            if (sshTargetsViewSetting === 'enabled' || (sshTargetsViewSetting === 'default' && await getActiveSshTarget(false))) {
                await enableSshTargetsView();
            } else if (sshTargetsViewSetting === 'disabled') {
                await disableSshTargetsView();
            }
        }
    }));
}

export function dispose(): void {
    if (sshConfigWatcher) {
        void sshConfigWatcher.close();
        sshConfigWatcher = undefined;
    }
    disposables.forEach(d => d.dispose());
}

function sshTerminal(node: TargetLeafNode): void {
    const terminal: vscode.Terminal = vscode.window.createTerminal(`SSH: ${node.name}`);
    terminal.sendText(`ssh "${node.name}"`);
    terminal.show();
}

async function enableSshTargetsViewAndRun<T>(func: (...paras: any[]) => T | Promise<T>, ...args: any[]): Promise<T> {
    await enableSshTargetsView();
    return func(...args);
}

async function enableSshTargetsView(): Promise<void> {
    if (sshTargetsViewEnabled || sshTargetsViewSetting === 'disabled') {
        return;
    }
    await vscode.commands.executeCommand('setContext', 'cpptools.enableSshTargetsView', true);
    sshConfigWatcher = chokidar.watch(getSshConfigurationFiles(), { ignoreInitial: true })
        .on('add', () => void vscode.commands.executeCommand(refreshCppSshTargetsViewCmd))
        .on('change', () => void vscode.commands.executeCommand(refreshCppSshTargetsViewCmd))
        .on('unlink', () => void vscode.commands.executeCommand(refreshCppSshTargetsViewCmd));
    sshTargetsViewEnabled = true;
}

async function disableSshTargetsView(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'cpptools.enableSshTargetsView', false);
    if (sshConfigWatcher) {
        void sshConfigWatcher.close();
        sshConfigWatcher = undefined;
    }
    sshTargetsViewEnabled = false;
}

async function addSshTargetImpl(): Promise<string> {
    const validConfigFiles: string[] = [];
    for (const configFile of getSshConfigurationFiles()) {
        if (await pathAccessible(configFile) && parseFailures.get(configFile)) {
            getSshChannel().appendLine(localize('cannot.modify.config.file', 'Cannot modify SSH configuration file because of parse failure "{0}".', configFile));
        } else {
            validConfigFiles.push(configFile);
        }
    }
    if (validConfigFiles.length === 0) {
        throw new Error(localize('no.valid.ssh.config.file', 'No valid SSH configuration file found.'));
    }

    const name: string | undefined = await vscode.window.showInputBox({
        title: localize('enter.ssh.target.name', 'Enter SSH Target Name'),
        placeHolder: localize('ssh.target.name.place.holder', 'Example: `mySSHTarget`'),
        ignoreFocusOut: true
    });
    if (name === undefined) {
        // Cancelled
        return '';
    }

    const command: string | undefined = await vscode.window.showInputBox({
        title: localize('enter.ssh.connection.command', 'Enter SSH Connection Command'),
        placeHolder: localize('ssh.connection.command.place.holder', 'Example: `ssh hello@microsoft.com -A`'),
        ignoreFocusOut: true
    });
    if (!command) {
        return '';
    }

    const newEntry: { [key: string]: string } = sshCommandToConfig(command, name);

    const targetFile: string | undefined = await vscode.window.showQuickPick(validConfigFiles, { title: localize('select.ssh.config.file', 'Select an SSH configuration file') });
    if (!targetFile) {
        return '';
    }

    const parsedSshConfig: Configuration = await getSshConfiguration(targetFile, false);
    parsedSshConfig.prepend(newEntry, true);
    await writeSshConfiguration(targetFile, parsedSshConfig);

    return name;
}

async function removeSshTargetImpl(node: TargetLeafNode): Promise<boolean> {
    const labelYes: string = localize('yes', 'Yes');
    const labelNo: string = localize('no', 'No');
    const confirm: string | undefined = await vscode.window.showInformationMessage(localize('ssh.target.delete.confirmation', 'Are you sure you want to permanently delete "{0}"?', node.name), labelYes, labelNo);
    if (!confirm || confirm === labelNo) {
        return false;
    }

    const parsedSshConfig: Configuration = await getSshConfiguration(node.sshConfigHostInfo.file, false);
    parsedSshConfig.remove({ Host: node.name });
    await writeSshConfiguration(node.sshConfigHostInfo.file, parsedSshConfig);

    return true;
}
