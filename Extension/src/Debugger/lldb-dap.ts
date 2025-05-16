/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { resolve } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { appendLine, appendLineAtLevel, localize, log, note } from '../common-remote-safe';
import { isWindows } from '../constants';
import { RemoteConnection, startRemoting, startWorker } from '../Utility/Remoting/snare';
import { CppDebugConfiguration, DebuggerType } from './configurations';
import { findLldbDapImpl } from './lldb-dap-worker';
export { isValidLldbDap } from './lldb-dap-worker';

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

/** Connection to the worker thread handling lldb-dap related operations. */
let remote: RemoteConnection | undefined;

/** Cached path to the lldb-dap executable once found. */
let lldbDapExecutable: string | undefined;

/**
 * Finds the path to the lldb-dap executable.
 *
 * This function uses a worker thread if available, otherwise calls the implementation directly.
 * The result is cached for subsequent calls.
 *
 * @returns A promise that resolves to the path of the lldb-dap executable, or undefined if not found.
 */
export async function findLldbDap() {
    return lldbDapExecutable ??= remote ? await remote.request('findLldbDapImpl') : findLldbDapImpl();
}

// This code must only run in the main thread.
if (isMainThread && !remote) {
    try {
        // find the entry point for the worker thread.
        const file = resolve(__dirname.substring(0, __dirname.lastIndexOf('dist')), "dist", "src", "Debugger", 'lldb-dap-worker.js');
        // create the worker and connection.
        remote = startRemoting(startWorker(file), {
            // These are the functions that the main thread exposes to the worker thread.
            log,
            note,
            localize,
            appendLine,
            appendLineAtLevel
        });

        if (!isWindows) {
            // If we are not on Windows, we'll start it searching for the lldb dap executable as early as possible.
            // Mainly, because the LLDB-DAP debugger isn't a common standalone debugger for Windows.
            void findLldbDap();
        }
    } catch (e) {
        // If we fail to start the worker, we can still use the implementation directly.
        appendLineAtLevel(6, "Failed to start the worker thread for LLDB-DAP remote calls. Falling back to direct calls.");
        remote = undefined;
    }
}
