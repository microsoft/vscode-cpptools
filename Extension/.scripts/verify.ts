/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { checkBinaries, checkCompiled, checkPrep, error, green } from './common';

export async function main() {
    let failing = await checkPrep() && error(`Files are not up to date. Run ${green('yarn prep')} to fix it.`);
    failing = (await checkCompiled() && error(`Compiled files are not present. Run ${green('yarn compile')} to fix it.`)) || failing;
    failing = (await checkBinaries() && error(`The native binary files are not present. You should either build or install the native binaries\n\n.`)) || failing;
    if (failing) {
        process.exit(1);
    }
}

export async function compiled() {
    if (await checkCompiled() && error(`Compiled files are not present. Run ${green('yarn compile')} to fix it.`)) {
        process.exit(1);
    }
}

export async function binaries() {
    if (await checkBinaries() && error(`The native binary files are not present. You should either build or install the native binaries\n\n.`)) {
        process.exit(1);
    }
}

export async function prep() {
    if (await checkPrep() && error(`Files are not up to date. Run ${green('yarn prep')} to fix it.`)) {
        process.exit(1);
    }
}
