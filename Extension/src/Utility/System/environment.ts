/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { isWindows } from '../../constants';

/* Returns an environment variable value by name */
export function getEnvironmentVariable(name: string): string | undefined {
    return process.env[name];
}

/** replaces instances of environment variables referenced  with the corresponding environment variable
 *
 * Windows:
 *   `%PATH%` -> environment variable `PATH`
 *
 * Non-Windows (posix-style):
 *  `$PATH` -> environment variable `PATH`
 *
 */
export function resolveEnvironmentVariables(str: string): string {
    return isWindows ?
        str.replace(/%([^%]+)%/g, (withPercents, withoutPercents) => getEnvironmentVariable(withoutPercents) || withPercents) : // Windows
        str.replace(/\$(\w+)/g, (withDollars, withoutDollars) => getEnvironmentVariable(withoutDollars) || withDollars); // everything else
}
