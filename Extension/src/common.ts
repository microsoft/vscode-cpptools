/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import * as child_process from 'child_process';
import * as jsonc from 'comment-json';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tmp from 'tmp';
import * as vscode from 'vscode';
import { DocumentFilter, Range } from 'vscode-languageclient';
import * as nls from 'vscode-nls';
import { TargetPopulation } from 'vscode-tas-client';
import * as which from "which";
import { ManualPromise } from './Utility/Async/manualPromise';
import { isWindows } from './constants';
import { getOutputChannelLogger, showOutputChannel } from './logger';
import { PlatformInformation } from './platform';
import * as Telemetry from './telemetry';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
export const failedToParseJson: string = localize("failed.to.parse.json", "Failed to parse json file, possibly due to comments or trailing commas.");

export type Mutable<T> = {
    // eslint-disable-next-line @typescript-eslint/array-type
    -readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U> ? Mutable<U>[] : Mutable<T[P]>
};

export let extensionPath: string;
export let extensionContext: vscode.ExtensionContext | undefined;
export function setExtensionContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
    extensionPath = extensionContext.extensionPath;
}

export function setExtensionPath(path: string): void {
    extensionPath = path;
}

let cachedClangFormatPath: string | undefined;
export function getCachedClangFormatPath(): string | undefined {
    return cachedClangFormatPath;
}

export function setCachedClangFormatPath(path: string): void {
    cachedClangFormatPath = path;
}

let cachedClangTidyPath: string | undefined;
export function getCachedClangTidyPath(): string | undefined {
    return cachedClangTidyPath;
}

export function setCachedClangTidyPath(path: string): void {
    cachedClangTidyPath = path;
}

// Use this package.json to read values
export const packageJson: any = vscode.extensions.getExtension("ms-vscode.cpptools")?.packageJSON;

// Use getRawSetting to get subcategorized settings from package.json.
// This prevents having to iterate every time we search.
let flattenedPackageJson: Map<string, any>;
export function getRawSetting(key: string): any {
    if (flattenedPackageJson === undefined) {
        flattenedPackageJson = new Map();
        for (const subheading of packageJson.contributes.configuration) {
            for (const setting in subheading.properties) {
                flattenedPackageJson.set(setting, subheading.properties[setting]);
            }
        }
    }
    return flattenedPackageJson.get(key);
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
        rawElement = jsonc.parse(fileContents, undefined, true);
    } catch (error) {
        throw new Error(failedToParseJson);
    }
    return rawElement;
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

export function getJsonPath(jsonFilaName: string, workspaceFolder?: vscode.WorkspaceFolder): string | undefined {
    const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!editor) {
        return undefined;
    }
    const folder: vscode.WorkspaceFolder | undefined = workspaceFolder ? workspaceFolder : vscode.workspace.getWorkspaceFolder(editor.document.uri);
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
export function isHeaderFile(uri: vscode.Uri): boolean {
    const fileExt: string = path.extname(uri.fsPath);
    const fileExtLower: string = fileExt.toLowerCase();
    return !fileExt || [".cuh", ".hpp", ".hh", ".hxx", ".h++", ".hp", ".h", ".ii", ".inl", ".idl", ""].some(ext => fileExtLower === ext);
}

export function isCppFile(uri: vscode.Uri): boolean {
    const fileExt: string = path.extname(uri.fsPath);
    const fileExtLower: string = fileExt.toLowerCase();
    return (fileExt === ".C") || [".cu", ".cpp", ".cc", ".cxx", ".c++", ".cp", ".ino", ".ipp", ".tcc"].some(ext => fileExtLower === ext);
}

export function isCFile(uri: vscode.Uri): boolean {
    const fileExt: string = path.extname(uri.fsPath);
    const fileExtLower: string = fileExt.toLowerCase();
    return (fileExt === ".C") || fileExtLower === ".c";
}

export function isCppOrCFile(uri: vscode.Uri | undefined): boolean {
    if (!uri) {
        return false;
    }
    return isCppFile(uri) || isCFile(uri);
}

export function isFolderOpen(uri: vscode.Uri): boolean {
    const folder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? true : false;
}

export function isEditorFileCpp(file: string): boolean {
    const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === file);
    if (!editor) {
        return false;
    }
    return editor.document.languageId === "cpp";
}

