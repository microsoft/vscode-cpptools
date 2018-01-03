/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as util from './common';
import * as Telemetry from './telemetry';
import * as LanguageServer from './LanguageServer/extension';
import * as DebuggerExtension from './Debugger/extension';
import { PlatformInformation } from './platform';
import { PackageManager, PackageManagerError, PackageManagerWebResponseError, IPackage } from './packageManager';
import { PersistentState } from './LanguageServer/persistentState';
import * as url from 'url';
import * as https from 'https';
import { extensionContext } from './common';

const releaseNotesVersion: number = 3;
const userBucketMax: number = 100;

// Used to save/re-execute commands used before the extension has activated (e.g. delayed by dependency downloading).
let delayedCommandsToExecute: Set<string>;
let tempCommands: vscode.Disposable[]; // Need to save this to unregister/dispose the temporary commands.

function registerTempCommand(command: string) {
    tempCommands.push(vscode.commands.registerCommand(command, () => {
        delayedCommandsToExecute.add(command);
        util.checkInstallLockFile().then((installLockExists: boolean) => {
            if (!installLockExists)
                util.showWaitForDownloadPrompt();
        });
    }));
}

const userBucketString = "CPP.UserBucket";

// NOTE: Code is copied from DownloadPackage in packageManager.ts, but with ~75% fewer lines.
function downloadCpptoolsJson(urlString): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let parsedUrl: url.Url = url.parse(urlString);
        let request = https.request({
            host: parsedUrl.host,
            path: parsedUrl.path,
            agent: util.GetHttpsProxyAgent(),
            rejectUnauthorized: vscode.workspace.getConfiguration().get("http.proxyStrictSSL", true)
        }, (response) => {
            if (response.statusCode == 301 || response.statusCode == 302) {
                let redirectUrl: string | string[];
                if (typeof response.headers.location === "string") {
                    redirectUrl = response.headers.location;
                } else {
                    redirectUrl = response.headers.location[0];
                }
                return resolve(downloadCpptoolsJson(redirectUrl)); // Redirect - download from new location
            }
            if (response.statusCode != 200)
                return reject();
            let downloadedBytes = 0;
            let cppToolsJsonFile: fs.WriteStream = fs.createWriteStream(util.getExtensionFilePath("cpptools.json"));
            response.on('data', (data) => { downloadedBytes += data.length; });
            response.on('end', () => { cppToolsJsonFile.close() });
            cppToolsJsonFile.on('close', () => { resolve(); });
            response.on('error', (error) => { reject(); });
            response.pipe(cppToolsJsonFile, { end: false });
        });
        request.on('error', (error) => { reject(); });
        request.end();
    });
}

function downloadCpptoolsJsonPkg(): Promise<void> {
    let hasError: boolean = false;
    let telemetryProperties: { [key: string]: string } = {};
    return downloadCpptoolsJson("https://go.microsoft.com/fwlink/?linkid=852750")
        .catch((error) => {
            // More specific error info is not likely to be helpful, and we get detailed download data from the initial install.
            hasError = true;
        })
        .then(() => {
            telemetryProperties['success'] = (!hasError).toString();
            Telemetry.logDebuggerEvent("cpptoolsJsonDownload", telemetryProperties);
        });
}

function processCpptoolsJson(cpptoolsString: string) {
    let cpptoolsObject = JSON.parse(cpptoolsString);
    let intelliSenseEnginePercentage: number = cpptoolsObject.intelliSenseEngine_default_percentage;

    if (!util.packageJson.extensionFolderPath.includes(".vscode-insiders")) {
        let prevIntelliSenseEngineDefault = util.packageJson.contributes.configuration.properties["C_Cpp.intelliSenseEngine"].default;
        if (util.extensionContext.globalState.get<number>(userBucketString, userBucketMax + 1) <= intelliSenseEnginePercentage) {
            util.packageJson.contributes.configuration.properties["C_Cpp.intelliSenseEngine"].default = "Default";
        } else {
            util.packageJson.contributes.configuration.properties["C_Cpp.intelliSenseEngine"].default = "Tag Parser";
        }
        if (prevIntelliSenseEngineDefault != util.packageJson.contributes.configuration.properties["C_Cpp.intelliSenseEngine"].default)
            return util.writeFileText(util.getPackageJsonPath(), util.getPackageJsonString());
    }
}

