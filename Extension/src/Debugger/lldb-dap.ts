/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as nls from 'vscode-nls';
import { executableName, findInPath, isExecutable, searchFolder, spawnChildProcess } from '../common';
import { isLinux, isMacOS, isWindows } from '../constants';
import { TroubleshootingLldbDap } from '../links';
import { log, note } from '../logger';
import { CppDebugConfiguration, DebuggerType } from './configurations';
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

let lldbDapPath: string | undefined;
let xcRunPath: string | undefined;

/** On OSX, calls xcrun to find a given xtools binary (usually they don't expose the binary to the PATH).
 *
 * @param filename The name of the binary to find (e.g. lldb-vscode or lldb-dap).
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

let searching: Promise<string | undefined> | undefined;
const candidates = [
    executableName('lldb-dap'),
    /^lldb-dap-\d+$|^lldb-dap-\d+\.exe$/,
    executableName('lldb-vscode'),
    /^lldb-vscode-\d+$^lldb-vscode-\d+\.exe$/
];

/** The search implementation to find the viable lldb-dap executable.
 *
 * We absolutely prefer an lldb-dap binary that is in the path.
 * Failing that, we'll:
 *  - try xcrun on OSX to see if xtools can give it to us
 *  - try searching the secure well-known locations for a binary
 *
 * And if we can't find the actual lldb-dap binary, we'll try the same thing
 * for 'lldb-vscode' (the old name for the DAP binary)
 * and then 'lldb-dap-##' and 'lldb-vscode-##' - in practice, one might find a
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
            log(`Discovered lldb-dap binary for OSX at '${lldbDapPath}' ${Date.now() - start} msec`);
            note(localize('lldb-dap.enabled', "The {0} debugger is enabled via '{1}'", 'lldb-dap', lldbDapPath));
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
                    log(`Discovered lldb-dap binary for OSX at '${lldbDapPath}' ${Date.now() - start} msec`);
                    note(localize('lldb-dap.enabled', "The {0} debugger is enabled via '{1}'", 'lldb-dap', lldbDapPath));
                    return lldbDapPath;
                }
            }

            // If we got this far, it's not in the PATH or via xcrun - but worry not,
            // we'll do a check of well known secured locations where it might be installed.
            for (const folder of ['/Applications', '/opt/homebrew']) {
                lldbDapPath = (await searchFolder(folder, candidate, isValidLldbDap, 8))[0];
                if (lldbDapPath) {
                    log(`Discovered lldb-dap binary for OSX at '${lldbDapPath}' ${Date.now() - start} msec`);
                    note(localize('lldb-dap.enabled', "The {0} debugger is enabled via '{1}'", 'lldb-dap', lldbDapPath));
                    return lldbDapPath;
                }
            }
        }

        if (isWindows) {
            // If we got this far, it's not in the PATH - but worry not,
            // we'll do a check of well known secured locations where it might be installed.
            for (const folder of ['c:/Program Files/LLVM', 'c:/Program Files/', 'C:/program files (x86)/']) {
                lldbDapPath = (await searchFolder(folder, candidate, isValidLldbDap))[0];
                if (lldbDapPath) {
                    log(`Discovered lldb-dap binary for Windows at '${lldbDapPath}' ${Date.now() - start} msec`);
                    note(localize('lldb-dap.enabled', "The {0} debugger is enabled via '{1}'", 'lldb-dap', lldbDapPath));
                    return lldbDapPath;
                }
            }
        }

        if (isLinux) {
            // If we got this far, it's not in the PATH - but worry not,
            // we'll do a check of well known secured locations where it might be installed.
            for (const folder of ['/usr', '/opt']) {
                lldbDapPath = (await searchFolder(folder, candidate, isValidLldbDap, 8))[0];
                if (lldbDapPath) {
                    log(`Discovered lldb-dap binary for Linux at '${lldbDapPath}' ${Date.now() - start} msec`);
                    note(localize('lldb-dap.enabled', "The {0} debugger is enabled via '{1}'", 'lldb-dap', lldbDapPath));
                    return lldbDapPath;
                }
            }
        }
    }
    log(localize('lldb-dap.notfound', "Unable to find a working '{0}' adapter. See: {1}", 'lldb-dap', TroubleshootingLldbDap));
    note(localize('lldb-dap.notfound', "Unable to find a working '{0}' adapter. See: {1}", 'lldb-dap', TroubleshootingLldbDap));
    return lldbDapPath;
}

/** Calls searchForLldbDap, but only runs one search at a time, subsequent calls return the current search.
 * @returns The path to the lldb dap executable or undefined if it was not found.
 */
export async function findLldbDap() {
    // If we already have a path, return it.
    if (lldbDapPath) {
        return lldbDapPath;
    }

    try {
        // Only run one search at a time, so if we are already searching, return that.
        return searching ??= searchForLldbDap();
    } finally {
        // When it's done searching, clear the promise so that if it's not found we can try again.
        void searching?.then(() => searching = undefined);
    }
}

/** Check if the given path is a valid lldb dap executable. (actually runs it to check).
 * @param lldbDap The path to the lldb dap executable.
 * @returns true If the path is valid, false otherwise.
 */
export async function isValidLldbDap(lldbDap: string | undefined) {
    if (lldbDap) {
        if (await isExecutable(lldbDap)) {
            const proc = await spawnChildProcess(lldbDap, ['--help']);
            if (proc.succeeded && proc.output.includes('USAGE')) {
                return true;
            }

            log(localize('lldb-dap.not.valid', "The lldb-dap binary at '{0}' does not appear to be functional. See: {1}", lldbDap, TroubleshootingLldbDap));
        }
    }
    return false;
}

/** Translates the cpplldb configuration to the lldb dap configuration.
 * Note: this modifies the existing configuration object in place.
 *
 * @param config The cpplldb configuration to translate.
 * @returns The translated lldb dap configuration.
 */
export function translateToLldbDap(config: CppDebugConfiguration) {
    // Adapt the cpplldb config to the lldb-dap config.
    if (config.type !== DebuggerType.cpplldb) {
        throw new Error(`Invalid config type ${config.type} for lldb-dap`);
    }

    // Translate environment to env.
    if (config.environment) {
        // 'config.environment' is an array of { "name":<string>, "value":<string> } objects.
        // lldb-dap expects an object of { <name>:<value>, ... }.
        const env: { [key: string]: string } = {};
        for (const each of config.environment) {
            if (typeof each.name === 'string' && typeof each.value === 'string') {
                env[each.name] = each.value;
            }
        }
        delete config.environment;
    }

    // Translate stopAtEntry to stopOnEntry.
    if (config.stopAtEntry !== undefined) {
        config.stopOnEntry = config.stopAtEntry;
        delete config.stopAtEntry;
    }

    // Translate serverLaunchTimeout (msec) to timeout (seconds).
    if (config.serverLaunchTimeout !== undefined) {
        config.timeout = Math.floor(config.serverLaunchTimeout / 1000);
        delete config.serverLaunchTimeout;
    }

    // Translate externalConsole to runInTerminal (!inverse).
    if (config.externalConsole !== undefined) {
        config.runInTerminal = !config.externalConsole;
        delete config.externalConsole;
    }

    // TODO: translate sourceFileMap to sourcePath and sourceMap.

    // Translate processId to pid.
    if (config.processId !== undefined) {
        config.pid = Number(config.processId);
        delete config.program;
    }

    return config;
}

// Ensures this is run on startup to find the lldb dap path and cache it before anyone asks.
void findLldbDap();
