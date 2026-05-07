/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { spawnSync } from 'child_process';
import { heading } from './common';
import * as copy from './copyExtensionBinaries';
import { install, isolated } from "./vscode";

export async function main() {
    console.log(heading(`Install VS Code`));
    const { cli, args } = await install();

    console.log(heading('Install latest C/C++ Extension'));
    console.log(`Running command: ${cli} ${args.join(' ')} --install-extension ms-vscode.cpptools --pre-release`);
    const result = spawnSync(cli, [...args, '--install-extension', 'ms-vscode.cpptools', '--pre-release'], { encoding: 'utf-8' });
    if (result.stdout) {
        console.log(result.stdout.toString());
    }
    if (result.stderr) {
        console.error(result.stderr.toString());
    }
    if (result.error) {
        console.error(result.error);
    }

    await copy.main(isolated);
}