export function activate(context: vscode.ExtensionContext) {
    util.setExtensionContext(context);
    Telemetry.activate();
    util.setProgress(0);

    // Initialize the DebuggerExtension and register the related commands and providers.
    DebuggerExtension.initialize();

    if (context.globalState.get<number>(userBucketString, -1) == -1) {
        let bucket = Math.floor(Math.random() * userBucketMax) + 1; // Range is [1, userBucketMax].
        context.globalState.update(userBucketString, bucket);
    }

    // Add temp commands that invoke the real commands after download/install is complete (preventing an error message),
    // and also show the C/C++ output pane and the "wait for download" message.
    tempCommands = [];
    delayedCommandsToExecute = new Set<string>();
    registerTempCommand("C_Cpp.ConfigurationEdit");
    registerTempCommand("C_Cpp.ConfigurationSelect");
    registerTempCommand("C_Cpp.SwitchHeaderSource");
    registerTempCommand("C_Cpp.Navigate");
    registerTempCommand("C_Cpp.GoToDeclaration");
    registerTempCommand("C_Cpp.PeekDeclaration");
    registerTempCommand("C_Cpp.ToggleErrorSquiggles");
    registerTempCommand("C_Cpp.ToggleIncludeFallback");
    registerTempCommand("C_Cpp.ShowReleaseNotes");
    registerTempCommand("C_Cpp.ResetDatabase");
    registerTempCommand("C_Cpp.PauseParsing");
    registerTempCommand("C_Cpp.ResumeParsing");
    registerTempCommand("C_Cpp.ShowParsingCommands");
    registerTempCommand("C_Cpp.TakeSurvey");

    processRuntimeDependencies(() => {
        downloadCpptoolsJsonPkg().then(() => {
            util.readFileText(util.getExtensionFilePath("cpptools.json"))
                .then((cpptoolsString) => {
                    processCpptoolsJson(cpptoolsString);
                })
                .catch((error) => {
                    // We already log telemetry if cpptools.json fails to download.
                })
                .then(() => {
                    // Main activation code.
                    tempCommands.forEach((command) => {
                        command.dispose();
                    });
                    tempCommands = [];
                    LanguageServer.activate(delayedCommandsToExecute);
                    delayedCommandsToExecute.forEach((command) => {
                        vscode.commands.executeCommand(command);
                    });
                    delayedCommandsToExecute.clear();
                })
        });
    });

    setInterval(() => {
        // Redownload occasionally to prevent an extra reload during long sessions.
        downloadCpptoolsJsonPkg();
    }, 30 * 60 * 1000); // 30 minutes.
}

export function deactivate(): Thenable<void> {
    DebuggerExtension.dispose();

    tempCommands.forEach((command) => {
        command.dispose();
    });

    Telemetry.deactivate();
    return LanguageServer.deactivate();
}

function removePotentialPII(str: string): string {
    let words = str.split(" ");
    let result = "";
    for (let word of words) {
        if (word.indexOf(".") == -1 && word.indexOf("/") == -1 && word.indexOf("\\") == -1 && word.indexOf(":") == -1) {
            result += word + " ";
        }
        else {
            result += "? "
        }
    }
    return result;
}

interface InstallBlob {
    stage: string,
    hasError: boolean,
    telemetryProperties: { [key: string]: string },
    info?: PlatformInformation,
    packageManager?: PackageManager
}

