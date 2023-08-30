/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { fail } from 'assert';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { verbose } from '../src/Utility/Text/streams';
import { $switches, error, mkdir, readJson, rimraf, write } from './common';

export const isolated = resolve(tmpdir(), '.vscode-test', createHash('sha256').update(__dirname).digest('hex').substring(0, 6));
export const extensionsDir = resolve(isolated, 'extensions');
export const userDir = resolve(isolated, 'user-data');
export const settings = resolve(userDir, "User", 'settings.json');

export const options = {
    cachePath: `${isolated}/cache`,
    launchArgs: ['--no-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes', `--extensions-dir=${extensionsDir}`, `--user-data-dir=${userDir}`, '--disable-workspace-trust']
};

export async function install() {
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
        const settingsJson = await readJson(settings, {});
        if (!settingsJson["workbench.colorTheme"]) {
            settingsJson["workbench.colorTheme"] = "Tomorrow Night Blue";
        }

        settingsJson["git.openRepositoryInParentFolders"] = "never";
        await write(settings, JSON.stringify(settingsJson, null, 4));

        return {
            cli, args
        };

    } catch (err: unknown) {
        console.log(err);
    }
}

export async function installExtension(name: string, version?: string) {
    // eslint-disable-next-line prefer-const
    let {cli, args} = await install();
    args = [...args, '--install-extension', version ? `${name}@${version}` : name ];
    if ($switches.includes('--pre-release')) {
        args.push('--pre-release');
    }
    verbose({cli, args});
    const result = spawnSync(cli, args, { encoding: 'utf-8', stdio: 'pipe', env:environment()});
    verbose(result.stdout);
    if (!result.status){
        for (const line of result.output){
            const [,id, ver] = /Extension '(.*)' v(.*?)\s/g.exec(line) ?? [];
            if (id) {
                return {id, ver};
            }
        }
    }
    error(result.stderr);
    fail('Failed to install extension');
}

export async function uninstallExtension(name: string) {
    // eslint-disable-next-line prefer-const
    let {cli, args} = await install();
    args = [...args, '--uninstall-extension', name];

    const result = spawnSync(cli, args, { encoding: 'utf-8', stdio: 'pipe', env:environment()});
    if (!result.status){
        for (const line of result.output){
            const [,id, ver] = /Extension '(.*)' v(.*?)\s/g.exec(line) ?? [];
            if (id) {
                return {id, ver};
                break;
            }
        }
    }
}

export async function extensions() {
    // eslint-disable-next-line prefer-const, @typescript-eslint/no-unused-vars
    let {cli, args} = await install();
}

/** returns a copy of the environment, with tweaks to ensure isolated instance works correctly in WSL and remote dev situations   */
export function environment() {
    const env = { ...process.env, DONT_PROMPT_WSL_INSTALL:"1" }; // this lets you run the native VSCODE instance, even if you're working in WSL
    Object.keys(env).map(each => each.includes('VSCODE') && delete env[each]); // prevent VSCode remoting from hijacking the launching of the isolated vscode
    return env;
}

export async function reset() {
    verbose(`Removing VSCode test folder: ${isolated}`);
    await rimraf(isolated);
}
