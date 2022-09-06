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
import { cmd_addSshTarget, BaseNode, cmd_refreshCppSshTargetsView } from '../SSH/TargetsView/common';
import { setActiveSshTarget, TargetLeafNode } from '../SSH/TargetsView/targetNodes';
import { sshCommandToConfig } from '../SSH/sshCommandToConfig';
import { getSshConfiguration, getSshConfigurationFiles, writeSshConfiguration } from '../SSH/sshHosts';
import { pathAccessible } from '../common';
import * as fs from 'fs';
import { Configuration } from 'ssh-config';
import * as chokidar from 'chokidar';
import * as path from 'path';

// The extension deactivate method is asynchronous, so we handle the disposables ourselves instead of using extensionContext.subscriptions.
const disposables: vscode.Disposable[] = [];
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

let sshTargetsViewEnabled: boolean = false;
let sshConfigWatcher: chokidar.FSWatcher | undefined;
let tasksWatcher: chokidar.FSWatcher | undefined;
let launchesWatcher: chokidar.FSWatcher | undefined;

const cmd_removeSshTarget: string = 'C_Cpp.removeSshTarget';
const cmd_setActiveSshTarget: string = 'C_Cpp.setActiveSshTarget';
const cmd_selectSshTarget: string = 'C_Cpp.selectSshTarget';
const cmd_selectActiveSshTarget: string = 'C_Cpp.selectActiveSshTarget';
const cmd_activeSshTarget: string = 'C_Cpp.activeSshTarget';
const sshTargetsCommands: string[] = [
    cmd_addSshTarget,
    cmd_removeSshTarget,
    cmd_refreshCppSshTargetsView,
    cmd_setActiveSshTarget,
    cmd_selectSshTarget,
    cmd_selectActiveSshTarget,
    cmd_activeSshTarget
];

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
    disposables.push(vscode.commands.registerCommand(cmd_addSshTarget, () => enableSshTargetsViewAndRun(addSshTargetImpl)));
    disposables.push(vscode.commands.registerCommand(cmd_removeSshTarget, (node?: BaseNode) => enableSshTargetsViewAndRun(removeSshTargetImpl, node)));
    disposables.push(vscode.commands.registerCommand(cmd_refreshCppSshTargetsView, (node?: BaseNode) => enableSshTargetsViewAndRun(sshTargetsProvider.refresh, node)));
    disposables.push(vscode.commands.registerCommand(cmd_setActiveSshTarget, async (node: TargetLeafNode) => {
        await enableSshTargetsView();
        await setActiveSshTarget(node.name);
        await vscode.commands.executeCommand(cmd_refreshCppSshTargetsView);
    }));
    disposables.push(vscode.commands.registerCommand(cmd_selectSshTarget, () => enableSshTargetsViewAndRun(selectSshTarget)));
    disposables.push(vscode.commands.registerCommand(cmd_selectActiveSshTarget, async () => {
        await enableSshTargetsView();
        const name: string | undefined = await selectSshTarget();
        if (name) {
            await setActiveSshTarget(name);
            await vscode.commands.executeCommand(cmd_refreshCppSshTargetsView);
        }
    }));
    disposables.push(vscode.commands.registerCommand(cmd_activeSshTarget, () => enableSshTargetsViewAndRun(getActiveSshTarget)));
    disposables.push(vscode.commands.registerCommand('C_Cpp.enableSshTargetsView', () => enableSshTargetsViewAndRun(enableSshTargetsView)));
    disposables.push(sshTargetsProvider);
    if (vscode.workspace.workspaceFolders?.length) {
        const tasksJsonPaths: string[] = vscode.workspace.workspaceFolders.map(folder => path.join(folder.uri.fsPath, '.vscode', 'tasks.json'));
        const launchJsonPaths: string[] = vscode.workspace.workspaceFolders.map(folder => path.join(folder.uri.fsPath, '.vscode', 'launch.json'));
        tasksWatcher = chokidar.watch(tasksJsonPaths, { ignoreInitial: true })
            .on('add', tasksAndLaunchesChanged)
            .on('change', tasksAndLaunchesChanged);
        launchesWatcher = chokidar.watch(launchJsonPaths, { ignoreInitial: true })
            .on('add', tasksAndLaunchesChanged)
            .on('change', tasksAndLaunchesChanged);

        if (!sshTargetsViewEnabled) {
            for (const launchJsonPath of launchJsonPaths) {
                const viewEnabled: boolean = await tasksAndLaunchesChanged(launchJsonPath);
                if (viewEnabled) {
                    break;
                }
            }
        }
        if (!sshTargetsViewEnabled) {
            for (const tasksJsonPath of tasksJsonPaths) {
                const viewEnabled: boolean = await tasksAndLaunchesChanged(tasksJsonPath);
                if (viewEnabled) {
                    break;
                }
            }
        }
    }
}

