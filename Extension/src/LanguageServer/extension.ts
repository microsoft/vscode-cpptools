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
import { UI, getUI } from './ui';
import { Client } from './client';
import { ClientCollection } from './clientCollection';
import { CppSettings } from './settings';
import { PersistentWorkspaceState } from './persistentState';
import { getLanguageConfig } from './languageConfig';
import { getCustomConfigProviders } from './customProviders';
import { PlatformInformation } from '../platform';
import { Range } from 'vscode-languageclient';
import { ChildProcess, spawn, execSync } from 'child_process';
import * as tmp from 'tmp';
import { getTargetBuildInfo } from '../githubAPI';

let prevCrashFile: string;
let clients: ClientCollection;
let activeDocument: string;
let ui: UI;
let disposables: vscode.Disposable[] = [];
let languageConfigurations: vscode.Disposable[] = [];
let intervalTimer: NodeJS.Timer;
let insiderUpdateTimer: NodeJS.Timer;
let realActivationOccurred: boolean = false;
let tempCommands: vscode.Disposable[] = [];
let activatedPreviously: PersistentWorkspaceState<boolean>;
const insiderUpdateTimerInterval: number = 1000 * 60 * 60;

/**
 * activate: set up the extension for language services
 */
export function activate(activationEventOccurred: boolean): void {
    console.log("activating extension");

    // Activate immediately if an activation event occurred in the previous workspace session.
    // If onActivationEvent doesn't occur, it won't auto-activate next time.
    activatedPreviously = new PersistentWorkspaceState("activatedPreviously", false);
    if (activatedPreviously.Value) {
        activatedPreviously.Value = false;
        realActivation();
    }

    registerCommands();
    tempCommands.push(vscode.workspace.onDidOpenTextDocument(d => onDidOpenTextDocument(d)));

    // Check if an activation event has already occurred.
    if (activationEventOccurred) {
        onActivationEvent();
        return;
    }

    // handle "workspaceContains:/.vscode/c_cpp_properties.json" activation event.
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        for (let i: number = 0; i < vscode.workspace.workspaceFolders.length; ++i) {
            let config: string = path.join(vscode.workspace.workspaceFolders[i].uri.fsPath, ".vscode/c_cpp_properties.json");
            if (fs.existsSync(config)) {
                onActivationEvent();
                return;
            }
        }
    }

    // handle "onLanguage:cpp" and "onLanguage:c" activation events.
    if (vscode.workspace.textDocuments !== undefined && vscode.workspace.textDocuments.length > 0) {
        for (let i: number = 0; i < vscode.workspace.textDocuments.length; ++i) {
            let document: vscode.TextDocument = vscode.workspace.textDocuments[i];
            if (document.languageId === "cpp" || document.languageId === "c") {
                onActivationEvent();
                return;
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
        throw new Error("Do not activate the extension when IntelliSense is disabled.");
    }

    realActivationOccurred = true;
    console.log("starting language server");
    clients = new ClientCollection();
    ui = getUI();

    // Check for files left open from the previous session. We won't get events for these until they gain focus,
    // so we manually activate the visible file.
    if (vscode.workspace.textDocuments !== undefined && vscode.workspace.textDocuments.length > 0) {
        onDidChangeActiveTextEditor(vscode.window.activeTextEditor);
    }

    // There may have already been registered CustomConfigurationProviders.
    // Request for configurations from those providers.
    clients.forEach(client => {
        getCustomConfigProviders().forEach(provider => client.onRegisterCustomConfigurationProvider(provider));
    });

    disposables.push(vscode.workspace.onDidChangeConfiguration(onDidChangeSettings));
    disposables.push(vscode.workspace.onDidSaveTextDocument(onDidSaveTextDocument));
    disposables.push(vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor));
    disposables.push(vscode.window.onDidChangeTextEditorSelection(onDidChangeTextEditorSelection));
    disposables.push(vscode.window.onDidChangeVisibleTextEditors(onDidChangeVisibleTextEditors));

    updateLanguageConfigurations();

    reportMacCrashes();

    const settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    if (settings.updateChannel === 'Insiders') {
        insiderUpdateTimer = setInterval(checkAndApplyUpdate, insiderUpdateTimerInterval, settings.updateChannel);
        checkAndApplyUpdate(settings.updateChannel);
    }

    intervalTimer = setInterval(onInterval, 2500);
}

