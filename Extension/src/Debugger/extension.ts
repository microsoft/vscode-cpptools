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
import { CppDbgDebugAdapterTrackerFactory } from './debugAdapterTrackerFactory';
import * as util from '../common';
import * as Telemetry from '../telemetry';
import * as nls from 'vscode-nls';
import { CppDbgDebugAdapterTracker } from './debugAdapterTracker';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// The extension deactivate method is asynchronous, so we handle the disposables ourselves instead of using extensonContext.subscriptions.
const disposables: vscode.Disposable[] = [];

export function buildAndDebugActiveFileStr(): string {
    return ` - ${localize("build.and.debug.active.file", 'Build and debug active file')}`;
}

export function initialize(context: vscode.ExtensionContext): void {
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
    let vsdbgProvider: CppVsDbgConfigurationProvider | null = null;
    if (os.platform() === 'win32') {
        vsdbgProvider = new CppVsDbgConfigurationProvider(configurationProvider);
        disposables.push(vscode.debug.registerDebugConfigurationProvider('cppvsdbg', new QuickPickConfigurationProvider(vsdbgProvider)));
    }
    const provider: CppDbgConfigurationProvider = new CppDbgConfigurationProvider(configurationProvider);
    disposables.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', new QuickPickConfigurationProvider(provider)));

    const trackerFactory: CppDbgDebugAdapterTrackerFactory = new CppDbgDebugAdapterTrackerFactory();
    disposables.push(vscode.debug.registerDebugAdapterTrackerFactory("cppdbg", trackerFactory))

    disposables.push(vscode.commands.registerCommand("C_Cpp.debugger.MemoryView", (any) => {
        vscode.window.showInputBox({
            prompt: "What memory do you want."
        }, undefined).then(memoryAddress => {
            vscode.window.showInputBox({
                prompt: "With what offset?"
            }, undefined).then(offset => {
                vscode.window.showInputBox({
                    prompt: "How much do you want to show?"
                }, undefined).then(size => {
                    if (memoryAddress)
                    {
                        const tracker: CppDbgDebugAdapterTracker | undefined = trackerFactory.getActiveDebugAdapterTracker()
                        if (tracker) 
                        {
                            tracker.sendReadMemoryRequest(memoryAddress, Number(offset), Number(size)).then(response => {
                                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath)
                                {
                                    const filePath = "C:\\cdmem\\memory.txt"
                                    const fsURI = vscode.Uri.parse(`file://${filePath}`);
                                    vscode.workspace.fs.writeFile(fsURI, Uint8Array.from(response.data)).then(() => {
                                        vscode.commands.executeCommand("vscode.openWith", fsURI, "hexEditor.hexedit", { preview: false });
                                    }, (error) => {
                                        const msg = (error.message || '') + '\nPerhaps expression for "address" contains invalid file name characters';
                                        vscode.window.showErrorMessage(`Unable to create/write memory file memory from ${fsURI.toString()}: ${msg}`);                  
                                    });
                                    console.log(response)
                                }
                            })
                        }
                    }
                })
            })
        })
    }));

    disposables.push(vscode.commands.registerTextEditorCommand("C_Cpp.BuildAndDebugActiveFile", async (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => {
        const folder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
        if (!folder) {
            // Not enabled because we do not react to single-file mode correctly yet.
            // We get an ENOENT when the user's c_cpp_properties.json is attempted to be parsed.
            // The DefaultClient will also have its configuration accessed, but since it doesn't exist it errors out.
            vscode.window.showErrorMessage('This command is not yet available for single-file mode.');
            return Promise.resolve();
        }

        if (!util.fileIsCOrCppSource(textEditor.document.uri.fsPath)) {
            vscode.window.showErrorMessage(localize("cannot.build.non.cpp", 'Cannot build and debug because the active file is not a C or C++ source file.'));
            return Promise.resolve();
        }

        const configs: vscode.DebugConfiguration[] = (await provider.provideDebugConfigurations(folder)).filter(config =>
            config.name.indexOf(buildAndDebugActiveFileStr()) !== -1);

        if (vsdbgProvider) {
            const vsdbgConfigs: vscode.DebugConfiguration[] = (await vsdbgProvider.provideDebugConfigurations(folder)).filter(config =>
                config.name.indexOf(buildAndDebugActiveFileStr()) !== -1);
            if (vsdbgConfigs) {
                configs.push(...vsdbgConfigs);
            }
        }

        interface MenuItem extends vscode.QuickPickItem {
            configuration: vscode.DebugConfiguration;
        }

        const items: MenuItem[] = configs.map<MenuItem>(config => ({label: config.name, configuration: config}));

        vscode.window.showQuickPick(items, {placeHolder: (items.length === 0 ? localize("no.compiler.found", "No compiler found") : localize("select.compiler", "Select a compiler"))}).then(async selection => {
            if (!selection) {
                return; // User canceled it.
            }
            if (selection.label.startsWith("cl.exe")) {
                if (!process.env.DevEnvDir || process.env.DevEnvDir.length === 0) {
                    vscode.window.showErrorMessage(localize("cl.exe.not.available", '{0} build and debug is only usable when VS Code is run from the Developer Command Prompt for VS.', "cl.exe"));
                    return;
                }
            }
            if (selection.configuration.preLaunchTask) {
                if (folder) {
                    try {
                        await util.ensureBuildTaskExists(selection.configuration.preLaunchTask);
                        Telemetry.logDebuggerEvent("buildAndDebug", { "success": "false" });
                    } catch (e) {
                        if (e && e.message === util.failedToParseTasksJson) {
                            vscode.window.showErrorMessage(util.failedToParseTasksJson);
                        }
                        return Promise.resolve();
                    }
                } else {
                    return Promise.resolve();
                    // TODO uncomment this when single file mode works correctly.
                    // const buildTasks: vscode.Task[] = await getBuildTasks(true);
                    // const task: vscode.Task = buildTasks.find(task => task.name === selection.configuration.preLaunchTask);
                    // await vscode.tasks.executeTask(task);
                    // delete selection.configuration.preLaunchTask;
                }
            }

            // Attempt to use the user's (possibly) modified configuration before using the generated one.
            try {
                await vscode.debug.startDebugging(folder, selection.configuration.name);
                Telemetry.logDebuggerEvent("buildAndDebug", { "success": "true" });
            } catch (e) {
                try {
                    vscode.debug.startDebugging(folder, selection.configuration);
                } catch (e) {
                    Telemetry.logDebuggerEvent("buildAndDebug", { "success": "false" });
                }
            }
        });
    }));

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
