/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { verbose } from '../src/Utility/Text/streams';
import { main as clean } from './clean';
import { $args, green, hr } from './common';

export async function main(): Promise<void> {
    if( $args.length < 2 ) {
        return;
    }
    const [fromCommit, toCommit, flag] = $args;

    if( flag === "0"  ) {
        // file checkout or  Nothing to do.
        verbose('Skipping post-checkout hook because of file checkout or no change in commit.');
        return;
    }

    // folder checkout. Let's make sure we're clean
    await clean();

    // tell the user what we've done
    console.log(`\n\n${hr}\n\nThe ${green('dist')} folder has been cleaned.\n\nYou should run ${green('yarn install')} to update dependencies. \n\n${hr}\n\n`)
}
