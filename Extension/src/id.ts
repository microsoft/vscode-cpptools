/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { execChildProcess } from './common';
import { isWindows } from './constants';
import { logLanguageServerEvent } from './telemetry';

/**
 * Hash the MAC addresses on the machine (Windows-only) and log telemetry.
 */
export async function logMachineIdMappings(): Promise<void> {
    if (!isWindows) {
        return;
    }

    const macAddresses = await getMacAddresses();

    // The first MAC address is the one Visual Studio uses
    const primary = await getMachineId(macAddresses.shift());
    if (primary) {
        logLanguageServerEvent('machineIdMap', {primary});
    }

    // VS Code uses os.networkInterfaces() which has different sorting and availability,
    // but all MAC addresses are returned by getmac.exe. The ID VS Code uses may change
    // based on changes to the network configuration. Log the extras so we can assess
    // how frequently this impacts the machine id.
    for (const macAddress of macAddresses) {
        const additional = await getMachineId(macAddress);
        if (additional) {
            logLanguageServerEvent('machineIdMap', {additional});
        }
    }
}

/**
 * Parse the output of getmac.exe to get the list of MAC addresses for the PC.
 */
async function getMacAddresses(): Promise<string[]> {
    try {
        const output = await execChildProcess('getmac');
        const regex = /(?:[a-z0-9]{2}[:\-]){5}[a-z0-9]{2}/gmi;
        return output.match(regex) ?? [];
    } catch (err) {
        return [];
    }
}

/**
 * Code below is adapted from:
 *  - vscode\src\vs\base\node\id.ts
 */

async function getMachineId(macAddress?: string): Promise<string | undefined> {
    if (!macAddress) {
        return undefined;
    }

    try {
        const crypto = await import('crypto');
        const normalized = macAddress.toUpperCase().replace(/:/g, '-');
        return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
    } catch (err) {
        return undefined;
    }
}
