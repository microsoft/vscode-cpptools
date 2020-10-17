/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as util from '../common';
import * as telemetry from '../telemetry';
import { TreeNode, NodeType } from './referencesModel';
import { UI, getUI } from './ui';
import { Client } from './client';
import { ClientCollection } from './clientCollection';
import { CppSettings, OtherSettings } from './settings';
import { PersistentWorkspaceState, PersistentState } from './persistentState';
import { getLanguageConfig } from './languageConfig';
import { getCustomConfigProviders } from './customProviders';
import { PlatformInformation } from '../platform';
import { Range } from 'vscode-languageclient';
import { ChildProcess, spawn } from 'child_process';
import { getTargetBuildInfo, BuildInfo } from '../githubAPI';
import { PackageVersion } from '../packageVersion';
import { getTemporaryCommandRegistrarInstance } from '../commands';
import * as rd from 'readline';
import * as yauzl from 'yauzl';
import { Readable, Writable } from 'stream';
import { ABTestSettings, getABTestSettings } from '../abTesting';
import * as nls from 'vscode-nls';
import { CppBuildTaskProvider } from './cppBuildTaskProvider';
import * as which from 'which';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
export const cppBuildTaskProvider: CppBuildTaskProvider = new CppBuildTaskProvider();

let prevCrashFile: string;
let clients: ClientCollection;
let activeDocument: string;
let ui: UI;
const disposables: vscode.Disposable[] = [];
let languageConfigurations: vscode.Disposable[] = [];
let intervalTimer: NodeJS.Timer;
let insiderUpdateEnabled: boolean = false;
let insiderUpdateTimer: NodeJS.Timer;
const insiderUpdateTimerInterval: number = 1000 * 60 * 60;
let realActivationOccurred: boolean = false;
let tempCommands: vscode.Disposable[] = [];
let activatedPreviously: PersistentWorkspaceState<boolean>;
let buildInfoCache: BuildInfo | undefined;
const cppInstallVsixStr: string = 'C/C++: Install vsix -- ';
let taskProvider: vscode.Disposable;
let codeActionProvider: vscode.Disposable;
export const intelliSenseDisabledError: string = "Do not activate the extension when IntelliSense is disabled.";

type vcpkgDatabase = { [key: string]: string[] }; // Stored as <header file entry> -> [<port name>]
let vcpkgDbPromise: Promise<vcpkgDatabase>;
function initVcpkgDatabase(): Promise<vcpkgDatabase> {
    return new Promise((resolve, reject) => {
        yauzl.open(util.getExtensionFilePath('VCPkgHeadersDatabase.zip'), { lazyEntries: true }, (err? : Error, zipfile?: yauzl.ZipFile) => {
            if (err || !zipfile) {
                resolve({});
                return;
            }
            zipfile.readEntry();
            let dbFound: boolean = false;
            zipfile.on('entry', entry => {
                if (entry.fileName !== 'VCPkgHeadersDatabase.txt') {
                    return;
                }
                dbFound = true;
                zipfile.openReadStream(entry, (err?: Error, stream?: Readable) => {
                    if (err || !stream) {
                        resolve({});
                        return;
                    }
                    const database: vcpkgDatabase = {};
                    const reader: rd.ReadLine = rd.createInterface(stream);
                    reader.on('line', (lineText: string) => {
                        const portFilePair: string[] = lineText.split(':');
                        if (portFilePair.length !== 2) {
                            return;
                        }

                        const portName: string = portFilePair[0];
                        const relativeHeader: string = portFilePair[1];

                        if (!database[relativeHeader]) {
                            database[relativeHeader] = [];
                        }

                        database[relativeHeader].push(portName);
                    });
                    reader.on('close', () => {
                        resolve(database);
                    });
                });
            });
            zipfile.on('end', () => {
                if (!dbFound) {
                    resolve({});
                }
            });
        });
    });
}

function getVcpkgHelpAction(): vscode.CodeAction {
    const dummy: any[] = [{}]; // To distinguish between entry from CodeActions and the command palette
    return {
        command: { title: 'vcpkgOnlineHelpSuggested', command: 'C_Cpp.VcpkgOnlineHelpSuggested', arguments: dummy },
        title: localize("learn.how.to.install.a.library", "Learn how to install a library for this header with vcpkg"),
        kind: vscode.CodeActionKind.QuickFix
    };
}

function getVcpkgClipboardInstallAction(port: string): vscode.CodeAction {
    return {
        command: { title: 'vcpkgClipboardInstallSuggested', command: 'C_Cpp.VcpkgClipboardInstallSuggested', arguments: [[port]] },
        title: localize("copy.vcpkg.command", "Copy vcpkg command to install '{0}' to the clipboard", port),
        kind: vscode.CodeActionKind.QuickFix
    };
}

