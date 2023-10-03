/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as os from 'os';
import { basename, resolve } from 'path';
import { rcompare } from 'semver';

import { accumulator } from '../../Utility/Async/iterators';
import { ManualPromise } from '../../Utility/Async/manualPromise';
import { sleep, then } from '../../Utility/Async/sleep';
import { filepath, filterToFolders, pathsFromVariable } from '../../Utility/Filesystem/filepath';
import { FastFinder, ripGrep } from '../../Utility/Filesystem/ripgrep';

import { Cache } from '../../Utility/System/cache';
import { is } from '../../Utility/System/guards';
import { structuredClone } from '../../Utility/System/structuredClone';
import { verbose } from '../../Utility/Text/streams';
import { render } from '../../Utility/Text/taggedLiteral';
import { isWindows } from '../../constants';
import { DefinitionFile, IntelliSense, IntelliSenseConfiguration } from '../interfaces';
import { getActions, strings } from '../strings';
import { loadCompilerDefinitions, resetCompilerDefinitions, runConditions } from './definition';
import { createResolver } from './resolver';
import { Toolset, loadToolsetData, persistToolsetData, settings } from './toolset';
import escapeStringRegExp = require('escape-string-regexp');

let initialized: ManualPromise | undefined;

const discoveringInProgress = new Map<DefinitionFile, Promise<void>>();
let discovering: Promise<any> | undefined;
const configurationFolders = new Set<string>();

const cache = new Cache<Record<string, string>>();
async function searchInsideBinary(compilerPath: string, rx: string | Promise<string>) {
    if (is.promise(rx)) {
        rx = await rx;
    }
    return cache.getOrAdd(compilerPath + rx, async () => {
        for await (const match of ripGrep(compilerPath, rx as string, { binary: true, ignoreCase: true })) {
            const rxResult = new RegExp(rx as string, 'i').exec(match.lines.text.replace(/\0/g, ''));
            if (rxResult) {
                return rxResult.groups || {};
            }
        }
        return undefined;
    });
}

async function discover(compilerPath: string, definition: DefinitionFile): Promise<Toolset | undefined> {
    // normalize the path separators to be forward slashes.
    compilerPath = resolve(compilerPath);

    let toolset = settings.discoveredToolsets.get(compilerPath);
    if (toolset) {
        return toolset;
    }
    // toolset was not previously discovered for this binary, so, discover it now.

    // clone the definition so it can be modified without affecting the original
    definition = structuredClone(definition);

    // create toolset object for the result.
    toolset = new Toolset(compilerPath, definition);

    const intellisense = definition.intellisense as IntelliSense;

    const requirements = getActions<Record<string, IntelliSenseConfiguration>>(definition.discover as any, [
        ['match', ['optional', 'priority', 'oneof']],
        ['expression', ['oneof', 'optional', 'priority', 'folder', 'file']]
    ]);
    nextBlock:
    for (const { action, block, flags } of requirements) {
        switch (action) {
            case 'match':
                // valid flags : 'oneof', 'optional'
                if (flags.has('oneof')) {
                    // run them in parallel, but take the first winning result in order
                    for (const [rawRx, isense] of Object.entries(block)) {
                        const result = await searchInsideBinary(compilerPath, render(rawRx, {}, toolset.resolver));
                        if (result) {
                            await toolset.applyToConfiguration(toolset.default, isense, result);
                            // first one wins, exit the block
                            // await Promise.all(results); // wait for all the results to complete?
                            continue nextBlock;
                        }
                    }
                    // if this is optional, we can move to the next entry
                    if (flags.has('optional')) {
                        continue nextBlock;
                    }
                    // if we got here, none matched, so this whole toolset is not a match
                    return;
                } else {
                    for (const [rawRx, isense] of Object.entries(block)) {
                        const r = await searchInsideBinary(compilerPath, render(rawRx, {}, toolset.resolver));
                        if (r) {
                            await toolset.applyToConfiguration(toolset.default, isense, r);
                            continue;
                        }
                        // not found, but not a problem
                        if (flags.has('optional')) {
                            continue;
                        }
                        // not found, and not optional, so this whole toolset is not a match
                        return;
                    }
                }
                break;

            case 'expression':
                // verifies that the expression is true
                // valid flags : 'oneof', 'optional', 'priority', 'folder', 'file'
                for (const [expr, isense] of Object.entries(block)) {
                    const value = await render(expr, {}, toolset.resolver);
                    if (value) {
                        if (flags.has('folder')) {
                            if (await filepath.isFolder(value)) {
                                await toolset.applyToConfiguration(intellisense, isense);
                                if (flags.has('oneof')) {
                                    // first one wins, exit the block
                                    continue nextBlock;
                                }
                                // a success, move to the next entry
                                continue;
                            }
                            // not a match
                            if (flags.has('optional') || flags.has('oneof')) {
                                // didn't find it, but it's optional (or we can still find a match later?), so we can move to the next entry
                                continue;
                            }

                            // should be a folder match, and not optional. this toolset is not a match
                            return;
                        }

                        if (flags.has('file')) {
                            if (await filepath.isFile(value)) {
                                await toolset.applyToConfiguration(intellisense, isense);
                                if (flags.has('oneof')) {
                                    // first one wins, exit the block
                                    continue nextBlock;
                                }
                                // a success, move to the next entry
                                continue;
                            }

                            // not a match
                            if (flags.has('optional') || flags.has('oneof')) {
                                // didn't find it, but it's optional (or we can still find a match later?), so we can move to the next entry
                                continue;
                            }

                            // should be a file match, and not optional. this toolset is not a match
                            return;
                        }

                        // it's a truthy value, so it's a match
                        await toolset.applyToConfiguration(intellisense, isense);
                        if (flags.has('oneof')) {
                            // first one wins, exit the block
                            continue nextBlock;
                        }
                        // a success, move to the next entry
                        continue;
                    }
                    // we didn't get a match
                    if (flags.has('optional') || flags.has('oneof')) {
                        // didn't find it, but it's optional (or we can still find a match later?), so we can move to the next entry
                        continue;
                    }

                    // no match, the whole toolset is not a match
                    return;
                }
                break;
        }
    }

    settings.discoveredToolsets.set(compilerPath, toolset);
    void persistToolsetData();

    return toolset;
}

