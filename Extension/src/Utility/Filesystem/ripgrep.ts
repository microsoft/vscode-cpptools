/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { strict } from 'assert';
import { existsSync } from 'fs';
import { accumulator } from '../Async/iterators';
import { logAndReturn } from '../Async/returns';
import { Process } from '../Process/process';
import { ProcessFunction, Program } from '../Process/program';
import { Instance } from '../System/types';
import { filepath } from './filepath';

let ripgrep: Instance<ProcessFunction> | undefined;
export async function initRipGrep(filename: string) {
    if (!ripgrep) {
        const rg = await filepath.isExecutable(filename);
        strict(rg, `File ${filename} is not executable`);
        ripgrep = await new Program(filename);
    }
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
        strict(ripgrep, 'initRipGrep must be called before using FastFinder');

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
            void ripgrep!(...globs.map(each => ['--glob', each]).flat(), '--max-depth', depth, '--null-data', '--no-messages', '-L', '--files', ...location.map(each => each.toString())).then(async proc => {
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
            }).catch(logAndReturn.undefined).finally(() => {
                this.pending--;
                if (this.readyToComplete && this.pending === 0) {
                    this.#files.complete();
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
    strict(ripgrep, 'initRipGrep must be called before using ripGrep');

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