async function lookupIncludeInVcpkg(document: vscode.TextDocument, line: number): Promise<string[]> {
    const matches: RegExpMatchArray | null = document.lineAt(line).text.match(/#include\s*[<"](?<includeFile>[^>"]*)[>"]/);
    if (!matches || !matches.length || !matches.groups) {
        return [];
    }
    const missingHeader: string = matches.groups['includeFile'].replace(/\//g, '\\');

    let portsWithHeader: string[] | undefined;
    const vcpkgDb: vcpkgDatabase = await vcpkgDbPromise;
    if (vcpkgDb) {
        portsWithHeader = vcpkgDb[missingHeader];
    }
    return portsWithHeader ? portsWithHeader : [];
}

function isMissingIncludeDiagnostic(diagnostic: vscode.Diagnostic): boolean {
    const missingIncludeCode: number = 1696;
    if (diagnostic.code === null || diagnostic.code === undefined || !diagnostic.source) {
        return false;
    }
    return diagnostic.code === missingIncludeCode && diagnostic.source === 'C/C++';
}

/**
 * activate: set up the extension for language services
 */
export function activate(activationEventOccurred: boolean): void {
    if (realActivationOccurred) {
        return; // Occurs if multiple delayed commands occur before the real commands are registered.
    }

    // Activate immediately if an activation event occurred in the previous workspace session.
    // If onActivationEvent doesn't occur, it won't auto-activate next time.
    activatedPreviously = new PersistentWorkspaceState("activatedPreviously", false);
    if (activatedPreviously.Value) {
        activatedPreviously.Value = false;
        realActivation();
    }

    if (tempCommands.length === 0) { // Only needs to be added once.
        tempCommands.push(vscode.workspace.onDidOpenTextDocument(onDidOpenTextDocument));
    }

    // handle "workspaceContains:/.vscode/c_cpp_properties.json" activation event.
    let cppPropertiesExists: boolean = false;
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        for (let i: number = 0; i < vscode.workspace.workspaceFolders.length; ++i) {
            const config: string = path.join(vscode.workspace.workspaceFolders[i].uri.fsPath, ".vscode/c_cpp_properties.json");
            if (fs.existsSync(config)) {
                vscode.workspace.openTextDocument(config).then((doc: vscode.TextDocument) => {
                    vscode.languages.setTextDocumentLanguage(doc, "jsonc");
                    cppPropertiesExists = true;
                });
            }
        }
    }

    // Check if an activation event has already occurred.
    if (activationEventOccurred) {
        onActivationEvent();
        return;
    }

    taskProvider = vscode.tasks.registerTaskProvider(CppBuildTaskProvider.CppBuildScriptType, cppBuildTaskProvider);

    vscode.tasks.onDidStartTask(event => {
        if (event.execution.task.source === CppBuildTaskProvider.CppBuildSourceStr) {
            telemetry.logLanguageServerEvent('buildTaskStarted');
        }
    });

    const selector: vscode.DocumentSelector = [
        { scheme: 'file', language: 'cpp' },
        { scheme: 'file', language: 'c' }
    ];
    codeActionProvider = vscode.languages.registerCodeActionsProvider(selector, {
        provideCodeActions: async (document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): Promise<vscode.CodeAction[]> => {
            if (!await clients.ActiveClient.getVcpkgEnabled()) {
                return [];
            }

            // Generate vcpkg install/help commands if the incoming doc/range is a missing include error
            if (!context.diagnostics.some(isMissingIncludeDiagnostic)) {
                return [];
            }

            telemetry.logLanguageServerEvent('codeActionsProvided', { "source": "vcpkg" });

            if (!await clients.ActiveClient.getVcpkgInstalled()) {
                return [getVcpkgHelpAction()];
            }

            const ports: string[] = await lookupIncludeInVcpkg(document, range.start.line);
            const actions: vscode.CodeAction[] = ports.map<vscode.CodeAction>(getVcpkgClipboardInstallAction);
            return actions;
        }
    });

    if (cppPropertiesExists) {
        onActivationEvent();
        return;
    }

    // handle "onLanguage:cpp" and "onLanguage:c" activation events.
    if (vscode.workspace.textDocuments !== undefined && vscode.workspace.textDocuments.length > 0) {
        for (let i: number = 0; i < vscode.workspace.textDocuments.length; ++i) {
            const document: vscode.TextDocument = vscode.workspace.textDocuments[i];
            if (document.uri.scheme === "file") {
                if (document.languageId === "cpp" || document.languageId === "c") {
                    onActivationEvent();
                    return;
                }
            }
        }
    }
}

function onDidOpenTextDocument(document: vscode.TextDocument): void {
    if (document.languageId === "c" || document.languageId === "cpp") {
        onActivationEvent();
    }
}

function onActivationEvent(): void {
    if (tempCommands.length === 0) {
        return;
    }

    // Cancel all the temp commands that just look for activations.
    tempCommands.forEach((command) => {
        command.dispose();
    });
    tempCommands = [];
    if (!realActivationOccurred) {
        realActivation();
    }
    activatedPreviously.Value = true;
}

function realActivation(): void {
    if (new CppSettings().intelliSenseEngine === "Disabled") {
        throw new Error(intelliSenseDisabledError);
    } else {
        console.log("activating extension");
        const checkForConflictingExtensions: PersistentState<boolean> = new PersistentState<boolean>("CPP." + util.packageJson.version + ".checkForConflictingExtensions", true);
        if (checkForConflictingExtensions.Value) {
            checkForConflictingExtensions.Value = false;
            const clangCommandAdapterActive: boolean = vscode.extensions.all.some((extension: vscode.Extension<any>, index: number, array: Readonly<vscode.Extension<any>[]>): boolean =>
                extension.isActive && extension.id === "mitaki28.vscode-clang");
            if (clangCommandAdapterActive) {
                telemetry.logLanguageServerEvent("conflictingExtension");
            }
        }
    }

    realActivationOccurred = true;
    console.log("starting language server");
    clients = new ClientCollection();
    ui = getUI();

    // Log cold start.
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (activeEditor) {
        clients.timeTelemetryCollector.setFirstFile(activeEditor.document.uri);
    }

    // There may have already been registered CustomConfigurationProviders.
    // Request for configurations from those providers.
    clients.forEach(client => {
        getCustomConfigProviders().forEach(provider => client.onRegisterCustomConfigurationProvider(provider));
    });

    disposables.push(vscode.workspace.onDidChangeConfiguration(onDidChangeSettings));
    disposables.push(vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor));
    ui.activeDocumentChanged(); // Handle already active documents (for non-cpp files that we don't register didOpen).
    disposables.push(vscode.window.onDidChangeTextEditorSelection(onDidChangeTextEditorSelection));
    disposables.push(vscode.window.onDidChangeVisibleTextEditors(onDidChangeVisibleTextEditors));

    updateLanguageConfigurations();

    reportMacCrashes();

    const settings: CppSettings = new CppSettings();

    vcpkgDbPromise = initVcpkgDatabase();

    PlatformInformation.GetPlatformInformation().then(info => {
        // Skip Insiders processing for 32-bit Linux.
        if (info.platform !== "linux" || info.architecture === "x86_64" || info.architecture === "arm" || info.architecture === "arm64") {
            // Skip Insiders processing for unsupported VS Code versions.
            const vscodeVersion: PackageVersion = new PackageVersion(vscode.version);
            const abTestSettings: ABTestSettings = getABTestSettings();
            const minimumSupportedVersionForInsidersUpgrades: PackageVersion = abTestSettings.getMinimumVSCodeVersion();
            if (!minimumSupportedVersionForInsidersUpgrades.isMajorMinorPatchGreaterThan(vscodeVersion)) {
                insiderUpdateEnabled = true;
                if (settings.updateChannel === 'Default') {
                    const userVersion: PackageVersion = new PackageVersion(util.packageJson.version);
                    if (userVersion.suffix === "insiders") {
                        checkAndApplyUpdate(settings.updateChannel, false);
                    } else {
                        suggestInsidersChannel();
                    }
                } else if (settings.updateChannel === 'Insiders') {
                    insiderUpdateTimer = global.setInterval(checkAndApplyUpdateOnTimer, insiderUpdateTimerInterval);
                    checkAndApplyUpdate(settings.updateChannel, false);
                }
            }
        }
    });

    clients.ActiveClient.notifyWhenReady(() => {
        intervalTimer = global.setInterval(onInterval, 2500);
    });
}

