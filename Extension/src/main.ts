/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as cpptoolsJsonUtils from './abTesting';
import * as DebuggerExtension from './Debugger/extension';
import * as fs from 'fs';
import * as LanguageServer from './LanguageServer/extension';
import * as os from 'os';
import * as Telemetry from './telemetry';
import * as util from './common';
import * as vscode from 'vscode';

import { getTemporaryCommandRegistrarInstance, initializeTemporaryCommandRegistrar } from './commands';
import { PlatformInformation } from './platform';
import { PackageManager, PackageManagerError, PackageManagerWebResponseError, IPackage } from './packageManager';
import { PersistentState } from './LanguageServer/persistentState';
import { initializeInstallationInformation, getInstallationInformationInstance, InstallationInformation, setInstallationStage } from './installationInformation';
import { Logger, getOutputChannelLogger, showOutputChannel } from './logger';

const releaseNotesVersion: number = 3;

export function activate(context: vscode.ExtensionContext): void | Promise<void> {
    initializeTemporaryCommandRegistrar();
    util.setExtensionContext(context);
    Telemetry.activate();
    util.setProgress(0);
    cpptoolsJsonUtils.activate(context);
    initializeInstallationInformation();

    // Initialize the DebuggerExtension and register the related commands and providers.
    DebuggerExtension.initialize();

    return processRuntimeDependencies();
}

export function deactivate(): Thenable<void> {
    DebuggerExtension.dispose();
    Telemetry.deactivate();
    return LanguageServer.deactivate();
}

async function processRuntimeDependencies(): Promise<void> {
    const installLockExists: boolean = await util.checkInstallLockFile();

    if (installLockExists) {
        // Offline Scenario: Lock file exists but package.json has not had its activationEvents rewritten.
        if (util.packageJson.activationEvents && util.packageJson.activationEvents.length === 1) {
            try {
                await offlineInstallation();
            } catch (error) {
                getOutputChannelLogger().showErrorMessage('The installation of the C/C++ extension failed. Please see the output window for more information.');
                showOutputChannel();
            }
        // The extension have been installed and activated before.
        } else {
            await finalizeExtensionActivation();
        }
    // No lock file, need to download and install dependencies.
    } else {
        try {
            await onlineInstallation();
        } catch (error) {
            handleError(error);
        }
    }
}

async function offlineInstallation(): Promise<void> {
    setInstallationStage('getPlatformInfo');
    const info: PlatformInformation = await PlatformInformation.GetPlatformInformation();

    setInstallationStage('makeBinariesExecutable');
    await makeBinariesExecutable();

    setInstallationStage('makeOfflineBinariesExecutable');
    await makeOfflineBinariesExecutable(info);

    setInstallationStage('removeUnnecessaryFile');
    await removeUnnecessaryFile();

    setInstallationStage('rewriteManifest');
    await rewriteManifest();

    setInstallationStage('postInstall');
    await postInstall(info);
}

async function onlineInstallation(): Promise<void> {
    setInstallationStage('getPlatformInfo');
    const info: PlatformInformation = await PlatformInformation.GetPlatformInformation();

    await downloadAndInstallPackages(info);

    setInstallationStage('makeBinariesExecutable');
    await makeBinariesExecutable();

    setInstallationStage('removeUnnecessaryFile');
    await removeUnnecessaryFile();

    setInstallationStage('rewriteManifest');
    await rewriteManifest();

    setInstallationStage('touchInstallLockFile');
    await touchInstallLockFile();

    setInstallationStage('postInstall');
    await postInstall(info);
}

async function downloadAndInstallPackages(info: PlatformInformation): Promise<void> {
    let outputChannelLogger: Logger = getOutputChannelLogger();
    outputChannelLogger.appendLine("Updating C/C++ dependencies...");

    let packageManager: PackageManager = new PackageManager(info, outputChannelLogger);

    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "C/C++ Extension",
        cancellable: false
    }, async (progress, token) => {

        outputChannelLogger.appendLine('');
        setInstallationStage('downloadPackages');
        await packageManager.DownloadPackages(progress);

        outputChannelLogger.appendLine('');
        setInstallationStage('installPackages');
        await packageManager.InstallPackages(progress);
    });
}

