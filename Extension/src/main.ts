/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as util from './common';
import * as Telemetry from './telemetry';
import * as LanguageServer from './LanguageServer/extension';
import * as DebuggerExtension from './Debugger/extension';
import * as commands from './commands';
import { PlatformInformation } from './platform';
import { PackageManager, PackageManagerError, PackageManagerWebResponseError, IPackage } from './packageManager';
import { PersistentState } from './LanguageServer/persistentState';
import {initializeInstallBlob, getInstallBlob, InstallBlobStage, InstallBlob, setInstallBlobStage } from './extensionActivationInformation';
import * as cpptoolsJsonUtils from './cpptoolsJsonUtils';

let tempCommandRegistrar: commands.TemporaryCommandRegistrar;
const releaseNotesVersion: number = 3;

export function activate(context: vscode.ExtensionContext): void | Promise<void> {
    tempCommandRegistrar = new commands.TemporaryCommandRegistrar();
    util.setExtensionContext(context);
    Telemetry.activate();
    util.setProgress(0);
    cpptoolsJsonUtils.activate(context);
    initializeInstallBlob();

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

    try {
        const info: PlatformInformation = await PlatformInformation.GetPlatformInformation();

        // Offline Scenario: Lock file exists but package.json has not had its activationEvents rewritten.
        if (installLockExists && util.packageJson.activationEvents && util.packageJson.activationEvents.length == 1) {
            await offlineInstallation(info);
        // No lock file, need to download and install dependencies.
        } else if (!installLockExists) {
            await onlineInstallation(info);
        }
    // Catches all errors from all promises within this block.
    } catch (error) {
        handleError(error);
    }
}

async function offlineInstallation(info: PlatformInformation): Promise<void> {
    let makeBinariesExecutablePromise: Promise<void> = makeBinariesExecutable();
    let makeOfflineBinariesExecutablePromise: Promise<void> = makeOfflineBinariesExecutable(info);
    let rewriteManifestPromise: Promise<void> = rewriteManifest();

    await Promise.all([makeBinariesExecutablePromise, makeOfflineBinariesExecutablePromise, rewriteManifestPromise]);

    await postInstall(info);
}

async function onlineInstallation(info: PlatformInformation): Promise<void> {
    await downloadAndInstallPackages(info);

    let makeBinariesExecutablePromise: Promise<void> = makeBinariesExecutable();
    let removeUnnecessaryFilePromise: Promise<void> = removeUnnecessaryFile();
    let rewriteManifestPromise: Promise<void> = rewriteManifest();
    let touchInstallLockFilePromise: Promise<void> = touchInstallLockFile(info);

    await Promise.all([makeBinariesExecutablePromise, removeUnnecessaryFilePromise, rewriteManifestPromise, touchInstallLockFilePromise]);

    await postInstall(info);
}

async function downloadAndInstallPackages(info: PlatformInformation): Promise<void> {
    let channel: vscode.OutputChannel = util.getOutputChannel();
    channel.appendLine("Updating C/C++ dependencies...");
    channel.appendLine('');

    let statusItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    let packageManager: PackageManager = new PackageManager(info, channel, statusItem);

    return packageManager.DownloadPackages().then(() => { 
        channel.appendLine('');
        return packageManager.InstallPackages();
    }).then(() => statusItem.dispose());
}

function makeBinariesExecutable(): Promise<void> {
    setInstallBlobStage(InstallBlobStage.makeBinariesExecutable);
    return util.allowExecution(util.getDebugAdaptersPath("OpenDebugAD7"));
}

function makeOfflineBinariesExecutable(info: PlatformInformation): Promise<void> {
    setInstallBlobStage(InstallBlobStage.makeOfflineBinariesExecutable);
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
    setInstallBlobStage(InstallBlobStage.removeUnnecessaryFile);
    if (os.platform() !== 'win32') {
        let sourcePath: string = util.getDebugAdaptersPath("bin/OpenDebugAD7.exe.config");
        if (fs.existsSync(sourcePath)) {
            fs.rename(sourcePath, util.getDebugAdaptersPath("bin/OpenDebugAD7.exe.config.unused"), (err) => {
                util.getOutputChannel().appendLine("removeUnnecessaryFile: fs.rename failed: " + err.message);
            });
        }
    }

    return Promise.resolve();
}

function touchInstallLockFile(info: PlatformInformation): Promise<void> {
    setInstallBlobStage(InstallBlobStage.touchInstallLockFile);

    return util.touchInstallLockFile();
}

