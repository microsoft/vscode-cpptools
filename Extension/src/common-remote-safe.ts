/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/** @file The functions here are safe to call from a worker thread or the main thread. */

import { ChildProcess, spawn } from 'node:child_process';
import { access, constants, readdir, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, normalize, resolve } from 'node:path';
import { isMainThread } from 'node:worker_threads';

import { isWindows } from './constants';
import { ManualPromise } from './Utility/Async/manualPromise';
import { RemoteConnection } from './Utility/Remoting/snare';
import { is } from './Utility/System/guards';

/**
 * @file These are vscode-extension functions that have been wrapped
 * so that they can be safely called from the main thread or worker threads.
 *
 * If this is imported in a module running in a worker thread, the worker
 * thread must call `initialize(remote)` with a valid `RemoteConnection`
 * instance before using these functions, otherwise they will be a no-op.
*/

let remoteConnection: RemoteConnection | undefined;

// In the main thread, grab the logger and localize functions directly.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logFn = isMainThread ? require('./logger').log : () => { };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const noteFn = isMainThread ? require('./logger').note : () => { };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const localizeFn = isMainThread ? require('./localization').localize : (info: { key: string; comment: string[] } | string, message: string, ...args: (string | number | boolean | undefined | null)[]) => message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? 'undefined'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const getOutputChannelLoggerFn = isMainThread ? require('./logger').getOutputChannelLogger : () => undefined;

/**
 * Used when this is imported in a module running in a worker thread.
 *
 * This ensures that the remote connection is set up before any of the
 * functions are called. If this is not called, the functions will be no-ops.
 *
 * @param remote The remote connection instance to use.
 */
export function initialize(remote: RemoteConnection | undefined): void {
    if (!isMainThread) {
        remoteConnection = remote;
    }
}

/** Appends the message to the log file.
 *
 * @param message The message to log. If this is a Promise, it will be resolved and logged.
 */
export function log(message: string | Promise<string>) {
    if (is.promise(message)) {
        void message.then(log);
        return;
    }
    return isMainThread ? logFn(message) : remoteConnection?.notify('log', message);
}

/** Sets a transient message in the vscode status bar.
 *
 * The mesage will be displayed for a short time and then cleared.
 * @param message The message to display.
 */
export function note(message: string | Promise<string>) {
    if (is.promise(message)) {
        void message.then(note);
        return;
    }
    return isMainThread ? noteFn(message) : remoteConnection?.notify('note', message);
}

/** Localizes a message.
 *
 * This function is used to localize a message in the vscode extension.
 *
 * @param info The localization information.
 * @param message The message to localize.
 * @param args The arguments for the message.
 */
export const localize: AsyncLocalizeFunc = (infoOrKey, message, ...args) => {
    if (isMainThread) {
        if (typeof infoOrKey === 'string') {
            return localizeFn(infoOrKey, message, ...args);
        } else {
            return localizeFn(infoOrKey as LocalizeInfo, message, ...args);
        }
    }
    return remoteConnection?.request('localize', infoOrKey, message, ...args) ??
        message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? 'undefined'));
};

export function appendLineAtLevel(level: number, message: string | Promise<string>): void {
    if (is.promise(message)) {
        void message.then((msg) => appendLineAtLevel(level, msg));
        return;
    }
    if (isMainThread) {
        getOutputChannelLoggerFn()?.appendLineAtLevel(level, message);
    } else {
        remoteConnection?.notify('appendLineAtLevel', level, message);
    }
}

export function appendLine(message: string | Promise<string>): void {
    if (is.promise(message)) {
        void message.then(appendLine);
        return;
    }
    if (isMainThread) {
        getOutputChannelLoggerFn()?.appendLine(message);
    } else {
        remoteConnection?.notify('appendLine', message);
    }
}

/** When on Windows, ensures that the given executable name ends in an '.exe'.
 * @param executableName The name of the executable to check.
 * @returns The executable name with .exe appended if on Windows and the name does not already end in an '.exe'.
 */
export function executableName(executableName: string) {
    return isWindows && !/\.exe$/i.test(executableName) ? `${executableName}.exe` : executableName;
}
/**
 * Represents a type which can release resources, such
 * as event listening or a timer.
 *
 * (This is similar to the `Disposable` interface in VS Code.)
 */
export interface Disposable {
    /**
     * Dispose this object.
     */
    dispose(): any;
}

/**
 * Represents a typed event.
 *
 * A function that represents an event to which you subscribe by calling it with
 * a listener function as argument.
 *
 * (This is similar to the `Event` interface in VS Code.)
 *
 * @example
 * item.onDidChange(function(event) { console.log("Event happened: " + event); });
 *
 * @param listener The listener function will be called when the event happens.
 * @param thisArgs The `this`-argument which will be used when calling the event listener.
 * @param disposables An array to which a {@link Disposable} will be added.
 * @returns A disposable which unsubscribes the event listener.
 */
