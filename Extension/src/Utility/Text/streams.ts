/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { verboseEnabled } from '../../constants';

export function verbose(...args: any[]): void {
    return verboseEnabled || process.argv.includes('--verbose') ? console.log(...args) : undefined;
}
