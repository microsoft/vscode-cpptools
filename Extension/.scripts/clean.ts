/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */


import { resolve, sep } from 'node:path';
import { filepath } from '../src/Utility/Filesystem/filepath';
import { verbose } from '../src/Utility/Text/streams';
import { $root, getModifiedIgnoredFiles, rimraf } from './common';

// list all gitignore'd files that are modified git clean -Xd -n 
// list all untracked and ignored files that are modified/created git clean -Xd -n 

export async function main() {
    await rimraf(resolve($root,'dist'));
}

export async function all() {
    await rimraf(...(await getModifiedIgnoredFiles()).filter( each => !each.includes('node_modules')));
}

export async function reset() {
    verbose( `Resetting all .gitignored files in extension`);
    await rimraf(...await getModifiedIgnoredFiles());
}

export async function show() {
    console.log('Untracked+Ignored files:')
    const files = await getModifiedIgnoredFiles();
    let all  = await Promise.all(files.map( async (each) => {
        const [filename, stats ] = await filepath.stats(each);
        return { 
            filename: stats.isDirectory() ? `${each}${sep}**` : each,
            date: stats.mtime.toLocaleDateString().replace(/\b(\d)\//g,'0$1\/'),
            time: stats.mtime.toLocaleTimeString().replace(/^(\d)\:/g,'0$1:'),
            modified: stats.mtime
        }
    }));
    all = all.sort( (a,b) => a.modified.getTime() - b.modified.getTime())
    // print a formatted table so the date and time are aligned
    const max = all.reduce( (max, each) => Math.max(max, each.filename.length), 0);
    all.forEach( each => console.log(`  ${each.filename.padEnd(max)}  [${each.date} ${each.time}]`));
    
}