export function updateLanguageConfigurations(): void {
    languageConfigurations.forEach(d => d.dispose());
    languageConfigurations = [];

    languageConfigurations.push(vscode.languages.setLanguageConfiguration('c', getLanguageConfig('c')));
    languageConfigurations.push(vscode.languages.setLanguageConfiguration('cpp', getLanguageConfig('cpp')));
}

/**
 * workspace events
 */
function onDidChangeSettings(event: vscode.ConfigurationChangeEvent): void {
    const activeClient: Client = clients.ActiveClient;
    const changedActiveClientSettings: { [key: string]: string } = activeClient.onDidChangeSettings(event, true);
    clients.forEach(client => {
        if (client !== activeClient) {
            client.onDidChangeSettings(event, false);
        }
    });

    if (insiderUpdateEnabled) {
        const newUpdateChannel: string = changedActiveClientSettings['updateChannel'];
        if (newUpdateChannel) {
            if (newUpdateChannel === 'Default') {
                clearInterval(insiderUpdateTimer);
            } else if (newUpdateChannel === 'Insiders') {
                insiderUpdateTimer = global.setInterval(checkAndApplyUpdateOnTimer, insiderUpdateTimerInterval);
            }

            checkAndApplyUpdate(newUpdateChannel, true);
        }
    }
}

export function onDidChangeActiveTextEditor(editor?: vscode.TextEditor): void {
    /* need to notify the affected client(s) */
    console.assert(clients !== undefined, "client should be available before active editor is changed");
    if (clients === undefined) {
        return;
    }

    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!editor || !activeEditor || activeEditor.document.uri.scheme !== "file" || (activeEditor.document.languageId !== "cpp" && activeEditor.document.languageId !== "c")) {
        activeDocument = "";
    } else {
        activeDocument = editor.document.uri.toString();
        clients.activeDocumentChanged(editor.document);
        clients.ActiveClient.selectionChanged(Range.create(editor.selection.start, editor.selection.end));
    }
    ui.activeDocumentChanged();
}

function onDidChangeTextEditorSelection(event: vscode.TextEditorSelectionChangeEvent): void {
    /* need to notify the affected client(s) */
    if (!event.textEditor || !vscode.window.activeTextEditor || event.textEditor.document.uri !== vscode.window.activeTextEditor.document.uri ||
        event.textEditor.document.uri.scheme !== "file" ||
        (event.textEditor.document.languageId !== "cpp" && event.textEditor.document.languageId !== "c")) {
        return;
    }

    if (activeDocument !== event.textEditor.document.uri.toString()) {
        // For some unknown reason we don't reliably get onDidChangeActiveTextEditor callbacks.
        activeDocument = event.textEditor.document.uri.toString();
        clients.activeDocumentChanged(event.textEditor.document);
        ui.activeDocumentChanged();
    }
    clients.ActiveClient.selectionChanged(Range.create(event.selections[0].start, event.selections[0].end));
}

export function processDelayedDidOpen(document: vscode.TextDocument): void {
    const client: Client = clients.getClientFor(document.uri);
    if (client) {
        // Log warm start.
        clients.timeTelemetryCollector.setDidOpenTime(document.uri);
        if (clients.checkOwnership(client, document)) {
            if (!client.TrackedDocuments.has(document)) {
                // If not yet tracked, process as a newly opened file.  (didOpen is sent to server in client.takeOwnership()).
                client.TrackedDocuments.add(document);
                const finishDidOpen = (doc: vscode.TextDocument) => {
                    client.provideCustomConfiguration(doc.uri, undefined);
                    client.notifyWhenReady(() => {
                        client.takeOwnership(doc);
                        client.onDidOpenTextDocument(doc);
                    });
                };
                let languageChanged: boolean = false;
                // Work around vscode treating ".C" or ".H" as c, by adding this file name to file associations as cpp
                if ((document.uri.path.endsWith(".C") || document.uri.path.endsWith(".H")) && document.languageId === "c") {
                    const cppSettings: CppSettings = new CppSettings();
                    if (cppSettings.autoAddFileAssociations) {
                        const fileName: string = path.basename(document.uri.fsPath);
                        const mappingString: string = fileName + "@" + document.uri.fsPath;
                        client.addFileAssociations(mappingString, false);
                        client.sendDidChangeSettings({ files: { associations: new OtherSettings().filesAssociations }});
                        vscode.languages.setTextDocumentLanguage(document, "cpp").then((newDoc: vscode.TextDocument) => {
                            finishDidOpen(newDoc);
                        });
                        languageChanged = true;
                    }
                }
                if (!languageChanged) {
                    finishDidOpen(document);
                }
            }
        }
    }
}

function onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {
    // Process delayed didOpen for any visible editors we haven't seen before
    editors.forEach(editor => {
        if ((editor.document.uri.scheme === "file") && (editor.document.languageId === "c" || editor.document.languageId === "cpp")) {
            processDelayedDidOpen(editor.document);
        }
    });
}

function onInterval(): void {
    // TODO: do we need to pump messages to all clients? depends on what we do with the icons, I suppose.
    clients.ActiveClient.onInterval();
}

/**
 * Install a VSIX package. This helper function will exist until VSCode offers a command to do so.
 * @param updateChannel The user's updateChannel setting.
 */
function installVsix(vsixLocation: string): Thenable<void> {
    const userVersion: PackageVersion = new PackageVersion(vscode.version);

    // 1.33.0 introduces workbench.extensions.installExtension.  1.32.3 was immediately prior.
    const lastVersionWithoutInstallExtensionCommand: PackageVersion = new PackageVersion('1.32.3');
    if (userVersion.isVsCodeVersionGreaterThan(lastVersionWithoutInstallExtensionCommand)) {
        return vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixLocation));
    }

    // Get the path to the VSCode command -- replace logic later when VSCode allows calling of
    // workbench.extensions.action.installVSIX from TypeScript w/o instead popping up a file dialog
    return PlatformInformation.GetPlatformInformation().then((platformInfo) => {
        const vsCodeScriptPath: string | undefined = function(platformInfo): string | undefined {
            if (platformInfo.platform === 'win32') {
                const vsCodeBinName: string = path.basename(process.execPath);
                let cmdFile: string; // Windows VS Code Insiders/Exploration breaks VS Code naming conventions
                if (vsCodeBinName === 'Code - Insiders.exe') {
                    cmdFile = 'code-insiders.cmd';
                } else if (vsCodeBinName === 'Code - Exploration.exe') {
                    cmdFile = 'code-exploration.cmd';
                } else {
                    cmdFile = 'code.cmd';
                }
                const vsCodeExeDir: string = path.dirname(process.execPath);
                return path.join(vsCodeExeDir, 'bin', cmdFile);
            } else if (platformInfo.platform === 'darwin') {
                return path.join(process.execPath, '..', '..', '..', '..', '..',
                    'Resources', 'app', 'bin', 'code');
            } else {
                const vsCodeBinName: string = path.basename(process.execPath);
                try {
                    return which.sync(vsCodeBinName);
                } catch (error) {
                    return undefined;
                }
            }
        }(platformInfo);
        if (!vsCodeScriptPath) {
            return Promise.reject(new Error('Failed to find VS Code script'));
        }

        // 1.28.0 changes the CLI for making installations.  1.27.2 was immediately prior.
        const oldVersion: PackageVersion = new PackageVersion('1.27.2');
        if (userVersion.isVsCodeVersionGreaterThan(oldVersion)) {
            return new Promise<void>((resolve, reject) => {
                let process: ChildProcess;
                try {
                    process = spawn(vsCodeScriptPath, ['--install-extension', vsixLocation, '--force']);

                    // Timeout the process if no response is sent back. Ensures this Promise resolves/rejects
                    const timer: NodeJS.Timer = global.setTimeout(() => {
                        process.kill();
                        reject(new Error('Failed to receive response from VS Code script process for installation within 30s.'));
                    }, 30000);

                    process.on('exit', (code: number) => {
                        clearInterval(timer);
                        if (code !== 0) {
                            reject(new Error(`VS Code script exited with error code ${code}`));
                        } else {
                            resolve();
                        }
                    });
                    if (process.pid === undefined) {
                        throw new Error();
                    }
                } catch (error) {
                    reject(new Error('Failed to launch VS Code script process for installation'));
                    return;
                }
            });
        }

        return new Promise<void>((resolve, reject) => {
            let process: ChildProcess;
            try {
                process = spawn(vsCodeScriptPath, ['--install-extension', vsixLocation]);
                if (process.pid === undefined) {
                    throw new Error();
                }
            } catch (error) {
                reject(new Error('Failed to launch VS Code script process for installation'));
                return;
            }

            // Timeout the process if no response is sent back. Ensures this Promise resolves/rejects
            const timer: NodeJS.Timer = global.setTimeout(() => {
                process.kill();
                reject(new Error('Failed to receive response from VS Code script process for installation within 30s.'));
            }, 30000);

            // If downgrading, the VS Code CLI will prompt whether the user is sure they would like to downgrade.
            // Respond to this by writing 0 to stdin (the option to override and install the VSIX package)
            let sentOverride: boolean = false;
            const stdout: Readable | null = process.stdout;
            if (!stdout) {
                reject(new Error("Failed to communicate with VS Code script process for installation"));
                return;
            }
            stdout.on('data', () => {
                if (sentOverride) {
                    return;
                }
                const stdin: Writable | null = process.stdin;
                if (!stdin) {
                    reject(new Error("Failed to communicate with VS Code script process for installation"));
                    return;
                }
                stdin.write('0\n');
                sentOverride = true;
                clearInterval(timer);
                resolve();
            });
        });
    });
}

