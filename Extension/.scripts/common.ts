/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Command, CommandFunction } from '../src/Utility/Process/program';

import { ok } from 'assert';
import { CommentJSONValue, parse, stringify } from 'comment-json';
import { mkdir as md, readFile, rm, writeFile } from 'fs/promises';
import { IOptions, glob as globSync } from 'glob';
import { dirname, resolve } from 'path';
import { chdir, cwd, env } from 'process';
import { setImmediate } from 'timers/promises';
import { promisify } from 'util';
import { filepath } from '../src/Utility/Filesystem/filepath';
import { is } from '../src/Utility/System/guards';
import { verbose } from '../src/Utility/Text/streams';

export const $root = resolve(`${__dirname}/..`);
export let $cmd = 'main';
export let $scenario = '';

// loop through the args and pick out --scenario=... and remove it from the $args and set $scenario
process.argv.slice(2).filter(each => !(each.startsWith('--scenario=') && ($scenario = each.substring('--scenario='.length))));
export const $args = process.argv.slice(2).filter(each => !each.startsWith('--'));
export const $switches = process.argv.slice(2).filter(each => each.startsWith('--'));

/** enqueue the call to the callback function to happen on the next available tick, and return a promise to the result */
export function then<T>(callback: () => Promise<T> | T): Promise<T> {
    return setImmediate().then(callback);
}

export const pwd = env.INIT_CWD ?? cwd();
verbose(yellow(`pwd: ${pwd}`));

// ensure we're in the extension folder.
chdir($root);

// dump unhandled async errors to the console and exit.
process.on('unhandledRejection', (reason: any, _promise) => {
    error(`${reason?.stack?.split(/\r?\n/).filter(l => !l.includes('node:internal') && !l.includes('node_modules')).join('\n')}`);
    process.exit(1);
});

const git = new Command('git');
export const Git = async (...args: Parameters<Awaited<CommandFunction>>) => (await git)(...args);
export const GitClean = async (...args: Parameters<Awaited<CommandFunction>>) => (await new Command(await git, 'clean'))(...args);

export async function getModifiedIgnoredFiles() {
    const {code, error, stdio } = await GitClean('-Xd', '-n');
    if (code) {
        throw new Error(`\n${error.all().join('\n')}`);
    }

    // return the full path of files that would be removed.
    return Promise.all(stdio.filter("Would remove").map((s) => filepath.exists(s.replace(/^Would remove /, ''), $root)).filter(p => p));
}

export async function rimraf(...paths: string[]) {
    const all = [];
    for (const each of paths) {
        if (!each) {
            continue;
        }
        if (await filepath.isFolder(each)) {
            verbose(`Removing folder ${red(each)}`);
            all.push(rm(each, {recursive: true, force: true}));
            continue;
        }
        verbose(`Removing file ${red(each)}`);
        all.push(rm(each, {force: true}));
    }
    await Promise.all(all);
}

export async function mkdir(filePath: string) {
    const [fullPath, info] = await filepath.stats(filePath, $root);
    if (info) {
        if (info.isDirectory()) {
            return fullPath;
        }
        throw new Error(`Cannot create directory '${filePath}' because there is a file there.`);
    }

    await md(fullPath, { recursive: true });
    return fullPath;
}

export const glob: (pattern: string, options?: IOptions) => Promise<string[]> = promisify(globSync);

export async function write(filePath: string, data: Buffer | string) {
    await mkdir(dirname(filePath));

    if (await filepath.isFile(filePath)) {
        const content = await readFile(filePath);
        if (is.string(data)) {
            // if we're passed a text file, we should match the line endings of the existing file.
            const textContent = content.toString();

            // normalize the line endings to the same as the current file.
            data = textContent.indexOf('\r\n') > -1 ? data.replace(/\r\n|\n/g, '\r\n') : data.replace(/\r\n|\n/g, '\n');

            // if the text content is a match, we don't have to change anything
            if (textContent === data) {
                verbose(`Text file at '${filePath}' is up to date.`);
                return;
            }
        } else {
            // if the binary content is a match, we don't have to change anything
            if (content.equals(data)) {
                verbose(`File at '${filePath}' is up to date.`);
                return;
            }
        }
    }

    verbose(`Writing file '${filePath}'`);
    await writeFile(filePath, data);
}

export async function updateFiles(files: string[], dest: string | Promise<string>) {
    const target = is.promise(dest) ? await dest : dest;
    await Promise.all(files.map(async (each) => {
        const sourceFile = await filepath.isFile(each, $root);
        if (sourceFile) {
            const targetFile = resolve(target, each);
            await write(targetFile, await readFile(sourceFile));
        }
    }));
}

export async function go() {
    if (require.main) {
        // loop through the args and pick out the first non --arg and remove it from the $args and set $cmd
        for (let i = 0; i < $args.length; i++) {
            const each = $args[i];
            if (!each.startsWith('--') && require.main.exports[each]) {
                $cmd = each;
                $args.splice(i, 1);
                break;
            }
        }

        verbose(`${yellow("Running task:")} ${green($cmd)} ${green($args.join(' '))}`);
        require.main.exports[$cmd](...$args);
    }
}
void then(go);

export async function read(filename: string) {
    const content = await readFile(filename);
    ok(content, `File '${filename}' has no content`);
    return content.toString();
}

export async function readJson(filename: string, fallback = {}): Promise<CommentJSONValue> {
    try {
        return parse(await read(filename));
    } catch {
        return fallback as CommentJSONValue;
    }
}