function makeBinariesExecutable(): Promise<void> {
    return util.allowExecution(util.getDebugAdaptersPath("OpenDebugAD7"));
}

function makeOfflineBinariesExecutable(info: PlatformInformation): Promise<void> {
    let promises: Thenable<void>[] = [];
    let packages: IPackage[] = util.packageJson["runtimeDependencies"];
    packages.forEach(p => {
        if (p.binaries && p.binaries.length > 0 &&
            p.platforms.findIndex(plat => plat === info.platform) !== -1 &&
            (p.architectures === undefined || p.architectures.findIndex(arch => arch === info.architecture) !== - 1)) {
            p.binaries.forEach(binary => promises.push(util.allowExecution(util.getExtensionFilePath(binary))));
        }
    });
    return Promise.all(promises).then(() => { });
}

function removeUnnecessaryFile(): Promise<void> {
    if (os.platform() !== 'win32') {
        let sourcePath: string = util.getDebugAdaptersPath("bin/OpenDebugAD7.exe.config");
        if (fs.existsSync(sourcePath)) {
            fs.rename(sourcePath, util.getDebugAdaptersPath("bin/OpenDebugAD7.exe.config.unused"), (err: NodeJS.ErrnoException) => {
                if (err) {
                    getOutputChannelLogger().appendLine(`ERROR: fs.rename failed with "${err.message}". Delete ${sourcePath} manually to enable debugging.`);
                }
            });
        }
    }

    return Promise.resolve();
}

function touchInstallLockFile(): Promise<void> {
    return util.touchInstallLockFile();
}

function handleError(error: any): void {
    let installationInformation: InstallationInformation = getInstallationInformationInstance();
    installationInformation.hasError = true;
    installationInformation.telemetryProperties['stage'] = installationInformation.stage;
    let errorMessage: string;

    if (error instanceof PackageManagerError) {
        // If this is a WebResponse error, log the IP that it resolved from the package URL
        if (error instanceof PackageManagerWebResponseError) {
            let webRequestPackageError: PackageManagerWebResponseError = error;
            if (webRequestPackageError.socket) {
                let address: any = webRequestPackageError.socket.address();
                if (address) {
                    installationInformation.telemetryProperties['error.targetIP'] = address.address + ':' + address.port;
                }
            }
        }

        let packageError: PackageManagerError = error;

        installationInformation.telemetryProperties['error.methodName'] = packageError.methodName;
        installationInformation.telemetryProperties['error.message'] = packageError.message;

        if (packageError.innerError) {
            errorMessage = packageError.innerError.toString();
            installationInformation.telemetryProperties['error.innerError'] = util.removePotentialPII(errorMessage);
        } else {
            errorMessage = packageError.message;
        }

        if (packageError.pkg) {
            installationInformation.telemetryProperties['error.packageName'] = packageError.pkg.description;
            installationInformation.telemetryProperties['error.packageUrl'] = packageError.pkg.url;
        }

        if (packageError.errorCode) {
            installationInformation.telemetryProperties['error.errorCode'] = util.removePotentialPII(packageError.errorCode);
        }
    } else {
        errorMessage = error.toString();
        installationInformation.telemetryProperties['error.toString'] = util.removePotentialPII(errorMessage);
    }

    let outputChannelLogger: Logger = getOutputChannelLogger();
    if (installationInformation.stage === 'downloadPackages') {
        outputChannelLogger.appendLine("");
    }
    // Show the actual message and not the sanitized one
    outputChannelLogger.appendLine(`Failed at stage: ${installationInformation.stage}`);
    outputChannelLogger.appendLine(errorMessage);
    outputChannelLogger.appendLine("");
    outputChannelLogger.appendLine(`If you work in an offline environment or repeatedly see this error, try downloading a version of the extension with all the dependencies pre-included from https://github.com/Microsoft/vscode-cpptools/releases, then use the "Install from VSIX" command in VS Code to install it.`);
    showOutputChannel();
}