function handleError(error: any): void {
    let installBlob: InstallBlob = getInstallBlob();
    installBlob.hasError = true;
    installBlob.telemetryProperties['stage'] = InstallBlobStage[installBlob.stage];
    let errorMessage: string;
    let channel: vscode.OutputChannel = util.getOutputChannel();

    if (error instanceof PackageManagerError) {
        // If this is a WebResponse error, log the IP that it resolved from the package URL
        if (error instanceof PackageManagerWebResponseError) {
            let webRequestPackageError: PackageManagerWebResponseError = error;
            if (webRequestPackageError.socket) {
                let address: any = webRequestPackageError.socket.address();
                if (address) {
                    installBlob.telemetryProperties['error.targetIP'] = address.address + ':' + address.port;
                }
            }
        }

        let packageError: PackageManagerError = error;

        installBlob.telemetryProperties['error.methodName'] = packageError.methodName;
        installBlob.telemetryProperties['error.message'] = packageError.message;

        if (packageError.innerError) {
            errorMessage = packageError.innerError.toString();
            installBlob.telemetryProperties['error.innerError'] = util.removePotentialPII(errorMessage);
        } else {
            errorMessage = packageError.message;
        }

        if (packageError.pkg) {
            installBlob.telemetryProperties['error.packageName'] = packageError.pkg.description;
            installBlob.telemetryProperties['error.packageUrl'] = packageError.pkg.url;
        }

        if (packageError.errorCode) {
            installBlob.telemetryProperties['error.errorCode'] = util.removePotentialPII(packageError.errorCode);
        }
    } else {
        errorMessage = error.toString();
        installBlob.telemetryProperties['error.toString'] = util.removePotentialPII(errorMessage);
    }

    // Show the actual message and not the sanitized one
    if (installBlob.stage == InstallBlobStage.downloadPackages) {
        channel.appendLine("");
    }
    channel.appendLine(`Failed at stage: ${InstallBlobStage[installBlob.stage]}`);
    channel.appendLine(errorMessage);
    channel.appendLine("");
    channel.appendLine(`If you work in an offline environment or repeatedly see this error, try downloading a version of the extension with all the dependencies pre-included from https://github.com/Microsoft/vscode-cpptools/releases, then use the "Install from VSIX" command in VS Code to install it.`);
    channel.show();
}

function postInstall(info: PlatformInformation): Thenable<void> {
    setInstallBlobStage(InstallBlobStage.postInstall);
    let channel: vscode.OutputChannel = util.getOutputChannel();

    channel.appendLine("");
    channel.appendLine("Finished installing dependencies");
    channel.appendLine("");

    let installBlob: InstallBlob = getInstallBlob();
    installBlob.telemetryProperties['success'] = (!installBlob.hasError).toString();

    if (info.distribution) {
        installBlob.telemetryProperties['linuxDistroName'] = info.distribution.name;
        installBlob.telemetryProperties['linuxDistroVersion'] = info.distribution.version;
    }

    if (!installBlob.hasError) {
        util.setProgress(util.getProgressInstallSuccess());
        let versionShown: PersistentState<number> = new PersistentState<number>("CPP.ReleaseNotesVersion", -1);
        if (versionShown.Value < releaseNotesVersion) {
            util.showReleaseNotes();
            versionShown.Value = releaseNotesVersion;
        }
    }

    installBlob.telemetryProperties['osArchitecture'] = info.architecture;

    Telemetry.logDebuggerEvent("acquisition", installBlob.telemetryProperties);

    // If there is a download failure, we shouldn't continue activating the extension in some broken state.
    if (installBlob.hasError) {
        return Promise.reject<void>("");
    }

    return util.readFileText(util.getExtensionFilePath("cpptools.json"))
        .then((cpptoolsString) => {
            cpptoolsJsonUtils.processCpptoolsJson(cpptoolsString);
        })
        .catch((error) => {
            // We already log telemetry if cpptools.json fails to download.
        })
        .then(() => {
            tempCommandRegistrar.dispose();
            // Redownload cpptools.json after activation so it's not blocked.
            // It'll be used after the extension reloads.
            cpptoolsJsonUtils.downloadCpptoolsJsonPkg();

            util.checkDistro(info);
        });
}

function rewriteManifest(): Promise<void> {
    setInstallBlobStage(InstallBlobStage.rewriteManifest);

    // Replace activationEvents with the events that the extension should be activated for subsequent sessions.
    util.packageJson.activationEvents = [
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
        "onCommand:C_Cpp.ShowReleaseNotes",
        "onCommand:C_Cpp.ResetDatabase",
        "onCommand:C_Cpp.PauseParsing",
        "onCommand:C_Cpp.ResumeParsing",
        "onCommand:C_Cpp.ShowParsingCommands",
        "onCommand:C_Cpp.TakeSurvey",
        "onDebug"
    ];

    return util.writeFileText(util.getPackageJsonPath(), util.getPackageJsonString());
}
