/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { platform } from 'os';

export const OperatingSystem = platform();

export const isWindows = OperatingSystem === 'win32';
export const isMacOS = OperatingSystem === 'darwin';
export const isLinux = OperatingSystem === 'linux';

// if you want to see the output of verbose logging, set this to true.
export const verboseEnabled = false;
