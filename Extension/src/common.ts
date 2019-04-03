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
import { PlatformInformation } from './platform';
import { getOutputChannelLogger, showOutputChannel } from './logger';
import * as assert from 'assert';
import * as https from 'https';
import { ClientRequest, OutgoingHttpHeaders } from 'http';
import { getBuildTasks } from './LanguageServer/extension';

export let extensionContext: vscode.ExtensionContext;
export function setExtensionContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

export const failedToParseTasksJson: string = "Failed to parse tasks.json, possibly due to comments or trailing commas.";

// Use this package.json to read values
export const packageJson: any = vscode.extensions.getExtension("ms-vscode.cpptools").packageJSON;

// Use getRawPackageJson to read and write back to package.json
// This prevents obtaining any of VSCode's expanded variables.
let rawPackageJson: any = null;
export function getRawPackageJson(): any {
    if (rawPackageJson === null) {
        const fileContents: Buffer = fs.readFileSync(getPackageJsonPath());
        rawPackageJson = JSON.parse(fileContents.toString());
    }
    return rawPackageJson;
}

export function getRawTasksJson(): Promise<any> {
    const path: string = getTasksJsonPath();
    if (!path) {
        return undefined;
    }
    return new Promise<any>((resolve, reject) => {
        fs.exists(path, exists => {
            if (!exists) {
                return resolve({});
            }
            let fileContents: string = fs.readFileSync(path).toString();
            fileContents = fileContents.replace(/^\s*\/\/.*$/gm, ""); // Remove start of line // comments.
            let rawTasks: any = {};
            try {
                rawTasks = JSON.parse(fileContents); 
            } catch (error) {
                return reject(new Error(failedToParseTasksJson));
            }
            resolve(rawTasks);
        });
    });
}

export async function ensureBuildTaskExists(taskName: string): Promise<void> {
    let rawTasksJson: any = await getRawTasksJson();

    // Ensure that the task exists in the user's task.json. Task will not be found otherwise.
    if (!rawTasksJson.tasks) {
        rawTasksJson.tasks = new Array();
    }
    // Find or create the task which should be created based on the selected "debug configuration".
    let selectedTask: vscode.Task = rawTasksJson.tasks.find(task => {
        return task.label && task.label === task;
    });
    if (selectedTask) {
        return;
    }

    const buildTasks: vscode.Task[] = await getBuildTasks(false);
    selectedTask = buildTasks.find(task => task.name === taskName);
    console.assert(selectedTask);

    rawTasksJson.version = "2.0.0";

    if (!rawTasksJson.tasks.find(task => { return task.label === selectedTask.definition.label; })) {
        rawTasksJson.tasks.push(selectedTask.definition);
    }
    
    // TODO: It's dangerous to overwrite this file. We could be wiping out comments.
    await writeFileText(getTasksJsonPath(), JSON.stringify(rawTasksJson, null, 2));
}

export function fileIsCOrCppSource(file: string): boolean {
    const fileExtLower: string = path.extname(file).toLowerCase();
    return [".C", ".c", ".cpp", ".cc", ".cxx", ".mm", ".ino", ".inl"].some(ext => fileExtLower === ext);
}

// This function is used to stringify the rawPackageJson.
// Do not use with util.packageJson or else the expanded
// package.json will be written back.
export function stringifyPackageJson(packageJson: string): string {
    return JSON.stringify(packageJson, null, 2);
}

export function getExtensionFilePath(extensionfile: string): string {
    return path.resolve(extensionContext.extensionPath, extensionfile);
}

export function getPackageJsonPath(): string {
    return getExtensionFilePath("package.json");
}

export function getTasksJsonPath(): string {
    const editor: vscode.TextEditor = vscode.window.activeTextEditor;
    const folder: vscode.WorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!folder) {
        return undefined;
    }
    return path.join(folder.uri.fsPath, ".vscode", "tasks.json");
}

export function getVcpkgPathDescriptorFile(): string {
    if (process.platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA, "vcpkg/vcpkg.path.txt");
    } else {
        return path.join(process.env.HOME, ".vcpkg/vcpkg.path.txt");
    }
}

let vcpkgRoot: string;
export function getVcpkgRoot(): string {
    if (!vcpkgRoot && vcpkgRoot !== "") {
        vcpkgRoot = "";
        // Check for vcpkg instance.
        if (fs.existsSync(getVcpkgPathDescriptorFile())) {
            let vcpkgRootTemp: string = fs.readFileSync(getVcpkgPathDescriptorFile()).toString();
            vcpkgRootTemp = vcpkgRootTemp.trim();
            if (fs.existsSync(vcpkgRootTemp)) {
                vcpkgRoot = path.join(vcpkgRootTemp, "/installed").replace(/\\/g, "/");
            }
        }
    }
    return vcpkgRoot;
}

