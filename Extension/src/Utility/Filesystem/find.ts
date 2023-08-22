/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/unified-signatures */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { Dirent, constants } from 'fs';
import { readdir, stat } from 'fs/promises';
import { basename, extname, sep } from 'path';
import { isWindows } from '../../constants';
import { accumulator, foreach } from '../Async/iterators';
import { ManualPromise } from '../Async/manualPromise';
import { returns } from '../Async/returns';
import { is } from '../System/guards';
import { File, Folder, normalize } from './filepath';

interface FolderWithChildren extends Folder {
    children?: Map<string, File | FolderWithChildren>;
}

const cache = new Map<string, File | FolderWithChildren | Promise<FolderWithChildren | undefined>>();

/**
 * This reads a directory and returns a map of the files and folders in it
 * It is quite tolerant of errors and reentrancy, so if multiple callers are trying to get the same results
 * it will only do the work once per directory
 *
 * @param fullPath the full path of the folder to read
 * @param executableExtensions  a set of file extensions that are considered executable on Windows
 * @returns a map of the files and folders in the directory, or undefined if the directory doesn't exist or is inaccessible.
 */
async function readDirectory(fullPath: string, executableExtensions: Set<string> = process.platform === 'win32' ? new Set(['.exe'/* ,'.cmd','.bat' */]) : new Set()): Promise<Map<string, File | FolderWithChildren> | undefined> {
    // have we already read this directory?
    let folder = cache.get(fullPath) as FolderWithChildren | undefined;
    let promise: ManualPromise<FolderWithChildren | undefined> | undefined;

    if (!folder) {
        // create a promise and insert it into the cache, so if something else comes looking before we do any async, they can await that
        promise = new ManualPromise<FolderWithChildren | undefined>();
        cache.set(fullPath, promise);

        const stats = await stat(fullPath).catch(returns.undefined);

        if (!stats?.isDirectory()) {
            // no results, return undefined.
            promise.resolve(folder);
            return undefined;
        }

        folder = {
            name: basename(fullPath),
            fullPath,
            isFolder: true,
            isFile: false,
            isLink: stats.isSymbolicLink()
        } as FolderWithChildren;
    }

    // if we are waiting on a promise
    if (is.promise(folder)) {
        folder = await folder;
    }

    // if the target isn't a folder, it can't have children
    if (!folder?.isFolder) {
        return undefined;
    }

    // if we haven't scanned this folder yet, do so now.
    if (!folder.children) {
        folder.children = new Map();

        if (!is.promise(promise)) {
            // if we didn't already have a promise, create one now.
            // this can happen when the parent has scanned and added in the child but nobody has asked for the children yet.
            promise = new ManualPromise<FolderWithChildren | undefined>();
            cache.set(fullPath, promise);
        }

        // this doesn't use the path.info function because in this case, the direntry is already available, and on Windows we can skip a call to stat (which is expensive)
        // process all the entries, and add them to the cache and the children map
        await foreach(readdir(fullPath, { withFileTypes: true }).catch(returns.none), async (direntry: Dirent) => {
            const name = direntry.name;
            const fp = `${fullPath}${sep}${name}`;
            if (cache.has(fp)) {
                return;
            }
            // create the entry
            const entry = {
                name,
                fullPath: fp,
                isFolder: direntry.isDirectory(),
                isFile: direntry.isFile(),
                isLink: direntry.isSymbolicLink()
            } as File | FolderWithChildren;

            if (entry.isFile) {
                if (isWindows) {
                    entry.extension = extname(name.toLowerCase());
                    entry.isExecutable = executableExtensions.has(entry.extension);
                    entry.basename = basename(name, entry.extension);
                } else {
                    entry.basename = basename(name);
                    // in non-Windows platforms, we need to check the file mode to see if it's executable.
                    const stats = await stat(entry.fullPath).catch(returns.undefined);
                    if (!stats) {
                        return;
                    }
                    // eslint-disable-next-line no-bitwise
                    entry.isExecutable = !!(stats.mode & (constants.S_IXUSR | constants.S_IXGRP | constants.S_IXOTH));
                    entry.extension = extname(name);
                }
            }

            // attach the child to the parent
            (folder as FolderWithChildren).children!.set(name, entry);

            // keep the child in the cache too.
            cache.set(entry.fullPath, entry);

        });
        cache.set(fullPath, folder as FolderWithChildren);
        if (!promise!.isResolved) {
            promise!.resolve(folder as FolderWithChildren);
        }

    }
    return folder.children;
}

export async function scanFolder(folder: string, scanDepth: number, filePredicate?: (file: File) => Promise<boolean> | boolean, folderPredicate?: (folder: FolderWithChildren) => Promise<boolean> | boolean, files = accumulator<string>()): Promise<void> {
    // should not have depth less than 0
    if (scanDepth < 0) {
        return;
    }

    // normalize the folder
    folder = normalize(folder);

    // if we have already visited this folder, return
    await foreach(readDirectory(folder), async ([_name, entry]) => {
        if (entry.isFile) {
            if (!filePredicate || await filePredicate(entry)) {
                files.add(entry.fullPath);
            }
            return;
        }
        if (scanDepth && entry.isFolder && (!folderPredicate || await folderPredicate(entry))) {
            await scanFolder(entry.fullPath, scanDepth - 1, filePredicate, folderPredicate, files);
        }
    });
}

/** The Finder searches paths to find executable given a name or regular expression.
 *
 * It can scan multiple paths, and can be configured to exclude folders.
 * It can also scan into subfolders of the given folders to a specified depth.
 *
 */
export class Finder implements AsyncIterable<string> {
    #excludedFolders = new Set<string | RegExp>(['winsxs', 'syswow64', 'system32']);
    #files = accumulator<string>().autoComplete(false);
    files = this.#files.reiterable();

    private match: (file: File) => Promise<boolean> | boolean;
    private promises = new Array<Promise<void>>();

    constructor(executableName: string);
    constructor(executableRegEx: RegExp);
    constructor(fileMatcher: (file: File) => Promise<boolean> | boolean);
    constructor(binary: string | RegExp | ((file: File) => Promise<boolean> | boolean)) {
        switch (typeof binary) {
            case 'string':
                this.match = (file: File) => file.isExecutable && file.basename === binary;
                break;
            case 'function':
                this.match = binary;
                break;
            case 'object':
                this.match = (file: File) => file.isExecutable && !!file.basename.match(binary);
                break;
        }
    }

    static resetCache() {
        cache.clear();
    }

    exclude(folder: string) {
        this.#excludedFolders.add(folder);
    }

    /**
     * Add one or more locations to scan, with an optionally specified depth.
     *
     * The scanning of those locations begins immediately and is done asynchronously.
     *
     */
    scan(...location: (Promise<string> | string)[]): Finder;
    scan(depth: number, ...location: (Promise<string> | string)[]): Finder;
    scan(...location: (Promise<string> | string | number)[]): Finder {
        const depth = typeof location[0] === 'number' ? location.shift() as number : 0;
        this.promises.push(...location.map(each => scanFolder(each.toString(), depth, this.match, (f) => !this.#excludedFolders.has(f.name), this.#files)));
        return this;
    }

    [Symbol.asyncIterator](): AsyncIterator<string> {
        this.#files.complete();
        return this.#files[Symbol.asyncIterator]();
    }

    get results(): Promise<Set<string>> {
        return Promise.all(this.promises).then(async () => {
            const result = new Set<string>();
            for await (const file of this) {
                result.add(file);
            }
            return result;
        });
    }
}
