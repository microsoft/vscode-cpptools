/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { cp, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { $args, $root, green, heading, note } from './common';

const extensionPrefix = 'ms-vscode.cpptools-';
const foldersToCopy = ['bin', 'debugAdapters'] as const;

type InstalledExtension = {
    path: string;
    version: number[];
    modified: number;
};

function compareVersions(left: number[], right: number[]): number {
    const maxLength: number = Math.max(left.length, right.length);
    for (let i = 0; i < maxLength; i++) {
        const diff: number = (left[i] ?? 0) - (right[i] ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}

function tryParseVersion(folderName: string): number[] | undefined {
    if (!folderName.startsWith(extensionPrefix)) {
        return undefined;
    }

    const versionText: string | undefined = folderName.substring(extensionPrefix.length).match(/^\d+\.\d+\.\d+/)?.[0];
    return versionText?.split('.').map(each => Number(each));
}

async function getInstalledExtensions(root: string): Promise<InstalledExtension[]> {
    try {
        const entries = await readdir(root, { withFileTypes: true });
        const candidates: Promise<InstalledExtension | undefined>[] = entries.map(async (entry) => {
            if (!entry.isDirectory()) {
                return undefined;
            }

            const version: number[] | undefined = tryParseVersion(entry.name);
            if (!version) {
                return undefined;
            }

            const extensionPath: string = join(root, entry.name);
            for (const folder of foldersToCopy) {
                const info = await stat(join(extensionPath, folder)).catch(() => undefined);
                if (!info?.isDirectory()) {
                    return undefined;
                }
            }

            const info = await stat(extensionPath);
            return {
                path: extensionPath,
                version,
                modified: info.mtimeMs
            };
        });

        const found = await Promise.all(candidates);
        return found.filter((entry): entry is InstalledExtension => entry !== undefined);
    } catch {
        return [];
    }
}

async function findLatestInstalledExtension(providedPath?: string): Promise<string> {
    if (providedPath) {
        return providedPath;
    }

    const searchRoots: string[] = [
        join(homedir(), '.vscode', 'extensions'),
        join(homedir(), '.vscode-insiders', 'extensions')
    ];

    const installed: InstalledExtension[] = (await Promise.all(searchRoots.map(each => getInstalledExtensions(each)))).flat();
    if (!installed.length) {
        throw new Error(`Unable to find an installed C/C++ extension under ${searchRoots.join(' or ')}.`);
    }

    installed.sort((left, right) => compareVersions(right.version, left.version) || right.modified - left.modified);
    return installed[0].path;
}

export async function main(sourcePath = $args[0]) {
    console.log(heading('Copy installed extension binaries'));

    const installedExtensionPath: string = await findLatestInstalledExtension(sourcePath);
    note(`Using installed extension at ${installedExtensionPath}`);

    for (const folder of foldersToCopy) {
        const source: string = join(installedExtensionPath, folder);
        const destination: string = join($root, folder);

        console.log(`Copying ${green(folder)} from ${source}`);
        await rm(destination, { recursive: true, force: true });
        await cp(source, destination, { recursive: true, force: true });
    }

    note(`Copied installed binaries into ${$root}`);
}
