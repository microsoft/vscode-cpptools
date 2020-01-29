/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as DebuggerExtension from './Debugger/extension';
import * as fs from 'fs';
import * as LanguageServer from './LanguageServer/extension';
import * as os from 'os';
import * as Telemetry from './telemetry';
import * as util from './common';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

import { CppToolsApi, CppToolsExtension } from 'vscode-cpptools';
import { getTemporaryCommandRegistrarInstance, initializeTemporaryCommandRegistrar } from './commands';
import { PlatformInformation } from './platform';
import { PackageManager, PackageManagerError, IPackage } from './packageManager';
import { getInstallationInformation, InstallationInformation, setInstallationStage, setInstallationType, InstallationType } from './installationInformation';
import { Logger, getOutputChannelLogger, showOutputChannel } from './logger';
import { CppTools1, NullCppTools } from './cppTools1';
import { CppSettings } from './LanguageServer/settings';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const cppTools: CppTools1 = new CppTools1();
let languageServiceDisabled: boolean = false;
let reloadMessageShown: boolean = false;
let disposables: vscode.Disposable[] = [];

export async function activate(context: vscode.ExtensionContext): Promise<CppToolsApi & CppToolsExtension> {
    let errMsg: string = "";
    if (process.arch !== 'ia32' && process.arch !== 'x64') {
        errMsg = localize("architecture.not.supported", "Architecture {0} is not supported. ", String(process.arch));
    } else if (process.platform === 'linux' && fs.existsSync('/etc/alpine-release')) {
        errMsg = localize("apline.containers.not.supported", "Alpine containers are not supported.");
    }
    if (errMsg) {
        vscode.window.showErrorMessage(errMsg);
        return new NullCppTools();
    }

    util.setExtensionContext(context);
    initializeTemporaryCommandRegistrar();
    Telemetry.activate();
    util.setProgress(0);

    // Initialize the DebuggerExtension and register the related commands and providers.
    DebuggerExtension.initialize(context);

    await processRuntimeDependencies();

    return cppTools;
}

export function deactivate(): Thenable<void> {
    DebuggerExtension.dispose();
    Telemetry.deactivate();
    disposables.forEach(d => d.dispose());

    if (languageServiceDisabled) {
        return;
    }
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
                getOutputChannelLogger().showErrorMessage(localize('initialization.failed', 'The installation of the C/C++ extension failed. Please see the output window for more information.'));
                showOutputChannel();

                // Send the failure telemetry since postInstall will not be called.
                sendTelemetry(await PlatformInformation.GetPlatformInformation());
            }
        } else {
            // The extension has been installed and activated before.
            await finalizeExtensionActivation();
        }
    } else {
        // No lock file, need to download and install dependencies.
        try {
            await onlineInstallation();
        } catch (error) {
            handleError(error);

            // Send the failure telemetry since postInstall will not be called.
            sendTelemetry(await PlatformInformation.GetPlatformInformation());
        }
    }
}

