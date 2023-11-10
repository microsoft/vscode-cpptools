/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { AsyncFunc, Func, it } from 'mocha';
import { is } from '../../src/Utility/System/guards';

export function when(prerequisite: boolean | (() => boolean)): {it: Mocha.TestFunction} {
    if (is.function(prerequisite)) {
        prerequisite = prerequisite();
    }
    if (prerequisite) {
        return {it};
    } else {
        const skip = (title: string, test: AsyncFunc | Func) => it.skip(`Dynamically skipping test: <<${title}>> - prerequisite not met.`, test);
        return {it:skip as Mocha.TestFunction};
    }
}

import { MessagePort } from 'worker_threads';
import { collectGarbage } from '../../src/Utility/System/garbageCollector';

function showActiveHandles() {
    const open = (process as any)._getActiveHandles().filter(
        (each: any) =>
            !each.destroyed && // discard handles that claim they are destroyed.
      !(each.fd === 0) && // ignore stdin/stdout/stderr
      !(each.fd === 1) && // ignore stdin/stdout/stderr
      !(each.fd === 2) && // ignore stdin/stdout/stderr
      !(each instanceof MessagePort) && // ignore worker thread message ports
      each.listening // keep servers that are still listening.

    );

    if (open.length) {
        console.log('################');
        console.log('Active Handles: ');
        console.log('################');
        console.log(open);
    }
}

let misbehavingPromises: Set<Promise<any>>;

export function addMisbehavingPromise(promise: Promise<any>) {
    misbehavingPromises?.add(promise);
    return promise;
}
(global as any).addMisbehavingPromise = addMisbehavingPromise;
let MAX = 20;

export function initDevModeChecks() {
    misbehavingPromises = new Set<Promise<any>>();

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('mocha').afterAll?.(() => {
            collectGarbage();
            console.log("showing!");
            showActiveHandles();
        });
    } catch {
        // ignore
        console.log('oops');
    }

    process.on('unhandledRejection', (reason: any, p) => {

        console.log(`Unhandled Rejection at: Promise ${p} - reason:, ${(reason as any)?.stack ?? reason}`);
    });

    process.on('multipleResolves', (type, promise, reason) => {
        if (misbehavingPromises.has(promise)) {
            return;
        }
        if (reason && (reason as any).stack) {
            console.error((reason as any).stack);
            return;
        }
        if (!MAX--) {
            throw new Error('MAX MULTIPLE RESOLVED REACHED');
        }
        console.error({text: 'Multiple Resolves', type, promise, reason});
    });

    process.on('exit', showActiveHandles);
}

initDevModeChecks();
