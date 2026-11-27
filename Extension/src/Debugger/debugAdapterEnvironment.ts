/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// This file must not import 'vscode' so that it can be unit tested.

// On Linux, the .NET runtime (W^X) creates a memfd called "doublemapper" and truncates it to 2 TiB.
// When the "Max file size" resource limit (ulimit -f) is lower than that, ftruncate fails with EFBIG,
// the process gets SIGXFSZ, and OpenDebugAD7 crashes at startup.
// Setting DOTNET_EnableWriteXorExecute=0 makes the runtime skip the double mapping.
const dotnetMemfdSize: bigint = 2n ** 41n; // 2 TiB

/**
 * Returns true if the 'Max file size' row of /proc/<pid>/limits shows a soft limit below 2 TiB.
 * Returns false for 'unlimited', for a missing row, and for anything that cannot be parsed.
 */
export function isFileSizeLimitBelowDotnetMemfd(procLimits: string): boolean {
    const match: RegExpMatchArray | null = /^Max file size\s+(\S+)/m.exec(procLimits);
    // /proc/<pid>/limits reports 'Max file size' in bytes (the Units column is 'bytes').
    if (!match || !/^\d+$/.test(match[1])) {
        return false;
    }
    return BigInt(match[1]) < dotnetMemfdSize;
}

/**
 * Environment overrides for the OpenDebugAD7 process, or undefined when none are needed.
 * An existing DOTNET_EnableWriteXorExecute value set by the user is never overridden.
 */
export function getDebugAdapterEnvironment(platform: string, processEnv: NodeJS.ProcessEnv, procLimits: string | undefined): { [key: string]: string } | undefined {
    if (platform !== 'linux' || processEnv.DOTNET_EnableWriteXorExecute !== undefined || procLimits === undefined) {
        return undefined;
    }
    return isFileSizeLimitBelowDotnetMemfd(procLimits) ? { DOTNET_EnableWriteXorExecute: '0' } : undefined;
}
