/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-dynamic-delete */

import { parse as parseJson } from 'comment-json';
import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { accumulator } from '../../Utility/Async/iterators';
import { AsyncMap } from '../../Utility/Async/map';
import { FastFinder } from '../../Utility/Filesystem/ripgrep';
import { is } from '../../Utility/System/guards';
import { CustomResolver, evaluateExpression } from '../../Utility/Text/taggedLiteral';
import { DeepPartial, DefinitionFile, IntelliSense, IntelliSenseConfiguration, PartialDefinitionFile, PkgMgr } from '../interfaces';
import { strings } from '../strings';
import { mergeObjects } from './objectMerge';

// iterates recursively over the parsed data and transform all the keys that are just
// identifiers and dots into nested objects
function transform(obj: any): any {
    if (typeof obj === 'object' && obj !== null) {
        for (const [key, value] of Object.entries(obj)) {
            if (is.string(key) && /^[a-zA-Z0-9\$._]+$/.test(key)) {
                const parts = key.split('.');
                if (parts.length > 1) {
                    const first = parts.shift()!;
                    if (!obj[first]) {
                        obj[first] = {};
                    }
                    obj[first][parts.join('.')] = value;
                    transform(obj[first]);
                    delete obj[key];
                }
            }
            transform(value);
        }
    }
    return obj;
}

function parse(text: string) {
    try {
        return transform(parseJson(text));
    } catch (e: any) {
        if (e.message) {
            console.error(e.message);
        }
    }
    return undefined;
}

function isToolsetDefinition(definition: any): definition is DefinitionFile {
    // stub for now - we can add a schema validator once we're sure the schema is stable
    return true;
}

function isPartialToolsetDefinition(definition: any): definition is DefinitionFile {
    // stub for now - we can add a schema validator once we're sure the schema is stable
    return true;
}

const compilerDefintions = new AsyncMap<string, DefinitionFile>();
const partialDefinitions = new AsyncMap<string, PartialDefinitionFile>();

export function formatIntelliSenseBlock<T extends DeepPartial<IntelliSenseConfiguration> | DeepPartial<IntelliSense>>(intellisense?: T): T {
    if (!intellisense) {
        return {} as T;
    }
    const i = intellisense.include = intellisense.include || {};

    // expand out the include paths
    i.quotePaths = strings(i.quotePaths);
    i.paths = strings(i.paths);
    i.systemPaths = strings(i.systemPaths);
    i.builtInPaths = strings(i.builtInPaths);
    i.afterPaths = strings(i.afterPaths);
    i.externalPaths = strings(i.externalPaths);
    i.frameworkPaths = strings(i.frameworkPaths);
    i.environmentPaths = strings(i.environmentPaths);

    intellisense.forcedIncludeFiles = strings(intellisense.forcedIncludeFiles);

    intellisense.frameworkPaths = strings(intellisense.frameworkPaths);
    intellisense.parserArguments = strings(intellisense.parserArguments);
    intellisense.compilerArgs = strings(intellisense.compilerArgs);
    intellisense.macros = intellisense.macros || {};

    for (const [key, value] of Object.entries(intellisense)) {
        if (key.startsWith('message') || key.startsWith('remove')) {
            // replace with strings array
            (intellisense as any)[key] = strings(value);
        }
    }

    return intellisense;
}

/** coerce the collections from OneOrMore<*> to Array<*> in the defintion  */
function formatDefinitionBlock(definition: DefinitionFile) {

    // definition.intellisense.* members
    formatIntelliSenseBlock(definition.intellisense);

    // definition.package.* = strings(definition.package.*);
    if (definition.package) {
        for (const key of Object.keys(definition.package)) {
            definition.package[key as PkgMgr] = strings(definition.package[key as PkgMgr]);
        }
    }

    // definition.analysis.* members
    if (definition.analysis) {
        for (const [key, value] of Object.entries(definition.analysis)) {
            if (key.startsWith('task')) {
                // replace with strings array
                (definition.analysis as any)[key] = strings(value);
            }
        }
    }

    if (definition.discover) {
        definition.discover.binary = strings(definition.discover.binary);
        definition.discover.locations = strings(definition.discover.locations);
    }
}

