/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { parentPort } from 'worker_threads';
import { getByRef, ref, startRemoting, unref } from '../../Utility/System/snare';
import { getToolsets, identifyToolset, initialize } from './discovery';
import { Toolset } from './toolset';

/** This is the SNARE remote call interface dispatcher that the worker thread supports  */
const remote = parentPort ? startRemoting(parentPort, {
    unref,
    initialize,
    getToolsets: () => getToolsets().then(toolsets => toolsets.entries()),
    identifyToolset: (candidate: string) => ref(identifyToolset(candidate)),
    "Toolset.getIntellisenseConfiguration": (identity: number, compilerArgs: string[], options: any) => getByRef<Toolset>(identity).getIntellisenseConfiguration(compilerArgs, options)
}) : undefined; //: fail("Remoting: Failed to start remote thread - no parent port");

export function log(text: string) {
    if (!remote) {
        console.log(text);
        return;
    }
    remote.notify('console.log', text);
}
