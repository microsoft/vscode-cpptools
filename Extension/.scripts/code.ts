/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { spawnSync } from 'child_process';
import { verbose } from '../src/Utility/Text/streams';
import { $args, $root, $scenario, assertAnyFile, brightGreen, gray, green, pwd } from './common';

import { resolve } from 'path';
import { getTestInfo } from '../test/common/selectTests';
import { install, options } from "./vscode";

export { install, reset } from './vscode';

export async function main() {
    let ti = await getTestInfo($scenario);
    if (!ti) {
        // try using the first arg as a scenario name or location
        ti = await getTestInfo($args[0], $args[0] ? resolve(pwd, $args[0]) : undefined);
        if (ti) {
            $args[0] = ti.workspace;
        }
    } else {
        // we found it
        $args.unshift(ti.workspace);
    }
    await assertAnyFile('dist/src/main.js', `The extension entry point '${$root}/dist/src/main.js is missing. You should run ${brightGreen("yarn compile")}\n\n`);

    const { cli, args } = await install();

    // example of installing an extension into code
    //verbose(`Installing release version of 'ms-vscode.cpptools'`);
    //spawnSync(cli, [...args, '--install-extension', 'ms-vscode.cpptools'], { encoding: 'utf-8', stdio: 'ignore' })
    verbose(green('Launch VSCode'));
    const ARGS = [...args, ...options.launchArgs.filter(each => !each.startsWith('--extensions-dir=') && !each.startsWith('--user-data-dir=')), `--extensionDevelopmentPath=${$root}`, ...$args ];
    verbose(gray(`${cli}\n  ${ [...ARGS ].join('\n  ')}`));

    spawnSync(cli, ARGS, { encoding: 'utf-8', stdio: 'ignore', env: { ...process.env, DONT_PROMPT_WSL_INSTALL:"1" } });
}