// If it's C, C++, or Cuda.
export function isCpp(document: vscode.TextDocument): boolean {
    return document.uri.scheme === "file" &&
        (document.languageId === "c" || document.languageId === "cpp" || document.languageId === "cuda-cpp");
}

export function isCppPropertiesJson(document: vscode.TextDocument): boolean {
    return document.uri.scheme === "file" && (document.languageId === "json" || document.languageId === "jsonc") &&
        document.fileName.endsWith("c_cpp_properties.json");
}
let isWorkspaceCpp: boolean = false;
export function setWorkspaceIsCpp(): void {
    if (!isWorkspaceCpp) {
        isWorkspaceCpp = true;
    }
}

export function getWorkspaceIsCpp(): boolean {
    return isWorkspaceCpp;
}

export function isCppOrRelated(document: vscode.TextDocument): boolean {
    return isCpp(document) || isCppPropertiesJson(document) || (document.uri.scheme === "output" && document.uri.fsPath.startsWith("extension-output-ms-vscode.cpptools")) ||
        (isWorkspaceCpp && (document.languageId === "json" || document.languageId === "jsonc") &&
            ((document.fileName.endsWith("settings.json") && (document.uri.scheme === "file" || document.uri.scheme === "vscode-userdata")) ||
                (document.uri.scheme === "file" && document.fileName.endsWith(".code-workspace"))));
}

let isExtensionNotReadyPromptDisplayed: boolean = false;
export const extensionNotReadyString: string = localize("extension.not.ready", 'The C/C++ extension is still installing. See the output window for more information.');