/**
 * This is a fuzzy determination of whether a uri represents a header file.
 * For the purposes of this function, a header file has no extension, or an extension that begins with the letter 'h'.
 * @param document The document to check.
 */
export function isHeader(uri: vscode.Uri): boolean {
    let ext: string = path.extname(uri.fsPath);
    return !ext || ext.startsWith(".h") || ext.startsWith(".H");
}

// Extension is ready if install.lock exists and debugAdapters folder exist.
export async function isExtensionReady(): Promise<boolean> {
    const doesInstallLockFileExist: boolean = await checkInstallLockFile();

    return doesInstallLockFileExist;
}

let isExtensionNotReadyPromptDisplayed: boolean = false;
export const extensionNotReadyString: string = 'The C/C++ extension is still installing. See the output window for more information.';

export function displayExtensionNotReadyPrompt(): void {

    if (!isExtensionNotReadyPromptDisplayed) {
        isExtensionNotReadyPromptDisplayed = true;
        showOutputChannel();

        getOutputChannelLogger().showInformationMessage(extensionNotReadyString).then(
            () => { isExtensionNotReadyPromptDisplayed = false; },
            () => { isExtensionNotReadyPromptDisplayed = false; }
        );
    }
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

export function setIntelliSenseProgress(progress: number): void {
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

let releaseNotesPanel: vscode.WebviewPanel = undefined;

export async function showReleaseNotes(): Promise<void> {
    if (releaseNotesPanel) {
        releaseNotesPanel.reveal();
    } else {
        releaseNotesPanel = vscode.window.createWebviewPanel('releaseNotes', "C/C++ Extension Release Notes", vscode.ViewColumn.One);
        releaseNotesPanel.webview.html = await readFileText(getExtensionFilePath("ReleaseNotes.html"));
        releaseNotesPanel.onDidDispose(() => releaseNotesPanel = undefined, null, extensionContext.subscriptions);
    }
}

export function isUri(input: any): input is vscode.Uri {
    return input && input instanceof vscode.Uri;
}

export function isString(input: any): input is string {
    return typeof(input) === "string";
}

export function isNumber(input: any): input is number {
    return typeof(input) === "number";
}

export function isBoolean(input: any): input is boolean {
    return typeof(input) === "boolean";
}

export function isArray(input: any): input is any[] {
    return input instanceof Array;
}

export function isOptionalString(input: any): input is string|undefined {
    return input === undefined || isString(input);
}

export function isArrayOfString(input: any): input is string[] {
    return isArray(input) && input.every(item => isString(item));
}

export function isOptionalArrayOfString(input: any): input is string[]|undefined {
    return input === undefined || isArrayOfString(input);
}

export function resolveVariables(input: string, additionalEnvironment: {[key: string]: string | string[]}): string {
    if (!input) {
        return "";
    }
    if (!additionalEnvironment) {
        additionalEnvironment = {};
    }

    // Replace environment and configuration variables.
    let regexp: () => RegExp = () => /\$\{((env|config|workspaceFolder)(\.|:))?(.*?)\}/g;
    let ret: string = input;
    let cycleCache: Set<string> = new Set();
    while (!cycleCache.has(ret)) {
        cycleCache.add(ret);
        ret = ret.replace(regexp(), (match: string, ignored1: string, varType: string, ignored2: string, name: string) => {
            // Historically, if the variable didn't have anything before the "." or ":"
            // it was assumed to be an environment variable
            if (varType === undefined) {
                varType = "env";
            }
            let newValue: string;
            switch (varType) {
                case "env": {
                    let v: string | string[] = additionalEnvironment[name];
                    if (isString(v)) {
                        newValue = v;
                    } else if (input === match && isArrayOfString(v)) {
                        newValue = v.join(";");
                    }
                    if (!isString(newValue)) {
                        newValue = process.env[name];
                    }
                    break;
                }
                case "config": {
                    let config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
                    if (config) {
                        newValue = config.get<string>(name);
                    }
                    break;
                }
                case "workspaceFolder": {
                    // Only replace ${workspaceFolder:name} variables for now.
                    // We may consider doing replacement of ${workspaceFolder} here later, but we would have to update the language server and also
                    // intercept messages with paths in them and add the ${workspaceFolder} variable back in (e.g. for light bulb suggestions)
                    if (name && vscode.workspace && vscode.workspace.workspaceFolders) {
                        let folder: vscode.WorkspaceFolder = vscode.workspace.workspaceFolders.find(folder => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase());
                        if (folder) {
                            newValue = folder.uri.fsPath;
                        }
                    }
                    break;
                }
                default: { assert.fail("unknown varType matched"); }
            }
            return (isString(newValue)) ? newValue : match;
        });
    }

    // Resolve '~' at the start of the path.
    regexp = () => /^\~/g;
    ret = ret.replace(regexp(), (match: string, name: string) => {
        let newValue: string = (process.platform === 'win32') ? process.env.USERPROFILE : process.env.HOME;
        return (newValue) ? newValue : match;
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
    if (os.platform() === 'win32') {
        return 'explorer';
    } else if (os.platform() === 'darwin') {
        return '/usr/bin/open';
    } else {
        return '/usr/bin/xdg-open';
    }
}

export function getDebugAdaptersPath(file: string): string {
    return path.resolve(getExtensionFilePath("debugAdapters"), file);
}

export function getHttpsProxyAgent(): HttpsProxyAgent {
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

/** Creates a file if it doesn't exist */
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
export function checkFileExists(filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stats) => {
            if (stats && stats.isFile()) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });
}

/** Test whether a directory exists */
export function checkDirectoryExists(dirPath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        fs.stat(dirPath, (err, stats) => {
            if (stats && stats.isDirectory()) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });
}

export function checkFileExistsSync(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch (e) {
    }
    return false;
}

/** Test whether a directory exists */
export function checkDirectoryExistsSync(dirPath: string): boolean {
    try {
        return fs.statSync(dirPath).isDirectory();
    } catch (e) {
    }
    return false;
}

/** Read the files in a directory */
export function readDir(dirPath: string): Promise<string[]> {
    return new Promise((resolve) => {
        fs.readdir(dirPath, (err, list) => {
            resolve(list);
            });
        });
}

/** Test whether the lock file exists.*/
export function checkInstallLockFile(): Promise<boolean> {
    return checkFileExists(getInstallLockPath());
}

/** Reads the content of a text file */
export function readFileText(filePath: string, encoding: string = "utf8"): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        fs.readFile(filePath, encoding, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

/** Writes content to a text file */
export function writeFileText(filePath: string, content: string, encoding: string = "utf8"): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.writeFile(filePath, content, { encoding }, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

export function deleteFile(filePath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (fs.existsSync(filePath)) {
            fs.unlink(filePath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
}

// Get the path of the lock file. This is used to indicate that the platform-specific dependencies have been downloaded.
export function getInstallLockPath(): string {
    return getExtensionFilePath("install.lock");
}

export function getReadmeMessage(): string {
    const readmePath: string = getExtensionFilePath("README.md");
    const readmeMessage: string = `Please refer to ${readmePath} for troubleshooting information. Issues can be created at https://github.com/Microsoft/vscode-cpptools/issues`;
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

    return new Promise<void>(function (resolve, reject): void {
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
            } else {
                resolve();
            }
        });
    });
}

export function allowExecution(file: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (process.platform !== 'win32') {
            checkFileExists(file).then((exists: boolean) => {
                if (exists) {
                    fs.chmod(file, '755', (err: NodeJS.ErrnoException) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    });
                } else {
                    getOutputChannelLogger().appendLine("");
                    getOutputChannelLogger().appendLine(`Warning: Expected file ${file} is missing.`);
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
}

export function removePotentialPII(str: string): string {
    let words: string[] = str.split(" ");
    let result: string = "";
    for (let word of words) {
        if (word.indexOf(".") === -1 && word.indexOf("/") === -1 && word.indexOf("\\") === -1 && word.indexOf(":") === -1) {
            result += word + " ";
        } else {
            result += "? ";
        }
    }
    return result;
}

export function checkDistro(platformInfo: PlatformInformation): void {
    if (platformInfo.platform !== 'win32' && platformInfo.platform !== 'linux' && platformInfo.platform !== 'darwin') {
        // this should never happen because VSCode doesn't run on FreeBSD
        // or SunOS (the other platforms supported by node)
        getOutputChannelLogger().appendLine(`Warning: Debugging has not been tested for this platform. ${getReadmeMessage()}`);
    }
}

export async function unlinkPromise(fileName: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.unlink(fileName, err => {
            if (err) {
                return reject(err);
            }
            return resolve();
        });
    });
}

export async function renamePromise(oldName: string, newName: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.rename(oldName, newName, err => {
            if (err) {
                return reject(err);
            }
            return resolve();
        });
    });
}

export function promptForReloadWindowDueToSettingsChange(): void {
    promptReloadWindow("Reload the workspace for the settings change to take effect.");
}

export function promptReloadWindow(message: string): void {
    let reload: string = "Reload";
    vscode.window.showInformationMessage(message, reload).then((value: string) => {
        if (value === reload) {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
    });
}

export function downloadFileToDestination(urlStr: string, destinationPath: string, headers?: OutgoingHttpHeaders): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let parsedUrl: url.Url = url.parse(urlStr);
        let request: ClientRequest = https.request({
            host: parsedUrl.host,
            path: parsedUrl.path,
            agent: getHttpsProxyAgent(),
            rejectUnauthorized: vscode.workspace.getConfiguration().get('http.proxyStrictSSL', true),
            headers: headers
        }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) { // If redirected
                // Download from new location
                let redirectUrl: string;
                if (typeof response.headers.location === 'string') {
                    redirectUrl = response.headers.location;
                } else {
                    redirectUrl = response.headers.location[0];
                }
                return resolve(downloadFileToDestination(redirectUrl, destinationPath, headers));
            }
            if (response.statusCode !== 200) { // If request is not successful
                return reject();
            }
            // Write file using downloaded data
            let createdFile: fs.WriteStream = fs.createWriteStream(destinationPath);
            createdFile.on('finish', () => { resolve(); });
            response.on('error', (error) => { reject(error); });
            response.pipe(createdFile);
        });
        request.on('error', (error) => { reject(error); });
        request.end();
    });
}

