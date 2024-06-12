/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { watch as watchFiles } from 'fs/promises';
import { filepath } from '../src/Utility/Filesystem/filepath';
import { verbose } from '../src/Utility/Text/streams';
import { $root, glob, mkdir, updateFiles } from './common';

export async function main() {
    verbose(`Copying walkthrough media to extension/dist folder`);
    await updateFiles(await glob('walkthrough/images/**/*'), mkdir('dist'));
}

export async function watch() {
    const source = await filepath.isFolder('walkthrough/images', $root);
    if (source) {
        verbose(`Watching ${source} folder for changes.`);
        console.log('Press Ctrl+C to exit.');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const event of watchFiles(source, {recursive: true })) {
            await main();
        }
    }

}

