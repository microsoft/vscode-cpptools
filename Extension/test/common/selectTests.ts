/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { readdir } from 'fs/promises';
import { IOptions, glob as globSync } from 'glob';
import * as Mocha from 'mocha';
import { basename, dirname, resolve } from 'path';
import { env } from 'process';
import { promisify } from 'util';
import { returns } from '../../src/Utility/Async/returns';
import { filepath } from '../../src/Utility/Filesystem/filepath';

export const glob: (pattern: string, options?: IOptions | undefined) => Promise<string[]> = promisify(globSync);

// depending if this is pulled in as a ts-node script, or an already-compiled file in dist/...
const $root = __dirname.includes('dist') ? resolve(__dirname, '..', '..', '..') : resolve(__dirname, '..', '..');

const scenariosFolder = resolve($root, 'test', 'scenarios');

async function getScenarioInfo(val: string) {

    // is it a name relative to the tests/scenarios folder?
    const folder = await filepath.isFolder(val, scenariosFolder);

    if (folder) {
        let name = basename(folder);
        if (name === 'assets') {
            name = basename(dirname(folder));
        }

        if ((await readdir(`${$root}/dist/test/scenarios/${name}/tests`).catch(returns.empty)).length === 0) {
            // no tests in this scenario have been compiled
            return undefined;
        }
        const assets = await filepath.isFolder('assets', folder) ?? folder;

        return {
            name,
            assets,
            workspace: (await glob(`${folder}/**/*.code-workspace`))[0] || assets
        };
    }

    const file = await filepath.isFile(val, scenariosFolder);
    if (file) {
        const assets = dirname(dirname(file));
        const name = basename(assets);
        if ((await readdir(`${$root}/dist/test/scenarios/${name}/tests`)).length === 0) {
            // no tests in this scenario have been compiled
            return undefined;
        }

        return {
            name,
            assets,
            workspace: file
        };
    }
    return undefined;
}

export async function getTestInfo(...scenarioOptions: (string | undefined)[]) {
    for (const each of scenarioOptions) {
        if (each) {
            const result = await getScenarioInfo(each);
            if (result) {
                return result;
            }
        }
    }
    return undefined;
}

export function run (testsRoot: string, cb: (error: any, failures?: number) => void): void {
/**
 * This code runs in the extension host process, and not in the launch (main.ts) process.
 */
    let location = '';

    // scan through the $args to find the --scenario=...
    process.argv.slice(2).find(arg => arg.startsWith('--scenario=') && (location = arg.substring('--scenario='.length)));

    void getTestInfo(location, env.SCENARIO).then(async (testInfo) => {
        if (!testInfo) {
            console.error(`The Scenario folder must be specified either by '--scenario=...' or an environment variable 'SCENARIO=...'`);
            process.exit(1);
        }
        const { name} = testInfo;

        void glob(`${$root}/dist/test/scenarios/${name}/tests/**/**.test.js`).then((files) => {

            try {
                if (!files.length) {
                    throw new Error(`Unable to find unit tests for ${name} at '${$root}/dist/test/scenarios/${name}/tests/**/**.test.js'`);
                }
                const mocha = new Mocha({
                    ui: 'tdd',
                    timeout: 500000,
                    require: ['source-map-support/register'],
                    color: true
                });

                // Add files to the test suite
                files.forEach(f => mocha.addFile(resolve(testsRoot, f)));

                console.log('\n\n=============================================\n Test Output\n\n');
                // Run the mocha test
                mocha.run((failures: any) => {
                    cb(null, failures);
                    console.log('\n\n=============================================\n\n');
                });
            } catch (err) {
                console.error(err);
                cb(err);
            }
        });
    });
}
