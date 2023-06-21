/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { setTimeout as after } from 'timers/promises';

/** pause for a number of milliseconds */
export const sleep = after as (msec: number) => Promise<void>;
