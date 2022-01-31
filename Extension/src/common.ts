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
import * as tmp from 'tmp';
import { ClientRequest, OutgoingHttpHeaders } from 'http';
import { lookupString } from './nativeStrings';
import * as nls from 'vscode-nls';
import { Readable } from 'stream';
import * as jsonc from 'comment-json';
import { TargetPopulation } from 'vscode-tas-client';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
export const failedToParseJson: string = localize("failed.to.parse.json", "Failed to parse json file, possibly due to comments or trailing commas.");

export type Mutable<T> = {
    // eslint-disable-next-line @typescript-eslint/array-type
    -readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U> ? Mutable<U>[] : Mutable<T[P]>
};

// Platform-specific environment variable delimiter
export const envDelimiter: string = (process.platform === 'win32') ? ";" : ":";

export let extensionPath: string;
export let extensionContext: vscode.ExtensionContext | undefined;
export function setExtensionContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
    extensionPath = extensionContext.extensionPath;
}
export function setExtensionPath(path: string): void {
    extensionPath = path;
}

let cachedClangFormatPath: string | null | undefined;
export function getCachedClangFormatPath(): string | null | undefined {
    return cachedClangFormatPath;
}
export function setCachedClangFormatPath(path: string | null): void {
    cachedClangFormatPath = path;
}

let cachedClangTidyPath: string | null | undefined;
export function getCachedClangTidyPath(): string | null | undefined {
    return cachedClangTidyPath;
}
export function setCachedClangTidyPath(path: string | null): void {
    cachedClangTidyPath = path;
}

// Use this package.json to read values
export const packageJson: any = vscode.extensions.getExtension("ms-vscode.cpptools")?.packageJSON;

// Use getRawPackageJson to read and write back to package.json
// This prevents obtaining any of VSCode's expanded variables.
let rawPackageJson: any = null;
export function getRawPackageJson(): any {
    if (rawPackageJson === null || rawPackageJson === undefined) {
        const fileContents: Buffer = fs.readFileSync(getPackageJsonPath());
        rawPackageJson = JSON.parse(fileContents.toString());
    }
    return rawPackageJson;
}

export async function getRawJson(path: string | undefined): Promise<any> {
    if (!path) {
        return {};
    }
    const fileExists: boolean = await checkFileExists(path);
    if (!fileExists) {
        return {};
    }

    const fileContents: string = await readFileText(path);
    let rawElement: any = {};
    try {
        rawElement = jsonc.parse(fileContents);
    } catch (error) {
        throw new Error(failedToParseJson);
    }
    return rawElement;
}

export function fileIsCOrCppSource(file?: string): boolean {
    if (file === undefined) {
        return false;
    }
    const fileExtLower: string = path.extname(file).toLowerCase();
    return [".cu", ".c", ".cpp", ".cc", ".cxx", ".c++", ".cp", ".tcc", ".mm", ".ino", ".ipp", ".inl"].some(ext => fileExtLower === ext);
}

export function isEditorFileCpp(file: string): boolean {
    const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === file);
    if (!editor) {
        return false;
    }
    return editor.document.languageId === "cpp";
}

// This function is used to stringify the rawPackageJson.
// Do not use with util.packageJson or else the expanded
// package.json will be written back.
export function stringifyPackageJson(packageJson: string): string {
    return JSON.stringify(packageJson, null, 2);
}

export function getExtensionFilePath(extensionfile: string): string {
    return path.resolve(extensionPath, extensionfile);
}

export function getPackageJsonPath(): string {
    return getExtensionFilePath("package.json");
}

export function getJsonPath(jsonFilaName: string): string | undefined {
    const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!editor) {
        return undefined;
    }
    const folder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!folder) {
        return undefined;
    }
    return path.join(folder.uri.fsPath, ".vscode", jsonFilaName);
}

export function getVcpkgPathDescriptorFile(): string {
    if (process.platform === 'win32') {
        const pathPrefix: string | undefined = process.env.LOCALAPPDATA;
        if (!pathPrefix) {
            throw new Error("Unable to read process.env.LOCALAPPDATA");
        }
        return path.join(pathPrefix, "vcpkg/vcpkg.path.txt");
    } else {
        const pathPrefix: string = os.homedir();
        return path.join(pathPrefix, ".vcpkg/vcpkg.path.txt");
    }
}

let vcpkgRoot: string | undefined;
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
    const ext: string = path.extname(uri.fsPath);
    return !ext || ext.startsWith(".h") || ext.startsWith(".H");
}