export type Event<T> = (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => Disposable;

/** The key for a localize call.
 * This interface provides structure for localization information.
 */
export interface LocalizeInfo {
    /** The localization key identifier. */
    key: string;
    /** Comments providing context for translators. */
    comment: string[];
}

/** The type for the localize function for string localization, but can work asynchronously (can be called via remoting). */
export type AsyncLocalizeFunc = (
    infoOrKey: LocalizeInfo | string,
    message: string,
    ...args: (string | number | boolean | undefined | null)[]
) => string | Promise<string>;

/**
 * A cancellation token is passed to an asynchronous or long running
 * operation to request cancellation, like cancelling a request
 * for completion items because the user continued to type.
 *
 * (This is similar to the `CancellationToken` interface in VS Code.)
 *
 * To get an instance of a `CancellationToken` use a
 * {@link CancellationTokenSource}.
 */
export interface CancellationToken {

    /**
     * Is `true` when the token has been cancelled, `false` otherwise.
     */
    isCancellationRequested: boolean;

    /**
     * An {@link Event} which fires upon cancellation.
     */
    onCancellationRequested: Event<any>;
}

/** Searches the PATH for a given executable program, using an optional predicate to control if the candidate is accepted.
 * @param filename The name of the executable to search for (string or a regular expression).
 * @param predicate A function that takes a binary file path and returns a boolean indicating whether to include it in the results.
 * @returns A promise that resolves to the full path of the executable if found, or undefined if not found.
 */
export async function findInPath(filename: string | RegExp, predicate?: (binary: string) => Promise<boolean>): Promise<string | undefined> {
    return searchFolders(process.env["PATH"]?.split(delimiter) || [], filename, predicate, 0);
}

/** Checks if a path is accessible with the specified permissions.
 *
 * @param filePath The path to check for accessibility.
 * @param permission fs file access constants: https://nodejs.org/api/fs.html#file-access-constants
 * @returns A promise that resolves to true if the path is accessible with the specified permissions, false otherwise.
 */
export async function pathAccessible(filePath: string, permission: number = constants.F_OK): Promise<boolean> {
    return filePath ? access(filePath, permission).then(() => true).catch(() => false) : false;
}

/** Checks if a file is executable by the current user.
 * @param file The path to the file to check.
 * @returns A promise that resolves to true if the file is executable, false otherwise.
 */
export function isExecutable(file: string): Promise<boolean> {
    return pathAccessible(file, constants.X_OK);
}

/** Represents the result of spawning a child process.
 * Contains information about the process exit code, standard output and error output.
 */
export interface ProcessReturnType {
    succeeded: boolean;
    exitCode?: number | NodeJS.Signals;
    output: string;
    outputError: string;
}

/** Escapes special characters in a string to make it safe for use in a regular expression.
 * @param str The string to escape.
 * @returns A new string with all special regex characters escaped with backslashes.
 */
export function escapeStringForRegex(str: string): string {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
}

/** Spawns a child process and returns its output.
 * @param program The path to the program to execute.
 * @param args The command line arguments to pass to the program.
 * @param localizer The function to use for localization.
 * @param continueOn Optional string pattern that, when found in stdout, will cause the process to be considered complete before it exits.
 * @param skipLogging Optional flag to skip logging process output.
 * @param cancellationToken Optional token that can be used to cancel the process.
 * @returns A promise that resolves to an object containing process output and exit information.
 */
export async function spawnChildProcess(program: string, args: string[] = [], continueOn?: string, skipLogging?: boolean, cancellationToken?: CancellationToken): Promise<ProcessReturnType> {
    // Do not use CppSettings to avoid circular require()
    if (skipLogging === undefined || !skipLogging) {
        appendLineAtLevel(5, `$ ${program} ${args.join(' ')}`);
    }
    const programOutput: ProcessOutput = await spawnChildProcessImpl(program, args, continueOn, skipLogging, cancellationToken);
    const exitCode: number | NodeJS.Signals | undefined = programOutput.exitCode;
    if (programOutput.exitCode) {
        return { succeeded: false, exitCode, outputError: programOutput.stderr, output: programOutput.stderr || programOutput.stdout || await localize('process.exited', 'Process exited with code {0}', exitCode) };
    } else {
        let stdout: string;
        if (programOutput.stdout.length) {
            // Type system doesn't work very well here, so we need call toString
            stdout = programOutput.stdout;
        } else {
            stdout = await localize('process.succeeded', 'Process executed successfully.');
        }
        return { succeeded: true, exitCode, outputError: programOutput.stderr, output: stdout };
    }
}

/** Represents the output of a child process spawned by the extension.
 * Contains the raw output streams and exit code information.
 */
interface ProcessOutput {
    /** The exit code of the process, or the signal that terminated it. */
    exitCode?: number | NodeJS.Signals;
    /** The standard output of the process as a string. */
    stdout: string;
    /** The standard error output of the process as a string. */
    stderr: string;
}

/** Implementation of the process spawning functionality.
 * This function handles the actual creation and management of the child process.
 *
 * @param program The path to the program to execute.
 * @param args The command line arguments to pass to the program.
 * @param continueOn Optional string pattern that, when found in stdout, will cause the process to be considered complete before it exits.
 * @param skipLogging Optional flag to skip logging process output.
 * @param cancellationToken Optional token that can be used to cancel the process.
 * @returns A promise that resolves to the process output, including stdout, stderr and exit code.
 */
async function spawnChildProcessImpl(program: string, args: string[], continueOn?: string, skipLogging?: boolean, cancellationToken?: CancellationToken): Promise<ProcessOutput> {
    const result = new ManualPromise<ProcessOutput>();

    let proc: ChildProcess;
    if (await isExecutable(program)) {
        proc = spawn(`.${isWindows ? '\\' : '/'}${basename(program)}`, args, { shell: true, cwd: dirname(program) });
    } else {
        proc = spawn(program, args, { shell: true });
    }

    const cancellationTokenListener: Disposable | undefined = cancellationToken?.onCancellationRequested(() => {

        appendLine(localize('killing.process', 'Killing process {0}', program));

        proc.kill();
    });

    /** Cleans up resources associated with the process.
     * Removes all event listeners and disposes the cancellation token listener.
     */
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
            if (skipLogging === undefined || !skipLogging) {
                appendLineAtLevel(1, str);
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

/** Returns true if the path is a folder.
 *
 * @param path The path to check.
 * @returns A promise that resolves to true if the path is a folder, false otherwise.
*/
export async function isFolder(path: string) {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        // Ignore errors, if we can't access the path, it's not a folder.
    }
    return false;
}

export async function searchFolders(folders: string[], filename: string | RegExp, predicate?: (binary: string) => Promise<boolean>, maxDepth = 4, options: { result?: string; visited?: Set<string>; topDepth?: number } = {}): Promise<string | undefined> {
    options.topDepth ??= maxDepth;
    options.visited ??= new Set<string>();
    const nameMatches = is.string(filename) ? (item: string) => item === filename : (item: string) => filename.test(item);

    for (let folder of folders) {
        // If the result was reached from anything going on asynchronously, we can stop searching.
        if (options.result) {
            return options.result;
        }

        // Ensure that the folder is normalized and absolute.
        folder = normalize(folder);
        if (!isAbsolute(folder)) {
            continue;
        }

        // If we've been here before, skip this folder.
        if (options.visited.has(folder) || !await isFolder(folder)) {
            continue;
        }
        // Mark the folder as visited to avoid infinite loops.
        options.visited.add(folder);

        // We can do a quick check in the folder when the filename is a string.
        if (is.string(filename)) {
            const fullPath = resolve(folder, filename);
            if (predicate ? await predicate(fullPath) : true) {
                return options.result ??= fullPath;
            }

            // And, if maxDepth is 0, we don't need to bother searching subfolders at all.
            if (maxDepth === 0) {
                continue;
            }
        }

        try {
            const subfolders = new Array<string>();

            // Parallelize the search for files in the folder.
            await Promise.all((await readdir(folder).catch(() => [])).map(async (item) => {

                // If we already found a match, stop searching.
                if (options.result) {
                    return;
                }

                // If we are not going to search subfolders, we can skip this item if it doesn't match the filename.
                if (maxDepth === 0 && !nameMatches(item)) {
                    return;
                }

                const fullPath: string = resolve(folder, item);

                const stats = await stat(fullPath).catch(() => undefined);
                if (!stats) {
                    return;
                }

                switch (true) {
                    // If anything else found anything, we can stop searching.
                    case !!options.result:
                        return;

                    // If the path is a symlink, skip it entirely.
                    case stats.isSymbolicLink():
                        // If it's a symlink, we can't follow it, so skip it.
                        log(`Skipping symlink: ${fullPath}`);
                        return;

                    // If it is a file, check for a match.
                    case stats.isFile():
                        if (nameMatches(item) && (predicate ? await predicate(fullPath) : true)) {
                            return options.result ??= fullPath;
                        }
                        break;

                    // If it's a folder, and we're not at the max depth yet, add it to the list of subfolders to search.
                    case maxDepth && stats.isDirectory():
                        subfolders.push(fullPath);
                        break;
                }
            }));

            if (subfolders.length) {
                await searchFolders(subfolders, filename, predicate, maxDepth - 1, options);
            }
        } catch {
            // Skip folders that can't be accessed.
        }
    }

    return options.result;
}
