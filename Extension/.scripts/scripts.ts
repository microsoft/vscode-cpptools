/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { gray, green, readJson } from './common';

export async function main() {
    const pkg = await readJson('package.json') as Record<string, any>;
    if (pkg.scripts) {
        console.log(green('\n\nAvailable script commands:\n'));
        for (const key of Object.keys(pkg.scripts)) {
            console.log(green(`yarn ${key} - ${gray(pkg.scripts[key])}`));
        }
        console.log('');
    }
}