let isExtensionNotReadyPromptDisplayed: boolean = false;
export const extensionNotReadyString: string = localize("extension.not.ready", 'The C/C++ extension is still installing. See the output window for more information.');

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

const installProgressStr: string = "CPP." + packageJson.version + ".Progress";
const intelliSenseProgressStr: string = "CPP." + packageJson.version + ".IntelliSenseProgress";

export function getProgress(): number {
    return extensionContext ? extensionContext.globalState.get<number>(installProgressStr, -1) : -1;
}

export function getIntelliSenseProgress(): number {
    return extensionContext ? extensionContext.globalState.get<number>(intelliSenseProgressStr, -1) : -1;
}

export function setProgress(progress: number): void {
    if (extensionContext && getProgress() < progress) {
        extensionContext.globalState.update(installProgressStr, progress);
        const telemetryProperties: { [key: string]: string } = {};
        let progressName: string | undefined;
        switch (progress) {
            case 0: progressName = "install started"; break;
            case progressInstallSuccess: progressName = "install succeeded"; break;
            case progressExecutableStarted: progressName = "executable started"; break;
            case progressExecutableSuccess: progressName = "executable succeeded"; break;
            case progressParseRootSuccess: progressName = "parse root succeeded"; break;
        }
        if (progressName) {
            telemetryProperties['progress'] = progressName;
        }
        Telemetry.logDebuggerEvent("progress", telemetryProperties);
    }
}

export function setIntelliSenseProgress(progress: number): void {
    if (extensionContext && getIntelliSenseProgress() < progress) {
        extensionContext.globalState.update(intelliSenseProgressStr, progress);
        const telemetryProperties: { [key: string]: string } = {};
        let progressName: string | undefined;
        switch (progress) {
            case progressIntelliSenseNoSquiggles: progressName = "IntelliSense no squiggles"; break;
        }
        if (progressName) {
            telemetryProperties['progress'] = progressName;
        }
        Telemetry.logDebuggerEvent("progress", telemetryProperties);
    }
}

export function getProgressInstallSuccess(): number { return progressInstallSuccess; } // Download/install was successful (i.e. not blocked by component acquisition).
export function getProgressExecutableStarted(): number { return progressExecutableStarted; } // The extension was activated and starting the executable was attempted.
export function getProgressExecutableSuccess(): number { return progressExecutableSuccess; } // Starting the exe was successful (i.e. not blocked by 32-bit or glibc < 2.18 on Linux)
export function getProgressParseRootSuccess(): number { return progressParseRootSuccess; } // Parse root was successful (i.e. not blocked by processing taking too long).
export function getProgressIntelliSenseNoSquiggles(): number { return progressIntelliSenseNoSquiggles; } // IntelliSense was successful and the user got no squiggles.

export function isUri(input: any): input is vscode.Uri {
    return input && input instanceof vscode.Uri;
}

export function isString(input: any): input is string {
    return typeof (input) === "string";
}

export function isNumber(input: any): input is number {
    return typeof (input) === "number";
}

export function isBoolean(input: any): input is boolean {
    return typeof (input) === "boolean";
}

export function isObject(input: any): input is object {
    return typeof (input) === "object";
}

export function isArray(input: any): input is any[] {
    return input instanceof Array;
}

export function isOptionalString(input: any): input is string | undefined {
    return input === undefined || isString(input);
}

export function isArrayOfString(input: any): input is string[] {
    return isArray(input) && input.every(isString);
}

export function isOptionalArrayOfString(input: any): input is string[] | undefined {
    return input === undefined || isArrayOfString(input);
}

export function resolveCachePath(input: string | undefined, additionalEnvironment: { [key: string]: string | string[] }): string {
    let resolvedPath: string = "";
    if (!input) {
        // If no path is set, return empty string to language service process, where it will set the default path as
        // Windows: %LocalAppData%/Microsoft/vscode-cpptools/
        // Linux and Mac: ~/.vscode-cpptools/
        return resolvedPath;
    }

    resolvedPath = resolveVariables(input, additionalEnvironment);
    return resolvedPath;
}

