/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { checkCompiled, checkPrep } from './common';

export async function main() {
    await checkPrep();
    await checkCompiled();
}

export async function prep() {
    await checkPrep();
}
