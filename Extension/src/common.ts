/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as child_process from 'child_process';
import * as vscode from 'vscode';
import * as Telemetry from './telemetry';
import HttpsProxyAgent = require('https-proxy-agent');
import * as url from 'url';

export let extensionContext: vscode.ExtensionContext;
export function setExtensionContext(context: vscode.ExtensionContext) {
    extensionContext = context;
}

export let packageJson: any = vscode.extensions.getExtension("ms-vscode.cpptools").packageJSON;

// Used to show a one-time wait/reload popup when launch.json becomes active.
let showReloadPromptOnce: boolean = false;
let showWaitForDownloadPromptOnce: boolean = false; 

let showReloadPromptAlways: boolean = false; // Used to show wait/reload in the launch/attach debug scenarios.

export function enableReloadOrWaitPrompt() {
    showReloadPromptOnce = showReloadPromptAlways = showWaitForDownloadPromptOnce = true;
}

export function getShowReloadPromptOnce(): boolean { return showReloadPromptOnce; }
export function getShowReloadPrompt(): boolean { return showReloadPromptAlways; }
export function getShowWaitForDownloadPromptOnce() { return showWaitForDownloadPromptOnce; }

export function showReloadPrompt() {
    showReloadPromptOnce = false;
    let reload: string = "Reload";
    vscode.window.showInformationMessage("Reload the window to finish installing the C/C++ extension.", reload).then(value => {
        if (value === reload) {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
    });
}

export function showWaitForDownloadPrompt() {
    showWaitForDownloadPromptOnce = false;
    getOutputChannel().show();
    vscode.window.showInformationMessage("Please wait for the C/C++ extension dependencies to finish downloading and installing.");
}

function showReloadOrWaitPromptImpl(once: boolean) {
    checkInstallLockFile().then((installLockExists: boolean) => {
        if (installLockExists) {
            showReloadPrompt();
        } else {
            if (!once || getShowWaitForDownloadPromptOnce()) {
                setDebuggerReloadLater();
                showWaitForDownloadPrompt();
            }
        }
    });
}

export function showReloadOrWaitPrompt() { showReloadOrWaitPromptImpl(false); }
export function showReloadOrWaitPromptOnce() { showReloadOrWaitPromptImpl(true); }

// Warning: The methods involving getExtensionFilePath are duplicated in debugProxyUtils.ts,
// because the extensionContext is not set in that context.

export function getExtensionFilePath(extensionfile: string): string {
    return path.resolve(extensionContext.extensionPath, extensionfile);
}
export function getPackageJsonPath(): string {
    return getExtensionFilePath("package.json");
}
export function getPackageJsonString(): string {
    packageJson.main = "./out/src/main"; // Needs to be reset, because the relative path is removed by VS Code.
    return JSON.stringify(packageJson, null, 2);
}

// This Progress global state tracks how far users are able to get before getting blocked.
// Users start with a progress of 0 and it increases as they get further along in using the tool.
// This eliminates noise/problems due to re-installs, terminated installs that don't send errors,
// errors followed by workarounds that lead to success, etc.
const progressInstallSuccess: number = 100;
const progressExecutableStarted: number = 150;
const progressExecutableSuccess: number = 200;
const progressParseRootSuccess: number = 300;
const progressIntelliSenseNoSquiggles: number = 1000;
// Might add more IntelliSense progress measurements later.
// IntelliSense progress is separate from the install progress, because parse root can occur afterwards.

let installProgressStr: string = "CPP." + packageJson.version + ".Progress";
let intelliSenseProgressStr: string = "CPP." + packageJson.version + ".IntelliSenseProgress";

export function getProgress(): number {
    return extensionContext.globalState.get<number>(installProgressStr, -1);
}

export function getIntelliSenseProgress(): number {
    return extensionContext.globalState.get<number>(intelliSenseProgressStr, -1);
}

export function setProgress(progress: number): void {
    if (getProgress() < progress) {
        extensionContext.globalState.update(installProgressStr, progress);
        let telemetryProperties: { [key: string]: string } = {};
        let progressName: string;
        switch (progress) {
            case 0: progressName = "install started"; break;
            case progressInstallSuccess: progressName = "install succeeded"; break;
            case progressExecutableStarted: progressName = "executable started"; break;
            case progressExecutableSuccess: progressName = "executable succeeded"; break;
            case progressParseRootSuccess: progressName = "parse root succeeded"; break;
        }
        telemetryProperties['progress'] = progressName;
        Telemetry.logDebuggerEvent("progress", telemetryProperties);
    }
}

export function setIntelliSenseProgress(progress: number) {
    if (getIntelliSenseProgress() < progress) {
        extensionContext.globalState.update(intelliSenseProgressStr, progress);
        let telemetryProperties: { [key: string]: string } = {};
        let progressName: string;
        switch (progress) {
            case progressIntelliSenseNoSquiggles: progressName = "IntelliSense no squiggles"; break;
        }
        telemetryProperties['progress'] = progressName;
        Telemetry.logDebuggerEvent("progress", telemetryProperties);
    }
}

export function getProgressInstallSuccess(): number { return progressInstallSuccess; } // Download/install was successful (i.e. not blocked by component acquisition).
export function getProgressExecutableStarted(): number { return progressExecutableStarted; } // The extension was activated and starting the executable was attempted.
export function getProgressExecutableSuccess(): number { return progressExecutableSuccess; } // Starting the exe was successful (i.e. not blocked by 32-bit or glibc < 2.18 on Linux)
export function getProgressParseRootSuccess(): number { return progressParseRootSuccess; } // Parse root was successful (i.e. not blocked by processing taking too long).
export function getProgressIntelliSenseNoSquiggles(): number { return progressIntelliSenseNoSquiggles; } // IntelliSense was successful and the user got no squiggles.

export function showReleaseNotes() {
    vscode.commands.executeCommand('vscode.previewHtml', vscode.Uri.file(getExtensionFilePath("ReleaseNotes.html")), vscode.ViewColumn.One, "C/C++ Extension Release Notes");
}

export function resolveVariables(input: string) {
    if (input === null) {
        return "";
    }

    // Replace environment variables. (support both ${env:VAR} and ${VAR} syntax)
    let regexp: RegExp = /\$\{(env:|env.)?(.*?)\}/g;
    let ret: string = input.replace(regexp, (match: string, ignored: string, name: string) => {
        let newValue: string = process.env[name];
        return (newValue != null) ? newValue : match;
    });

    // Resolve '~' at the start of the path.
    regexp = /^\~/g;
    ret = ret.replace(regexp, (match: string, name: string) => {
        let newValue: string = process.env.HOME;
        return (newValue != null) ? newValue : match;
    });

    return ret;
}

export function asFolder(uri: vscode.Uri): string {
    let result: string = uri.toString();
    if (result.charAt(result.length - 1) !== '/') {
        result += '/';
    }
    return result;
}

/**
 * get the default open command for the current platform
 */
export function getOpenCommand(): string {
    if (os.platform() == 'win32') {
        return 'explorer';
    } else if (os.platform() == 'darwin') {
        return '/usr/bin/open';
    } else {
        return '/usr/bin/xdg-open';
    }
}

// NOTE: This function is duplicated in debugProxyUtils.ts because common.ts cannot be imported by debugProxy.ts.
export function getDebugAdaptersPath(file: string): string {
    return path.resolve(getExtensionFilePath("debugAdapters"), file);
}

export function GetHttpsProxyAgent(): HttpsProxyAgent {
    let proxy: string = vscode.workspace.getConfiguration().get<string>('http.proxy');
    if (!proxy) {
        proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
        if (!proxy) {
            return null; // No proxy
        }
    }

    // Basic sanity checking on proxy url
    let proxyUrl: any = url.parse(proxy);
    if (proxyUrl.protocol !== "https:" && proxyUrl.protocol !== "http:") {
        return null;
    }

    let strictProxy: any = vscode.workspace.getConfiguration().get("http.proxyStrictSSL", true);
    let proxyOptions: any = {
        host: proxyUrl.hostname,
        port: parseInt(proxyUrl.port, 10),
        auth: proxyUrl.auth,
        rejectUnauthorized: strictProxy
    };

    return new HttpsProxyAgent(proxyOptions);
}

let reloadLater: boolean = false;
export function setDebuggerReloadLater() { reloadLater = true; }
export function getDebuggerReloadLater(): boolean { return reloadLater; }

/** Creates the lock file if it doesn't exist */
// NOTE: This function is duplicated in debugProxyUtils.ts because common.ts cannot be imported by debugProxy.ts.
function touchFile(file: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.writeFile(file, "", (err) => {
            if (err) {
                reject(err);
            }

            resolve();
        });
    });
}