async function suggestInsidersChannel(): Promise<void> {
    const suggestInsiders: PersistentState<boolean> = new PersistentState<boolean>("CPP.suggestInsiders", true);

    if (!suggestInsiders.Value) {
        return;
    }
    let buildInfo: BuildInfo | undefined;
    try {
        buildInfo = await getTargetBuildInfo("Insiders", false);
    } catch (error) {
        console.log(`${cppInstallVsixStr}${error.message}`);
        if (error.message.indexOf('/') !== -1 || error.message.indexOf('\\') !== -1) {
            error.message = "Potential PII hidden";
        }
        telemetry.logLanguageServerEvent('suggestInsiders', { 'error': error.message, 'success': 'false' });
    }
    if (!buildInfo) {
        return; // No need to update.
    }
    const message: string = localize('insiders.available', "Insiders version {0} is available. Would you like to switch to the Insiders channel and install this update?", buildInfo.name);
    const yes: string = localize("yes.button", "Yes");
    const askLater: string = localize("ask.me.later.button", "Ask Me Later");
    const dontShowAgain: string = localize("dont.show.again.button", "Don't Show Again");
    const selection: string | undefined = await vscode.window.showInformationMessage(message, yes, askLater, dontShowAgain);
    switch (selection) {
        case yes:
            // Cache buildInfo.
            buildInfoCache = buildInfo;
            // It will call onDidChangeSettings.
            vscode.workspace.getConfiguration("C_Cpp").update("updateChannel", "Insiders", vscode.ConfigurationTarget.Global);
            break;
        case dontShowAgain:
            suggestInsiders.Value = false;
            break;
        case askLater:
            break;
        default:
            break;
    }
}

async function applyUpdate(buildInfo: BuildInfo): Promise<void> {
    let tempVSIX: any;
    try {
        tempVSIX = await util.createTempFileWithPostfix('.vsix');

        // Try to download VSIX
        const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
        const originalProxySupport: string | undefined = config.inspect<string>('http.proxySupport')?.globalValue;
        while (true) { // Might need to try again with a different http.proxySupport setting.
            try {
                await util.downloadFileToDestination(buildInfo.downloadUrl, tempVSIX.name);
            } catch {
                // Try again with the proxySupport to "off".
                if (originalProxySupport !== config.inspect<string>('http.proxySupport')?.globalValue) {
                    config.update('http.proxySupport', originalProxySupport, true); // Reset the http.proxySupport.
                    throw new Error('Failed to download VSIX package with proxySupport off'); // Changing the proxySupport didn't help.
                }
                if (config.get('http.proxySupport') !== "off" && originalProxySupport !== "off") {
                    config.update('http.proxySupport', "off", true);
                    continue;
                }
                throw new Error('Failed to download VSIX package');
            }
            if (originalProxySupport !== config.inspect<string>('http.proxySupport')?.globalValue) {
                config.update('http.proxySupport', originalProxySupport, true); // Reset the http.proxySupport.
                telemetry.logLanguageServerEvent('installVsix', { 'error': "Success with proxySupport off", 'success': 'true' });
            }
            break;
        }

        // Install VSIX
        try {
            await installVsix(tempVSIX.name);
        } catch (error) {
            throw new Error('Failed to install VSIX package');
        }

        // Installation successful
        clearInterval(insiderUpdateTimer);
        const message: string = localize("extension.updated",
            "The C/C++ Extension has been updated to version {0}. Please reload the window for the changes to take effect.",
            buildInfo.name);
        util.promptReloadWindow(message);
        telemetry.logLanguageServerEvent('installVsix', { 'success': 'true' });

    } catch (error) {
        console.error(`${cppInstallVsixStr}${error.message}`);
        if (error.message.indexOf('/') !== -1 || error.message.indexOf('\\') !== -1) {
            error.message = "Potential PII hidden";
        }
        telemetry.logLanguageServerEvent('installVsix', { 'error': error.message, 'success': 'false' });
    }

    // Delete temp VSIX file
    if (tempVSIX) {
        tempVSIX.removeCallback();
    }
}

async function checkAndApplyUpdateOnTimer(): Promise<void> {
    return checkAndApplyUpdate('Insiders', false);
}

/**
 * Query package.json and the GitHub API to determine whether the user should update, if so then install the update.
 * The update can be an upgrade or downgrade depending on the the updateChannel setting.
 * @param updateChannel The user's updateChannel setting.
 * @param isFromSettingsChange True if the invocation is the result of a settings change.
 */
async function checkAndApplyUpdate(updateChannel: string, isFromSettingsChange: boolean): Promise<void> {
    // If we have buildInfo cache, we should use it.
    let buildInfo: BuildInfo | undefined = buildInfoCache;
    // clear buildInfo cache.
    buildInfoCache = undefined;

    if (!buildInfo) {
        try {
            buildInfo = await getTargetBuildInfo(updateChannel, isFromSettingsChange);
        } catch (error) {
            telemetry.logLanguageServerEvent('installVsix', { 'error': error.message, 'success': 'false' });
        }
    }
    if (!buildInfo) {
        return; // No need to update.
    }
    await applyUpdate(buildInfo);
}

/**
 * registered commands
 */
let commandsRegistered: boolean = false;

