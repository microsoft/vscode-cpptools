/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { verbose } from '../src/Utility/Text/streams';
import { mkdir, readJson, rimraf, write } from './common';

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

export async function reset() {
    verbose(`Removing VSCode test folder: ${isolated}`);
    await rimraf(isolated);
}