// During activation, the C++ extension must perform the following steps:
//  1. Check the package.lock - if present, we're done.
//  2. Check for the install.lock file - if present, we write the package.lock and activate if activationEvents is not "*".
//  3. If activationEvents is "*", then we do the offline installation (everything after download/install).
//  4. If there's no install.lock, download and install (i.e. unzip) the required dependencies.
//  5. For both online and offline install, make sure all binaries are marked as executable.
//  6. And rewrite the package.json to launch the actual debugger instead of the proxy stub.
//  7. Create the install.lock file on success, but if a command is done before this time, a wait message is shown.
//  8. Log installation telemetry.
//  9. After the install is finished, show a reload prompt if a debug attach/launch occurrs or launch.json is opened.
// 10. We also download a cpptool.json in case we want to use the data in it to alter the behavior post-shipping (i.e. a/b testing).
// 11. After reloading, the package.lock is written, which causes the reload prompt to no longer appear.
function processRuntimeDependencies(activateExtensions: () => void) {
    util.checkPackageLockFile().then((packageLockExists: boolean) => {
        if (packageLockExists)
            return activateExtensions();

        util.checkInstallLockFile().then((installLockExists: boolean) => {
            let installBlob: InstallBlob = {
                stage: 'getPlatformInfo',
                hasError: false,
                telemetryProperties: {}
            };

            if (installLockExists) {
                if (util.packageJson.activationEvents && util.packageJson.activationEvents.length == 1) {
                    // If the lock exists, but package.json hasn't been rewritten, then there are some setup steps that have been skipped (offline install)

                    // Need to watch for debugger.reload in case launch debugging is done.
                    fs.watch(extensionContext.extensionPath, (event: string, filename: string) => {
                        if (filename == "debugger.reload")
                            util.showReloadPrompt();
                    });
                    PlatformInformation.GetPlatformInformation()
                        .then((info) => {
                            installBlob.info = info;
                            makeBinariesExecutable(installBlob);
                        })
                        .then(() => makeOfflineBinariesExecutable(installBlob))
                        .then(() => rewriteManifest(installBlob))
                        .then(() => touchInstallLockFile(installBlob))
                        .catch(error => handleError(installBlob, error))
                        .then(() => postInstall(installBlob))
                        .then(() => activateExtensions());
                } else {
                    util.touchPackageLockFile();
                    return activateExtensions();
                }
            } else {
                // Need to watch for debugger.reload in case launch debugging is done.
                fs.watch(extensionContext.extensionPath, (event: string, filename: string) => {
                    if (filename == "debugger.reload") {
                        util.checkInstallLockFile().then((installLockExists) => {
                            if (installLockExists) {
                                util.showReloadPrompt();
                            } else {
                                util.setDebuggerReloadLater();
                                util.showWaitForDownloadPrompt();
                            }
                        });
                    }
                });
                let channel = util.getOutputChannel();
                channel.appendLine("Updating C/C++ dependencies...");

                let statusItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
                let packageManager: PackageManager;

                PlatformInformation.GetPlatformInformation()
                    .then((info) => {
                        installBlob.info = info;
                        packageManager = new PackageManager(info, channel, statusItem);
                        channel.appendLine("");
                        installBlob.stage = "downloadPackages";
                        return packageManager.DownloadPackages();
                    })
                    .then(() => {
                        channel.appendLine("");
                        installBlob.stage = "installPackages";
                        return packageManager.InstallPackages();
                    })
                    .then(() => makeBinariesExecutable(installBlob))
                    .then(() => removeUnnecessaryFile(installBlob))
                    .then(() => rewriteManifest(installBlob))
                    .then(() => touchInstallLockFile(installBlob))
                    .catch(error => handleError(installBlob, error))
                    .then(() => statusItem.dispose())
                    .then(() => postInstall(installBlob))
                    .then(() => activateExtensions());
            }
        });
    });
}

function makeBinariesExecutable(installBlob: InstallBlob): Thenable<void> {
    installBlob.stage = "makeBinariesExecutable";
    return util.allowExecution(util.getDebugAdaptersPath("OpenDebugAD7"));
}

function makeOfflineBinariesExecutable(installBlob: InstallBlob): Thenable<void> {
    let promises: Thenable<void>[] = [];
    let packages: IPackage[] = util.packageJson["runtimeDependencies"];
    packages.forEach(p => {
        if (p.binaries && p.binaries.length > 0 &&
            p.platforms.findIndex(plat => plat === installBlob.info.platform) !== -1 &&
            p.architectures.findIndex(arch => arch === installBlob.info.architecture) !== - 1) {
            p.binaries.forEach(binary => promises.push(util.allowExecution(util.getExtensionFilePath(binary))));
        }
    });
    return Promise.all(promises).then(() => { });
}