export function updateLanguageConfigurations(): void {
    languageConfigurations.forEach(d => d.dispose());
    languageConfigurations = [];

    languageConfigurations.push(vscode.languages.setLanguageConfiguration('c', getLanguageConfig('c', clients.ActiveClient.RootUri)));
    languageConfigurations.push(vscode.languages.setLanguageConfiguration('cpp', getLanguageConfig('cpp', clients.ActiveClient.RootUri)));
}

/*********************************************
 * workspace events
 *********************************************/

function onDidChangeSettings(): void {
    const changedActiveClientSettings: { [key: string] : string } = clients.ActiveClient.onDidChangeSettings();
    clients.forEach(client => client.onDidChangeSettings());

    const newUpdateChannel: string = changedActiveClientSettings['updateChannel'];
    if (newUpdateChannel) {
        if (newUpdateChannel === 'Default') {
            clearInterval(insiderUpdateTimer);
        } else if (newUpdateChannel === 'Insiders') {
            insiderUpdateTimer = setInterval(checkAndApplyUpdate, insiderUpdateTimerInterval);
        }

        checkAndApplyUpdate(newUpdateChannel);
    }
}

let saveMessageShown: boolean = false;
function onDidSaveTextDocument(doc: vscode.TextDocument): void {
    if (!vscode.window.activeTextEditor || doc !== vscode.window.activeTextEditor.document || (doc.languageId !== "cpp" && doc.languageId !== "c")) {
        return;
    }

    if (!saveMessageShown && new CppSettings(doc.uri).clangFormatOnSave) {
        saveMessageShown = true;
        vscode.window.showInformationMessage("\"C_Cpp.clang_format_formatOnSave\" has been removed. Please use \"editor.formatOnSave\" instead.");
    }
}

function onDidChangeActiveTextEditor(editor: vscode.TextEditor): void {
    /* need to notify the affected client(s) */
    console.assert(clients !== undefined, "client should be available before active editor is changed");
    if (clients === undefined) {
        return;
    }

    let activeEditor: vscode.TextEditor = vscode.window.activeTextEditor;
    if (!activeEditor || (activeEditor.document.languageId !== "cpp" && activeEditor.document.languageId !== "c")) {
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
        (event.textEditor.document.languageId !== "cpp" && event.textEditor.document.languageId !== "c")) {
        return;
    }

    if (activeDocument !== event.textEditor.document.uri.toString()) {
        // For some strange (buggy?) reason we don't reliably get onDidChangeActiveTextEditor callbacks.
        activeDocument = event.textEditor.document.uri.toString();
        clients.activeDocumentChanged(event.textEditor.document);
        ui.activeDocumentChanged();
    }
    clients.ActiveClient.selectionChanged(Range.create(event.selections[0].start, event.selections[0].end));
}

function onDidChangeVisibleTextEditors(editors: vscode.TextEditor[]): void {
    clients.forEach(client => client.onDidChangeVisibleTextEditors(editors));
}

function onInterval(): void {
    // TODO: do we need to pump messages to all clients? depends on what we do with the icons, I suppose.
    clients.ActiveClient.onInterval();
}

/**
 * Install a VSIX package. This helper function will exist until VSCode offers a command to do so.
 * @param updateChannel The user's updateChannel setting.
 */
