/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { Configuration, NewIntelliSense } from '../LanguageServer/configurations';
import { MarshalByReference, startRemoting } from '../Utility/System/snare';
import { CStandard, CppStandard, IntelliSenseConfiguration, Language } from './interfaces';
import { appendUnique } from './strings';

import { resolve } from 'path';
import { SHARE_ENV, Worker, isMainThread } from 'worker_threads';

import { SourceFileConfiguration } from 'vscode-cpptools';
import { Mutable } from '../common';
import { getOutputChannel } from '../logger';

// this code must only run in the main thread.
if (!isMainThread) {
    throw new Error("Remoting: Failed to start host thread responder - not on main thread");
}

// starts the worker thread and returns the RemoteConnection object
export const remote = startRemoting(new Worker(resolve(__dirname.substring(0, __dirname.lastIndexOf('dist')), "dist", "src", "ToolsetDetection", "Service", 'worker.js'), {stderr:true, stdout: true, env: SHARE_ENV}), {
    // this is the functions we expose to the worker
    "console.log": (text: string) => {
        try {
            getOutputChannel().appendLine(text);
        } catch {
            // fall back to console?
            console.log(text);
        }
    }
});

/**
 * This is a byref proxy to the toolset.
 *
 * As with all byref proxies, it is a reference to an object that lives in the worker thread.
 * It is important to call .dispose() when you are done with it, as this enables the worker
 * thread to release the object and free up resources.
 *
 */
export class Toolset extends MarshalByReference {
    async getIntellisenseConfiguration(compilerArgs: string[], options?: { baseDirectory?: string; sourceFile?: string; language?: Language; standard?: CppStandard | CStandard; userIntellisenseConfiguration?: IntelliSenseConfiguration }): Promise<IntelliSenseConfiguration> {
        return this.remote.request('Toolset.getIntellisenseConfiguration', this.instance, compilerArgs, options);
    }
    harvestFromConfiguration(configuration: Configuration | (Mutable<SourceFileConfiguration> & NewIntelliSense), intellisense: IntelliSenseConfiguration) {
        // includePath
        intellisense.include!.paths = appendUnique(intellisense.include!.paths, configuration.includePath);

        // macFrameworkPath
        intellisense.include!.frameworkPaths = appendUnique(intellisense.include!.frameworkPaths, (configuration as any).macFrameworkPath);

        // cStandard
        // cppStandard

        // defines
        for (const define of configuration.defines || []) {
            const [,key, value] = /^([^=]+)=*(.*)?$/.exec(define) ?? [];
            if (key && value) {
                intellisense.defines[key] = value;
            }
        }

        // forcedInclude
        intellisense.forcedIncludeFiles = appendUnique(intellisense.forcedIncludeFiles, configuration.forcedInclude);

        return intellisense;
    }
}

/**
 * Makes a remote call to the identifyToolset function in the worker thread.
 *
 * @param candidate one of:
 *   - the path to the compiler executable to identify
 *   - a name of a binary on the PATH
 *   - a name of a toolset definition (supports wildcards)
 * @returns a Promise to either a valid toolset or undefined if there was no match..
 */
export function identifyToolset(candidate: string): Promise<Toolset | undefined> {
    return remote.marshall(Toolset, remote.request('identifyToolset', candidate));
}

/** Makes a remote call to initialize the toolset detection system */
export async function initialize(configFolders: string[], options?: { quick?: boolean; storagePath?: string }): Promise<void>{
    return remote.request('initialize', configFolders, options);
}

/** Makes a remote call to get the list of toolsets from the worker thread */
export async function getToolsets(): Promise<Map<string, string>>{
    return new Map(await remote.request('getToolsets'));
}
