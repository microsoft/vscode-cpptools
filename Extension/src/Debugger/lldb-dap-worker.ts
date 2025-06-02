/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { isMainThread, parentPort } from 'node:worker_threads';

import { appendLineAtLevel, executableName, findInPath, initialize, isExecutable, localize, searchFolders, spawnChildProcess } from '../common-remote-safe';
import { isLinux, isMacOS, isWindows } from '../constants';
import { TroubleshootingLldbDap } from '../links';
import { ManualPromise } from '../Utility/Async/manualPromise';
import { RemoteConnection, startRemoting } from '../Utility/Remoting/snare';

let remote: RemoteConnection | undefined;

/**
 * Base interface for debug configurations.
 * Represents a configuration used by the VS Code debugger.
 */
export interface DebugConfiguration {
    /**
     * The type of the debug session.
     */
    type: string;

    /**
     * The name of the debug session.
     */
    name: string;

    /**
     * The request type of the debug session.
     */
    request: string;

    /**
     * Additional debug type specific properties.
     */
    [key: string]: any;
}

/**
 * C++ specific debug configuration interface.
 * Extends the base debug configuration with C++ specific properties.
 */
export interface CppDebugConfiguration extends DebugConfiguration {
    /** Detailed description of the configuration. */
    detail?: string;

    /** Status of the associated build task. */
    taskStatus?: any;

    /**
     * Indicates whether this is the default debug configuration.
     * The debug configuration is considered as default if the prelaunch task is set as default.
     */
    isDefault?: boolean;

    /** Source of the configuration (e.g., auto-generated, user-defined). */
    configSource?: any;

    /** Debugger-specific event information. */
    debuggerEvent?: any;

    /** Type of debugging to perform. */
    debugType?: any;

    /** Indicates whether this configuration represents an existing debug session. */
    existing?: boolean;
}

/**
 * Enum representing the supported debugger types in the C++ extension.
 */
export enum DebuggerType {
    /** Microsoft Visual Studio Debugger */
    cppvsdbg = "cppvsdbg",

    /** GDB Debugger */
    cppdbg = "cppdbg",

    /** LLDB Debugger with Debug Adapter Protocol support */
    cpplldb = "cpplldb",

    /** Represents all debugger types */
    all = "all"
}

/** Cached path to the lldb-dap executable once found. */
let lldbDapPath: string | undefined;

/** Cached path to the xcrun tool on macOS. */
let xcRunPath: string | undefined;

/**
 * On macOS, calls xcrun to find a given xtools binary (usually they don't expose the binary to the PATH).
 *
 * @param filename The name of the binary to find (e.g., lldb-vscode or lldb-dap).
 * @returns The path to the binary or undefined if it was not found.
 */
export async function xcRun(filename: string) {
    if (isMacOS) {
        try {
            xcRunPath ??= await findInPath('xcrun');
            if (xcRunPath) {
                const xcRun = await spawnChildProcess(xcRunPath, ['--find', filename]);

                if (xcRun.succeeded) {
                    const path = xcRun.output.trim();
                    if (await isValidLldbDap(path)) {
                        return path;
                    }
                }
            }
        } catch {
            // Ignore failure to run xcrun, or no results found.
        }
    }

    return undefined;
}

/** Promise representing an ongoing search for the lldb-dap executable. */
let searching: ManualPromise<string | undefined> | undefined;

/**
 * List of candidate file names and patterns to search for when looking for the lldb-dap executable.
 * Includes both string literals and regular expressions to match version-specific binaries.
 */
const candidates = [
    executableName('lldb-dap'),
    /^lldb-dap-\d+$|^lldb-dap-\d+\.exe$/,
    executableName('lldb-vscode'),
    /^lldb-vscode-\d+$|^lldb-vscode-\d+\.exe$/
];

/**
 * The search implementation to find the viable lldb-dap executable.
 *
 * We absolutely prefer an lldb-dap binary that is in the path.
 * Failing that, we'll:
 *  - Try xcrun on macOS to see if xtools can give it to us
 *  - Try searching the secure well-known locations for a binary
 *
 * And if we can't find the actual lldb-dap binary, we'll try the same thing
 * for 'lldb-vscode' (the old name for the DAP binary)
 * and then 'lldb-dap-##' and 'lldb-vscode-##'. In practice, one might find a
 * binary with the LLVM major version number in it.
 *
 * @returns The path to the lldb-dap executable or undefined if it was not found.
 */
