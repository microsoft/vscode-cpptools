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
import { PersistentWorkspaceState, PersistentState } from './persistentState';
import { getLanguageConfig } from './languageConfig';
import { getCustomConfigProviders } from './customProviders';
import { PlatformInformation } from '../platform';
import { Range } from 'vscode-languageclient';
import { ChildProcess, spawn, execSync } from 'child_process';
import * as tmp from 'tmp';
import { getTargetBuildInfo, BuildInfo } from '../githubAPI';
import * as configs from './configurations';
import { PackageVersion } from '../packageVersion';
import { getTemporaryCommandRegistrarInstance } from '../commands';

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
let buildInfoCache: BuildInfo | null = null;
const taskSourceStr: string = "C/C++";
const cppInstallVsixStr: string = 'C/C++: Install vsix -- ';
let taskProvider: vscode.Disposable;

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
        tempCommands.push(vscode.workspace.onDidOpenTextDocument(d => onDidOpenTextDocument(d)));
    }

    // Check if an activation event has already occurred.
    if (activationEventOccurred) {
        onActivationEvent();
        return;
    }

    taskProvider = vscode.tasks.registerTaskProvider(taskSourceStr, {
        provideTasks: () => {
            return getBuildTasks(false);
        },
        resolveTask(task: vscode.Task): vscode.Task {
            // Currently cannot implement because VS Code does not call this. Can implement custom output file directory when enabled.
            return undefined;
        }
    });
    vscode.tasks.onDidStartTask(event => {
        if (event.execution.task.source === taskSourceStr) {
            telemetry.logLanguageServerEvent('buildTaskStarted');
        }
    });

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

export interface BuildTaskDefinition extends vscode.TaskDefinition {
    compilerPath: string;
}

/**
 * Generate tasks to build the current file based on the user's detected compilers, the user's compilerPath setting, and the current file's extension.
 */