async function getWellKnownBinariesFromPath() {
    // create the finder
    const finder = new FastFinder(['cl'], { executable: true, executableExtensions: ['.exe'] });

    // start scanning the folders in the $PATH
    finder.scan(...await filterToFolders(pathsFromVariable('PATH')));

    for await (const compilerPath of finder) {
        await identify(compilerPath);
    }
}

/**
 * This will search for toolsets based on the definitions
 * Calling this forces a reset of the compiler definitions and discovered toolsets -- ideally this shouldn't need to be called
 * more than the initial time
 */
export async function initialize(configFolders: string[], options?: { quick?: boolean; storagePath?: string }) {
    if (initialized) {
        // wait for an existing initialize to complete
        await initialized;
    }

    initialized = new ManualPromise();

    const forceReset = !options?.quick;

    settings.globalStoragePath = options?.storagePath;

    if (forceReset) {
        // if initialize is called more than once, we need to reset the compiler definitions and list of discovered toolsets
        // (options.quick=true should only be used with tests)
        resetCompilerDefinitions();
        settings.discoveredToolsets.clear();
        discoveringInProgress.clear();
    }

    // add the configuration folders to the list of folders to scan
    configFolders.forEach(each => configurationFolders.add(each));

    await loadToolsetData();
    // if we have zero entries, then we're going to prioritize finding well known compilers on the PATH.
    if (settings.discoveredToolsets.size === 0) {
        try {
            await getWellKnownBinariesFromPath();
        } catch {
            // ignore any failures during this process
        }
    }

    initialized.resolve();

    // find the well-known compilers on the path

    if (forceReset) {
        // we kick off the discovery in the background but we wait
        // a few seconds to give the intelliSense engine an opportunity to start up
        // and perhaps get a few requests for previously discovered toolsets.
        // but we really do want to start the discovery so that it's in progress in the background
        // for the next time it's needed.
        void sleep(5000).then(() => getToolsets());
    }
}

/**
 * Async scan for all compilers using the definitions (toolset.*.json) in the given folders
 * (iterate over this with `for await`)
 *
 * UNUSED-- TARGET FOR DELETION
 * /
export async function* detectToolsets(): AsyncIterable<Toolset> {
    const results = accumulator<Toolset>();
    for await (const definition of loadCompilerDefinitions(configurationFolders)) {
        results.add(searchForToolsets(definition));
    }
    results.complete();
    yield* results;
}
*/

/** Returns the discovered toolsets all at once
 *
 * If the discovery has been done before, it will just return the cached results.
 * If it hasn't, it will run the discovery process and then return all the results.
 *
 * To reset the cache, call initialize() before calling this.
 */
export async function getToolsets() {
    if (!initialized) {
        throw new Error('Compiler detection has not been initialized. Call initialize() before calling this.');
    }

    // ensure that init is done
    await initialized;

    // this exponentially/asychnronously searches for toolsets using the configuration folders
    for await (const definition of loadCompilerDefinitions(configurationFolders)) {
        // have we started searching with this definition yet?
        const searching = discoveringInProgress.get(definition);

        // yeah, we're already searching, so skip this one
        if (is.promise(searching)) {
            continue;
        }
        // nope, we haven't started searching yet, so start it now
        discoveringInProgress.set(definition, then(async () => {
            for await (const toolset of searchForToolsets(definition)) {
                if (toolset) {
                    verbose(`Detected Compiler ${toolset.name}`);
                }
            }
        }));
    }
    // wait for the inProgress searches to complete
    discovering = Promise.all(discoveringInProgress.values());

    await discovering;

    // return the results
    return settings.discoveredToolsets;
}