async function searchForLldbDap() {
    if (lldbDapPath) {
        return lldbDapPath;
    }
    const start = Date.now();
    // PATH binaries take priority.
    for (const candidate of candidates) {
        // First, search the environment PATH for the binary.
        lldbDapPath = await findInPath(candidate, isValidLldbDap);
        if (lldbDapPath) {
            appendLineAtLevel(6, `Discovered lldb-dap binary at '${lldbDapPath}' ${Date.now() - start} msec`);
            return lldbDapPath;
        }
    }

    // Well-known-locations next.
    for (const candidate of candidates) {
        if (isMacOS) {
            // If that fails, use xcrun to find the path.
            if (typeof candidate === 'string') {
                lldbDapPath = await xcRun(candidate);
                if (lldbDapPath) {
                    appendLineAtLevel(6, `Discovered lldb-dap binary for macOS at '${lldbDapPath}' ${Date.now() - start} msec`);
                    return lldbDapPath;
                }
            }

            // If we got this far, it's not in the PATH or via xcrun - but worry not,
            // we'll do a check of well known secured locations where it might be installed.
            lldbDapPath = await searchFolders(['/Applications', '/opt/homebrew'], candidate, isValidLldbDap, 8);
            if (lldbDapPath) {
                appendLineAtLevel(6, `Discovered lldb-dap binary for macOS at '${lldbDapPath}' ${Date.now() - start} msec`);
                return lldbDapPath;
            }
        }

        if (isWindows) {
            // If we got this far, it's not in the PATH - but worry not,
            // we'll do a check of well known secured locations where it might be installed.
            lldbDapPath = await searchFolders(['c:/Program Files/LLVM', 'c:/Program Files/', 'C:/program files (x86)/'], candidate, isValidLldbDap);
            if (lldbDapPath) {
                appendLineAtLevel(6, `Discovered lldb-dap binary for Windows at '${lldbDapPath}' ${Date.now() - start} msec`);
                return lldbDapPath;
            }

        }

        if (isLinux) {
            // If we got this far, it's not in the PATH - but worry not,
            // we'll do a check of well known secured locations where it might be installed.
            lldbDapPath = await searchFolders(['/usr', '/opt'], candidate, isValidLldbDap, 8);
            if (lldbDapPath) {
                appendLineAtLevel(6, `Discovered lldb-dap binary for Linux at '${lldbDapPath}' ${Date.now() - start} msec`);
                return lldbDapPath;
            }
        }
    }
    appendLineAtLevel(1, localize('lldb-dap.notfound', "Unable to find a working '{0}' adapter ({1} msec). See: {2}", 'lldb-dap', Date.now() - start, TroubleshootingLldbDap));
    return lldbDapPath;
}

/**
 * Calls searchForLldbDap, but only runs one search at a time. Subsequent calls return the current search.
 *
 * @returns The path to the lldb-dap executable or undefined if it was not found.
 */
export async function findLldbDapImpl() {
    // If we already have a path, return it.
    if (lldbDapPath) {
        return lldbDapPath;
    }
    if (searching) {
        return searching;
    }

    // Only run one search at a time, so if we are already searching, return that.
    searching = new ManualPromise<string | undefined>();
    searchForLldbDap().then((result: string | undefined): void => {
        if (searching) {
            searching.resolve(result);
            searching = undefined;
        }
    }).catch(error => {
        if (searching) {
            searching.reject(error);
            searching = undefined;
        }
    });
    return searching;
}

/**
 * Check if the given path is a valid lldb-dap executable (actually runs it to check).
 *
 * @param lldbDap The path to the lldb-dap executable.
 * @returns True if the path is valid, false otherwise.
 */
export async function isValidLldbDap(lldbDap: string | undefined) {
    if (lldbDap) {
        if (await isExecutable(lldbDap)) {
            const proc = await spawnChildProcess(lldbDap, ['--help'], undefined, true);
            if (proc.succeeded && proc.output.includes('USAGE')) {
                return true;
            }

            appendLineAtLevel(6, localize('lldb-dap.not.valid', "The lldb-dap binary at '{0}' does not appear to be functional. See: {1}", lldbDap, TroubleshootingLldbDap));
        }
    }
    return false;
}

if (!isMainThread) {
    // if this is loaded in a worker thread, we'll set up the remoting interface.
    try {
        /** This is the SNARE remote call interface dispatcher that the worker thread supports  */
        remote = parentPort ? startRemoting(parentPort, {
            // these are the functions that this worker exposes to the parent thread.
            findLldbDapImpl
        }) : undefined; // if we're not in a worker thread - then we don't really have a remote interface.
        initialize(remote);
    } catch (e) {
        if (e instanceof Error) {
            appendLineAtLevel(6, `Error in worker thread: ${e.message}`);
        }
    }
}