async function installVsix(vsixLocation: string, updateChannel: string): Promise<void> {
    // Get the path to the VSCode command -- replace logic later when VSCode allows calling of
    // workbench.extensions.action.installVSIX from TypeScript w/o instead popping up a file dialog
    return PlatformInformation.GetPlatformInformation().then((platformInfo) => {
        const vsCodeScriptPath: string = function(platformInfo): string {
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
                    const stdout: Buffer = execSync('which ' + vsCodeBinName);
                    return stdout.toString().trim();
                } catch (error) {
                    return undefined;
                }
            }
        }(platformInfo);
        if (!vsCodeScriptPath) {
            return Promise.reject(new Error('Failed to find VS Code script'));
        }

        // Install the VSIX
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
            const timer: NodeJS.Timer = setTimeout(() => {
                process.kill();
                reject(new Error('Failed to receive response from VS Code script process for installation within 30s.'));
            }, 30000);

            // If downgrading, the VS Code CLI will prompt whether the user is sure they would like to downgrade.
            // Respond to this by writing 0 to stdin (the option to override and install the VSIX package)
            let sentOverride: boolean = false;
            process.stdout.on('data', () => {
                if (sentOverride) {
                    return;
                }
                process.stdin.write('0\n');
                sentOverride = true;
                clearInterval(timer);
                resolve();
            });
        });
    });
}

/**
 * Query package.json and the GitHub API to determine whether the user should update, if so then install the update.
 * The update can be an upgrade or downgrade depending on the the updateChannel setting.
 * @param updateChannel The user's updateChannel setting.
 */
async function checkAndApplyUpdate(updateChannel: string): Promise<void> {
    // Wrap in new Promise to allow tmp.file callback to successfully resolve/reject
    // as tmp.file does not do anything with the callback functions return value
    const p: Promise<void> = new Promise<void>((resolve, reject) => {
        getTargetBuildInfo(updateChannel).then(buildInfo => {
            if (!buildInfo) {
                resolve();
                return;
            }

            // Create a temporary file, download the VSIX to it, then install the VSIX
            tmp.file({postfix: '.vsix'}, async (err, vsixPath, fd, cleanupCallback) => {
                if (err) {
                    reject(new Error('Failed to create vsix file'));
                    return;
                }

                // Place in try/catch as the .catch call catches a rejection in downloadFileToDestination
                // then the .catch call will return a resolved promise
                // Thusly, the .catch call must also throw, as a return would simply return an unused promise
                // instead of returning early from this function scope
                try {
                    await util.downloadFileToDestination(buildInfo.downloadUrl, vsixPath)
                        .catch(() => { throw new Error('Failed to download VSIX package'); });
                    await installVsix(vsixPath, updateChannel)
                        .catch((error: Error) => { throw error; });
                } catch (error) {
                    reject(error);
                    return;
                }
                clearInterval(insiderUpdateTimer);
                const message: string =
                    `The C/C++ Extension has been updated to version ${buildInfo.name}. Please reload the window for the changes to take effect.`;
                util.promptReloadWindow(message);
                telemetry.logLanguageServerEvent('installVsix', { 'success': 'true' });

                resolve();
            });
        }, (error: Error) => {
            // Handle getTargetBuildInfo rejection
            reject(error);
        });
    });
    await p.catch((error: Error) => {
        // Handle .then following getTargetBuildInfo rejection
        if (error.message.indexOf('/') !== -1 || error.message.indexOf('\\') !== -1) {
            error.message = "Potential PII hidden";
        }
        telemetry.logLanguageServerEvent('installVsix', { 'error': error.message, 'success': 'false' });
    });
}

/*********************************************
 * registered commands
 *********************************************/

function registerCommands(): void {
    disposables.push(vscode.commands.registerCommand('C_Cpp.Navigate', onNavigate));
    disposables.push(vscode.commands.registerCommand('C_Cpp.GoToDeclaration', onGoToDeclaration));
    disposables.push(vscode.commands.registerCommand('C_Cpp.PeekDeclaration', onPeekDeclaration));
    disposables.push(vscode.commands.registerCommand('C_Cpp.SwitchHeaderSource', onSwitchHeaderSource));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ResetDatabase', onResetDatabase));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationSelect', onSelectConfiguration));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationProviderSelect', onSelectConfigurationProvider));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ConfigurationEdit', onEditConfiguration));
    disposables.push(vscode.commands.registerCommand('C_Cpp.AddToIncludePath', onAddToIncludePath));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleErrorSquiggles', onToggleSquiggles));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleSnippets', onToggleSnippets));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleIncludeFallback', onToggleIncludeFallback));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleDimInactiveRegions', onToggleDimInactiveRegions));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowReleaseNotes', onShowReleaseNotes));
    disposables.push(vscode.commands.registerCommand('C_Cpp.PauseParsing', onPauseParsing));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ResumeParsing', onResumeParsing));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowParsingCommands', onShowParsingCommands));
    disposables.push(vscode.commands.registerCommand('C_Cpp.TakeSurvey', onTakeSurvey));
}