export function registerCommands(): void {
    if (commandsRegistered) {
        return;
    }

    commandsRegistered = true;
    getTemporaryCommandRegistrarInstance().clearTempCommands();
    disposables.push(vscode.commands.registerCommand('C_Cpp.SwitchHeaderSource', onSwitchHeaderSource));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ResetDatabase', onResetDatabase));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationSelect', onSelectConfiguration));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationProviderSelect', onSelectConfigurationProvider));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEditJSON', onEditConfigurationJSON));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEditUI', onEditConfigurationUI));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEdit', onEditConfiguration));
    disposables.push(vscode.commands.registerCommand('C_Cpp.AddToIncludePath', onAddToIncludePath));
    disposables.push(vscode.commands.registerCommand('C_Cpp.EnableErrorSquiggles', onEnableSquiggles));
    disposables.push(vscode.commands.registerCommand('C_Cpp.DisableErrorSquiggles', onDisableSquiggles));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleIncludeFallback', onToggleIncludeFallback));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleDimInactiveRegions', onToggleDimInactiveRegions));
    disposables.push(vscode.commands.registerCommand('C_Cpp.PauseParsing', onPauseParsing));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ResumeParsing', onResumeParsing));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowParsingCommands', onShowParsingCommands));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowReferencesProgress', onShowReferencesProgress));
    disposables.push(vscode.commands.registerCommand('C_Cpp.TakeSurvey', onTakeSurvey));
    disposables.push(vscode.commands.registerCommand('C_Cpp.LogDiagnostics', onLogDiagnostics));
    disposables.push(vscode.commands.registerCommand('C_Cpp.RescanWorkspace', onRescanWorkspace));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowReferenceItem', onShowRefCommand));
    disposables.push(vscode.commands.registerCommand('C_Cpp.referencesViewGroupByType', onToggleRefGroupView));
    disposables.push(vscode.commands.registerCommand('C_Cpp.referencesViewUngroupByType', onToggleRefGroupView));
    disposables.push(vscode.commands.registerCommand('C_Cpp.VcpkgClipboardInstallSuggested', onVcpkgClipboardInstallSuggested));
    disposables.push(vscode.commands.registerCommand('C_Cpp.VcpkgOnlineHelpSuggested', onVcpkgOnlineHelpSuggested));
    disposables.push(vscode.commands.registerCommand('cpptools.activeConfigName', onGetActiveConfigName));
    disposables.push(vscode.commands.registerCommand('cpptools.activeConfigCustomVariable', onGetActiveConfigCustomVariable));
    disposables.push(vscode.commands.registerCommand('cpptools.setActiveConfigName', onSetActiveConfigName));
    getTemporaryCommandRegistrarInstance().executeDelayedCommands();
}

function onSwitchHeaderSource(): void {
    onActivationEvent();
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!activeEditor || !activeEditor.document) {
        return;
    }

    if (activeEditor.document.languageId !== "cpp" && activeEditor.document.languageId !== "c") {
        return;
    }

    let rootPath: string = clients.ActiveClient.RootPath;
    const fileName: string = activeEditor.document.fileName;

    if (!rootPath) {
        rootPath = path.dirname(fileName); // When switching without a folder open.
    }

    clients.ActiveClient.requestSwitchHeaderSource(rootPath, fileName).then((targetFileName: string) => {
        vscode.workspace.openTextDocument(targetFileName).then((document: vscode.TextDocument) => {
            let foundEditor: boolean = false;
            // If the document is already visible in another column, open it there.
            vscode.window.visibleTextEditors.forEach((editor, index, array) => {
                if (editor.document === document && !foundEditor) {
                    foundEditor = true;
                    vscode.window.showTextDocument(document, editor.viewColumn);
                }
            });
            // TODO: Handle non-visibleTextEditor...not sure how yet.
            if (!foundEditor) {
                if (vscode.window.activeTextEditor !== undefined) {
                    // TODO: Change to show it in a different column?
                    vscode.window.showTextDocument(document, vscode.window.activeTextEditor.viewColumn);
                } else {
                    vscode.window.showTextDocument(document);
                }
            }
        });
    });
}

/**
 * Allow the user to select a workspace when multiple workspaces exist and get the corresponding Client back.
 * The resulting client is used to handle some command that was previously invoked.
 */
function selectClient(): Thenable<Client> {
    if (clients.Count === 1) {
        return Promise.resolve(clients.ActiveClient);
    } else {
        return ui.showWorkspaces(clients.Names).then(key => {
            if (key !== "") {
                const client: Client | undefined = clients.get(key);
                if (client) {
                    return client;
                } else {
                    console.assert("client not found");
                }
            }
            return Promise.reject<Client>(localize("client.not.found", "client not found"));
        });
    }
}

function onResetDatabase(): void {
    onActivationEvent();
    clients.ActiveClient.resetDatabase();
}

function onSelectConfiguration(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize("configuration.select.first", 'Open a folder first to select a configuration'));
    } else {
        // This only applies to the active client. You cannot change the configuration for
        // a client that is not active since that client's UI will not be visible.
        clients.ActiveClient.handleConfigurationSelectCommand();
    }
}

function onSelectConfigurationProvider(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize("configuration.provider.select.first", 'Open a folder first to select a configuration provider'));
    } else {
        selectClient().then(client => client.handleConfigurationProviderSelectCommand(), rejected => {});
    }
}

function onEditConfigurationJSON(): void {
    onActivationEvent();
    telemetry.logLanguageServerEvent("SettingsCommand", { "palette": "json" }, undefined);
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize('edit.configurations.open.first', 'Open a folder first to edit configurations'));
    } else {
        selectClient().then(client => client.handleConfigurationEditJSONCommand(), rejected => {});
    }
}

function onEditConfigurationUI(): void {
    onActivationEvent();
    telemetry.logLanguageServerEvent("SettingsCommand", { "palette": "ui" }, undefined);
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize('edit.configurations.open.first', 'Open a folder first to edit configurations'));
    } else {
        selectClient().then(client => client.handleConfigurationEditUICommand(), rejected => {});
    }
}