async function offlineInstallation(): Promise<void> {
    setInstallationStage('getPlatformInfo');
    setInstallationType(InstallationType.Offline);
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
    setInstallationType(InstallationType.Online);
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
    outputChannelLogger.appendLine(localize("updating.dependencies", "Updating C/C++ dependencies..."));

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
                    getOutputChannelLogger().appendLine(localize("rename.failed.delete.manually",
                        'ERROR: fs.rename failed with "{0}". Delete {1} manually to enable debugging.', err.message, sourcePath));
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
    let installationInformation: InstallationInformation = getInstallationInformation();
    installationInformation.hasError = true;
    installationInformation.telemetryProperties['stage'] = installationInformation.stage;
    let errorMessage: string;

    if (error instanceof PackageManagerError) {
        let packageError: PackageManagerError = error;

        installationInformation.telemetryProperties['error.methodName'] = packageError.methodName;
        installationInformation.telemetryProperties['error.message'] = packageError.message;

        if (packageError.innerError) {
            errorMessage = packageError.innerError.toString();
            installationInformation.telemetryProperties['error.innerError'] = util.removePotentialPII(errorMessage);
        } else {
            errorMessage = packageError.localizedMessageText;
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
    outputChannelLogger.appendLine(localize('failed.at.stage', "Failed at stage: {0}", installationInformation.stage));
    outputChannelLogger.appendLine(errorMessage);
    outputChannelLogger.appendLine("");
    outputChannelLogger.appendLine(localize('failed.at.stage2', 'If you work in an offline environment or repeatedly see this error, try downloading a version of the extension with all the dependencies pre-included from https://github.com/Microsoft/vscode-cpptools/releases, then use the "Install from VSIX" command in VS Code to install it.'));
    showOutputChannel();
}

function sendTelemetry(info: PlatformInformation): boolean {
    let installBlob: InstallationInformation = getInstallationInformation();
    const success: boolean = !installBlob.hasError;

    installBlob.telemetryProperties['success'] = success.toString();
    installBlob.telemetryProperties['type'] = installBlob.type === InstallationType.Online ? "online" : "offline";

    if (info.distribution) {
        installBlob.telemetryProperties['linuxDistroName'] = info.distribution.name;
        installBlob.telemetryProperties['linuxDistroVersion'] = info.distribution.version;
    }

    if (success) {
        util.setProgress(util.getProgressInstallSuccess());
    }

    installBlob.telemetryProperties['osArchitecture'] = info.architecture;

    Telemetry.logDebuggerEvent("acquisition", installBlob.telemetryProperties);

    return success;
}

async function postInstall(info: PlatformInformation): Promise<void> {
    let outputChannelLogger: Logger = getOutputChannelLogger();
    outputChannelLogger.appendLine("");
    outputChannelLogger.appendLine(localize('finished.installing.dependencies', "Finished installing dependencies"));
    outputChannelLogger.appendLine("");

    const installSuccess: boolean = sendTelemetry(info);

    // If there is a download failure, we shouldn't continue activating the extension in some broken state.
    if (!installSuccess) {
        return Promise.reject<void>("");
    } else {
        // Notify users if debugging may not be supported on their OS.
        util.checkDistro(info);

        return finalizeExtensionActivation();
    }
}

async function finalizeExtensionActivation(): Promise<void> {
    let settings: CppSettings = new CppSettings();
    if (!settings.intelliSenseEnabled) {
        languageServiceDisabled = true;
        getTemporaryCommandRegistrarInstance().disableLanguageServer();
        disposables.push(vscode.workspace.onDidChangeConfiguration(() => {
            if (!reloadMessageShown && settings.intelliSenseEnabled) {
                reloadMessageShown = true;
                util.promptForReloadWindowDueToSettingsChange();
            }
        }));
        return;
    }
    disposables.push(vscode.workspace.onDidChangeConfiguration(() => {
        if (!reloadMessageShown && !settings.intelliSenseEnabled) {
            reloadMessageShown = true;
            util.promptForReloadWindowDueToSettingsChange();
        }
    }));
    getTemporaryCommandRegistrarInstance().activateLanguageServer();

    let packageJson: any = util.getRawPackageJson();
    let writePackageJson: boolean = false;
    let packageJsonPath: string = util.getExtensionFilePath("package.json");
    if (packageJsonPath.includes(".vscode-insiders") || packageJsonPath.includes(".vscode-exploration")) {
        if (packageJson.contributes.configuration.properties['C_Cpp.updateChannel'].default === 'Default') {
            packageJson.contributes.configuration.properties['C_Cpp.updateChannel'].default = 'Insiders';
            writePackageJson = true;
        }
    }

    if (writePackageJson) {
        return util.writeFileText(util.getPackageJsonPath(), util.stringifyPackageJson(packageJson));
    }
}

function rewriteManifest(): Promise<void> {
    // Replace activationEvents with the events that the extension should be activated for subsequent sessions.
    let packageJson: any = util.getRawPackageJson();

    packageJson.activationEvents = [
        "onLanguage:cpp",
        "onLanguage:c",
        "onCommand:extension.pickNativeProcess",
        "onCommand:extension.pickRemoteNativeProcess",
        "onCommand:C_Cpp.BuildAndDebugActiveFile",
        "onCommand:C_Cpp.ConfigurationEditJSON",
        "onCommand:C_Cpp.ConfigurationEditUI",
        "onCommand:C_Cpp.ConfigurationSelect",
        "onCommand:C_Cpp.ConfigurationProviderSelect",
        "onCommand:C_Cpp.SwitchHeaderSource",
        "onCommand:C_Cpp.EnableErrorSquiggles",
        "onCommand:C_Cpp.DisableErrorSquiggles",
        "onCommand:C_Cpp.ToggleIncludeFallback",
        "onCommand:C_Cpp.ToggleDimInactiveRegions",
        "onCommand:C_Cpp.ResetDatabase",
        "onCommand:C_Cpp.TakeSurvey",
        "onCommand:C_Cpp.LogDiagnostics",
        "onCommand:C_Cpp.RescanWorkspace",
        "onCommand:C_Cpp.VcpkgClipboardInstallSuggested",
        "onCommand:C_Cpp.VcpkgClipboardOnlineHelpSuggested",
        "onDebug",
        "workspaceContains:/.vscode/c_cpp_properties.json"
    ];

    return util.writeFileText(util.getPackageJsonPath(), util.stringifyPackageJson(packageJson));
}