function onNavigate(): void {
    onActivationEvent();
    let activeEditor: vscode.TextEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }

    clients.ActiveClient.requestNavigationList(activeEditor.document).then((navigationList: string) => {
        ui.showNavigationOptions(navigationList);
    });
}

function onGoToDeclaration(): void {
    onActivationEvent();
    clients.ActiveClient.requestGoToDeclaration().then(() => vscode.commands.executeCommand("editor.action.goToDeclaration"));
}

function onPeekDeclaration(): void {
    onActivationEvent();
    clients.ActiveClient.requestGoToDeclaration().then(() => vscode.commands.executeCommand("editor.action.previewDeclaration"));
}

function onSwitchHeaderSource(): void {
    onActivationEvent();
    let activeEditor: vscode.TextEditor = vscode.window.activeTextEditor;
    if (!activeEditor || !activeEditor.document) {
        return;
    }

    if (activeEditor.document.languageId !== "cpp" && activeEditor.document.languageId !== "c") {
        return;
    }

    let rootPath: string = clients.ActiveClient.RootPath;
    let fileName: string = activeEditor.document.fileName;

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
                let client: Client = clients.get(key);
                if (client) {
                    return client;
                } else {
                    console.assert("client not found");
                }
            }
            return Promise.reject<Client>("client not found");
        });
    }
}

function onResetDatabase(): void {
    onActivationEvent();
    /* need to notify the affected client(s) */
    selectClient().then(client => client.resetDatabase(), rejected => {});
}

function onSelectConfiguration(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to select a configuration');
    } else {
        // This only applies to the active client. You cannot change the configuration for
        // a client that is not active since that client's UI will not be visible.
        clients.ActiveClient.handleConfigurationSelectCommand();
    }
}

function onSelectConfigurationProvider(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to select a configuration provider');
    } else {
        selectClient().then(client => client.handleConfigurationProviderSelectCommand(), rejected => {});
    }
}

function onEditConfiguration(): void {
    onActivationEvent();
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to edit configurations');
    } else {
        selectClient().then(client => client.handleConfigurationEditCommand(), rejected => {});
    }
}

function onAddToIncludePath(path: string): void {
    if (!isFolderOpen()) {
        vscode.window.showInformationMessage('Open a folder first to add to includePath');
    } else {
        // This only applies to the active client. It would not make sense to add the include path
        // suggestion to a different workspace.
        clients.ActiveClient.handleAddToIncludePathCommand(path);
    }
}

function onToggleSquiggles(): void {
    onActivationEvent();
    // This only applies to the active client.
    let settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.toggleSetting("errorSquiggles", "Enabled", "Disabled");
}

function onToggleSnippets(): void {
    onActivationEvent();

    // This will apply to all clients as it's a global toggle. It will require a reload.
    const snippetsCatName: string  = "Snippets";
    let newPackageJson: any = util.getRawPackageJson();

    if (newPackageJson.categories.findIndex(cat => cat === snippetsCatName) === -1) {
        // Add the Snippet category and snippets node. 

        newPackageJson.categories.push(snippetsCatName);
        newPackageJson.contributes.snippets = [{"language": "cpp", "path": "./cpp_snippets.json"}, {"language": "c", "path": "./cpp_snippets.json"}];

        fs.writeFile(util.getPackageJsonPath(), util.stringifyPackageJson(newPackageJson), () => {
            showReloadPrompt("Reload Window to finish enabling C++ snippets");
        });
        
    } else {
        // Remove the category and snippets node.
        let ndxCat: number = newPackageJson.categories.indexOf(snippetsCatName);
        if (ndxCat !== -1) {
            newPackageJson.categories.splice(ndxCat, 1);
        }

        delete newPackageJson.contributes.snippets;

        fs.writeFile(util.getPackageJsonPath(), util.stringifyPackageJson(newPackageJson), () => {
            showReloadPrompt("Reload Window to finish disabling C++ snippets");
        });
    }
}