async function loadDefinition(definitionFile: string): Promise<DefinitionFile | undefined> {
    return compilerDefintions.getOrAdd(definitionFile, async () => {
        try {
            const definition = parse(await readFile(definitionFile, 'utf8'));
            if (!isToolsetDefinition(definition)) {
                console.error(`The definition file ${definitionFile} is not a valid toolset definition.`);
                return;
            }
            formatDefinitionBlock(definition);
            if (definition.import) {
                const files = strings(definition.import);
                for (const file of files) {
                // there should be a partial definition file that matches this expression
                    const partialFile = resolve(dirname(definitionFile), file);
                    await loadPartialDefinition(partialFile);

                    if (partialDefinitions.has(partialFile)) {
                        const partial = partialDefinitions.get(partialFile)!;
                        if (!isPartialToolsetDefinition(partial)) {
                            continue;
                        }
                        mergeObjects(definition, partial);
                        formatDefinitionBlock(definition);
                    }
                }
            }

            if (definition.conditions) {
            // eslint-disable-next-line prefer-const
                for (let [expression, part] of Object.entries(definition.conditions)) {
                    if (is.string(part) || is.array(part)) {
                        const files = strings(part);
                        part = {};
                        for (const file of files) {
                        // there should be a partial definition file that matches this expression
                            const partialFile = resolve(dirname(definitionFile), file);
                            await loadPartialDefinition(partialFile);

                            if (partialDefinitions.has(partialFile)) {
                                const partial = partialDefinitions.get(partialFile)!;
                                if (!isPartialToolsetDefinition(partial)) {
                                    continue;
                                }
                                mergeObjects(part, partial);
                                formatDefinitionBlock(definition);
                            }
                        }
                    }
                    if (isPartialToolsetDefinition(part)) {
                    // replace the location with the contents
                        definition.conditions[expression] = part;
                    }
                }
            }
            compilerDefintions.set(definitionFile, definition);
            return definition;
        } catch (e: any) {
            if (e.message) {
                console.warn(`Error loading compiler definition file: ${definitionFile} - ${e.message}`);
            }
        }
        compilerDefintions.delete(definitionFile);
        return undefined;
    });
}

async function loadPartialDefinition(definitionFile: string) {
    if (!partialDefinitions.has(definitionFile)) {
        const definition = parse(await readFile(definitionFile, 'utf8'));
        if (!isPartialToolsetDefinition(definition)) {
            console.error(`Error loading partial compiler definition file: ${definitionFile} - Invalid definition file.`);
            return;
        }

        if (definition.import) {
            const files = strings(definition.import);
            for (const file of files) {
                // there should be a partial definition file that matches this expression
                const partialFile = resolve(dirname(definitionFile), file);
                await loadPartialDefinition(partialFile);

                if (partialDefinitions.has(partialFile)) {
                    const partial = partialDefinitions.get(partialFile)!;
                    if (!isPartialToolsetDefinition(partial)) {
                        continue;
                    }
                    mergeObjects(definition, partial);
                    formatDefinitionBlock(definition);
                }
            }
        }

        partialDefinitions.set(definitionFile, definition);
    }
}
export function resetCompilerDefinitions() {
    compilerDefintions.clear();
    partialDefinitions.clear();
}

export async function* loadCompilerDefinitions(configurationFolders: Set<string>): AsyncIterable<DefinitionFile> {
    // find all the definition files in the specified configuration folders.
    const result = accumulator<DefinitionFile>();
    const definitionFiles = new FastFinder(['toolset.*.json']).scan(...configurationFolders);
    const all = [];
    for await (const file of definitionFiles) {
        all.push(loadDefinition(file).then(each => result.add(each)));
    }
    void Promise.all(all).then(() => result.complete());

    yield* result;
}

export async function runConditions(definition: DefinitionFile, resolver: CustomResolver): Promise<boolean> {
    let conditionsRan = false;
    if (definition.conditions) {
        for (const [expression, part] of Object.entries(definition.conditions)) {
            if (await evaluateExpression(expression, definition, resolver)) {
                // the condition is true!
                // which means something changed...
                conditionsRan = true;

                // remove the condition from the definition so we don't re-run it
                delete definition.conditions[expression];

                // merge the part into the main document
                mergeObjects(definition, part as any);
                formatDefinitionBlock(definition);

                // we should also run the conditions again, in case the new definition has more conditions
                await runConditions(definition, resolver);
            }
        }
        return conditionsRan;
    }
    return false;
}
