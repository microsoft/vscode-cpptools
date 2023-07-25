/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable no-cond-assign */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { IOptions, glob as globSync } from 'glob';
import * as Mocha from 'mocha';
import { basename, dirname, resolve } from 'path';
import { env } from 'process';
import { promisify } from 'util';
import { path } from '../../src/Utility/Filesystem/path';

export const glob: (pattern: string, options?: IOptions | undefined) => Promise<string[]> = promisify(globSync);
// eslint-disable-next-line @typescript-eslint/naming-convention
const MochaTest = (Mocha as any).default as (new (options?: Mocha.MochaOptions) => Mocha);

// depending if this is pulled in as a ts-node script, or an already-compiled file in dist/...
const $root = __dirname.includes('dist') ? resolve(__dirname, '..', '..', '..') : resolve(__dirname, '..', '..') ;

export const $args = process.argv.slice(2);
const scenarios = resolve($root, 'test', 'scenarios');

export async function getScenarioFolder(val: string) {
    console.log(scenarios);
    // is it a name relative to the tests/scenarios folder?
    const folder = await path.isFolder(val, scenarios);

    if (folder) {
        let name = basename(folder);
        if (name === 'assets') {
            name = basename(dirname(folder));
        }
        console.log(`Using :${folder} and ${(await glob(`${folder}/*.code-workspace`))[0] || folder} `);
        return {
            name,
            assets: folder,
            workspace: (await glob(`${folder}/**/*.code-workspace`))[0] || folder
        };
    }

    const file = await path.isFile(val, scenarios);
    if (file) {
        const assets = dirname(dirname(file));

        return {
            name: basename(assets),
            assets,
            workspace: file
        };
    }
    throw new Error(`Unable to find scenario folder for '${val}' \n\nThe Scenario folder must be specified either by '--scenario=...' or an environment variable 'SCENARIO=...'`);
}

export async function getTestInfo() {
    let location: string|undefined = '';
    if ($args.find(arg => arg.startsWith('--scenario=') && (location = arg.substring('--scenario='.length)))) {
        return getScenarioFolder(location);
    }

    if (location = env.SCENARIO) {
        return getScenarioFolder(location);
    }

    console.error(`The Scenario folder must be specified either by '--scenario=...' or an environment variable 'SCENARIO=...'`);
    process.exit(1);
}

export function run (testsRoot: string, cb: (error: any, failures?: number) => void): void {
/**
 * This code runs in the extension host process, and not in the launch (main.ts) process.
 */
    void getTestInfo().then(async ({ name, assets, workspace}) => {
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
