/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { normalize } from 'path';
import { isWindows } from '../../constants';
import { Command, CommandFunction } from '../Process/program';
import { Cache } from './cache';

let powerShell: CommandFunction;

async function init() {
    powerShell = await new Command("powershell", '-NoProfile', '-NonInteractive', '-Command');
}
const initialized = init();

type QueryResults = { subKeys: string[]; values: Record<string, { data: any; type: string } >};
type RegistryProperties = Record<string, string | number | string[] | Buffer >;

interface RegKey {
    properties: RegistryProperties;
    children: string[];
}

const regKeyCache = new Cache<RegKey>(5 * Cache.OneMinute);

/**
 * Returns a RegKey containing the registry data from the given hive and path
 *
 * @param hive the hive to read from (HKLM, HKCU, etc)
 * @param path the path to read from (ie, 'SOFTWARE\Microsoft\Windows Kits\Installed Roots')
 * @returns a RegKey containing the registry data from the given hive and path, or undefined if the key does not exist or the user does not have access
 *
 * @remarks if anything goes wrong, this will return undefined
 */
export async function readKey(hive: string, path: string): Promise<RegKey | undefined> {
    if (!isWindows) {
        // registry is only available on windows
        return undefined;
    }
    const cacheKey = `${hive}:${path}`;
    const result = regKeyCache.get(cacheKey);
    if (result) {
        return result;
    }

    try {
        // normalize the hive name
        switch (hive.toUpperCase()) {
            case 'HKLM':
            case 'HKEY_LOCAL_MACHINE':
                hive = 'HKLM';
                break;
            case 'HKCU':
            case 'HKEY_CURRENT_USER':
                hive = 'HKCU';
                break;
            default:
            // invalid hive, PS only has HKLM and HKCU PSDrives.
                return undefined;
        }

        // remove all unprintable characters and normalize the path (backslashes as separators, no leading/trailing slashes)
        // eslint-disable-next-line no-control-regex
        path = normalize(path.replace(/[\x00-\x1F]/gm, '')).replace(/(^\\+|\\$)/gm, '');

        // ensure that the command is initialized
        await initialized;

        // shell out to powershell to get the registry data
        const data = await powerShell(`
        $item = (Get-Item -Path "${hive}:${path}" -ea 0)
        if( $item ) {
            $result = @{
                subKeys = $item.getSubKeyNames()
                values = @{}
            }
            $item.GetValueNames() |% { 
                $result.values[$_] = @{ 
                    data = $item.GetValue($_)
                    type  = $item.GetValueKind($_).toString().toLower()
                } 
            } 
            $result | convertto-json -depth 4
        } else { 
            exit -1
        }
    `);

        // if the command failed, return undefined
        if (data.code) {
            return undefined;
        }

        // parse the json output
        const queried = JSON.parse(data.stdio.all().join('')) as QueryResults;

        // return the data in a more usable format
        return regKeyCache.set(cacheKey, {
            children: queried.subKeys,
            properties: Object.entries(queried.values).reduce((result, [key, value]) => {
                result[key] = value.type === 'binary' ? Buffer.from(value.data) : value.data;
                return result;
            }, {} as RegistryProperties)
        });
    } catch {
        // failures will always return undefined
        return undefined;
    }
}