function lookupToolset(name: string) {
    // simple lookup first
    const result = settings.discoveredToolsets.get(name);
    if (result) {
        return result;
    }

    // if the name isn't wildcarded, and it's not a full path, then we just look at the filenames
    if (name.match(/[\\\/*?]/) === null) {
        for (const toolset of settings.discoveredToolsets.values()) {
            if (name === basename(toolset.compilerPath)) {
                return toolset;
            }
        }
    }

    // check if the candidate is a name of a toolset (* AND ? are supported)
    const rx = new RegExp(escapeStringRegExp(name).replace(/\\\*/g, '.*'));

    // iterate over the discovered toolsets starting with the highest versions
    for (const toolset of [...settings.discoveredToolsets.values()].sort((a, b) => rcompare(a.version ?? "0.0.0", b.version ?? "0.0.0"))) {
        // return the first match given the regex
        if (rx.exec(toolset.name)) {
            return toolset;
        }
    }
}

const identifyInProgress = new Map<string, Promise<Toolset | undefined>>();

/**
 * Given a path to a binary, identify the compiler
 * @param candidate the path to the binary to identify
 * @returns a Toolset or undefined.
 */
export async function identifyToolset(candidate: string): Promise<Toolset | undefined> {
    if (!initialized) {
        throw new Error('Compiler detection has not been initialized. Call initialize() before calling this.');
    }
    await initialized;

    // quick check if the given path is already in the discovered toolsets
    const toolset = lookupToolset(candidate);
    if (toolset) {
        return toolset;
    }

    // check if we're already identifying this candidate
    if (identifyInProgress.get(candidate)) {
        return identifyInProgress.get(candidate);
    }

    // set this candidate to in-progress.
    const promise = new ManualPromise<Toolset | undefined>();
    identifyInProgress.set(candidate, promise);

    // get file info for the candidate (is it even a file?)
    const fileInfo = await filepath.info(candidate);

    if (!fileInfo?.isFile) {
        // if it's not a file let's quickly check for a match in the discovered toolsets
        const toolset = lookupToolset(candidate);
        if (toolset) {
            return promise.resolve(toolset);
        }

        // we didn't find it, but the discovery may not be done yet, (or hasn't been done).
        // make sure discovery is complete before doing another lookup.
        await (is.promise(discovering) ? discovering : getToolsets());

        return promise.resolve(lookupToolset(candidate));
    }

    if (fileInfo.isExecutable) {
        // otherwise, let's use the definitions to try to identify it.
        return identify(candidate).then((result) => promise.resolve(result));
    }
    // otherwise...
    return promise.resolve(undefined);
}

async function identify(candidate: string, name?: string): Promise<Toolset | undefined> {
    const bn = basename(candidate);
    for await (const definition of loadCompilerDefinitions(configurationFolders)) {
        if (!name || definition.name === name) {
            const resolver = createResolver(definition);
            await runConditions(definition, resolver);

            if (strings(definition.discover.binary).includes(basename(bn, isWindows ? '.exe' : undefined))) {
                const toolset = await discover(candidate, definition);
                if (toolset) {
                    return toolset;
                }
            }
        }
    }
    return undefined;
}

/** Given a specific definition file, detect a compiler
 *
 * If a path to candidate is passed in then we will only check that path.
 *
 * Otherwise, it will scan the $PATH, $ProgramFiles* and locations specified in the definition file.
 */
async function* searchForToolsets(definition: DefinitionFile): AsyncIterable<Toolset | undefined> {
    // run the conditions once before we start.
    const resolver = createResolver(definition);
    await runConditions(definition, resolver);

    // create the finder
    const finder = new FastFinder(strings(definition.discover.binary), { executable: true, executableExtensions: ['.exe'] });

    // start scanning the folders in the $PATH
    finder.scan(...await filterToFolders(pathsFromVariable('PATH')));

    // add any folders that the definition specifies (expand any variables)
    finder.scan(10, ...await render(strings(definition.discover.locations), {}, resolver));

    // add any platform folders
    switch (os.platform()) {
        case 'win32':
            finder.scan(10, ...['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)', 'ProgramFiles(Arm)'].map(each => process.env[each]).filter(each => each) as string[]);
            break;
        case 'linux':
            finder.scan(10, '/usr/lib/');
            break;
        case 'darwin':
            break;
    }

    const results = accumulator<Toolset>();

    // kick off each discovery asynchronously
    for await (const compilerPath of finder) {
        results.add(discover(compilerPath, definition));
    }
    results.complete();

    // return them as they complete.
    yield* results;
}
