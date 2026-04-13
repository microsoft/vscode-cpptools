/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { runVSCodeCommand } from '@vscode/test-electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $root, error, heading, note } from './common';
import * as copy from './copyExtensionBinaries';
import { install, isolated, options } from "./vscode";

export async function main() {
    console.log(heading(`Install VS Code`));
    const vscode = await install();

    console.log(heading('Install latest C/C++ Extension'));
    const result = await runVSCodeCommand([...vscode?.args ?? [], '--install-extension', 'ms-vscode.cpptools', '--pre-release'], options);
    if (result.stdout) {
        console.log(result.stdout.toString());
    }
    if (result.stderr) {
        error(result.stderr.toString());
    }

    const binaryVersion = await copy.main(isolated);
    if (binaryVersion) {
        await writeFile(join($root, 'bin', 'binaryVersion.json'), JSON.stringify({ version: binaryVersion }));
        note(`Wrote binary version ${binaryVersion} to bin/binaryVersion.json`);
    }
}
