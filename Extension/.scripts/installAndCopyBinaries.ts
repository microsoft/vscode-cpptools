/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { spawnSync } from 'child_process';
import { verbose } from '../src/Utility/Text/streams';
import { heading } from './common';
import * as copy from './copyExtensionBinaries';
import { install, isolated } from "./vscode";

export async function main() {
    console.log(heading(`Install VS Code`));
    const { cli, args } = await install();

    console.log(heading('Install latest C/C++ Extension'));
    verbose(`Running command: ${cli} ${args.join(' ')} --install-extension ms-vscode.cpptools --pre-release`);
    const result = spawnSync(cli, ['--install-extension', 'ms-vscode.cpptools', '--pre-release'], { encoding: 'utf-8', shell: true })
    if (result.stdout) {
        verbose(result.stdout.toString());
    }

    await copy.main(isolated);
}