export function dispose(): void {
    // Don't wait
    if (sshConfigWatcher) {
        sshConfigWatcher.close();
        sshConfigWatcher = undefined;
    }
    disposeTasksAndLaunchesWatchers();
    disposables.forEach(d => d.dispose());
}

function disposeTasksAndLaunchesWatchers(): void {
    if (tasksWatcher) {
        tasksWatcher.close();
        tasksWatcher = undefined;
    }
    if (launchesWatcher) {
        launchesWatcher.close();
        launchesWatcher = undefined;
    }
}

async function tasksAndLaunchesChanged(path: string): Promise<boolean> {
    const shouldEnableView: boolean = await containsSshTargetsCommands(path);
    if (shouldEnableView) {
        await enableSshTargetsView();
        disposeTasksAndLaunchesWatchers();
    }
    return shouldEnableView;
}

async function containsSshTargetsCommands(path: string): Promise<boolean> {
    const fileContents: string = (await vscode.workspace.fs.readFile(vscode.Uri.file(path))).toString();
    for (const command of sshTargetsCommands) {
        if (fileContents.includes(command)) {
            return true;
        }
    }
    return false;
}

async function enableSshTargetsViewAndRun<T>(func: (...paras: any[]) => T | Promise<T>, ...args: any[]): Promise<T> {
    await enableSshTargetsView();
    return func(...args);
}

async function enableSshTargetsView(): Promise<void> {
    if (sshTargetsViewEnabled) {
        return;
    }
    await vscode.commands.executeCommand('setContext', 'enableCppSshTargetsView', true);
    sshConfigWatcher = chokidar.watch(getSshConfigurationFiles(), {ignoreInitial: true})
        .on('add', () => vscode.commands.executeCommand(cmd_refreshCppSshTargetsView))
        .on('change', () => vscode.commands.executeCommand(cmd_refreshCppSshTargetsView))
        .on('unlink', () => vscode.commands.executeCommand(cmd_refreshCppSshTargetsView));
    sshTargetsViewEnabled = true;
}

async function addSshTargetImpl(): Promise<string> {
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

    const targetFile: string | undefined = await vscode.window.showQuickPick(getSshConfigurationFiles().filter(file => pathAccessible(file, fs.constants.W_OK)), { title: localize('select.ssh.config.file', 'Select an SSH configuration file') });
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
    const confirm: string | undefined = await vscode.window.showInformationMessage(localize('ssh.target.delete.confirmation', 'Are you sure you want to permanamtly delete "{0}"?', node.name), labelYes, labelNo);
    if (!confirm || confirm === labelNo) {
        return false;
    }

    const parsedSshConfig: Configuration = await getSshConfiguration(node.sshConfigHostInfo.file, false);
    parsedSshConfig.remove({ Host: node.name });
    await writeSshConfiguration(node.sshConfigHostInfo.file, parsedSshConfig);

    return true;
}