function showReloadPrompt(msg: string): void { 
    let reload: string = "Reload"; 
    vscode.window.showInformationMessage(msg, reload).then(value => { 
       if (value === reload) { 
          vscode.commands.executeCommand("workbench.action.reloadWindow"); 
       } 
    }); 
 } 

function onToggleIncludeFallback(): void {
    onActivationEvent();
    // This only applies to the active client.
    let settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.toggleSetting("intelliSenseEngineFallback", "Enabled", "Disabled");
}

function onToggleDimInactiveRegions(): void {
    onActivationEvent();
    // This only applies to the active client.
    let settings: CppSettings = new CppSettings(clients.ActiveClient.RootUri);
    settings.update<boolean>("dimInactiveRegions", !settings.dimInactiveRegions);
}

function onShowReleaseNotes(): void {
    onActivationEvent();
    util.showReleaseNotes();
}

function onPauseParsing(): void {
    onActivationEvent();
    selectClient().then(client => client.pauseParsing(), rejected => {});
}

function onResumeParsing(): void {
    onActivationEvent();
    selectClient().then(client => client.resumeParsing(), rejected => {});
}

function onShowParsingCommands(): void {
    onActivationEvent();
    selectClient().then(client => client.handleShowParsingCommands(), rejected => {});
}

function onTakeSurvey(): void {
    onActivationEvent();
    telemetry.logLanguageServerEvent("onTakeSurvey");
    let uri: vscode.Uri = vscode.Uri.parse(`https://www.research.net/r/VBVV6C6?o=${os.platform()}&m=${vscode.env.machineId}`);
    vscode.commands.executeCommand('vscode.open', uri);
}

function reportMacCrashes(): void {
    if (process.platform === "darwin") {
        prevCrashFile = "";
        let crashFolder: string = path.resolve(process.env.HOME, "Library/Logs/DiagnosticReports");
        fs.stat(crashFolder, (err, stats) => {
            let crashObject: { [key: string]: string } = {};
            if (err) {
                // If the directory isn't there, we have a problem...
                crashObject["fs.stat: err.code"] = err.code;
                telemetry.logLanguageServerEvent("MacCrash", crashObject, null);
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
                    if (!filename.startsWith("Microsoft.VSCode.CPP.")) {
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
    let crashObject: { [key: string]: string } = {};
    crashObject["CrashingThreadCallStack"] = data;
    telemetry.logLanguageServerEvent("MacCrash", crashObject, null);
}

function handleCrashFileRead(err: NodeJS.ErrnoException, data: string): void {
    if (err) {
        return logCrashTelemetry("readFile: " + err.code);
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

    // Get rid of the process names on each line and just add it to the start.
    const process1: string = "Microsoft.VSCode.CPP.IntelliSense.Msvc.darwin\t";
    const process2: string = "Microsoft.VSCode.CPP.Extension.darwin\t";
    if (data.includes(process1)) {
        data = data.replace(new RegExp(process1, "g"), "");
        data = process1 + "\n" + data;
    } else if (data.includes(process2)) {
        data = data.replace(new RegExp(process2, "g"), "");
        data = process2 + "\n" + data;
    } else {
        return logCrashTelemetry("No process"); // Not expected, but just in case.
    }

    // Remove runtime lines because they can be different on different machines.
    let lines: string[] = data.split("\n");
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
    console.log("deactivating extension");
    telemetry.logLanguageServerEvent("LanguageServerShutdown");
    clearInterval(intervalTimer);
    clearInterval(insiderUpdateTimer);
    disposables.forEach(d => d.dispose());
    languageConfigurations.forEach(d => d.dispose());
    ui.dispose();
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