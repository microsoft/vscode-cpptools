/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable prefer-const */

import { unlinkSync, writeFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { delimiter, dirname, resolve } from 'path';
import { filepath, mkdir, tmpFile } from '../../Utility/Filesystem/filepath';
import { Command, CommandFunction, cmdlineToArray } from '../../Utility/Process/program';
import { is } from '../../Utility/System/guards';
import { CustomResolver, evaluateExpression, recursiveRender, render } from '../../Utility/Text/taggedLiteral';
import { formatIntelliSenseBlock } from './definition';

import { parse } from 'comment-json';
import { Cache, isExpired, isLater } from '../../Utility/System/cache';
import { structuredClone } from '../../Utility/System/structuredClone';
import { CStandard, CppStandard, DeepPartial, DefinitionFile, IntelliSense, IntelliSenseConfiguration, Language, OneOrMore } from '../interfaces';
import { getActions, strings } from '../strings';
import { mergeObjects } from './objectMerge';
import { createResolver } from './resolver';
import { log } from './worker';

function isC(language?: string): boolean {
    return language === 'c';
}

function isCpp(language?: string): boolean {
    return language === 'cpp' || language === 'c++';
}

export let settings = {
    globalStoragePath:  undefined as string | undefined,
    discoveredToolsets: new Cache<Toolset>(Cache.OneWeek),
    get toolsetFilePath() {
        return settings.globalStoragePath ? resolve(settings.globalStoragePath, 'detected-toolsets.json') : '';
    },
    timestamp: 0
};

/** Trims out empty elements during serialization to JSON */
function trim(key: string, value: any) {
    if (is.array(value) && value.length === 0) {
        // empty arrays
        return undefined;
    }
    if (is.object(value) && Object.keys(value).length === 0) {
        // empty objects
        return undefined;
    }
    return value;
}

export async function persistToolsetData() {
    // we can only store data if the globalStoragePath is set
    // eslint-disable-next-line no-constant-condition
    if (1 !== 1 && settings.globalStoragePath) {

        // ensure the folder is created
        await mkdir(settings.globalStoragePath);

        // check to see if we have a file already
        const info = await filepath.info(settings.toolsetFilePath);
        if (info?.isFile && info.timestamp > settings.timestamp) {
            // we do have a file, and it's newer than the last time we wrote to it.
            // so we should merge that data before we write to it.
            await loadToolsetData();
        }

        // ok, serialize out the data we have
        const contents = {} as Record<string, [number, Record<string, any>]>;
        for (const [path, [timeout, toolset]] of settings.discoveredToolsets.cacheEntries()) {
            contents[path] = [timeout, toolset.serialize()];
        }

        log(`persisting ${Object.keys(contents).length} toolsets to ${settings.toolsetFilePath}`);

        // write out the file
        await writeFile(settings.toolsetFilePath, JSON.stringify(contents, trim));

        // set our timestamp to now
        settings.timestamp = Date.now();
    }
}

function mergeToolsetData(newer: Toolset, older: Toolset) {
    for (const [key, [timeout, query]] of older.cachedQueries.cacheEntries()) {
        newer.cachedQueries.set(key, query, timeout);
    }
    for (const [key, [timeout, analysis]] of older.cachedAnalysis.cacheEntries()) {
        newer.cachedAnalysis.set(key, analysis, timeout);
    }
    return newer;
}

export async function loadToolsetData() {
    if (!settings.globalStoragePath) {
        log(`GlobalStoragePath not set - can't load toolsets`);
        return false;
    }
    const location = resolve(settings.globalStoragePath, 'detected-toolsets.json');
    const cachePath = await filepath.isFile(location);
    if (!cachePath) {
        log(`No cached toolset file at ${location} - can't load toolsets`);
        return false;
    }

    log(`loading toolsets from ${settings.toolsetFilePath}`);
    const entries = parse(await readFile(cachePath, 'utf8')) as Record<string, any>;
    if (!is.object(entries)) {
        return false;
    }

    for (const [path, [timeout, serializedToolset]] of Object.entries(entries)) {
        // in the event that something throws, we'll skip it an move on.
        try {
            // if the entry is expired, skip it completely.
            if (isExpired(timeout)) {
                continue;
            }

            // if we have one, let's see if it's newer than the one we have.
            const current = settings.discoveredToolsets.getCacheEntry(path);
            if (!current) {
                // we don't have one currently, so let's just deserialize this one
                const toolset = settings.discoveredToolsets.set(path, await Toolset.deserialize(serializedToolset), timeout);
                log(`Loaded toolset: ${toolset?.name}`);
                continue;
            }

            // there is a current one.

            // ok, merge the current one and the deserialized one, and then set the cache to the merged one.
            let toolset = await Toolset.deserialize(serializedToolset);
            log(`Loaded toolset (merging): ${toolset?.name}`);
            if (toolset) {
                if (isLater(timeout, current[0])) {
                    // merge the current one into the deserialized one
                    settings.discoveredToolsets.set(path, mergeToolsetData(toolset, current[1]), timeout);
                } else {
                    // merge the deserialized one into the current one
                    settings.discoveredToolsets.set(path, mergeToolsetData(current[1], toolset), timeout);
                }
            }
        } catch {
            // ignore deserialization failures
        }
        return true;
    }
}

type Entries = {
    action: string;
    block: Record<string, IntelliSenseConfiguration>;
    flags: Map<string, string | boolean>;
    priority: number;
    comment?: string | undefined;
}[];

/**
 * The Toolset is the final results of the [discovery+query] process
 *
 * This is the contents that we're going to eventually pass to the back end.
 */
export class Toolset {
    cachedQueries = new Cache<string>(Cache.OneWeek);
    cachedAnalysis = new Cache<IntelliSenseConfiguration>(Cache.OneWeek);
    resolver: CustomResolver;
    cmd: Promise<CommandFunction>;
    rxResolver: (prefix: string, expression: string) => any;
    get default() {
        return this.definition.intellisense as IntelliSense;
    }

    get version() {
        return this.definition.version || this.definition.intellisense?.version;
    }

    get name() {
        return `${this.definition.name}/${this.version}/${this.default.architecture}/${this.default.hostArchitecture || process.arch}`;
    }

    serialize() {
        return {
            name: this.name,
            compilerPath: this.compilerPath,
            definition: this.definition,
            queries: this.cachedQueries.cacheEntries(),
            analysis: this.cachedAnalysis.cacheEntries()
        };
    }

    static async deserialize(obj: Record<string, any>) {
        try {
            const { compilerPath, definition, queries, analysis } = obj;
            const result = new Toolset(compilerPath, definition);
            result.cachedQueries = new Cache(queries, Cache.OneWeek);
            result.cachedAnalysis = new Cache(analysis, Cache.OneWeek);
            return result;
        } catch {
            return undefined;
        }
    }

    constructor(readonly compilerPath: string, readonly definition: DefinitionFile) {
        this.resolver = createResolver(definition, compilerPath);
        this.definition.intellisense = this.definition.intellisense || {};
        this.cmd = new Command(this.compilerPath, { env: { PATH: `${dirname(this.compilerPath)}${delimiter}${process.env.PATH}` } });

        this.rxResolver = async (prefix: string, expression: string) => {
            if (!prefix) {
                switch (expression.toLowerCase()) {
                    case '-/':
                    case '/-':
                        return '[\\-\\/]';

                    case 'key':
                        return '(?<key>[^=]+)';

                    case 'value':
                        return '(?<value>.+)';

                    case 'keyequalsvalue':
                        return '(?<key>[^=]+)=(?<value>.+)';
                }
            }

            return this.resolver(prefix, expression);
        };
    }

    async applyToConfiguration(intellisenseConfiguration: IntelliSenseConfiguration | IntelliSense, partial: DeepPartial<IntelliSenseConfiguration>, data: Record<string, any> = intellisenseConfiguration) {
        mergeObjects(intellisenseConfiguration, await recursiveRender(formatIntelliSenseBlock(partial), data, this.resolver));
    }

    async query(command: string, queries: Record<string, DeepPartial<IntelliSenseConfiguration>>, intellisenseConfiguration: IntelliSenseConfiguration) {
        // check if we've handled this command before.
        const key = await render(command, {}, this.resolver);
        let text = this.cachedQueries.get(key);

        if (!text) {
            // prepare the command to run
            const cmd = await this.cmd;
            const tmpFiles = new Array<string>();
            let stdout = '';
            let stderr = '';

            const commandLine = await render(command, {}, async (prefix, expression) => {
                if (prefix === 'tmp') {
                    // creating temp files
                    const tmp = tmpFile('tmp.', `.${expression}`);
                    writeFileSync(tmp, '');
                    tmpFiles.push(tmp);
                    switch (expression) {
                        case 'stdout':
                            stdout = tmp;
                            break;
                        case 'stderr':
                            stderr = tmp;
                            break;
                    }
                    return tmp;
                }
                return this.resolver(prefix, expression);
            });

            // parse the arguments and replace any tmp files with actual files
            const args = cmdlineToArray(commandLine);
            // execute the command line now.
            const out = await cmd(...args);
            text = [...out.stdio.all(), ...out.error.all()].join('\n');

            if (stdout) {
                text += await readFile(stdout, 'utf8');
            }
            if (stderr) {
                text += await readFile(stderr, 'utf8');
            }

            for (const tmp of tmpFiles) {
                text = text!.replace(new RegExp(tmp, 'g'), '');
                unlinkSync(tmp);
            }

            this.cachedQueries.set(key, text);
            void persistToolsetData();
        }

        // now we can process the queries
        for (const [rxes, isense] of Object.entries(queries)) {
            for (const rx of strings(rxes)) {
                for (const match of [...text.matchAll(new RegExp(rx, 'gm'))]) {
                    if (match?.groups) {
                        // transform multi-line values into arrays
                        const data = {} as Record<string, any>;

                        for (let [variable, value] of Object.entries(match.groups)) {
                            value = value || '';
                            data[variable] = value.includes('\n') ?
                                value.split('\n').map(each => each.trim()).filter(each => each) :
                                value;
                        }

                        await this.applyToConfiguration(intellisenseConfiguration, isense, data);
                    }
                }
            }
        }
    }

    async runTasks(block: OneOrMore<string>, commandLineArgs: string[]) {
        for (const task of strings(block)) {
            switch (task) {
                case 'inline-environment-variables':
                    const CL = process.env.CL;
                    const _CL_ = process.env['_CL_'];
                    if (CL) {
                        commandLineArgs.push(...cmdlineToArray(CL));
                    }
                    if (_CL_) {
                        commandLineArgs.unshift(...cmdlineToArray(_CL_));
                    }
                    break;
                case 'inline-response-file':
                    // scan thru the command line arguments and look for @file
                    // and replace it with the contents of the file
                    for (let i = 0; i < commandLineArgs.length; i++) {
                        if (commandLineArgs[i].startsWith('@')) {
                            const file = commandLineArgs[i].slice(1);
                            const contents = await readFile(file, 'utf8');
                            commandLineArgs.splice(i, 1, ...cmdlineToArray(contents));
                        }
                    }
                    break;

                case 'consume-lib-path':

                    break;

                case 'remove-linker-arguments':
                    const link = commandLineArgs.findIndex(each => /^[\/-]link$/i.exec(each));
                    if (link !== -1) {
                        commandLineArgs.length = link; // drop it and all that follow
                    }
                    break;

                case 'zwCommandLineSwitch':
                    break;

                case 'experimentalModuleNegative':
                    break;

                case 'verifyIncludes':
                    break;
            }
        }
    }

    async processComamndLineArgs(block: Record<string, any>, commandLineArgs: string[], intellisenseConfiguration: IntelliSenseConfiguration, flags: Map<string, any>) {
        // get all the regular expressions and the results to apply
        let allEngineeredRegexes: [RegExp[], any][] = [];
        for (const [engineeredRx, result] of Object.entries(block)) {
            const rxes: RegExp[] = [];
            for (const rx of engineeredRx.split(';')) {
                rxes.push(new RegExp(await render(`^${rx}$`, {}, this.rxResolver)));

            }
            allEngineeredRegexes.push([rxes, result]);
        }
        const keptArgs = new Array<string>();

        nextArg:
        while (commandLineArgs.length) {
            nextRx:
            for (const [engineeredRegexSet, isense] of allEngineeredRegexes) {
                const capturedData = {};
                for (const result of engineeredRegexSet.map((rx, index) => rx.exec(commandLineArgs[index]))) {
                    if (result === null) {
                        continue nextRx; // something didn't match, we don't care.
                    }
                    if (result.groups) {
                        mergeObjects(capturedData, result.groups);
                    }
                }
                // now we can apply the results to the intellisenseConfiguration
                await this.applyToConfiguration(intellisenseConfiguration, isense, capturedData);

                // remove the args used from the command line
                const usedArgs = commandLineArgs.splice(0, engineeredRegexSet.length);

                // but if the no_consume flag set, we should keep the args in the KeptArgs list
                if (flags.get('no_consume')) {
                    // remove the arguments from the command line
                    keptArgs.push(...usedArgs);
                }
                continue nextArg;
            }

            // if we got here after running the expressions, we did not have a match.
            // so we can just assume that something else will look at them later
            keptArgs.push(commandLineArgs.shift()!);
        }
        return keptArgs;
    }

    async ensurePathsAreLegit(obj: Record<string, any>) {
        for (let [key, value] of Object.entries(obj)) {
            const k = key.toLowerCase();
            // if it's a *path(s), let's make sure they are real
            if (['path', 'paths', 'file', 'files'].find(each => k.endsWith(each))) {
                if (is.string(value)) {
                    // if we started with a string, let's check if it's a concatenated path first.
                    const values = value.split(delimiter);
                    if (values.length <= 1) {
                        obj[key] = await filepath.exists(render(value as string, {}, this.resolver)) || value;
                        continue;
                    }

                    // concatenated path (with delimiters)
                    value = values;
                }

                // if it's an array, let's check each value now.
                if (is.array(value)) {
                    obj[key] = [...new Set(await Promise.all(value.map(each => each && filepath.exists(render(each as string, {}, this.resolver)))))].filter(each => each);
                }
            }

            // if it's a nested object, let's recurse
            if (is.object(value)) {
                await this.ensurePathsAreLegit(value);
            }
        }
    }

    private async process(entries: Entries, compilerArgs: string[], intellisenseConfiguration: IntelliSenseConfiguration) {
        for (const { action, block, flags } of entries) {
            // If the flags specifies 'C' and the language is not 'c', then we should skip this section.
            if (flags.get('c') && !isC(intellisenseConfiguration.lanugage)) {
                continue;
            }

            // If the flags specifies 'c++' and the language is not 'c++', then we should skip this section.
            if (flags.get('cpp') || flags.get('c++') && !isCpp(intellisenseConfiguration.lanugage)) {
                continue;
            }

            switch (action) {
                case 'task':
                    await this.runTasks(block as unknown as OneOrMore<string>, compilerArgs /* , intellisenseConfiguration */);
                    break;

                case 'command':
                    // commandLineArguments
                    compilerArgs = await this.processComamndLineArgs(block, compilerArgs, intellisenseConfiguration, flags);
                    break;

                case 'quer':
                    for (const [command, queries] of Object.entries(block as Record<string, Record<string, DeepPartial<IntelliSenseConfiguration>>>)) {
                        await this.query(command, queries, intellisenseConfiguration);
                    }
                    break;

                case 'expression':
                    for (const [expr, isense] of Object.entries(block as Record<string, DeepPartial<IntelliSenseConfiguration>>)) {
                        if (await evaluateExpression(expr, intellisenseConfiguration, this.resolver)) {
                            await this.applyToConfiguration(intellisenseConfiguration, isense);
                        }
                    }
                    break;
                default:
                    break;
            }
        }
        return compilerArgs;
    }

    /**
     * Processes the analysis section of the definition file given a command line to work with
     */
    async getIntellisenseConfiguration(compilerArgs: string[], options?: { baseDirectory?: string; sourceFile?: string; language?: Language; standard?: CppStandard | CStandard; userIntellisenseConfiguration?: IntelliSenseConfiguration }): Promise<IntelliSenseConfiguration> {
        let entries: Entries = [];
        const userIntellisenseConfiguration = this.postProcessIntellisense(structuredClone(options?.userIntellisenseConfiguration ?? {}));

        // if we have an analysis section, we're going to need to get it ready
        if (this.definition.analysis) {
            entries = getActions<Record<string, IntelliSenseConfiguration>>(this.definition.analysis as any, [
                ['task', ['priority', 'c', 'cpp', 'c++']],
                ['command', ['priority', 'c', 'cpp', 'c++', 'no_consume']],
                ['quer', ['priority', 'c', 'cpp', 'c++']],
                ['expression', ['priority', 'c', 'cpp', 'c++']]
            ]);
        }

        const early = entries.filter(each => each.priority < 0);
        let intellisenseConfiguration = {
            ...this.definition.intellisense,
            language: options?.language,
            standard: options?.standard,
            compilerPath: this.compilerPath
        } as IntelliSenseConfiguration;

        // process the 'early' steps before we generate the cache key so that we can filter out useless args
        if (early.length) {
            compilerArgs = await this.process(early, compilerArgs, intellisenseConfiguration);
        }

        const late = entries.filter(each => each.priority >= 0);

        const cacheKey = compilerArgs.join(' ');
        const i = this.cachedAnalysis.get(cacheKey);
        if (i) {
            intellisenseConfiguration = structuredClone(i);
            // after getting the cached results, merge in user settings (which are not cached here)
            if (options?.userIntellisenseConfiguration) {
                await this.applyToConfiguration(intellisenseConfiguration, userIntellisenseConfiguration);

                // before we go, let's make sure that any *paths are unique, and that they are all absolute
                await this.ensurePathsAreLegit(intellisenseConfiguration);
            }

            return intellisenseConfiguration;
        }

        // (late) Analysis phase
        compilerArgs = await this.process(late, compilerArgs, intellisenseConfiguration);

        // before we go, let's make sure that any *paths are unique, and that they are all absolute
        await this.ensurePathsAreLegit(intellisenseConfiguration);

        // render any variables that are left (if therer are value that are specified explicity in definition that reference variables, this is when they get resolved)
        intellisenseConfiguration = await recursiveRender(intellisenseConfiguration, intellisenseConfiguration, this.resolver);

        // cache the results
        this.cachedAnalysis.set(cacheKey, intellisenseConfiguration);
        void persistToolsetData();

        intellisenseConfiguration = structuredClone(intellisenseConfiguration);
        this.postProcessIntellisense(intellisenseConfiguration);

        // after the cached results, merge in user settings (since the user can change those at any time)
        if (options?.userIntellisenseConfiguration) {
            await this.applyToConfiguration(intellisenseConfiguration, userIntellisenseConfiguration);

            // before we go, let's make sure that any *paths are unique, and that they are all absolute
            await this.ensurePathsAreLegit(intellisenseConfiguration);
        }

        /// this.postProcessIntellisense(intellisenseConfiguration);

        return intellisenseConfiguration;
    }

    /** the final steps to producing the parser args for EDG */
    postProcessIntellisense(intellisense: IntelliSense) {
        const args = [];
        // turn the macros into -D flags
        if (intellisense.macro) {
            for (const [name, value] of Object.entries(intellisense.macro)) {
                args.push(`-D${name}=${value}`);
            }
        }

        // generate the two sets of include paths that EDG supports:
        // --inlcude_directory and --sys_include
        for (const each of intellisense.path?.builtInInclude ?? []) {
            args.push('--sys_include', each);
            /// args.push(`-I${each}`);
        }

        for (const each of intellisense.path?.systemInclude ?? []) {
            args.push('--sys_include', each);
        }
        for (const each of intellisense.path?.externalInclude ?? []) {
            args.push('--sys_include', each);
        }

        for (const each of intellisense.path?.include ?? []) {
            args.push('--include_directory', each);
        }

        for (const each of intellisense.path?.environmentInclude ?? []) {
            args.push('--include_directory', each);
        }

        intellisense.parserArgument = strings(intellisense.parserArgument).concat(args);
        intellisense.queryArgument = undefined;

        return intellisense;
    }

}