// Pass in 'arrayResults' if a string[] result is possible and a delimited string result is undesirable.
// The string[] result will be copied into 'arrayResults'.
export function resolveVariables(input: string | undefined, additionalEnvironment?: { [key: string]: string | string[] }, arrayResults?: string[]): string {
    if (!input) {
        return "";
    }

    // Replace environment and configuration variables.
    let regexp: () => RegExp = () => /\$\{((env|config|workspaceFolder|file|fileDirname|fileBasenameNoExtension|execPath|pathSeparator)(\.|:))?(.*?)\}/g;
    let ret: string = input;
    const cycleCache: Set<string> = new Set();
    while (!cycleCache.has(ret)) {
        cycleCache.add(ret);
        ret = ret.replace(regexp(), (match: string, ignored1: string, varType: string, ignored2: string, name: string) => {
            // Historically, if the variable didn't have anything before the "." or ":"
            // it was assumed to be an environment variable
            if (!varType) {
                varType = "env";
            }
            let newValue: string | undefined;
            switch (varType) {
                case "env": {
                    if (additionalEnvironment) {
                        const v: string | string[] | undefined = additionalEnvironment[name];
                        if (isString(v)) {
                            newValue = v;
                        } else if (input === match && isArrayOfString(v)) {
                            if (arrayResults !== undefined) {
                                arrayResults.push(...v);
                                newValue = "";
                                break;
                            } else {
                                newValue = v.join(envDelimiter);
                            }
                        }
                    }
                    if (newValue === undefined) {
                        newValue = process.env[name];
                    }
                    break;
                }
                case "config": {
                    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
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
                        const folder: vscode.WorkspaceFolder | undefined = vscode.workspace.workspaceFolders.find(folder => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase());
                        if (folder) {
                            newValue = folder.uri.fsPath;
                        }
                    }
                    break;
                }
                default: { assert.fail("unknown varType matched"); }
            }
            return newValue !== undefined ? newValue : match;
        });
    }

    // Resolve '~' at the start of the path.
    regexp = () => /^\~/g;
    ret = ret.replace(regexp(), (match: string, name: string) => os.homedir());

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

