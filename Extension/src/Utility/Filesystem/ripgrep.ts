/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { strict } from 'assert';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { isWindows } from '../../constants';
import { accumulator } from '../Async/iterators';
import { Process } from '../Process/process';
import { ProcessFunction, Program } from '../Process/program';
import { is } from '../System/guards';
import { Instance } from '../System/types';
import { verbose } from '../Text/streams';
import { downloadRipgrep } from './downloadRipgrep';
import { filepath } from './filepath';

let ripgrep: Instance<ProcessFunction>;
async function setRipgrepBinaryLocation(filename: string) {
    if (!ripgrep) {
        const rg = await filepath.isExecutable(filename);
        strict(rg, `File ${filename} is not executable`);
        verbose(`Using ripgrep at'${filename}'`);
        ripgrep = await new Program(filename);
    }
    return ripgrep;
}

export async function autoInitializeRipGrep() {
    if (!ripgrep) {
        try {
        // if we're in vscode and it thas a copy of ripgrep, let's use that
            const p = process as any;
            if (p.resourcesPath) {
                // if we're running in vscode, this will be there. If it isn't it's not likely that vscode itself is working correctly.
                return setRipgrepBinaryLocation(resolve((process as any).resourcesPath, `app/node_modules.asar.unpacked/@vscode/ripgrep/bin/rg${isWindows ? '.exe' : ''}`));
            }
        } catch {
            // ignore, move on.
        }

        // if we get here it might be because we're in a WSL or Remote vscode session,
        // and the remote host is a bit different than a local instance of vscode.
        // The vscode/ripgrep package should be in the node_modules folder, which means we can use it to find the ripgrep binary that it has.
        // let's see if @vscode/ripgrep is installed
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const vs_rg = require('@vscode/ripgrep');
            if (vs_rg) {
                return setRipgrepBinaryLocation(vs_rg);
            }
        } catch {
            // ignore, move on
        }

        // if we get here, ripgrep isn't installed for us and we don't appear to have the @vscode/ripgrep package
        // we can call the downloadRipgrep function (which was borrowed from the @vscode/ripgrep package)
        // this is a last resort, and should never happen in production, but could be necessary in development or CI or unit testing.
        return setRipgrepBinaryLocation(await downloadRipgrep());
    }
}
const initialization = autoInitializeRipGrep();

export async function fastFind(fileGlobs: string | string[], locations: string | string[], depth = 20): Promise<string[]> {
    depth++;
    fileGlobs = is.array(fileGlobs) ? fileGlobs : [fileGlobs];
    locations = is.array(locations) ? locations : [locations];

    fileGlobs.map(glob => glob.includes('**') ? glob : `**/${glob}`);
    locations = locations.filter(each => existsSync(each.toString()));
    const results = new Set<string>();

    if (fileGlobs.length && locations.length) {
        try {
            const proc = await ripgrep(...fileGlobs.map(each => ['--glob', each]).flat(), '--max-depth', depth, '--null-data', '--no-messages', '-L', '--files', ...locations.map(each => each.toString()));
            for await (const line of proc.stdio) {
                results.add(line);
            }
        } catch {
            // ignore
        }
    }

    return [...results];
}

export class FastFinder implements AsyncIterable<string> {
    private keepOnlyExecutables: boolean;
    private executableExtensions = new Array<string>();
    private processes = new Array<Instance<Process>>();
    private pending = 0;
    private readyToComplete = false;
    private distinct = new Set<string>();

    #files = accumulator<string>().autoComplete(false);

    [Symbol.asyncIterator](): AsyncIterator<string> {
        this.readyToComplete = true;
        if (this.pending === 0) {
            this.#files.complete();
        }

        return this.#files[Symbol.asyncIterator]();
    }

    constructor(private fileGlobs: string[], options?: { executable?: boolean; executableExtensions?: string[] }) {
        this.keepOnlyExecutables = options?.executable ?? false;
        if (this.keepOnlyExecutables && process.platform === 'win32') {
            this.executableExtensions = options?.executableExtensions ?? ['.exe', '.bat', '.cmd', '.ps1'];
        }
    }

    /**
     * Add one or more locations to scan, with an optionally specified depth.
     *
     * The scanning of those locations begins immediately and is done asynchronously.
     *
     */
    scan(...location: string[]): FastFinder;
    scan(depth: number, ...location: string[]): FastFinder;
    scan(...location: (string | number)[]): FastFinder {
        const depth = (typeof location[0] === 'number' ? location.shift() as number : 0) + 1;
        const globs = this.executableExtensions.length ?
            this.fileGlobs.map(glob => this.executableExtensions.map(ext => glob.includes('**') ? glob : `**/${glob}${ext}`)).flat() :
            this.fileGlobs.map(glob => glob.includes('**') ? glob : `**/${glob}`);

        // only search locations that exist
        location = location.filter(each => existsSync(each.toString()));

        // only search if there are globs and locations to search
        if (globs.length && location.length) {
            this.pending++;
            void initialization.then(async () => {
                try {
                    const proc = await ripgrep(...globs.map(each => ['--glob', each]).flat(), '--max-depth', depth, '--null-data', '--no-messages', '-L', '--files', ...location.map(each => each.toString()));

                    const process = proc as unknown as Instance<Process>;
                    this.processes.push(process);
                    for await (const line of process.stdio) {
                        if (this.distinct.has(line)) {
                            continue;
                        }
                        this.distinct.add(line);
                        if (!this.keepOnlyExecutables || await filepath.isExecutable(line)) {
                            this.#files.add(line);
                        }
                    }
                } catch (e) {
                    console.log(e);
                } finally {
                    this.pending--;
                    if (this.readyToComplete && this.pending === 0) {
                        this.#files.complete();
                    }
                }

            });
        }
        return this;
    }
}

interface MatchData {
    path: {
        text: string;
    };
    lines: {
        text: string;
    };
    line_number: number;
    absolute_offset: number;
    submatches: unknown[];
}

interface RipGrepMatch {
    type: 'match';
    data: MatchData;
}

function isMatch(obj: Record<string, any>): obj is RipGrepMatch {
    return obj.type === 'match' && obj.data.path && obj.data.lines;
}

/** Calls RipGrep looking for strings */
export async function* ripGrep(target: string, regex: string, options?: { glob?: string; binary?: boolean; encoding?: 'utf-16' | 'utf-8'; ignoreCase?: boolean }): AsyncGenerator<MatchData> {
    await initialization;

    const optionalArguments = new Array<string>();
    if (options?.binary) {
        optionalArguments.push('--binary');
    }
    if (options?.encoding) {
        optionalArguments.push('-E', options.encoding);
    }
    if (options?.glob) {
        optionalArguments.push('--iglob', options.glob);
    }
    if (options?.ignoreCase) {
        optionalArguments.push('--ignore-case');
    }
    regex = regex.replace(/\?\</g, '\?P<');
    const proc = await ripgrep(regex, '--null-data', '--json', '--no-messages', ...optionalArguments, target);

    for await (const line of proc.stdio) {
        try {
            const obj = JSON.parse(line);
            if (isMatch(obj)) {
                yield obj.data;
            }
        } catch {
            // skip deserialization errors.
        }
    }
}