function onEditConfiguration(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize('edit.configurations.open.first', 'Open a folder first to edit configurations'));
    } else {
        selectClient().then(client => client.handleConfigurationEditCommand(), rejected => {});
    }
}

function onAddToIncludePath(path: string): void {
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage(localize('add.includepath.open.first', 'Open a folder first to add to {0}', "includePath"));
    } else {
        // This only applies to the active client. It would not make sense to add the include path
        // suggestion to a different workspace.
        clients.ActiveClient.handleAddToIncludePathCommand(path);
    }
}

function onEnableSquiggles(): void {
    onActivationEvent();
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.update<string>("errorSquiggles", "Enabled");
}

function onDisableSquiggles(): void {
    onActivationEvent();
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.update<string>("errorSquiggles", "Disabled");
}

function onToggleIncludeFallback(): void {
    onActivationEvent();
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.toggleSetting("intelliSenseEngineFallback", "Enabled", "Disabled");
}

function onToggleDimInactiveRegions(): void {
    onActivationEvent();
    // This only applies to the active client.
    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.update<boolean>("dimInactiveRegions", !settings.dimInactiveRegions);
}

function onPauseParsing(): void {
    onActivationEvent();
    clients.ActiveClient.pauseParsing();
}

function onResumeParsing(): void {
    onActivationEvent();
    clients.ActiveClient.resumeParsing();
}

function onShowParsingCommands(): void {
    onActivationEvent();
    clients.ActiveClient.handleShowParsingCommands();
}

function onShowReferencesProgress(): void {
    onActivationEvent();
    clients.ActiveClient.handleReferencesIcon();
}

function onToggleRefGroupView(): void {
    // Set context to switch icons
    const client: Client = getActiveClient();
    client.toggleReferenceResultsView();
}

function onTakeSurvey(): void {
    onActivationEvent();
    telemetry.logLanguageServerEvent("onTakeSurvey");
    const uri: vscode.Uri = vscode.Uri.parse(`https://www.research.net/r/VBVV6C6?o=${os.platform()}&m=${vscode.env.machineId}`);
    vscode.commands.executeCommand('vscode.open', uri);
}

function onVcpkgOnlineHelpSuggested(dummy?: any): void {
    telemetry.logLanguageServerEvent('vcpkgAction', { 'source': dummy ? 'CodeAction' : 'CommandPalette', 'action': 'vcpkgOnlineHelpSuggested' });
    const uri: vscode.Uri = vscode.Uri.parse(`https://aka.ms/vcpkg`);
    vscode.commands.executeCommand('vscode.open', uri);
}

async function onVcpkgClipboardInstallSuggested(ports?: string[]): Promise<void> {
    onActivationEvent();
    let source: string;
    if (ports && ports.length) {
        source = 'CodeAction';
    } else {
        source = 'CommandPalette';
        // Glob up all existing diagnostics for missing includes and look them up in the vcpkg database
        const missingIncludeLocations: [vscode.TextDocument, number[]][] = [];
        vscode.languages.getDiagnostics().forEach(uriAndDiagnostics => {
            // Extract textDocument
            const textDocument: vscode.TextDocument | undefined = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === uriAndDiagnostics[0].fsPath);
            if (!textDocument) {
                return;
            }

            // Extract lines numbers for missing include diagnostics
            let lines: number[] = uriAndDiagnostics[1].filter(isMissingIncludeDiagnostic).map<number>(d => d.range.start.line);
            if (!lines.length) {
                return;
            }

            // Filter duplicate lines
            lines = lines.filter((line: number, index: number) => {
                const foundIndex: number = lines.indexOf(line);
                return foundIndex === index;
            });

            missingIncludeLocations.push([textDocument, lines]);
        });
        if (!missingIncludeLocations.length) {
            return;
        }

        // Queue look ups in the vcpkg database for missing ports; filter out duplicate results
        const portsPromises: Promise<string[]>[] = [];
        missingIncludeLocations.forEach(docAndLineNumbers => {
            docAndLineNumbers[1].forEach(async line => {
                portsPromises.push(lookupIncludeInVcpkg(docAndLineNumbers[0], line));
            });
        });
        ports = ([] as string[]).concat(...(await Promise.all(portsPromises)));
        if (!ports.length) {
            return;
        }
        const ports2: string[] = ports;
        ports = ports2.filter((port: string, index: number) => ports2.indexOf(port) === index);
    }

    let installCommand: string = 'vcpkg install';
    ports.forEach(port => installCommand += ` ${port}`);
    telemetry.logLanguageServerEvent('vcpkgAction', { 'source': source, 'action': 'vcpkgClipboardInstallSuggested', 'ports': ports.toString() });

    await vscode.env.clipboard.writeText(installCommand);
}

function onSetActiveConfigName(configurationName: string): Thenable<void> {
    return clients.ActiveClient.setCurrentConfigName(configurationName);
}

function onGetActiveConfigName(): Thenable<string | undefined> {
    return clients.ActiveClient.getCurrentConfigName();
}

function onGetActiveConfigCustomVariable(variableName: string): Thenable<string> {
    return clients.ActiveClient.getCurrentConfigCustomVariable(variableName);
}

function onLogDiagnostics(): void {
    onActivationEvent();
    clients.ActiveClient.logDiagnostics();
}

function onRescanWorkspace(): void {
    onActivationEvent();
    clients.ActiveClient.rescanFolder();
}

function onShowRefCommand(arg?: TreeNode): void {
    if (!arg) {
        return;
    }
    const { node } = arg;
    if (node === NodeType.reference) {
        const { referenceLocation } = arg;
        if (referenceLocation) {
            vscode.window.showTextDocument(referenceLocation.uri, {
                selection: referenceLocation.range.with({ start: referenceLocation.range.start, end: referenceLocation.range.end })
            });
        }
    } else if (node === NodeType.fileWithPendingRef) {
        const { fileUri } = arg;
        if (fileUri) {
            vscode.window.showTextDocument(fileUri);
        }
    }
}