function removeUnnecessaryFile(installBlob: InstallBlob): void {
    if (os.platform() !== 'win32') {
        installBlob.stage = "removeUnnecessaryFile";
        let sourcePath = util.getDebugAdaptersPath("bin/OpenDebugAD7.exe.config");
        if (fs.existsSync(sourcePath))
            fs.rename(sourcePath, util.getDebugAdaptersPath("bin/OpenDebugAD7.exe.config.unused"), (err) => {
                util.getOutputChannel().appendLine("removeUnnecessaryFile: fs.rename failed: " + err.message);
            });
    }
}

function touchInstallLockFile(installBlob: InstallBlob): Thenable<void> {
    checkDistro(util.getOutputChannel(), installBlob.info);

    installBlob.stage = "touchInstallLockFile";
    return util.touchInstallLockFile();
}

function handleError(installBlob: InstallBlob, error: any): void {
    installBlob.hasError = true;
    installBlob.telemetryProperties['stage'] = installBlob.stage;
    let errorMessage: string;
    let channel = util.getOutputChannel();

    if (error instanceof PackageManagerError) {
        // If this is a WebResponse error, log the IP that it resolved from the package URL
        if (error instanceof PackageManagerWebResponseError) {
            let webRequestPackageError: PackageManagerWebResponseError = error;
            if (webRequestPackageError.socket) {
                let address = webRequestPackageError.socket.address();
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
            installBlob.telemetryProperties['error.innerError'] = removePotentialPII(errorMessage);
        } else {
            errorMessage = packageError.message;
        }

        if (packageError.pkg) {
            installBlob.telemetryProperties['error.packageName'] = packageError.pkg.description;
            installBlob.telemetryProperties['error.packageUrl'] = packageError.pkg.url;
        }

        if (packageError.errorCode) {
            installBlob.telemetryProperties['error.errorCode'] = removePotentialPII(packageError.errorCode);
        }
    }
    else {
        errorMessage = error.toString();
        installBlob.telemetryProperties['error.toString'] = removePotentialPII(errorMessage);
    }

    // Show the actual message and not the sanitized one
    if (installBlob.stage == "downloadPackages")
        channel.appendLine("");
    channel.appendLine(`Failed at stage: ${installBlob.stage}`);
    channel.appendLine(errorMessage);
    channel.appendLine("");
    channel.appendLine(`If you work in an offline environment or repeatedly see this error, try downloading a version of the extension with all the dependencies pre-included from https://github.com/Microsoft/vscode-cpptools/releases, then use the "Install from VSIX" command in VS Code to install it.`);
    channel.show();
}

function postInstall(installBlob: InstallBlob): Thenable<void> {
    let channel = util.getOutputChannel();

    channel.appendLine("");
    channel.appendLine("Finished installing dependencies");
    channel.appendLine("");
    installBlob.stage = '';

    installBlob.telemetryProperties['success'] = (!installBlob.hasError).toString();

    if (installBlob.info.distribution) {
        installBlob.telemetryProperties['linuxDistroName'] = installBlob.info.distribution.name;
        installBlob.telemetryProperties['linuxDistroVersion'] = installBlob.info.distribution.version;
    }

    if (!installBlob.hasError) {
        util.setProgress(util.getProgressInstallSuccess());
        let versionShown = new PersistentState<number>("CPP.ReleaseNotesVersion", -1);
        if (versionShown.Value < releaseNotesVersion) {
            util.showReleaseNotes();
            versionShown.Value = releaseNotesVersion;
        }
    }

    installBlob.telemetryProperties['osArchitecture'] = installBlob.info.architecture;

    Telemetry.logDebuggerEvent("acquisition", installBlob.telemetryProperties);

    // If there is a download failure, we shouldn't continue activating the extension in some broken state.
    if (installBlob.hasError)
        return Promise.reject<void>("");

    if (util.getDebuggerReloadLater())
        util.showReloadPrompt();

    return Promise.resolve();
}

function checkDistro(channel: vscode.OutputChannel, platformInfo: PlatformInformation): void {
    if (platformInfo.platform != 'win32' && platformInfo.platform != 'linux' && platformInfo.platform != 'darwin') {
        // this should never happen because VSCode doesn't run on FreeBSD
        // or SunOS (the other platforms supported by node)
        channel.appendLine(`Warning: Debugging has not been tested for this platform. ${util.getReadmeMessage()}`);
    }
}

function rewriteManifest(installBlob: InstallBlob): void {
    installBlob.stage = "rewriteManifest";

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
}
