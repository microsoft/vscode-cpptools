/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { checkBinaries, checkCompiled, checkDTS, checkPrep, error, green } from './common';
const quiet = process.argv.includes('--quiet');

export async function main() {
    let failing = await checkPrep() && (quiet || error(`Files are not up to date. Run ${green('yarn prep')} to fix it.`));
    failing = (await checkCompiled() && (quiet || error(`Compiled files are not present. Run ${green('yarn compile')} to fix it.`))) || failing;
    failing = (await checkBinaries() && (quiet || error(`The native binary files are not present. You should either build or install the native binaries\n\n.`))) || failing;
    if (failing) {
        process.exit(1);
    }
}

export async function compiled() {
    let failing = false;
    failing = (await checkCompiled() && (quiet || error(`Compiled files are not present. Run ${green('yarn compile')} to fix it.`))) || failing;

    if (failing) {
        process.exit(1);
    }
}

export async function binaries() {
    let failing = false;
    failing = (await checkBinaries() && (quiet || error(`The native binary files are not present. You should either build or install the native binaries\n\n.`))) || failing;

    if (failing) {
        process.exit(1);
    }
}

export async function prep() {
    let failing = false;
    failing = (await checkPrep() && (quiet || error(`Files are not up to date. Run ${green('yarn prep')} to fix it.`))) || failing;

    if (failing) {
        process.exit(1);
    }
}

export async function dts() {
    let failing = false;
    failing = (await checkDTS() && (quiet || error(`VSCode import files are not present. Run ${green('yarn prep')} to fix it.`))) || failing;

    if (failing) {
        process.exit(1);
    }
}