export function touchInstallLockFile(): Promise<void> {
    return touchFile(getInstallLockPath());
}

export function touchPackageLockFile(): Promise<void> {
    return touchFile(getPackageLockPath());
}

export function touchExtensionFolder(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.utimes(path.resolve(extensionContext.extensionPath, ".."), new Date(Date.now()), new Date(Date.now()), (err) => {
            if (err) {
                reject(err);
            }

            resolve();
        });
    });
}

/** Test whether a file exists */
// NOTE: This function is duplicated in debugProxyUtils.ts because common.ts cannot be imported by debugProxy.ts.
export function checkFileExists(filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stats) => {
            if (stats && stats.isFile()) {
                resolve(true);
            }
            else {
                resolve(false);
            }
        });
    });
}

/** Test whether the lock file exists.*/
// NOTE: This function is duplicated in debugProxyUtils.ts because common.ts cannot be imported by debugProxy.ts.
export function checkInstallLockFile(): Promise<boolean> {
    return checkFileExists(getInstallLockPath());
}

// NOTE: This function is duplicated in debugProxyUtils.ts because common.ts cannot be imported by debugProxy.ts.
export function checkPackageLockFile(): Promise<boolean> {
    return checkFileExists(getPackageLockPath());
}

/** Reads the content of a text file */
export function readFileText(filePath: string, encoding: string = "utf8"): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        fs.readFile(filePath, encoding, (err, data) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(data);
        });
    });
}