export function displayExtensionNotReadyPrompt(): void {
    if (!isExtensionNotReadyPromptDisplayed) {
        isExtensionNotReadyPromptDisplayed = true;
        showOutputChannel();

        void getOutputChannelLogger().showInformationMessage(extensionNotReadyString).then(
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
        void extensionContext.globalState.update(installProgressStr, progress);
        const telemetryProperties: Record<string, string> = {};
        let progressName: string | undefined;
        switch (progress) {
            case 0: progressName = "install started"; break;
            case progressInstallSuccess: progressName = "install succeeded"; break;
            case progressExecutableStarted: progressName = "executable started"; break;
            case progressExecutableSuccess: progressName = "executable succeeded"; break;
            case progressParseRootSuccess: progressName = "parse root succeeded"; break;
        }
        if (progressName) {
            telemetryProperties.progress = progressName;
        }
        Telemetry.logDebuggerEvent("progress", telemetryProperties);
    }
}

export function setIntelliSenseProgress(progress: number): void {
    if (extensionContext && getIntelliSenseProgress() < progress) {
        void extensionContext.globalState.update(intelliSenseProgressStr, progress);
        const telemetryProperties: Record<string, string> = {};
        let progressName: string | undefined;
        switch (progress) {
            case progressIntelliSenseNoSquiggles: progressName = "IntelliSense no squiggles"; break;
        }
        if (progressName) {
            telemetryProperties.progress = progressName;
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
    return typeof input === "string";
}

export function isNumber(input: any): input is number {
    return typeof input === "number";
}

export function isBoolean(input: any): input is boolean {
    return typeof input === "boolean";
}

export function isObject(input: any): input is object {
    return typeof input === "object";
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

export function resolveCachePath(input: string | undefined, additionalEnvironment: Record<string, string | string[]>): string {
    let resolvedPath: string = "";
    if (!input || input.trim() === "") {
        // If no path is set, return empty string to language service process, where it will set the default path as
        // Windows: %LocalAppData%/Microsoft/vscode-cpptools/
        // Linux and Mac: ~/.vscode-cpptools/
        return resolvedPath;
    }

    resolvedPath = resolveVariables(input, additionalEnvironment);
    return resolvedPath;
}

export function defaultExePath(): string {
    const exePath: string = path.join('${fileDirname}', '${fileBasenameNoExtension}');
    return isWindows ? exePath + '.exe' : exePath;
}

export function findExePathInArgs(args: string[]): string | undefined {
    const exePath: string | undefined = args.find((arg: string, index: number) => arg.includes(".exe") || (index > 0 && args[index - 1] === "-o"));
    if (exePath?.startsWith("/Fe")) {
        return exePath.substring(3);
    }
    if (exePath?.toLowerCase().startsWith("/out:")) {
        return exePath.substring(5);
    }
    return exePath;
}

// Pass in 'arrayResults' if a string[] result is possible and a delimited string result is undesirable.
// The string[] result will be copied into 'arrayResults'.
export function resolveVariables(input: string | undefined, additionalEnvironment?: Record<string, string | string[]>, arrayResults?: string[]): string {
    if (!input) {
        return "";
    }

    // jsonc parser may assign a non-string object to a string.
    // TODO: https://github.com/microsoft/vscode-cpptools/issues/9414
    if (!isString(input)) {
        const inputAny: any = input;
        input = inputAny.toString();
        return input ?? "";
    }

    // Replace environment and configuration variables.
    const regexp: () => RegExp = () => /\$\{((env|config|workspaceFolder|file|fileDirname|fileBasenameNoExtension|execPath|pathSeparator)(\.|:))?(.*?)\}/g;
    let ret: string = input;
    const cycleCache = new Set<string>();
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
                                newValue = v.join(path.delimiter);
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

    return resolveHome(ret);
}

export function resolveVariablesArray(variables: string[] | undefined, additionalEnvironment?: Record<string, string | string[]>): string[] {
    let result: string[] = [];
    if (variables) {
        variables.forEach(variable => {
            const variablesResolved: string[] = [];
            const variableResolved: string = resolveVariables(variable, additionalEnvironment, variablesResolved);
            result = result.concat(variablesResolved.length === 0 ? variableResolved : variablesResolved);
        });
    }
    return result;
}

// Resolve '~' at the start of the path.
export function resolveHome(filePath: string): string {
    return filePath.replace(/^\~/g, os.homedir());
}

export function asFolder(uri: vscode.Uri): string {
    let result: string = uri.toString();
    if (!result.endsWith('/')) {
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

export async function fsStat(filePath: fs.PathLike): Promise<fs.Stats | undefined> {
    let stats: fs.Stats | undefined;
    try {
        stats = await fs.promises.stat(filePath);
    } catch (e) {
        // File doesn't exist
        return undefined;
    }
    return stats;
}

export async function checkPathExists(filePath: string): Promise<boolean> {
    return !!await fsStat(filePath);
}

/** Test whether a file exists */
export async function checkFileExists(filePath: string): Promise<boolean> {
    const stats: fs.Stats | undefined = await fsStat(filePath);
    return !!stats && stats.isFile();
}

/** Test whether a file exists */
export async function checkExecutableWithoutExtensionExists(filePath: string): Promise<boolean> {
    if (await checkFileExists(filePath)) {
        return true;
    }
    if (os.platform() === 'win32') {
        if (filePath.length > 4) {
            const possibleExtension: string = filePath.substring(filePath.length - 4).toLowerCase();
            if (possibleExtension === ".exe" || possibleExtension === ".cmd" || possibleExtension === ".bat") {
                return false;
            }
        }
        if (await checkFileExists(filePath + ".exe")) {
            return true;
        }
        if (await checkFileExists(filePath + ".cmd")) {
            return true;
        }
        if (await checkFileExists(filePath + ".bat")) {
            return true;
        }
    }
    return false;
}

/** Test whether a directory exists */
export async function checkDirectoryExists(dirPath: string): Promise<boolean> {
    const stats: fs.Stats | undefined = await fsStat(dirPath);
    return !!stats && stats.isDirectory();
}

export function createDirIfNotExistsSync(filePath: string | undefined): void {
    if (!filePath) {
        return;
    }
    const dirPath: string = path.dirname(filePath);
    if (!checkDirectoryExistsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

export function checkFileExistsSync(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch (e) {
        return false;
    }
}

export function checkExecutableWithoutExtensionExistsSync(filePath: string): boolean {
    if (checkFileExistsSync(filePath)) {
        return true;
    }
    if (os.platform() === 'win32') {
        if (filePath.length > 4) {
            const possibleExtension: string = filePath.substring(filePath.length - 4).toLowerCase();
            if (possibleExtension === ".exe" || possibleExtension === ".cmd" || possibleExtension === ".bat") {
                return false;
            }
        }
        if (checkFileExistsSync(filePath + ".exe")) {
            return true;
        }
        if (checkFileExistsSync(filePath + ".cmd")) {
            return true;
        }
        if (checkFileExistsSync(filePath + ".bat")) {
            return true;
        }
    }
    return false;
}

/** Test whether a directory exists */
export function checkDirectoryExistsSync(dirPath: string): boolean {
    try {
        return fs.statSync(dirPath).isDirectory();
    } catch (e) {
        return false;
    }
}

/** Test whether a relative path exists */
export function checkPathExistsSync(path: string, relativePath: string, _isWindows: boolean, isCompilerPath: boolean): { pathExists: boolean; path: string } {
    let pathExists: boolean = true;
    const existsWithExeAdded: (path: string) => boolean = (path: string) => isCompilerPath && _isWindows && fs.existsSync(path + ".exe");
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
export function readFileText(filePath: string, encoding: BufferEncoding = "utf8"): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        fs.readFile(filePath, { encoding }, (err: any, data: any) => {
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

export function deleteDirectory(directoryPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (fs.existsSync(directoryPath)) {
            fs.rmdir(directoryPath, (err) => {
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

export interface ProcessReturnType {
    succeeded: boolean;
    exitCode?: number | NodeJS.Signals;
    output: string;
}

export async function spawnChildProcess(program: string, args: string[] = [], continueOn?: string, skipLogging?: boolean, cancellationToken?: vscode.CancellationToken): Promise<ProcessReturnType> {
    // Do not use CppSettings to avoid circular require()
    if (skipLogging === undefined || !skipLogging) {
        const settings: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", null);
        const loggingLevel: string | undefined = settings.get<string>("loggingLevel");
        if (loggingLevel === "Information" || loggingLevel === "Debug") {
            getOutputChannelLogger().appendLine(`$ ${program} ${args.join(' ')}`);
        }
    }
    const programOutput: ProcessOutput = await spawnChildProcessImpl(program, args, continueOn, skipLogging, cancellationToken);
    const exitCode: number | NodeJS.Signals | undefined = programOutput.exitCode;
    if (programOutput.exitCode) {
        return { succeeded: false, exitCode, output: programOutput.stderr || programOutput.stdout || localize('process.exited', 'Process exited with code {0}', exitCode) };
    } else {
        let stdout: string;
        if (programOutput.stdout.length) {
            // Type system doesn't work very well here, so we need call toString
            stdout = programOutput.stdout;
        } else {
            stdout = localize('process.succeeded', 'Process executed successfully.');
        }
        return { succeeded: true, exitCode, output: stdout };
    }
}

interface ProcessOutput {
    exitCode?: number | NodeJS.Signals;
    stdout: string;
    stderr: string;
}

async function spawnChildProcessImpl(program: string, args: string[], continueOn?: string, skipLogging?: boolean, cancellationToken?: vscode.CancellationToken): Promise<ProcessOutput> {
    const result = new ManualPromise<ProcessOutput>();

    // Do not use CppSettings to avoid circular require()
    const settings: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", null);
    const loggingLevel: string | undefined = (skipLogging === undefined || !skipLogging) ? settings.get<string>("loggingLevel") : "None";

    let proc: child_process.ChildProcess;
    if (await isExecutable(program)) {
        proc = child_process.spawn(`.${isWindows ? '\\' : '/'}${path.basename(program)}`, args, { shell: true, cwd: path.dirname(program) });
    } else {
        proc = child_process.spawn(program, args, { shell: true });
    }

    const cancellationTokenListener: vscode.Disposable | undefined = cancellationToken?.onCancellationRequested(() => {
        getOutputChannelLogger().appendLine(localize('killing.process', 'Killing process {0}', program));
        proc.kill();
    });

    const clean = () => {
        proc.removeAllListeners();
        if (cancellationTokenListener) {
            cancellationTokenListener.dispose();
        }
    };

    let stdout: string = '';
    let stderr: string = '';
    if (proc.stdout) {
        proc.stdout.on('data', data => {
            const str: string = data.toString();
            if (loggingLevel !== "None") {
                getOutputChannelLogger().append(str);
            }
            stdout += str;
            if (continueOn) {
                const continueOnReg: string = escapeStringForRegex(continueOn);
                if (stdout.search(continueOnReg)) {
                    result.resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                }
            }
        });
    }
    if (proc.stderr) {
        proc.stderr.on('data', data => stderr += data.toString());
    }
    proc.on('close', (code, signal) => {
        clean();
        result.resolve({ exitCode: code || signal || undefined, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    proc.on('error', error => {
        clean();
        result.reject(error);
    });
    return result;
}

/**
 * @param permission fs file access constants: https://nodejs.org/api/fs.html#file-access-constants
 */
export function pathAccessible(filePath: string, permission: number = fs.constants.F_OK): Promise<boolean> {
    if (!filePath) { return Promise.resolve(false); }
    return new Promise(resolve => fs.access(filePath, permission, err => resolve(!err)));
}

export function isExecutable(file: string): Promise<boolean> {
    return pathAccessible(file, fs.constants.X_OK);
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
        if (!word.includes(".") && !word.includes("/") && !word.includes("\\") && !word.includes(":")) {
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

export async function promptForReloadWindowDueToSettingsChange(): Promise<void> {
    await promptReloadWindow(localize("reload.workspace.for.changes", "Reload the workspace for the settings change to take effect."));
}

export async function promptReloadWindow(message: string): Promise<void> {
    const reload: string = localize("reload.string", "Reload");
    const value: string | undefined = await vscode.window.showInformationMessage(message, reload);
    if (value === reload) {
        return vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}

export function createTempFileWithPostfix(postfix: string): Promise<tmp.FileResult> {
    return new Promise<tmp.FileResult>((resolve, reject) => {
        tmp.file({ postfix: postfix }, (err, path, fd, cleanupCallback) => {
            if (err) {
                return reject(err);
            }
            return resolve({ name: path, fd: fd, removeCallback: cleanupCallback } as tmp.FileResult);
        });
    });
}

function resolveWindowsEnvironmentVariables(str: string): string {
    return str.replace(/%([^%]+)%/g, (withPercents, withoutPercents) => {
        const found: string | undefined = process.env[withoutPercents];
        return found || withPercents;
    });
}

function legacyExtractArgs(argsString: string): string[] {
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

function extractArgs(argsString: string): string[] {
    argsString = argsString.trim();
    if (os.platform() === 'win32') {
        argsString = resolveWindowsEnvironmentVariables(argsString);
        const result: string[] = [];
        let currentArg: string = "";
        let isInQuote: boolean = false;
        let wasInQuote: boolean = false;
        let i: number = 0;
        while (i < argsString.length) {
            let c: string = argsString[i];
            if (c === '\"') {
                if (!isInQuote) {
                    isInQuote = true;
                    wasInQuote = true;
                    ++i;
                    continue;
                }
                // Need to peek at next character.
                if (++i === argsString.length) {
                    break;
                }
                c = argsString[i];
                if (c !== '\"') {
                    isInQuote = false;
                }
                // Fall through. If c was a quote character, it will be added as a literal.
            }
            if (c === '\\') {
                let backslashCount: number = 1;
                let reachedEnd: boolean = true;
                while (++i !== argsString.length) {
                    c = argsString[i];
                    if (c !== '\\') {
                        reachedEnd = false;
                        break;
                    }
                    ++backslashCount;
                }
                const still_escaping: boolean = (backslashCount % 2) !== 0;
                if (!reachedEnd && c === '\"') {
                    backslashCount = Math.floor(backslashCount / 2);
                }
                while (backslashCount--) {
                    currentArg += '\\';
                }
                if (reachedEnd) {
                    break;
                }
                // If not still escaping and a quote was found, it needs to be handled above.
                if (!still_escaping && c === '\"') {
                    continue;
                }
                // Otherwise, fall through to handle c as a literal.
            }
            if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
                if (!isInQuote) {
                    if (currentArg !== "" || wasInQuote) {
                        wasInQuote = false;
                        result.push(currentArg);
                        currentArg = "";
                    }
                    i++;
                    continue;
                }
            }
            currentArg += c;
            i++;
        }
        if (currentArg !== "" || wasInQuote) {
            result.push(currentArg);
        }
        return result;
    } else {
        try {
            const wordexpResult: any = child_process.execFileSync(getExtensionFilePath("bin/cpptools-wordexp"), [argsString], { shell: false });
            if (wordexpResult === undefined) {
                return [];
            }
            const jsonText: string = wordexpResult.toString();
            return jsonc.parse(jsonText, undefined, true) as any;
        } catch {
            return [];
        }
    }
}

export function isCl(compilerPath: string): boolean {
    const compilerPathLowercase: string = compilerPath.toLowerCase();
    return compilerPathLowercase === "cl" || compilerPathLowercase === "cl.exe"
        || compilerPathLowercase.endsWith("\\cl.exe") || compilerPathLowercase.endsWith("/cl.exe")
        || compilerPathLowercase.endsWith("\\cl") || compilerPathLowercase.endsWith("/cl");
}

/** CompilerPathAndArgs retains original casing of text input for compiler path and args */
export interface CompilerPathAndArgs {
    compilerPath?: string;
    compilerName: string;
    compilerArgs?: string[];
    compilerArgsFromCommandLineInPath: string[];
    allCompilerArgs: string[];
}

export function extractCompilerPathAndArgs(useLegacyBehavior: boolean, inputCompilerPath?: string, compilerArgs?: string[]): CompilerPathAndArgs {
    let compilerPath: string | undefined = inputCompilerPath;
    let compilerName: string = "";
    let compilerArgsFromCommandLineInPath: string[] = [];
    if (compilerPath) {
        compilerPath = compilerPath.trim();
        if (isCl(compilerPath) || checkExecutableWithoutExtensionExistsSync(compilerPath)) {
            // If the path ends with cl, or if a file is found at that path, accept it without further validation.
            compilerName = path.basename(compilerPath);
        } else if (compilerPath.startsWith("\"") || (os.platform() !== 'win32' && compilerPath.startsWith("'"))) {
            // If the string starts with a quote, treat it as a command line.
            // Otherwise, a path with a leading quote would not be valid.
            if (useLegacyBehavior) {
                compilerArgsFromCommandLineInPath = legacyExtractArgs(compilerPath);
                if (compilerArgsFromCommandLineInPath.length > 0) {
                    compilerPath = compilerArgsFromCommandLineInPath.shift();
                    if (compilerPath) {
                        // Try to trim quotes from compiler path.
                        const tempCompilerPath: string[] | undefined = extractArgs(compilerPath);
                        if (tempCompilerPath && compilerPath.length > 0) {
                            compilerPath = tempCompilerPath[0];
                        }
                        compilerName = path.basename(compilerPath);
                    }
                }
            } else {
                compilerArgsFromCommandLineInPath = extractArgs(compilerPath);
                if (compilerArgsFromCommandLineInPath.length > 0) {
                    compilerPath = compilerArgsFromCommandLineInPath.shift();
                    if (compilerPath) {
                        compilerName = path.basename(compilerPath);
                    }
                }
            }
        } else {
            const spaceStart: number = compilerPath.lastIndexOf(" ");
            if (spaceStart !== -1) {
                // There is no leading quote, but a space suggests it might be a command line.
                // Try processing it as a command line, and validate that by checking for the executable.
                const potentialArgs: string[] = useLegacyBehavior ? legacyExtractArgs(compilerPath) : extractArgs(compilerPath);
                let potentialCompilerPath: string | undefined = potentialArgs.shift();
                if (useLegacyBehavior) {
                    if (potentialCompilerPath) {
                        const tempCompilerPath: string[] | undefined = extractArgs(potentialCompilerPath);
                        if (tempCompilerPath && compilerPath.length > 0) {
                            potentialCompilerPath = tempCompilerPath[0];
                        }
                    }
                }
                if (potentialCompilerPath) {
                    if (isCl(potentialCompilerPath) || checkExecutableWithoutExtensionExistsSync(potentialCompilerPath)) {
                        compilerArgsFromCommandLineInPath = potentialArgs;
                        compilerPath = potentialCompilerPath;
                        compilerName = path.basename(compilerPath);
                    }
                }
            }
        }
    }
    let allCompilerArgs: string[] = !compilerArgs ? [] : compilerArgs;
    allCompilerArgs = allCompilerArgs.concat(compilerArgsFromCommandLineInPath);
    return { compilerPath, compilerName, compilerArgs, compilerArgsFromCommandLineInPath, allCompilerArgs };
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

export function getSenderType(sender?: any): string {
    if (isString(sender)) {
        return sender;
    } else if (isUri(sender)) {
        return 'contextMenu';
    }
    return 'commandPalette';
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
    [0xE0000, 0xEFFFD] // LANGUAGE TAG (U+E0001) - VARIATION SELECTOR-256 (U+E01EF)
];

const disallowedFirstCharacterIdentifierUnicodeRanges: number[][] = [
    [0x0030, 0x0039], // digits
    [0x0300, 0x036F], // COMBINING GRAVE ACCENT - COMBINING LATIN SMALL LETTER X
    [0x1DC0, 0x1DFF], // COMBINING DOTTED GRAVE ACCENT - COMBINING RIGHT ARROWHEAD AND DOWN ARROWHEAD BELOW
    [0x20D0, 0x20FF], // COMBINING LEFT HARPOON ABOVE - COMBINING ASTERISK ABOVE
    [0xFE20, 0xFE2F] // COMBINING LIGATURE LEFT HALF - COMBINING CYRILLIC TITLO RIGHT HALF
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

export function getCacheStoragePath(): string {
    let defaultCachePath: string = "";
    let pathEnvironmentVariable: string | undefined;
    switch (os.platform()) {
        case 'win32':
            defaultCachePath = "Microsoft\\vscode-cpptools\\";
            pathEnvironmentVariable = process.env.LOCALAPPDATA;
            break;
        case 'darwin':
            defaultCachePath = "Library/Caches/vscode-cpptools/";
            pathEnvironmentVariable = os.homedir();
            break;
        default: // Linux
            defaultCachePath = "vscode-cpptools/";
            pathEnvironmentVariable = process.env.XDG_CACHE_HOME;
            if (!pathEnvironmentVariable) {
                pathEnvironmentVariable = path.join(os.homedir(), ".cache");
            }
            break;
    }

    return pathEnvironmentVariable ? path.join(pathEnvironmentVariable, defaultCachePath) : "";
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
    return !!process.env.CODESPACES;
}

// Sequentially Resolve Promises.
export function sequentialResolve<T>(items: T[], promiseBuilder: (item: T) => Promise<void>): Promise<void> {
    return items.reduce(async (previousPromise, nextItem) => {
        await previousPromise;
        return promiseBuilder(nextItem);
    }, Promise.resolve());
}

export function quoteArgument(argument: string): string {
    // Return the argument as is if it's empty
    if (!argument) {
        return argument;
    }

    if (os.platform() === "win32") {
        // Windows-style quoting logic
        if (!/[\s\t\n\v\"\\&%^]/.test(argument)) {
            return argument;
        }

        let quotedArgument = '"';
        let backslashCount = 0;

        for (const char of argument) {
            if (char === '\\') {
                backslashCount++;
            } else {
                if (char === '"') {
                    quotedArgument += '\\'.repeat(backslashCount * 2 + 1);
                } else {
                    quotedArgument += '\\'.repeat(backslashCount);
                }
                quotedArgument += char;
                backslashCount = 0;
            }
        }

        quotedArgument += '\\'.repeat(backslashCount * 2);
        quotedArgument += '"';
        return quotedArgument;
    } else {
        // Unix-style quoting logic
        if (!/[\s\t\n\v\"'\\$`|;&(){}<>*?!\[\]~^#%]/.test(argument)) {
            return argument;
        }

        let quotedArgument = "'";
        for (const c of argument) {
            if (c === "'") {
                quotedArgument += "'\\''";
            } else {
                quotedArgument += c;
            }
        }

        quotedArgument += "'";
        return quotedArgument;
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
                return undefined;
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

export function stripEscapeSequences(str: string): string {
    return str
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[\??[0-9]{0,3}(;[0-9]{1,3})?[a-zA-Z]/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(/\u0008/g, '')
        .replace(/\r/g, '');
}

export function splitLines(data: string): string[] {
    return data.split(/\r?\n/g);
}

export function escapeStringForRegex(str: string): string {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
}

export function replaceAll(str: string, searchValue: string, replaceValue: string): string {
    const pattern: string = escapeStringForRegex(searchValue);
    const re: RegExp = new RegExp(pattern, 'g');
    return str.replace(re, replaceValue);
}

export interface ISshHostInfo {
    hostName: string;
    user?: string;
    port?: number | string;
}

export interface ISshConfigHostInfo extends ISshHostInfo {
    file: string;
}

/** user@host */
export function getFullHostAddressNoPort(host: ISshHostInfo): string {
    return host.user ? `${host.user}@${host.hostName}` : `${host.hostName}`;
}

export function getFullHostAddress(host: ISshHostInfo): string {
    const fullHostName: string = getFullHostAddressNoPort(host);
    return host.port ? `${fullHostName}:${host.port}` : fullHostName;
}

export interface ISshLocalForwardInfo {
    bindAddress?: string;
    port?: number | string;
    host?: string;
    hostPort?: number | string;
    localSocket?: string;
    remoteSocket?: string;
}

export function whichAsync(name: string): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
        which(name, (err, resolved) => {
            if (err) {
                resolve(undefined);
            } else {
                resolve(resolved);
            }
        });
    });
}

export const documentSelector: DocumentFilter[] = [
    { scheme: 'file', language: 'c' },
    { scheme: 'file', language: 'cpp' },
    { scheme: 'file', language: 'cuda-cpp' }
];

export function hasMsvcEnvironment(): boolean {
    const msvcEnvVars: string[] = [
        'DevEnvDir',
        'Framework40Version',
        'FrameworkDir',
        'FrameworkVersion',
        'INCLUDE',
        'LIB',
        'LIBPATH',
        'NETFXSDKDir',
        'UCRTVersion',
        'UniversalCRTSdkDir',
        'VCIDEInstallDir',
        'VCINSTALLDIR',
        'VCToolsRedistDir',
        'VisualStudioVersion',
        'VSINSTALLDIR',
        'WindowsLibPath',
        'WindowsSdkBinPath',
        'WindowsSdkDir',
        'WindowsSDKLibVersion',
        'WindowsSDKVersion'
    ];
    return msvcEnvVars.every((envVarName) => process.env[envVarName] !== undefined && process.env[envVarName] !== '');
}

function isIntegral(str: string): boolean {
    const regex = /^-?\d+$/;
    return regex.test(str);
}

export function getNumericLoggingLevel(loggingLevel: string | undefined): number {
    if (!loggingLevel) {
        return 1;
    }
    if (isIntegral(loggingLevel)) {
        return parseInt(loggingLevel, 10);
    }
    const lowerCaseLoggingLevel: string = loggingLevel.toLowerCase();
    switch (lowerCaseLoggingLevel) {
        case "error":
            return 1;
        case "warning":
            return 3;
        case "information":
            return 5;
        case "debug":
            return 6;
        default:
            return 0;
    }
}

export function mergeOverlappingRanges(ranges: Range[]): Range[] {
    // Fix any reversed ranges. Not sure if this is needed, but ensures the input is sanitized.
    const mergedRanges: Range[] = ranges.map(range => {
        if (range.start.line > range.end.line || (range.start.line === range.end.line && range.start.character > range.end.character)) {
            return Range.create(range.end, range.start);
        }
        return range;
    });

    // Merge overlapping ranges.
    mergedRanges.sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character);
    let lastMergedIndex = 0; // Index to keep track of the last merged range
    for (let currentIndex = 0; currentIndex < ranges.length; currentIndex++) {
        const currentRange = ranges[currentIndex]; // No need for a shallow copy, since we're not modifying the ranges we haven't read yet.
        let nextIndex = currentIndex + 1;
        while (nextIndex < ranges.length) {
            const nextRange = ranges[nextIndex];
            // Check for non-overlapping ranges first
            if (nextRange.start.line > currentRange.end.line ||
                (nextRange.start.line === currentRange.end.line && nextRange.start.character > currentRange.end.character)) {
                break;
            }
            // Otherwise, merge the overlapping ranges
            currentRange.end = {
                line: Math.max(currentRange.end.line, nextRange.end.line),
                character: Math.max(currentRange.end.character, nextRange.end.character)
            };
            nextIndex++;
        }
        // Overwrite the array in-place
        mergedRanges[lastMergedIndex] = currentRange;
        lastMergedIndex++;
        currentIndex = nextIndex - 1; // Skip the merged ranges
    }
    mergedRanges.length = lastMergedIndex;
    return mergedRanges;
}
