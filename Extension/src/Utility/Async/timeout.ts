/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { sleep } from './sleep';

/** wait on any of the promises to resolve, or the timeout to expire */

export function timeout(msecs: number, ...promises: Promise<any>[]): Promise<any> {
    return Promise.any([sleep(msecs), ...promises]);
}
