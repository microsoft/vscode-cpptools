/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { checkCompiled, checkPrep } from './common';

export async function main() {
    if (await checkPrep(false) || await checkCompiled(false)) {
        process.exit(1);
    }

}

export async function prep() {
    if (await checkPrep(false)) {
        process.exit(1);
    }
}
