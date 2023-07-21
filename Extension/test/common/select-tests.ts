/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable no-cond-assign */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { fail } from 'assert';
import { IOptions, glob as globSync } from 'glob';
import * as Mocha from 'mocha';
import { resolve } from 'path';
import { env } from 'process';
import { promisify } from 'util';
import { path } from '../../src/Utility/Filesystem/path';

export const glob: (pattern: string, options?: IOptions | undefined) => Promise<string[]> = promisify(globSync);
// eslint-disable-next-line @typescript-eslint/naming-convention
const MochaTest = (Mocha as any).default as (new (options?: Mocha.MochaOptions) => Mocha);
const $root = resolve(__dirname, '..', '..', '..');
export const $args = process.argv.slice(2);
const scenarios = resolve($root, 'test', 'scenarios');

async function getScenarioFolder() {
    let folder: string|undefined = '';
    let scenario = '';
    let assets = '';

    // see if it was passed on the command line
    if ($args.find(arg => arg.startsWith('--scenario=') && (folder = arg.substring('--scenario='.length)))) {
        // if we find a folder, and it has the right things, we're good
        return {
            scenario: scenario = await path.isFolder(folder, scenarios) || await path.isFolder(folder, $root) || fail(`Unable to find scenario folder based on the '--scenario=${folder}' argument.`),
            assets: assets = await path.isFolder('assets', scenario) || fail(`The scenario folder at ${scenario} doesn't appear to have an 'assets' folder.`),
            tests: await path.isFolder('tests', scenario) || fail(`The scenario folder at ${scenario} doesn't appear to have a 'tests' folder.`),
            workspace:  (await glob(`${assets}/*.code-workspace`))[0] // if there is a .code-workspace file in the assets folder, then use that
        };
    }

    // check if there is a environment variable used
    if (folder = env.SCENARIO) {
        // if we find a folder, and it has the right things, we're good
        return {
            scenario: scenario = await path.isFolder(folder, scenarios) || await path.isFolder(folder, $root) || fail(`Unable to find scenario folder based on the '--scenario=${folder}' argument.`),
            assets: assets = await path.isFolder('assets', scenario) || fail(`The scenario folder at ${scenario} doesn't appear to have an 'assets' folder.`),
            tests: await path.isFolder('tests', scenario) || fail(`The scenario folder at ${scenario} doesn't appear to have a 'tests' folder.`),
            workspace: (await glob(`${assets}/*.code-workspace`))[0] // if there is a .code-workspace file in the assets folder, then use that
        };
    }

    throw new Error(`The Scenario folder must be specified either by '--scenario=...' or an environment variable 'SCENARIO=...'`);
}

export function run (testsRoot: string, cb: (error: any, failures?: number) => void): void {
    /**
   * This code runs in the extension host process, and not in the launch (main.ts) process.
   *
   */
    void getScenarioFolder().then(async ({scenario, assets, tests, workspace}) => {
        void glob(`${scenario}/**/**.js`).then((files) => {

            const mocha = new MochaTest({
                ui: 'tdd',
                timeout: 500000,
                require: ['source-map-support/register'],
                color: true
            });

            // Add files to the test suite
            files.forEach(f => mocha.addFile(resolve(testsRoot, f)));

            try {
                console.log('\n\n=============================================\n Test Output\n\n');
                // Run the mocha test
                mocha.run((failures: any) => {
                // cb(null, failures);
                    console.log('\n\n=============================================\n\n');
                });
            } catch (err) {
                console.error(err);
                cb(err);
            }
        });
    });
}