function reportMacCrashes(): void {
    if (process.platform === "darwin") {
        prevCrashFile = "";
        const home: string | undefined = process.env.HOME;
        if (!home) {
            return;
        }
        const crashFolder: string = path.resolve(home, "Library/Logs/DiagnosticReports");
        fs.stat(crashFolder, (err, stats) => {
            const crashObject: { [key: string]: string } = {};
            if (err?.code) {
                // If the directory isn't there, we have a problem...
                crashObject["fs.stat: err.code"] = err.code;
                telemetry.logLanguageServerEvent("MacCrash", crashObject, undefined);
                return;
            }

            // vscode.workspace.createFileSystemWatcher only works in workspace folders.
            try {
                fs.watch(crashFolder, (event, filename) => {
                    if (event !== "rename") {
                        return;
                    }
                    if (filename === prevCrashFile) {
                        return;
                    }
                    prevCrashFile = filename;
                    if (!filename.startsWith("cpptools")) {
                        return;
                    }
                    // Wait 5 seconds to allow time for the crash log to finish being written.
                    setTimeout(() => {
                        fs.readFile(path.resolve(crashFolder, filename), 'utf8', (err, data) => {
                            if (err) {
                                // Try again?
                                fs.readFile(path.resolve(crashFolder, filename), 'utf8', handleCrashFileRead);
                                return;
                            }
                            handleCrashFileRead(err, data);
                        });
                    }, 5000);
                });
            } catch (e) {
                // The file watcher limit is hit (may not be possible on Mac, but just in case).
            }
        });
    }
}

function logCrashTelemetry(data: string): void {
    const crashObject: { [key: string]: string } = {};
    crashObject["CrashingThreadCallStack"] = data;
    telemetry.logLanguageServerEvent("MacCrash", crashObject, undefined);
}

function handleCrashFileRead(err: NodeJS.ErrnoException | undefined | null, data: string): void {
    if (err) {
        return logCrashTelemetry("readFile: " + err.code);
    }

    // Extract the crashing process version, because the version might not match
    // if multiple VS Codes are running with different extension versions.
    let binaryVersion: string = "";
    const startVersion: number = data.indexOf("Version:");
    if (startVersion >= 0) {
        data = data.substr(startVersion);
        const binaryVersionMatches: string[] | null = data.match(/^Version:\s*(\d*\.\d*\.\d*\.\d*|\d)/);
        binaryVersion = binaryVersionMatches && binaryVersionMatches.length > 1 ? binaryVersionMatches[1] : "";
    }

    // Extract the crashing thread's call stack.
    const crashStart: string = " Crashed:";
    let startCrash: number = data.indexOf(crashStart);
    if (startCrash < 0) {
        return logCrashTelemetry("No crash start");
    }
    startCrash += crashStart.length + 1; // Skip past crashStart.
    let endCrash: number = data.indexOf("Thread ", startCrash);
    if (endCrash < 0) {
        endCrash = data.length - 1; // Not expected, but just in case.
    }
    if (endCrash <= startCrash) {
        return logCrashTelemetry("No crash end");
    }
    data = data.substr(startCrash, endCrash - startCrash);

    // Get rid of the memory addresses (which breaks being able get a hit count for each crash call stack).
    data = data.replace(/0x................ /g, "");
    data = data.replace(/0x1........ \+ 0/g, "");

    // Get rid of the process names on each line and just add it to the start.
    const process1: string = "cpptools-srv";
    const process2: string = "cpptools";
    if (data.includes(process1)) {
        data = data.replace(new RegExp(process1 + "\\s+", "g"), "");
        data = `${process1}\t${binaryVersion}\n${data}`;
    } else if (data.includes(process2)) {
        data = data.replace(new RegExp(process2 + "\\s+", "g"), "");
        data = `${process2}\t${binaryVersion}\n${data}`;
    } else {
        // Not expected, but just in case.
        data = `cpptools?\t${binaryVersion}\n${data}`;
    }

    // Remove runtime lines because they can be different on different machines.
    const lines: string[] = data.split("\n");
    data = "";
    lines.forEach((line: string) => {
        if (!line.includes(".dylib") && !line.includes("???")) {
            line = line.replace(/^\d+\s+/, ""); // Remove <numbers><spaces> from the start of the line.
            line = line.replace(/std::__1::/g, "std::");  // __1:: is not helpful.
            data += (line + "\n");
        }
    });
    data = data.trimRight();

    if (data.length > 8192) { // The API has an 8k limit.
        data = data.substr(0, 8189) + "...";
    }

    logCrashTelemetry(data);
}

export function deactivate(): Thenable<void> {
    clients.timeTelemetryCollector.clear();
    console.log("deactivating extension");
    telemetry.logLanguageServerEvent("LanguageServerShutdown");
    clearInterval(intervalTimer);
    clearInterval(insiderUpdateTimer);
    disposables.forEach(d => d.dispose());
    languageConfigurations.forEach(d => d.dispose());
    ui.dispose();
    if (taskProvider) {
        taskProvider.dispose();
    }
    if (codeActionProvider) {
        codeActionProvider.dispose();
    }
    return clients.dispose();
}

export function isFolderOpen(): boolean {
    return vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length > 0;
}

export function getClients(): ClientCollection {
    if (!realActivationOccurred) {
        realActivation();
    }
    return clients;
}

export function getActiveClient(): Client {
    if (!realActivationOccurred) {
        realActivation();
    }
    return clients.ActiveClient;
}
