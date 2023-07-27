/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { runTests } from '@vscode/test-electron';
import { spawnSync } from 'child_process';
import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { env } from 'process';
import { returns } from '../src/Utility/Async/returns';
import { filepath } from '../src/Utility/Filesystem/filepath';
import { verbose } from '../src/Utility/Text/streams';
import { getTestInfo } from '../test/common/selectTests';
import { $root, $scenario, brightGreen, checkFile, checkFolder, cmdSwitch, cyan, error, green, red } from './common';
import { install, isolated, options } from './vscode';

export { install, reset } from './vscode';

const sowrite = process.stdout.write.bind(process.stdout) as (...args: unknown[]) => boolean;
const sewrite = process.stderr.write.bind(process.stderr) as (...args: unknown[]) => boolean;
        
const filters = [
    /^\[(.*)\].*/,
    /^Unexpected token A/,
    /Cannot register 'cmake.cmakePath'/,
    /\[DEP0005\] DeprecationWarning/,
    /--trace-deprecation/,
    /Iconv-lite warning/,
    /^Extension '/,
    /^Found existing install/
];

// remove unwanted messages from stdio
function filterStdio() {
    process.stdout.write = function (...args: unknown[]) {
        if (typeof(args[0]) === 'string') {
            const text = args[0];

            if (filters.some(each => text.match(each))) {
                return true;
            }
        }
        if (args[0] instanceof Buffer) {
            const text = args[0].toString();
            if (filters.some(each => text.match(each))) {
                return true;
            }
        }
        return sowrite(...args);
    };

    process.stderr.write = function (...args: unknown[]) {
        if (typeof(args[0]) === 'string') {
            const text = args[0];

            if (filters.some(each => text.match(each))) {
                return true;
            }
        }
        if (args[0] instanceof Buffer) {
            const text = args[0].toString();
            if (filters.some(each => text.match(each))) {
                return true;
            }
        }
        return sewrite(...args);
    };
}

filterStdio();

async function unitTests() {
    const mocha = await checkFile(["node_modules/.bin/mocha.cmd","node_modules/.bin/mocha"], `Can't find the mocha testrunner. You might need to run ${brightGreen("yarn install")}\n\n`);
    const result = spawnSync(mocha, [`${$root}/dist/test/internalUnitTests/**/*.test.js`], { stdio:'inherit'});
    verbose(`\n${green("NOTE:")} If you want to run a scenario test (end-to-end) use ${cmdSwitch('scenario=<NAME>')} \n\n`);
    return result.status;
}

async function scenarioTests( assets: string, name:string, workspace:string ) {
    return runTests({
        ...options,
        extensionDevelopmentPath: $root,
        extensionTestsPath: resolve( $root, 'dist/test/common/selectTests' ),
        launchArgs: workspace ? [...options.launchArgs, workspace] : options.launchArgs,
        extensionTestsEnv: { 
            SCENARIO: assets,
        }
    });
}

export async function main() {
    await checkFolder('dist/test/',`The folder '${$root}/dist/test is missing. You should run ${brightGreen("yarn compile")}\n\n`);
    const testInfo = await getTestInfo($scenario, env.SCENARIO);

    if( !testInfo ) {
        // lets just run the unit tests
        process.exit(await unitTests());
    }

    // at this point, we're going to run some vscode tests
    if(!await filepath.isFolder(isolated)) {
        await install();
    }
    process.exit( await scenarioTests(testInfo.assets, testInfo.name, testInfo.workspace));
}

export async function all() {
    const finished: string[] = [];

    if( await unitTests() !== 0 ) {
        console.log(`${cyan("UNIT TESTS: ")}${red("failed")}`);
        process.exit(1);
    }
    finished.push(`${cyan("UNIT TESTS: ")}${green("success")}`);

    // at this point, we're going to run some vscode tests
    if(!await filepath.isFolder(isolated)) {
        await install();
    }
    try {
        const scenarios = await readdir(`${$root}/test/scenarios`).catch(returns.empty);
        for( const each of scenarios) {
            if( each === 'Debugger') {
                continue;
            }
            if( await filepath.isFolder(`${$root}/test/scenarios/${each}/tests`) ) {
                const ti = await getTestInfo(each);
                
                if( ti ) {
                    console.log(`\n\nRunning scenario ${each}`);
                    const result = await scenarioTests(ti.assets, ti.name, ti.workspace);
                    if( result ) {
                        console.log( finished.join('\n') );
                        console.log(`${cyan(`${ti.name} Tests:`)}${red("failed")}`);
                        process.exit(result);
                    }
                    finished.push(`${cyan(`${ti.name} Tests:`)}${green("success")}`);
                }
            }
        }
    } catch (e) {
        error(e);
    } finally {
        console.log( finished.join('\n') );
    }
    
}
