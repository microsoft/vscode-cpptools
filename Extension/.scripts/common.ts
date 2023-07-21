/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */


import { Command, CommandFunction } from '../src/Utility/Process/program';

import { ok } from 'assert';
import { mkdir as md, readFile, rm, writeFile } from 'fs/promises';
import { IOptions, glob as globSync } from 'glob';
import { dirname, resolve } from 'path';
import { chdir } from 'process';
import { setImmediate } from 'timers/promises';
import { promisify } from 'util';
import { path } from '../src/Utility/Filesystem/path';
import { is } from '../src/Utility/System/guards';
import { verbose } from '../src/Utility/Text/streams';
export const $root = resolve(`${__dirname}/..`);
export const $cmd = process.argv.slice(2).find( each => !each.startsWith('--')) ?? 'main'
export const $args = process.argv.slice(3);

/** enqueue the call to the callback function to happen on the next available tick, and return a promise to the result */
export function then<T>(callback: () => Promise<T>|T): Promise<T> {
    return setImmediate().then(callback);
}


// ensure we're in the extension folder.
chdir($root);

// dump unhandled async errors to the console and exit.
process.on('unhandledRejection', (reason: any, p) => {
    console.log(`${reason.stack.split(/\r?\n/).filter(l => !l.includes('node:internal') && !l.includes('node_modules') ).join('\n')}`);
    process.exit(1);
});

const git = new Command('git');
export const Git = async (...args :Parameters<Awaited<CommandFunction>>) => (await git)(...args);
export const GitClean = async (...args :Parameters<Awaited<CommandFunction>>) => (await new Command(await git, 'clean'))(...args);

export async function getModifiedIgnoredFiles() {
    const {code, error, stdio } = await GitClean('-Xd', '-n');
    if( code ) {
        throw new Error(`\n${error.all().join('\n')}`)
    }
    
    // return the full path of files that would be removed.
    return Promise.all(stdio.filter("Would remove").map( (s) => path.exists(s.replace(/^Would remove /,''),$root)).filter(p=>p));
}

export async function rimraf(...paths: string[]) {
    const all = [];
    for( const each of paths) {
        if(await path.isFolder(each)) {
            verbose(`Removing folder ${each}`);
            all.push(rm(each, {recursive: true, force: true}));
            continue;
        }
        verbose(`Removing file ${each}`);
        all.push(await rm(each, {force: true}));
    }
    await Promise.all(all);
}
export async function mkdir(filePath:string) {
    const [fullPath, info] = await path.stats(filePath,$root);
    if( info ) {
        if( info.isDirectory() ) {
            return fullPath;
        }
        throw new Error(`Cannot create directory '${filePath}' because thre is a file there.`);
    }
    
    await md(fullPath, { recursive: true })
    return fullPath;
}

export const glob: (pattern: string, options?: IOptions | undefined) => Promise<string[]> = promisify(globSync)

export async function write( filePath: string, data: Buffer|string) {
    await mkdir(dirname(filePath));

    if(await path.isFile(filePath)) {
        const content = await readFile(filePath);
        if (is.string(data)) {
            // if we're passed a text file, we should match the line endings of the existing file.
            const textContent = content.toString();

            // normalize the line endings to the same as the current file. 
            data = textContent.indexOf('\r\n') > -1 ? data.replace(/\r\n|\n/g,'\r\n') :  data.replace(/\r\n|\n/g,'\n');

            // if the text content is a match, we don't have to change anything
            if (textContent === data ) {
                verbose(`Text file at '${filePath}' is up to date.`);
                return;    
            }
        } else {
            // if the binary content is a match, we don't have to change anything
            if( content.equals(data)) {
                verbose(`File at '${filePath}' is up to date.`);
                return;
            }
        }
    }

    verbose(`Writing file '${filePath}'`);
    await writeFile(filePath, data);
}

export async function updateFiles( files: string[], dest: string| Promise<string>) {
    const target = is.promise(dest) ? await dest : dest;
    await Promise.all(files.map( async (each) => {
        const sourceFile = await path.isFile(each,$root);
        if( sourceFile ) {
            const targetFile = resolve(target, each);
            await write(targetFile,await readFile(sourceFile));
        }
    }));
}
export async function go() {
    if( require.main ) {
        verbose(`Running task: ${$cmd} ${$args.join(' ')}`);
        require.main.exports[$cmd](...$args);
    }
}
then(go);

export async function read(filename: string ) {
    const content = await readFile(filename);
    ok(content,`File '${filename}' has no content`);
    return content.toString();
}