/** Writes content to a text file */
export function writeFileText(filePath: string, content: string, encoding: string = "utf8"): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.writeFile(filePath, content, { encoding }, (err) => {
            if (err) {
                reject(err);
                return;
            }

            resolve();
        });
    });
}

// Get the path of the lock file. This is used to indicate that the platform-specific dependencies have been downloaded.
// NOTE: This function is duplicated in debugProxyUtils.ts because common.ts cannot be imported by debugProxy.ts.
export function getInstallLockPath(): string {
    return getExtensionFilePath("install.lock");
}

// This 2nd lock is needed for the debugger launch scenario to detect if a reload has been done yet.
// NOTE: This function is duplicated in debugProxyUtils.ts because common.ts cannot be imported by debugProxy.ts.
export function getPackageLockPath(): string {
    return getExtensionFilePath("package.lock");
}

// Used to communicate from the debugProxy to the extension code.
// NOTE: This function is duplicated in debugProxyUtils.ts because common.ts cannot be imported by debugProxy.ts.
export function getDebuggerReloadPath(): string {
    return getExtensionFilePath(`debugger.reload`);
}

export function getReadmeMessage(): string {
    const readmePath: string = getExtensionFilePath("README.md");
    const readmeMessage: string = `Please refer to ${readmePath} for troubleshooting information. Issues can be created at https://github.com/Microsoft/vscppsamples/issues`;
    return readmeMessage;
}

/** Used for diagnostics only */
export function logToFile(message: string): void {
    const logFolder: string = getExtensionFilePath("extension.log");
    fs.writeFileSync(logFolder, `${message}${os.EOL}`, { flag: 'a' });
}

export function execChildProcess(process: string, workingDirectory: string, channel?: vscode.OutputChannel): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        child_process.exec(process, { cwd: workingDirectory, maxBuffer: 500 * 1024 }, (error: Error, stdout: string, stderr: string) => {
            if (channel) {
                let message: string = "";
                let err: Boolean = false;
                if (stdout && stdout.length > 0) {
                    message += stdout;
                }

                if (stderr && stderr.length > 0) {
                    message += stderr;
                    err = true;
                }

                if (error) {
                    message += error.message;
                    err = true;
                }

                if (err) {
                    channel.append(message);
                    channel.show();
                }
            }

            if (error) {
                reject(error);
                return;
            }

            if (stderr && stderr.length > 0) {
                reject(new Error(stderr));
                return;
            }

            resolve(stdout);
        });
    });
}

export function spawnChildProcess(process: string, args: string[], workingDirectory: string,
    dataCallback: (stdout: string) => void, errorCallback: (stderr: string) => void): Promise<void> {

    return new Promise<void>(function (resolve, reject) {
        const child: child_process.ChildProcess = child_process.spawn(process, args, { cwd: workingDirectory });

        child.stdout.on('data', (data) => {
            dataCallback(`${data}`);
        });

        child.stderr.on('data', (data) => {
            errorCallback(`${data}`);
        });

        child.on('exit', (code: number) => {
            if (code !== 0) {
                reject(new Error(`${process} exited with error code ${code}`));
            }
            else {
                resolve();
            }
        });
    });
}

let outputChannel: vscode.OutputChannel;

export function getOutputChannel(): vscode.OutputChannel {
    if (outputChannel == undefined) {
        outputChannel = vscode.window.createOutputChannel("C/C++");
    }
    return outputChannel;
}

export function allowExecution(file: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (process.platform != 'win32') {
            checkFileExists(file).then((exists: boolean) => {
                if (exists) {
                    fs.chmod(file, '755', (err: NodeJS.ErrnoException) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    });
                }
                else {
                    getOutputChannel().appendLine("");
                    getOutputChannel().appendLine(`Warning: Expected file ${file} is missing.`);
                    resolve();
                }
            });
        }
        else {
            resolve();
        }
    });
}