export async function writeJson(filename: string, object: CommentJSONValue) {
    await write(filename, stringify(object, null, 4));
}

export function error(text: string) {
    console.error(`\n${red('ERROR')}: ${text}`);
    return true;
}

export function warn(text: string) {
    console.error(`\n${yellow('WARNING')}: ${text}`);
    return true;
}

export function note(text: string) {
    console.error(`\n${cyan('NOTE')}: ${text}`);
}

export function underline(text: string) {
    return `\u001b[4m${text}\u001b[0m`;
}

export function bold(text: string) {
    return `\u001b[1m${text}\u001b[0m`;
}

export function dim(text: string) {
    return `\u001b[2m${text}\u001b[0m`;
}

export function brightGreen(text: string) {
    return `\u001b[38;2;19;161;14m${text}\u001b[0m`;
}

export function green(text: string) {
    return `\u001b[38;2;78;154;6m${text}\u001b[0m`;
}

export function brightWhite(text: string) {
    return `\u001b[38;2;238;238;236m${text}\u001b[0m`;
}

export function gray(text: string) {
    return `\u001b[38;2;117;113;94m${text}\u001b[0m`;
}

export function yellow(text: string) {
    return `\u001b[38;2;252;233;79m${text}\u001b[0m`;
}

export function red(text: string) {
    return `\u001b[38;2;197;15;31m${text}\u001b[0m`;
}

export function cyan(text: string) {
    return `\u001b[38;2;0;174;239m${text}\u001b[0m`;
}

export const hr = "===============================================================================";

export function heading(text: string, level = 1) {
    switch (level) {
        case 1:
            return `${underline(bold(text))}`;
        case 2:
            return `${brightGreen(text)}`;
        case 3:
            return `${green(text)}`;
    }
    return `${bold(text)}\n`;
}

export function optional(text: string) {
    return gray(text);
}

export function cmdSwitch(text: string) {
    return optional(`--${text}`);
}

export function command(text: string) {
    return brightWhite(bold(text));
}

export function hint(text: string) {
    return green(dim(text));
}

export function count(num: number) {
    return gray(`${num}`);
}

export function position(text: string) {
    return gray(`${text}`);
}

export async function assertAnyFolder(oneOrMoreFolders: string | string[], errorMessage?: string): Promise<string> {
    oneOrMoreFolders = is.array(oneOrMoreFolders) ? oneOrMoreFolders : [oneOrMoreFolders];
    for (const each of oneOrMoreFolders) {
        const result = await filepath.isFolder(each, $root);
        if (result) {
            verbose(`Folder ${brightGreen(each)} exists.`);
            return result;
        }
    }
    if (errorMessage) {
        if (!$switches.includes('--quiet')) {
            error(errorMessage);
        }
        process.exit(1);
    }
}

export async function assertAnyFile(oneOrMoreFiles: string | string[], errorMessage?: string): Promise<string> {
    oneOrMoreFiles = is.array(oneOrMoreFiles) ? oneOrMoreFiles : [oneOrMoreFiles];
    for (const each of oneOrMoreFiles) {
        const result = await filepath.isFile(each, $root);
        if (result) {
            verbose(`Folder ${brightGreen(each)} exists.`);
            return result;
        }
    }
    if (errorMessage) {
        if (!$switches.includes('--quiet')) {
            error(errorMessage);
        }
        process.exit(1);
    }
}

const quiet = process.argv.includes('--quiet');

export async function checkPrep() {
    let failing = false;

    failing = !await assertAnyFolder('dist/test') && (quiet || warn(`The compiled test files are not in place.`)) || failing;
    failing = !await assertAnyFolder('dist/walkthrough') && (quiet || warn(`The walkthrough files are not in place.`)) || failing;
    failing = !await assertAnyFolder('dist/html') && (quiet || warn(`The html files are not in place.`)) || failing;
    failing = !await assertAnyFolder('dist/schema') && (quiet || warn(`The schema files are not in place.`)) || failing;
    failing = !await assertAnyFile('dist/nls.metadata.json') && (quiet || warn(`The extension translation file '${$root}/dist/nls.metadata.json is missing.`)) || failing;
    failing = await checkDTS() || failing;

    if (!failing) {
        verbose('Prep files appear to be in place.');
    }
    return failing;
}

export async function checkCompiled() {
    let failing = false;
    failing = await checkDTS() || failing;
    failing = !await assertAnyFile('dist/src/main.js') && (quiet || warn(`The extension entry point '${$root}/dist/src/main.js is missing.`)) || failing;

    if (!failing) {
        verbose('Compiled files appear to be in place.');
    }
    return failing;
}

export async function checkDTS() {
    let failing = false;
    failing = !await assertAnyFile('vscode.d.ts') && (quiet || warn(`The VSCode import file '${$root}/dist/src/vscode.d.ts is missing.`)) || failing;
    failing = !await assertAnyFile('vscode.proposed.terminalDataWriteEvent.d.ts') && (quiet || warn(`The VSCode import file '${$root}/dist/src/vscode.proposed.terminalDataWriteEvent.d.ts is missing.`)) || failing;

    if (!failing) {
        verbose('VSCode d.ts files appear to be in place.');
    }
    return failing;
}

export async function checkBinaries() {
    let failing = false;
    failing = !await assertAnyFile(['bin/cpptools.exe', 'bin/cpptools']) && (quiet || warn(`The native binary files are not present. You should either build or install the native binaries\n\n.`)) || failing;

    if (!failing) {
        verbose('Native binary files appear to be in place.');
    }
    return failing;
}