export async function getBuildTasks(returnComplerPath: boolean): Promise<vscode.Task[]> {
    const editor: vscode.TextEditor = vscode.window.activeTextEditor;
    if (!editor) {
        return [];
    }

    const fileExt: string = path.extname(editor.document.fileName);
    if (!fileExt) {
        return;
    }

    // Don't offer tasks for header files.
    const fileExtLower: string = fileExt.toLowerCase();
    const isHeader: boolean = !fileExt || [".hpp", ".hh", ".hxx", ".h", ".inl", ""].some(ext => fileExtLower === ext);
    if (isHeader) {
        return [];
    }

    // Don't offer tasks if the active file's extension is not a recognized C/C++ extension.
    let fileIsCpp: boolean;
    let fileIsC: boolean;
    if (fileExt === ".C") { // ".C" file extensions are both C and C++.
        fileIsCpp = true;
        fileIsC = true;
    } else {
        fileIsCpp = [".cpp", ".cc", ".cxx", ".mm", ".ino"].some(ext => fileExtLower === ext);
        fileIsC = fileExtLower === ".c";
    }
    if (!(fileIsCpp || fileIsC)) {
        return [];
    }

    // Get a list of compilers found from the C++ side, then filter them based on the file type to get a reduced list appropriate
    // for the active file, remove duplicate compiler names, then finally add the user's compilerPath setting.
    let compilerPaths: string[];
    const isWindows: boolean = os.platform() === 'win32';
    const activeClient: Client = getActiveClient();
    let userCompilerPath: string = await activeClient.getCompilerPath();
    if (userCompilerPath) {
        userCompilerPath = userCompilerPath.trim();
        if (isWindows && userCompilerPath.startsWith("/")) { // TODO: Add WSL compiler support.
            userCompilerPath = null;
        } else {
            userCompilerPath = userCompilerPath.replace(/\\\\/g, "\\");
        }
    }

    let knownCompilers: configs.KnownCompiler[] = await activeClient.getKnownCompilers();
    if (knownCompilers) {
        knownCompilers = knownCompilers.filter(info => {
            return ((fileIsCpp && !info.isC) || (fileIsC && info.isC)) &&
                (!isWindows || !info.path.startsWith("/")); // TODO: Add WSL compiler support.
        });
        compilerPaths = knownCompilers.map<string>(info => { return info.path; });

        let map: Map<string, string> = new Map<string, string>();
        const insertOrAssignEntry: (compilerPath: string) => void = (compilerPath: string): void => {
            let basename: string = compilerPath;
            if (compilerPath === userCompilerPath) {
                // Make sure the compiler args are not part of the basename.
                const compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(compilerPath);
                basename = compilerPathAndArgs.compilerPath;
            }
            basename = path.basename(basename);
            map.set(basename, compilerPath);
        };
        compilerPaths.forEach(insertOrAssignEntry);

        // Ensure that the user's compilerPath setting is used by inserting/assigning last.
        if (userCompilerPath) {
            insertOrAssignEntry(userCompilerPath);
        }

        compilerPaths = [...map.values()];
    } else if (userCompilerPath) {
        compilerPaths = [userCompilerPath];
    }

    if (!compilerPaths) {
        // Don't prompt a message yet until we can make a data-based decision.
        telemetry.logLanguageServerEvent('noCompilerFound');
        // Display a message prompting the user to install compilers if none were found.
        // const dontShowAgain: string = "Don't Show Again";
        // const learnMore: string = "Learn More";
        // const message: string = "No C/C++ compiler found on the system. Please install a C/C++ compiler to use the C/C++: build active file tasks.";

        // let showNoCompilerFoundMessage: PersistentState<boolean> = new PersistentState<boolean>("CPP.showNoCompilerFoundMessage", true);
        // if (showNoCompilerFoundMessage) {
        //     vscode.window.showInformationMessage(message, learnMore, dontShowAgain).then(selection => {
        //         switch (selection) {
        //             case learnMore:
        //                 const uri: vscode.Uri = vscode.Uri.parse(`https://go.microsoft.com/fwlink/?linkid=864631`);
        //                 vscode.commands.executeCommand('vscode.open', uri);
        //                 break;
        //             case dontShowAgain:
        //                 showNoCompilerFoundMessage.Value = false;
        //                 break;
        //             default:
        //                 break;
        //         }
        //     });
        // }
        return [];
    }

    // Generate tasks.
    return compilerPaths.map<vscode.Task>(compilerPath => {
        // Handle compiler args in compilerPath.
        let compilerPathAndArgs: util.CompilerPathAndArgs = util.extractCompilerPathAndArgs(compilerPath);
        compilerPath = compilerPathAndArgs.compilerPath;
        const filePath: string = path.join('${fileDirname}', '${fileBasenameNoExtension}');
        const compilerPathBase: string = path.basename(compilerPath);
        const taskName: string = compilerPathBase + " build active file";
        const isCl: boolean = taskName.startsWith("cl.exe");
        let args: string[] = isCl ? [ '/Zi', '/EHsc', '/Fe:', filePath + '.exe', '${file}'  ] : ['-g', '${file}', '-o', filePath + (isWindows ? '.exe' : '')];
        if (compilerPathAndArgs.additionalArgs) {
            args = args.concat(compilerPathAndArgs.additionalArgs);
        }
        const cwd: string = isCl ? "" : path.dirname(compilerPath);
        const kind: BuildTaskDefinition = {
            type: 'shell',
            label: taskName,
            command: isCl ? compilerPathBase : compilerPath,
            args: args,
            options: isCl ? undefined : {"cwd": cwd},
            compilerPath: isCl ? compilerPathBase : compilerPath
        };

        const command: vscode.ShellExecution = new vscode.ShellExecution(compilerPath, [...args], { cwd: cwd });
        const target: vscode.WorkspaceFolder = vscode.workspace.getWorkspaceFolder(clients.ActiveClient.RootUri);
        let task: vscode.Task = new vscode.Task(kind, target, taskName, taskSourceStr, command, '$gcc');
        task.definition = kind; // The constructor for vscode.Task will eat the definition. Reset it by reassigning.
        task.group = vscode.TaskGroup.Build;

        if (!returnComplerPath) {
            delete task.definition.compilerPath;
        }

        return task;
    });
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
    } else {
        console.log("activating extension");
        let checkForConflictingExtensions: PersistentState<boolean> = new PersistentState<boolean>("CPP." + util.packageJson.version + ".checkForConflictingExtensions", true);
        if (checkForConflictingExtensions.Value) {
            checkForConflictingExtensions.Value = false;
            let clangCommandAdapterActive: boolean = vscode.extensions.all.some((extension: vscode.Extension<any>, index: number, array: vscode.Extension<any>[]): boolean => {
                return extension.isActive && extension.id === "mitaki28.vscode-clang";
            });
            if (clangCommandAdapterActive) {
                telemetry.logLanguageServerEvent("conflictingExtension");
            }
        }
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
    
    if (settings.updateChannel === 'Default') {
        suggestInsidersChannel();
    } else if (settings.updateChannel === 'Insiders') {
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
function installVsix(vsixLocation: string, updateChannel: string): Promise<void> {
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

        // 1.28.0 changes the CLI for making installations
        let userVersion: PackageVersion = new PackageVersion(vscode.version);
        let breakingVersion: PackageVersion = new PackageVersion('1.28.0');
        if (userVersion.isGreaterThan(breakingVersion, 'insider')) {
            return new Promise<void>((resolve, reject) => {
                let process: ChildProcess;
                try {
                    process = spawn(vsCodeScriptPath, ['--install-extension', vsixLocation, '--force']);
                    
                    // Timeout the process if no response is sent back. Ensures this Promise resolves/rejects
                    const timer: NodeJS.Timer = setTimeout(() => {
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

async function suggestInsidersChannel(): Promise<void> {
    let suggestInsiders: PersistentState<boolean> = new PersistentState<boolean>("CPP.suggestInsiders", true);

    if (!suggestInsiders.Value) {
        return;
    }
    let buildInfo: BuildInfo;
    try {
        buildInfo = await getTargetBuildInfo("Insiders");
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
    const message: string = `Insiders version ${buildInfo.name} is available. Would you like to switch to the Insiders channel and install this update?`;
    const yes: string = "Yes";
    const askLater: string = "Ask Me Later";
    const dontShowAgain: string = "Don't Show Again";
    let selection: string = await vscode.window.showInformationMessage(message, yes, askLater, dontShowAgain);
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

function applyUpdate(buildInfo: BuildInfo, updateChannel: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        tmp.file({postfix: '.vsix'}, async (err, vsixPath, fd, cleanupCallback) => {
            if (err) {
                reject(new Error('Failed to create vsix file'));
                return;
            }
    
            // Place in try/catch as the .catch call catches a rejection in downloadFileToDestination
            // then the .catch call will return a resolved promise
            // Thusly, the .catch call must also throw, as a return would simply return an unused promise
            // instead of returning early from this function scope
            let config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
            let originalProxySupport: string = config.inspect<string>('http.proxySupport').globalValue;
            while (true) { // Might need to try again with a different http.proxySupport setting.
                try {
                    await util.downloadFileToDestination(buildInfo.downloadUrl, vsixPath);
                } catch {
                    // Try again with the proxySupport to "off".
                    if (originalProxySupport !== config.inspect<string>('http.proxySupport').globalValue) {
                        config.update('http.proxySupport', originalProxySupport, true); // Reset the http.proxySupport.
                        reject(new Error('Failed to download VSIX package with proxySupport off')); // Changing the proxySupport didn't help.
                        return;
                    }
                    if (config.get('http.proxySupport') !== "off" && originalProxySupport !== "off") {
                        config.update('http.proxySupport', "off", true);
                        continue;
                    }
                    reject(new Error('Failed to download VSIX package'));
                    return;
                }
                if (originalProxySupport !== config.inspect<string>('http.proxySupport').globalValue) {
                    config.update('http.proxySupport', originalProxySupport, true); // Reset the http.proxySupport.
                    telemetry.logLanguageServerEvent('installVsix', { 'error': "Success with proxySupport off", 'success': 'true' });
                }
                break;
            }
            try {
                await installVsix(vsixPath, updateChannel);
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
    }).catch(error => {
        console.error(`${cppInstallVsixStr}${error.message}`);
        if (error.message.indexOf('/') !== -1 || error.message.indexOf('\\') !== -1) {
            error.message = "Potential PII hidden";
        }
        telemetry.logLanguageServerEvent('installVsix', { 'error': error.message, 'success': 'false' });
    });
}

/**
 * Query package.json and the GitHub API to determine whether the user should update, if so then install the update.
 * The update can be an upgrade or downgrade depending on the the updateChannel setting.
 * @param updateChannel The user's updateChannel setting.
 */
async function checkAndApplyUpdate(updateChannel: string): Promise<void> {
    // If we have buildInfo cache, we should use it.
    let buildInfo: BuildInfo | null = buildInfoCache;
    // clear buildInfo cache.
    buildInfoCache = null;
    
    if (!buildInfo) {
        try {
            buildInfo = await getTargetBuildInfo(updateChannel);
        } catch (error) {
            telemetry.logLanguageServerEvent('installVsix', { 'error': error.message, 'success': 'false' });
        }
    }
    if (!buildInfo) {
        return; // No need to update.
    }
    await applyUpdate(buildInfo, updateChannel);
}

/*********************************************
 * registered commands
 *********************************************/
let commandsRegistered: boolean = false;

export function registerCommands(): void {
    if (commandsRegistered) {
        return;
    }
    commandsRegistered = true;
    getTemporaryCommandRegistrarInstance().clearTempCommands();
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
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleIncludeFallback', onToggleIncludeFallback));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ToggleDimInactiveRegions', onToggleDimInactiveRegions));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowReleaseNotes', onShowReleaseNotes));
    disposables.push(vscode.commands.registerCommand('C_Cpp.PauseParsing', onPauseParsing));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ResumeParsing', onResumeParsing));
    disposables.push(vscode.commands.registerCommand('C_Cpp.ShowParsingCommands', onShowParsingCommands));
    disposables.push(vscode.commands.registerCommand('C_Cpp.TakeSurvey', onTakeSurvey));
    disposables.push(vscode.commands.registerCommand('cpptools.activeConfigName', onGetActiveConfigName));
    getTemporaryCommandRegistrarInstance().executeDelayedCommands();
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

function onGetActiveConfigName(): Thenable<string> {
    return clients.ActiveClient.getCurrentConfigName();
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
    data = data.replace(/0x1........ \+ 0/g, "");

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
    if (taskProvider) {
        taskProvider.dispose();
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
