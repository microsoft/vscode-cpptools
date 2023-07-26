/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { verbose } from '../src/Utility/Text/streams';
import { getTestInfo } from '../test/common/selectTests';
import { $root, mkdir, readJson, rimraf, write } from './common';

const sowrite = process.stdout.write.bind(process.stdout) as (...args: unknown[]) => boolean;
const sewrite = process.stderr.write.bind(process.stderr) as (...args: unknown[]) => boolean;
const isolated = resolve(tmpdir(), '.vscode-test', createHash('sha256').update(__dirname).digest('hex').substring(0,6));
const scenarios = resolve($root,'test','scenarios');
const extensionsDir = resolve(isolated,'extensions');
const userDir = resolve(isolated,'user-data');
const settings = resolve(userDir,"User", 'settings.json');
        
const options = {
    cachePath: `${isolated}/cache`,
    launchArgs: ['--no-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes', `--extensions-dir=${extensionsDir}`, `--user-data-dir=${userDir}`, '--disable-workspace-trust']
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

function filter() {
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
}

async function install() {
    try {
        // Create a new isolated directory for VS Code instance in the test folder, and make it specific to the extension folder so we can avoid collisions.
        // keeping this out of the Extension folder means we're not worried about VS Code getting weird with locking files and such.
        
        verbose(`Isolated VSCode test folder: ${isolated}`);
        await mkdir(isolated);

        const vscodeExecutablePath = await downloadAndUnzipVSCode(options);
        const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath).filter(each => !each.startsWith('--extensions-dir=') && !each.startsWith('--user-data-dir='));

        args.push(`--extensions-dir=${extensionsDir}`, `--user-data-dir=${userDir}`);

        // install the appropriate extensions
        // spawnSync(cli, [...args, '--install-extension', 'ms-vscode.cpptools'], { encoding: 'utf-8', stdio: 'ignore' });
        // spawnSync(cli, [...args, '--install-extension', 'twxs.cmake'], { encoding: 'utf-8', stdio: 'ignore' });
        // spawnSync(cli, [...args, '--install-extension', 'ms-vscode.cmake-tools'], { encoding: 'utf-8', stdio: 'ignore' });
        return { 
            cli, args
        }
      
    } catch (err: unknown) {
        console.log(err);
    }

}

export async function reset() {
    verbose(`Removing VSCode test folder: ${isolated}`);
    await rimraf(isolated);
}

export async function run() {
    const { assets, name, workspace } = await getTestInfo();
    console.log( workspace);
    await runTests({
      ...options,
      extensionDevelopmentPath: $root,
      extensionTestsPath: resolve( $root, 'dist/test/common/selectTests' ),
      launchArgs: workspace ? [...options.launchArgs, workspace] : options.launchArgs,
      extensionTestsEnv: { 
        SCENARIO: assets,
      }
    });
}

export async function start() {
    const { cli, args } = await install();
    //verbose(`Installing release version of 'ms-vscode.cpptools'`);
    //spawnSync(cli, [...args, '--install-extension', 'ms-vscode.cpptools'], { encoding: 'utf-8', stdio: 'ignore' })
    verbose('Launch VSCode');
    const ARGS =[...args, ... options.launchArgs.filter(each => !each.startsWith('--extensions-dir=') && !each.startsWith('--user-data-dir=')), `--extensionDevelopmentPath=${$root}`, resolve($root, 'test/scenarios/SimpleCppProject/assets') ];
    verbose(`${cli}\n  ${ [...ARGS ].join('\n  ')}`);
    const settingsJson = await readJson(settings, {});
    if( !settingsJson["workbench.colorTheme"] ) {
        settingsJson["workbench.colorTheme"] = "Tomorrow Night Blue";
    }
    
    settingsJson["git.openRepositoryInParentFolders"] =  "never";
    write(settings, JSON.stringify(settingsJson,null, 4));
    
    spawnSync(cli, ARGS,{ encoding: 'utf-8', stdio: 'ignore' })
    
}

export async function main() {
    await install();
}