function sendTelemetry(info: PlatformInformation): boolean {
    let installBlob: InstallationInformation = getInstallationInformationInstance();
    const success: boolean = !installBlob.hasError;

    installBlob.telemetryProperties['success'] = success.toString();

    if (info.distribution) {
        installBlob.telemetryProperties['linuxDistroName'] = info.distribution.name;
        installBlob.telemetryProperties['linuxDistroVersion'] = info.distribution.version;
    }

    if (success) {
        util.setProgress(util.getProgressInstallSuccess());
        let versionShown: PersistentState<number> = new PersistentState<number>("CPP.ReleaseNotesVersion", -1);
        if (versionShown.Value < releaseNotesVersion) {
            util.showReleaseNotes();
            versionShown.Value = releaseNotesVersion;
        }
    }

    installBlob.telemetryProperties['osArchitecture'] = info.architecture;

    Telemetry.logDebuggerEvent("acquisition", installBlob.telemetryProperties);

    return success;
}

async function postInstall(info: PlatformInformation): Promise<void> {
    let outputChannelLogger: Logger = getOutputChannelLogger();
    outputChannelLogger.appendLine("");
    outputChannelLogger.appendLine("Finished installing dependencies");
    outputChannelLogger.appendLine("");

    const installSuccess: boolean = sendTelemetry(info);

    // If there is a download failure, we shouldn't continue activating the extension in some broken state.
    if (!installSuccess) {
        return Promise.reject<void>("");
    } else {
        // Notify user's if debugging may not be supported on their OS.
        util.checkDistro(info);

        return finalizeExtensionActivation();
    }
}

async function finalizeExtensionActivation(): Promise<void> {
    const cpptoolsJsonFile: string = util.getExtensionFilePath("cpptools.json");

    try {
        const exists: boolean = await util.checkFileExists(cpptoolsJsonFile);
        if (exists) {
            const cpptoolsString: string = await util.readFileText(cpptoolsJsonFile);
            await cpptoolsJsonUtils.processCpptoolsJson(cpptoolsString);
        }
    } catch (error) {
        // Ignore any cpptoolsJsonFile errors
    }

    getTemporaryCommandRegistrarInstance().activateLanguageServer();

    // Redownload cpptools.json after activation so it's not blocked.
    // It'll be used after the extension reloads.
    cpptoolsJsonUtils.downloadCpptoolsJsonPkg();
}

function rewriteManifest(): Promise<void> {
    // Replace activationEvents with the events that the extension should be activated for subsequent sessions.
    let packageJson: any = util.getRawPackageJson();
    
    packageJson.activationEvents = [
        "onLanguage:cpp",
        "onLanguage:c",
        "onCommand:extension.pickNativeProcess",
        "onCommand:extension.pickRemoteNativeProcess",
        "onCommand:C_Cpp.ConfigurationEdit",
        "onCommand:C_Cpp.ConfigurationSelect",
        "onCommand:C_Cpp.SwitchHeaderSource",
        "onCommand:C_Cpp.Navigate",
        "onCommand:C_Cpp.GoToDeclaration",
        "onCommand:C_Cpp.PeekDeclaration",
        "onCommand:C_Cpp.ToggleErrorSquiggles",
        "onCommand:C_Cpp.ToggleIncludeFallback",
        "onCommand:C_Cpp.ToggleDimInactiveRegions",
        "onCommand:C_Cpp.ToggleSnippets",
        "onCommand:C_Cpp.ShowReleaseNotes",
        "onCommand:C_Cpp.ResetDatabase",
        "onCommand:C_Cpp.PauseParsing",
        "onCommand:C_Cpp.ResumeParsing",
        "onCommand:C_Cpp.ShowParsingCommands",
        "onCommand:C_Cpp.TakeSurvey",
        "onDebug",
        "workspaceContains:/.vscode/c_cpp_properties.json"
    ];

    return util.writeFileText(util.getPackageJsonPath(), util.stringifyPackageJson(packageJson));
}
