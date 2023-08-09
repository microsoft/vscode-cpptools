/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { chmod } from 'fs/promises';
import { resolve } from 'path';
import { $root, write } from './common';

export async function main(): Promise<void> {
    const postCheckout = resolve(`${$root}`,'..','.git','hooks','post-checkout');
    await write(postCheckout, `#!/bin/sh
yarn --cwd Extension post-checkout $*
`);

    await chmod(postCheckout, 0o755);
}