export function downloadFileToStr(urlStr: string, headers?: OutgoingHttpHeaders): Promise<any> {
    return new Promise<string>((resolve, reject) => {
        let parsedUrl: url.Url = url.parse(urlStr);
        let request: ClientRequest = https.request({
            host: parsedUrl.host,
            path: parsedUrl.path,
            agent: getHttpsProxyAgent(),
            rejectUnauthorized: vscode.workspace.getConfiguration().get('http.proxyStrictSSL', true),
            headers: headers
        }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) { // If redirected
                // Download from new location
                let redirectUrl: string;
                if (typeof response.headers.location === 'string') {
                    redirectUrl = response.headers.location;
                } else {
                    redirectUrl = response.headers.location[0];
                }
                return resolve(downloadFileToStr(redirectUrl, headers));
            }
            if (response.statusCode !== 200) { // If request is not successful
                return reject();
            }
            let downloadedData: string = '';
            response.on('data', (data) => { downloadedData += data; });
            response.on('error', (error) => { reject(error); });
            response.on('end', () => { resolve(downloadedData); });
        });
        request.on('error', (error) => { reject(error); });
        request.end();
    });
}

export interface CompilerPathAndArgs {
    compilerPath: string;
    additionalArgs: string[];
}

export function extractCompilerPathAndArgs(inputCompilerPath: string): CompilerPathAndArgs {
    let compilerPath: string = inputCompilerPath;
    let additionalArgs: string[];
    let isWindows: boolean = os.platform() === 'win32';
    if (compilerPath) {
        if (compilerPath.startsWith("\"")) {
            let endQuote: number = compilerPath.substr(1).search("\"") + 1;
            if (endQuote !== -1) {
                additionalArgs = compilerPath.substr(endQuote + 1).split(" ");
                additionalArgs = additionalArgs.filter((arg: string) => { return arg.trim().length !== 0; }); // Remove empty args.
                compilerPath = compilerPath.substr(1, endQuote - 1);
            }
        } else {
            // Go from right to left checking if a valid path is to the left of a space.
            let spaceStart: number = compilerPath.lastIndexOf(" ");
            if (spaceStart !== -1 && (!isWindows || !compilerPath.endsWith("cl.exe")) && !checkFileExistsSync(compilerPath)) {
                let potentialCompilerPath: string = compilerPath.substr(0, spaceStart);
                while ((!isWindows || !potentialCompilerPath.endsWith("cl.exe")) && !checkFileExistsSync(potentialCompilerPath)) {
                    spaceStart = potentialCompilerPath.lastIndexOf(" ");
                    if (spaceStart === -1) {
                        // Reached the start without finding a valid path. Use the original value.
                        potentialCompilerPath = compilerPath;
                        break;
                    }
                    potentialCompilerPath = potentialCompilerPath.substr(0, spaceStart);
                }
                if (compilerPath !== potentialCompilerPath) {
                    // Found a valid compilerPath and args.
                    additionalArgs = compilerPath.substr(spaceStart + 1).split(" ");
                    additionalArgs = additionalArgs.filter((arg: string) => { return arg.trim().length !== 0; }); // Remove empty args.
                    compilerPath = potentialCompilerPath;
                }
            }
        }
    }
    return { compilerPath, additionalArgs };
}