export function getHttpsProxyAgent(): HttpsProxyAgent | undefined {
    let proxy: string | undefined = vscode.workspace.getConfiguration().get<string>('http.proxy');
    if (!proxy) {
        proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
        if (!proxy) {
            return undefined; // No proxy
        }
    }

    // Basic sanity checking on proxy url
    const proxyUrl: any = url.parse(proxy);
    if (proxyUrl.protocol !== "https:" && proxyUrl.protocol !== "http:") {
        return undefined;
    }

    const strictProxy: any = vscode.workspace.getConfiguration().get("http.proxyStrictSSL", true);
    const proxyOptions: any = {
        host: proxyUrl.hostname,
        port: parseInt(proxyUrl.port, 10),
        auth: proxyUrl.auth,
        rejectUnauthorized: strictProxy
    };

    return new HttpsProxyAgent(proxyOptions);
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

/** Test whether a relative path exists */
export function checkPathExistsSync(path: string, relativePath: string, isWindows: boolean, isWSL: boolean, isCompilerPath: boolean): { pathExists: boolean; path: string } {
    let pathExists: boolean = true;
    const existsWithExeAdded: (path: string) => boolean = (path: string) => isCompilerPath && isWindows && !isWSL && fs.existsSync(path + ".exe");
    if (!fs.existsSync(path)) {
        if (existsWithExeAdded(path)) {
            path += ".exe";
        } else if (!relativePath) {
            pathExists = false;
        } else {
            // Check again for a relative path.
            relativePath = relativePath + path;
            if (!fs.existsSync(relativePath)) {
                if (existsWithExeAdded(path)) {
                    path += ".exe";
                } else {
                    pathExists = false;
                }
            } else {
                path = relativePath;
            }
        }
    }
    return { pathExists, path };
}

/** Read the files in a directory */
export function readDir(dirPath: string): Promise<string[]> {
    return new Promise((resolve) => {
        fs.readdir(dirPath, (err, list) => {
            resolve(list);
        });
    });
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
export function writeFileText(filePath: string, content: string, encoding: BufferEncoding = "utf8"): Promise<void> {
    const folders: string[] = filePath.split(path.sep).slice(0, -1);
    if (folders.length) {
        // create folder path if it doesn't exist
        folders.reduce((previous, folder) => {
            const folderPath: string = previous + path.sep + folder;
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath);
            }
            return folderPath;
        });
    }

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

export function getReadmeMessage(): string {
    const readmePath: string = getExtensionFilePath("README.md");
    const readmeMessage: string = localize("refer.read.me", "Please refer to {0} for troubleshooting information. Issues can be created at {1}", readmePath, "https://github.com/Microsoft/vscode-cpptools/issues");
    return readmeMessage;
}

/** Used for diagnostics only */
export function logToFile(message: string): void {
    const logFolder: string = getExtensionFilePath("extension.log");
    fs.writeFileSync(logFolder, `${message}${os.EOL}`, { flag: 'a' });
}

export function execChildProcess(process: string, workingDirectory?: string, channel?: vscode.OutputChannel): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        child_process.exec(process, { cwd: workingDirectory, maxBuffer: 500 * 1024 }, (error: Error | null, stdout: string, stderr: string) => {
            if (channel) {
                let message: string = "";
                let err: boolean = false;
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

        const stdout: Readable | null = child.stdout;
        if (stdout) {
            stdout.on('data', (data) => {
                dataCallback(`${data}`);
            });
        }

        const stderr: Readable | null = child.stderr;
        if (stderr) {
            stderr.on('data', (data) => {
                errorCallback(`${data}`);
            });
        }

        child.on('exit', (code: number) => {
            if (code !== 0) {
                reject(new Error(localize("process.exited.with.code", "{0} exited with error code {1}", process, code)));
            } else {
                resolve();
            }
        });
    });
}

export function isExecutable(file: string): Promise<boolean> {
    return new Promise((resolve) => {
        fs.access(file, fs.constants.X_OK, (err) => {
            if (err) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

export async function allowExecution(file: string): Promise<void> {
    if (process.platform !== 'win32') {
        const exists: boolean = await checkFileExists(file);
        if (exists) {
            const isExec: boolean = await isExecutable(file);
            if (!isExec) {
                await chmodAsync(file, '755');
            }
        } else {
            getOutputChannelLogger().appendLine("");
            getOutputChannelLogger().appendLine(localize("warning.file.missing", "Warning: Expected file {0} is missing.", file));
        }
    }
}

export async function chmodAsync(path: fs.PathLike, mode: fs.Mode): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.chmod(path, mode, (err: NodeJS.ErrnoException | null) => {
            if (err) {
                return reject(err);
            }
            return resolve();
        });
    });
}

export function removePotentialPII(str: string): string {
    const words: string[] = str.split(" ");
    let result: string = "";
    for (const word of words) {
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
        getOutputChannelLogger().appendLine(localize("warning.debugging.not.tested", "Warning: Debugging has not been tested for this platform.") + " " + getReadmeMessage());
    }
}

export async function unlinkAsync(fileName: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.unlink(fileName, err => {
            if (err) {
                return reject(err);
            }
            return resolve();
        });
    });
}

export async function renameAsync(oldName: string, newName: string): Promise<void> {
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
    promptReloadWindow(localize("reload.workspace.for.changes", "Reload the workspace for the settings change to take effect."));
}

export function promptReloadWindow(message: string): void {
    const reload: string = localize("reload.string", "Reload");
    vscode.window.showInformationMessage(message, reload).then((value?: string) => {
        if (value === reload) {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
    });
}

export function createTempFileWithPostfix(postfix: string): Promise<tmp.FileResult> {
    return new Promise<tmp.FileResult>((resolve, reject) => {
        tmp.file({ postfix: postfix }, (err, path, fd, cleanupCallback) => {
            if (err) {
                return reject(err);
            }
            return resolve(<tmp.FileResult>{ name: path, fd: fd, removeCallback: cleanupCallback });
        });
    });
}

export function downloadFileToDestination(urlStr: string, destinationPath: string, headers?: OutgoingHttpHeaders): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const parsedUrl: url.Url = url.parse(urlStr);
        const request: ClientRequest = https.request({
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
                    if (!response.headers.location) {
                        return reject(new Error(localize("invalid.download.location.received", 'Invalid download location received')));
                    }
                    redirectUrl = response.headers.location[0];
                }
                return resolve(downloadFileToDestination(redirectUrl, destinationPath, headers));
            }
            if (response.statusCode !== 200) { // If request is not successful
                return reject();
            }
            // Write file using downloaded data
            const createdFile: fs.WriteStream = fs.createWriteStream(destinationPath);
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
        const parsedUrl: url.Url = url.parse(urlStr);
        const request: ClientRequest = https.request({
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
                    if (!response.headers.location) {
                        return reject(new Error(localize("invalid.download.location.received", 'Invalid download location received')));
                    }
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

/** CompilerPathAndArgs retains original casing of text input for compiler path and args */
export interface CompilerPathAndArgs {
    compilerPath?: string;
    compilerName: string;
    additionalArgs: string[];
}

function extractArgs(argsString: string): string[] {
    const isWindows: boolean = os.platform() === 'win32';
    const result: string[] = [];
    let currentArg: string = "";
    let isWithinDoubleQuote: boolean = false;
    let isWithinSingleQuote: boolean = false;
    for (let i: number = 0; i < argsString.length; i++) {
        const c: string = argsString[i];
        if (c === '\\') {
            currentArg += c;
            if (++i === argsString.length) {
                if (currentArg !== "") {
                    result.push(currentArg);
                }
                return result;
            }
            currentArg += argsString[i];
            continue;
        }
        if (c === '"') {
            if (!isWithinSingleQuote) {
                isWithinDoubleQuote = !isWithinDoubleQuote;
            }
        } else if (c === '\'') {
            // On Windows, a single quote string is not allowed to join multiple args into a single arg
            if (!isWindows) {
                if (!isWithinDoubleQuote) {
                    isWithinSingleQuote = !isWithinSingleQuote;
                }
            }
        } else if (c === ' ') {
            if (!isWithinDoubleQuote && !isWithinSingleQuote) {
                if (currentArg !== "") {
                    result.push(currentArg);
                    currentArg = "";
                }
                continue;
            }
        }
        currentArg += c;
    }
    if (currentArg !== "") {
        result.push(currentArg);
    }
    return result;
}

export function extractCompilerPathAndArgs(inputCompilerPath?: string, inputCompilerArgs?: string[]): CompilerPathAndArgs {
    let compilerPath: string | undefined = inputCompilerPath;
    const compilerPathLowercase: string | undefined = inputCompilerPath?.toLowerCase();
    let compilerName: string = "";
    let additionalArgs: string[] = [];

    if (compilerPath) {
        if (compilerPathLowercase?.endsWith("\\cl.exe") || compilerPathLowercase?.endsWith("/cl.exe") || (compilerPathLowercase === "cl.exe")
            || compilerPathLowercase?.endsWith("\\cl") || compilerPathLowercase?.endsWith("/cl") || (compilerPathLowercase === "cl")) {
            compilerName = path.basename(compilerPath);
        } else if (compilerPath.startsWith("\"")) {
            // Input has quotes around compiler path
            const endQuote: number = compilerPath.substr(1).search("\"") + 1;
            if (endQuote !== -1) {
                additionalArgs = extractArgs(compilerPath.substr(endQuote + 1));
                compilerPath = compilerPath.substr(1, endQuote - 1);
                compilerName = path.basename(compilerPath);
            }
        } else {
            // Input has no quotes around compiler path
            let spaceStart: number = compilerPath.lastIndexOf(" ");
            if (checkFileExistsSync(compilerPath)) {
                // Get compiler name if there are no args but path is valid.
                compilerName = path.basename(compilerPath);
            } else if (spaceStart !== -1 && !checkFileExistsSync(compilerPath)) {
                // Get compiler name if compiler path has spaces and args.
                // Go from right to left checking if a valid path is to the left of a space.
                let potentialCompilerPath: string = compilerPath.substr(0, spaceStart);
                while (!checkFileExistsSync(potentialCompilerPath)) {
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
                    additionalArgs = extractArgs(compilerPath.substr(spaceStart + 1));
                    compilerPath = potentialCompilerPath;
                    compilerName = path.basename(potentialCompilerPath);
                }
            }
        }
    }
    // Combine args from inputCompilerPath and inputCompilerArgs and remove duplicates
    if (inputCompilerArgs && inputCompilerArgs.length) {
        additionalArgs = inputCompilerArgs.concat(additionalArgs.filter(
            function (item: string): boolean {
                return inputCompilerArgs.indexOf(item) < 0;
            }));
    }
    return { compilerPath, compilerName, additionalArgs };
}

export function escapeForSquiggles(s: string): string {
    // Replace all \<escape character> with \\<character>, except for \"
    // Otherwise, the JSON.parse result will have the \<escape character> missing.
    let newResults: string = "";
    let lastWasBackslash: boolean = false;
    let lastBackslashWasEscaped: boolean = false;
    for (let i: number = 0; i < s.length; i++) {
        if (s[i] === '\\') {
            if (lastWasBackslash) {
                newResults += "\\";
                lastBackslashWasEscaped = !lastBackslashWasEscaped;
            } else {
                lastBackslashWasEscaped = false;
            }
            newResults += "\\";
            lastWasBackslash = true;
        } else {
            if (lastWasBackslash && (lastBackslashWasEscaped || (s[i] !== '"'))) {
                newResults += "\\";
            }
            lastWasBackslash = false;
            lastBackslashWasEscaped = false;
            newResults += s[i];
        }
    }
    if (lastWasBackslash) {
        newResults += "\\";
    }
    return newResults;
}

export class BlockingTask<T> {
    private done: boolean = false;
    private promise: Thenable<T>;

    constructor(task: () => Thenable<T>, dependency?: BlockingTask<any>) {
        if (!dependency) {
            this.promise = task();
        } else {
            this.promise = new Promise<T>((resolve, reject) => {
                const f1: () => void = () => {
                    task().then(resolve, reject);
                };
                const f2: (err: any) => void = (err) => {
                    console.log(err);
                    task().then(resolve, reject);
                };
                dependency.promise.then(f1, f2);
            });
        }
        this.promise.then(() => this.done = true, () => this.done = true);
    }

    public get Done(): boolean {
        return this.done;
    }

    public getPromise(): Thenable<T> {
        return this.promise;
    }
}

interface VSCodeNlsConfig {
    locale: string;
    availableLanguages: {
        [pack: string]: string;
    };
}

export function getLocaleId(): string {
    // This replicates the language detection used by initializeSettings() in vscode-nls
    if (isString(process.env.VSCODE_NLS_CONFIG)) {
        const vscodeOptions: VSCodeNlsConfig = JSON.parse(process.env.VSCODE_NLS_CONFIG) as VSCodeNlsConfig;
        if (vscodeOptions.availableLanguages) {
            const value: any = vscodeOptions.availableLanguages['*'];
            if (isString(value)) {
                return value;
            }
        }
        if (isString(vscodeOptions.locale)) {
            return vscodeOptions.locale.toLowerCase();
        }
    }
    return "en";
}

export function getLocalizedHtmlPath(originalPath: string): string {
    const locale: string = getLocaleId();
    const localizedFilePath: string = getExtensionFilePath(path.join("dist/html/", locale, originalPath));
    if (!fs.existsSync(localizedFilePath)) {
        return getExtensionFilePath(originalPath);
    }
    return localizedFilePath;
}

export interface LocalizeStringParams {
    text: string;
    stringId: number;
    stringArgs: string[];
    indentSpaces: number;
}

export function getLocalizedString(params: LocalizeStringParams): string {
    let indent: string = "";
    if (params.indentSpaces) {
        indent = " ".repeat(params.indentSpaces);
    }
    let text: string = params.text;
    if (params.stringId !== 0) {
        text = lookupString(params.stringId, params.stringArgs);
    }
    return indent + text;
}

export function getLocalizedSymbolScope(scope: string, detail: string): string {
    return localize({
        key: "c.cpp.symbolscope.separator", comment:
            ["{0} is an untranslated C++ keyword (e.g. \"private\") and {1} is either another keyword (e.g. \"typedef\") or a localized property (e.g. a localized version of \"declaration\""]
    }, "{0}, {1}", scope, detail);
}

function decodeUCS16(input: string): number[] {
    const output: number[] = [];
    let counter: number = 0;
    const length: number = input.length;
    let value: number;
    let extra: number;
    while (counter < length) {
        value = input.charCodeAt(counter++);
        // eslint-disable-next-line no-bitwise
        if ((value & 0xF800) === 0xD800 && counter < length) {
            // high surrogate, and there is a next character
            extra = input.charCodeAt(counter++);
            // eslint-disable-next-line no-bitwise
            if ((extra & 0xFC00) === 0xDC00) { // low surrogate
                // eslint-disable-next-line no-bitwise
                output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
            } else {
                output.push(value, extra);
            }
        } else {
            output.push(value);
        }
    }
    return output;
}

const allowedIdentifierUnicodeRanges: number[][] = [
    [0x0030, 0x0039], // digits
    [0x0041, 0x005A], // upper case letters
    [0x005F, 0x005F], // underscore
    [0x0061, 0x007A], // lower case letters
    [0x00A8, 0x00A8], // DIARESIS
    [0x00AA, 0x00AA], // FEMININE ORDINAL INDICATOR
    [0x00AD, 0x00AD], // SOFT HYPHEN
    [0x00AF, 0x00AF], // MACRON
    [0x00B2, 0x00B5], // SUPERSCRIPT TWO - MICRO SIGN
    [0x00B7, 0x00BA], // MIDDLE DOT - MASCULINE ORDINAL INDICATOR
    [0x00BC, 0x00BE], // VULGAR FRACTION ONE QUARTER - VULGAR FRACTION THREE QUARTERS
    [0x00C0, 0x00D6], // LATIN CAPITAL LETTER A WITH GRAVE - LATIN CAPITAL LETTER O WITH DIAERESIS
    [0x00D8, 0x00F6], // LATIN CAPITAL LETTER O WITH STROKE - LATIN SMALL LETTER O WITH DIAERESIS
    [0x00F8, 0x167F], // LATIN SMALL LETTER O WITH STROKE - CANADIAN SYLLABICS BLACKFOOT W
    [0x1681, 0x180D], // OGHAM LETTER BEITH - MONGOLIAN FREE VARIATION SELECTOR THREE
    [0x180F, 0x1FFF], // SYRIAC LETTER BETH - GREEK DASIA
    [0x200B, 0x200D], // ZERO WIDTH SPACE - ZERO WIDTH JOINER
    [0x202A, 0x202E], // LEFT-TO-RIGHT EMBEDDING - RIGHT-TO-LEFT OVERRIDE
    [0x203F, 0x2040], // UNDERTIE - CHARACTER TIE
    [0x2054, 0x2054], // INVERTED UNDERTIE
    [0x2060, 0x218F], // WORD JOINER - TURNED DIGIT THREE
    [0x2460, 0x24FF], // CIRCLED DIGIT ONE - NEGATIVE CIRCLED DIGIT ZERO
    [0x2776, 0x2793], // DINGBAT NEGATIVE CIRCLED DIGIT ONE - DINGBAT NEGATIVE CIRCLED SANS-SERIF NUMBER TEN
    [0x2C00, 0x2DFF], // GLAGOLITIC CAPITAL LETTER AZU - COMBINING CYRILLIC LETTER IOTIFIED BIG YUS
    [0x2E80, 0x2FFF], // CJK RADICAL REPEAT - IDEOGRAPHIC DESCRIPTION CHARACTER OVERLAID
    [0x3004, 0x3007], // JAPANESE INDUSTRIAL STANDARD SYMBOL - IDEOGRAPHIC NUMBER ZERO
    [0x3021, 0x302F], // HANGZHOU NUMERAL ONE - HANGUL DOUBLE DOT TONE MARK
    [0x3031, 0xD7FF], // VERTICAL KANA REPEAT MARK - HANGUL JONGSEONG PHIEUPH-THIEUTH
    [0xF900, 0xFD3D], // CJK COMPATIBILITY IDEOGRAPH-F900 - ARABIC LIGATURE ALEF WITH FATHATAN ISOLATED FORM
    [0xFD40, 0xFDCF], // ARABIC LIGATURE TEH WITH JEEM WITH MEEM INITIAL FORM - ARABIC LIGATURE NOON WITH JEEM WITH YEH FINAL FORM
    [0xFDF0, 0xFE44], // ARABIC LIGATURE SALLA USED AS KORANIC STOP SIGN ISOLATED FORM - PRESENTATION FORM FOR VERTICAL RIGHT WHITE CORNER BRACKET
    [0xFE47, 0xFFFD], // PRESENTATION FORM FOR VERTICAL LEFT SQUARE BRACKET - REPLACEMENT CHARACTER
    [0x10000, 0x1FFFD], // LINEAR B SYLLABLE B008 A - CHEESE WEDGE (U+1F9C0)
    [0x20000, 0x2FFFD], //
    [0x30000, 0x3FFFD], //
    [0x40000, 0x4FFFD], //
    [0x50000, 0x5FFFD], //
    [0x60000, 0x6FFFD], //
    [0x70000, 0x7FFFD], //
    [0x80000, 0x8FFFD], //
    [0x90000, 0x9FFFD], //
    [0xA0000, 0xAFFFD], //
    [0xB0000, 0xBFFFD], //
    [0xC0000, 0xCFFFD], //
    [0xD0000, 0xDFFFD], //
    [0xE0000, 0xEFFFD]  // LANGUAGE TAG (U+E0001) - VARIATION SELECTOR-256 (U+E01EF)
];

const disallowedFirstCharacterIdentifierUnicodeRanges: number[][] = [
    [0x0030, 0x0039], // digits
    [0x0300, 0x036F], // COMBINING GRAVE ACCENT - COMBINING LATIN SMALL LETTER X
    [0x1DC0, 0x1DFF], // COMBINING DOTTED GRAVE ACCENT - COMBINING RIGHT ARROWHEAD AND DOWN ARROWHEAD BELOW
    [0x20D0, 0x20FF], // COMBINING LEFT HARPOON ABOVE - COMBINING ASTERISK ABOVE
    [0xFE20, 0xFE2F]  // COMBINING LIGATURE LEFT HALF - COMBINING CYRILLIC TITLO RIGHT HALF
];

export function isValidIdentifier(candidate: string): boolean {
    if (!candidate) {
        return false;
    }
    const decoded: number[] = decodeUCS16(candidate);
    if (!decoded || !decoded.length) {
        return false;
    }

    // Reject if first character is disallowed
    for (let i: number = 0; i < disallowedFirstCharacterIdentifierUnicodeRanges.length; i++) {
        const disallowedCharacters: number[] = disallowedFirstCharacterIdentifierUnicodeRanges[i];
        if (decoded[0] >= disallowedCharacters[0] && decoded[0] <= disallowedCharacters[1]) {
            return false;
        }
    }

    for (let position: number = 0; position < decoded.length; position++) {
        let found: boolean = false;
        for (let i: number = 0; i < allowedIdentifierUnicodeRanges.length; i++) {
            const allowedCharacters: number[] = allowedIdentifierUnicodeRanges[i];
            if (decoded[position] >= allowedCharacters[0] && decoded[position] <= allowedCharacters[1]) {
                found = true;
                break;
            }
        }
        if (!found) {
            return false;
        }
    }
    return true;
}

function getUniqueWorkspaceNameHelper(workspaceFolder: vscode.WorkspaceFolder, addSubfolder: boolean): string {
    const workspaceFolderName: string = workspaceFolder ? workspaceFolder.name : "untitled";
    if (!workspaceFolder || workspaceFolder.index < 1) {
        return workspaceFolderName; // No duplicate names to search for.
    }
    for (let i: number = 0; i < workspaceFolder.index; ++i) {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 && vscode.workspace.workspaceFolders[i].name === workspaceFolderName) {
            return addSubfolder ? path.join(workspaceFolderName, String(workspaceFolder.index)) : // Use the index as a subfolder.
                workspaceFolderName + String(workspaceFolder.index);
        }
    }
    return workspaceFolderName; // No duplicate names found.
}

export function getUniqueWorkspaceName(workspaceFolder: vscode.WorkspaceFolder): string {
    return getUniqueWorkspaceNameHelper(workspaceFolder, false);
}

export function getUniqueWorkspaceStorageName(workspaceFolder: vscode.WorkspaceFolder): string {
    return getUniqueWorkspaceNameHelper(workspaceFolder, true);
}

export function isCodespaces(): boolean {
    return !!process.env["CODESPACES"];
}

// Sequentially Resolve Promises.
export function sequentialResolve<T>(items: T[], promiseBuilder: (item: T) => Promise<void>): Promise<void> {
    return items.reduce(async (previousPromise, nextItem) => {
        await previousPromise;
        return promiseBuilder(nextItem);
    }, Promise.resolve());
}

export function normalizeArg(arg: string): string {
    arg = arg.trimLeft().trimRight();
    // Check if the arg is enclosed in backtick,
    // or includes unescaped double-quotes (or single-quotes on windows),
    // or includes unescaped single-quotes on mac and linux.
    if (/^`.*`$/g.test(arg) || /.*[^\\]".*/g.test(arg) ||
        (process.platform.includes("win") && /.*[^\\]'.*/g.test(arg)) ||
        (!process.platform.includes("win") && /.*[^\\]'.*/g.test(arg))) {
        return arg;
    }
    // The special character double-quote is already escaped in the arg.
    const unescapedSpaces: string | undefined = arg.split('').find((char, index) => index > 0 && char === " " && arg[index - 1] !== "\\");
    if (!unescapedSpaces && !process.platform.includes("win")) {
        return arg;
    } else if (arg.includes(" ")) {
        arg = arg.replace(/\\\s/g, " ");
        return "\"" + arg + "\"";
    } else {
        return arg;
    }
}

/**
 * Find PowerShell executable from PATH (for Windows only).
 */
export function findPowerShell(): string | undefined {
    const dirs: string[] = (process.env.PATH || '').replace(/"+/g, '').split(';').filter(x => x);
    const exts: string[] = (process.env.PATHEXT || '').split(';');
    const names: string[] = ['pwsh', 'powershell'];
    for (const name of names) {
        const candidates: string[] = dirs.reduce<string[]>((paths, dir) => [
            ...paths, ...exts.map(ext => path.join(dir, name + ext))
        ], []);
        for (const candidate of candidates) {
            try {
                if (fs.statSync(candidate).isFile()) {
                    return name;
                }
            } catch (e) {
            }
        }
    }
}

export function getCppToolsTargetPopulation(): TargetPopulation {
    // If insiders.flag is present, consider this an insiders build.
    // If release.flag is present, consider this a release build.
    // Otherwise, consider this an internal build.
    if (checkFileExistsSync(getExtensionFilePath("insiders.flag"))) {
        return TargetPopulation.Insiders;
    } else if (checkFileExistsSync(getExtensionFilePath("release.flag"))) {
        return TargetPopulation.Public;
    }
    return TargetPopulation.Internal;
}

export function isVsCodeInsiders(): boolean {
    return extensionPath.includes(".vscode-insiders") ||
        extensionPath.includes(".vscode-server-insiders") ||
        extensionPath.includes(".vscode-exploration") ||
        extensionPath.includes(".vscode-server-exploration");
}
