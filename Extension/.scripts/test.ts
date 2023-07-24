/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { fail } from 'assert';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { env } from 'process';
import { path } from '../src/Utility/Filesystem/path';
import { verbose } from '../src/Utility/Text/streams';
import { $args, $root, glob, mkdir, rimraf } from './common';

const sowrite = process.stdout.write.bind(process.stdout) as (...args: unknown[]) => boolean;
const sewrite = process.stderr.write.bind(process.stderr) as (...args: unknown[]) => boolean;
const isolated = resolve(tmpdir(), '.vscode-test', createHash('sha256').update(__dirname).digest('hex').substring(0,6) );
const scenarios = resolve($root,'test','scenarios');
        
const options = {
    cachePath: `${isolated}/cache`,
    launchArgs: ['--no-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes', `--extensions-dir=${isolated}/extensions`, `--user-data-dir=${isolated}/user-data`]
};

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

process.stdout.write = function (...args: unknown[]) {
    //console.error(`***************${JSON.stringify(args)}`);
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

async function getScenarioFolder() {
    let folder ='';
    let scenario = '';
    let assets = '';
    
    // see if it was passed on the command line
    if( $args.find( arg => arg.startsWith('--scenario=') && (folder = arg.substring('--scenario='.length)) ) ) {
        // if we find a folder, and it has the right things, we're good
        return { 
            scenario: scenario = await path.isFolder(folder,scenarios) || await path.isFolder(folder,$root) || fail(`Unable to find scenario folder based on the '--scenario=${folder}' argument.`),
            assets: assets = await path.isFolder('assets',scenario) || fail(`The scenario folder at ${scenario} doesn't appear to have an 'assets' folder.`),
            tests: await path.isFolder('tests',scenario) || fail(`The scenario folder at ${scenario} doesn't appear to have a 'tests' folder.`),
            workspace:  (await glob(`${assets}/*.code-workspace`))[0] // if there is a .code-workspace file in the assets folder, then use that 
        }
    }

    // check if there is a environment variable used
    if( folder = env.SCENARIO ) {
         // if we find a folder, and it has the right things, we're good
        return { 
            scenario: scenario = await path.isFolder(folder,scenarios) || await path.isFolder(folder,$root) || fail(`Unable to find scenario folder based on the '--scenario=${folder}' argument.`),
            assets: assets = await path.isFolder('assets',scenario) || fail(`The scenario folder at ${scenario} doesn't appear to have an 'assets' folder.`),
            tests: await path.isFolder('tests',scenario) || fail(`The scenario folder at ${scenario} doesn't appear to have a 'tests' folder.`),
            workspace: (await glob(`${assets}/*.code-workspace`))[0] // if there is a .code-workspace file in the assets folder, then use that 
        }
    }

    throw new Error(`The Scenario folder must be specified either by '--scenario=...' or an environment variable 'SCENARIO=...'`);
}

async function install() {
    try {
        // Create a new isolated directory for VS Code instance in the test folder, and make it specific to the extension folder so we can avoid collisions.
        // keeping this out of the Extension folder means we're not worried about VS Code getting weird with locking files and such.
        
        verbose(`Isolated VSCode test folder: ${isolated}`);
        
        await mkdir(isolated);


        const vscodeExecutablePath = await downloadAndUnzipVSCode(options);
        const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath).filter(each => !each.startsWith('--extensions-dir=') && !each.startsWith('--user-data-dir='));

        args.push(`--extensions-dir=${isolated}/extensions`, `--user-data-dir=${isolated}/user-data`);

        // install the appropriate extensions
        // spawnSync(cli, [...args, '--install-extension', 'ms-vscode.cpptools'], { encoding: 'utf-8', stdio: 'ignore' });
        // spawnSync(cli, [...args, '--install-extension', 'twxs.cmake'], { encoding: 'utf-8', stdio: 'ignore' });
        // spawnSync(cli, [...args, '--install-extension', 'ms-vscode.cmake-tools'], { encoding: 'utf-8', stdio: 'ignore' });

      
    } catch (err: unknown) {
        console.log(err);
    }
}

export async function reset() {
    verbose(`Removing VSCode test folder: ${isolated}`);
    await rimraf(isolated);
}

export async function run() {
    const { scenario, assets, tests, workspace } = await getScenarioFolder();
    
    await runTests({
      ...options,
      extensionDevelopmentPath: $root,
      extensionTestsPath: resolve( $root, 'dist/test/common/selectTests' ),
      launchArgs: workspace ? [...options.launchArgs, workspace] : options.launchArgs,
      extensionTestsEnv: { 
        SCENARIO: scenario,
      }
    });
}


export async function main() {
    await install();
}
