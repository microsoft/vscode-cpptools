/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { error } from 'node:console';
import { resolve, sep } from 'node:path';
import { filepath } from '../src/Utility/Filesystem/filepath';
import { verbose } from '../src/Utility/Text/streams';
import { $root, Git, brightGreen, cyan, getModifiedIgnoredFiles, rimraf } from './common';

// notes:
// list all gitignore'd files that are modified: `git clean -Xd -n`
// list all untracked and ignored files that are modified/created: `git clean -Xd -n`

export async function main() {
    await rimraf(resolve($root, 'dist'));
}

export async function all() {
    await rimraf(...(await getModifiedIgnoredFiles()).filter((each): each is string => each !== undefined && !each.includes('node_modules')));
}

export async function reset() {
    verbose(`Resetting all .gitignored files in extension`);
    await rimraf(...(await getModifiedIgnoredFiles()).filter((each): each is string => each !== undefined));
}

async function details(files: string[]) {
    const results = await Promise.all(files.filter(each => each).map(async (each) => {
        const [, stats] = await filepath.stats(each);
        if (!stats) {
            return null;
        }
        return {
            filename: stats.isDirectory() ? cyan(`${each}${sep}**`) : brightGreen(`${each}`),
            date: stats.mtime.toLocaleDateString().replace(/\b(\d)\//g, '0$1\/'),
            time: stats.mtime.toLocaleTimeString().replace(/^(\d)\:/g, '0$1:'),
            modified: stats.mtime
        };
    }));
    let all = results.filter((each): each is NonNullable<typeof each> => each !== null);
    all = all.sort((a, b) => a.modified.getTime() - b.modified.getTime());
    // print a formatted table so the date and time are aligned
    const max = all.reduce((max, each) => Math.max(max, each.filename.length), 0);
    all.forEach(each => console.log(`  ${each.filename.padEnd(max)}  [${each.date} ${each.time}]`));
    console.log('');
}

export async function show(opt?: string) {
    switch (opt?.toLowerCase()) {
        case 'new':
            console.log(cyan('\n\nNew files:'));
            const r = await Git('ls-files', '--others', '--exclude-standard', '-z');
            return details(r.stdio.all().map(each => resolve(each.trim().replace(/\0/g, ''))));

        case undefined:
        case '':
        case 'ignored':
        case 'untracked':
            console.log(cyan('\n\nUntracked+Ignored files:'));
            return details((await getModifiedIgnoredFiles()).filter((each): each is string => each !== undefined));

        default:
            return error(`Unknown option '${opt}'`);
    }
}
