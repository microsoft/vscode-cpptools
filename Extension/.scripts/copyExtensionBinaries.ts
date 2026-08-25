/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { cp, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { verbose } from '../src/Utility/Text/streams';
import { $args, $root, Git, green, heading, note, warn } from './common';

const extensionPrefix = 'ms-vscode.cpptools-';
const foldersToCopy = ['bin', 'debugAdapters', 'LLVM'] as const;

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

async function findExtensionsFolder(root: string): Promise<string | undefined> {
    try {
        const entries = await readdir(root, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name === 'extensions') {
                    const extensionEntries = await readdir(join(root, entry.name), { withFileTypes: true });
                    for (const extensionEntry of extensionEntries) {
                        if (extensionEntry.isDirectory() && extensionEntry.name.startsWith(extensionPrefix)) {
                            return join(root, entry.name);
                        }
                    }
                } else {
                    const result = await findExtensionsFolder(join(root, entry.name));
                    if (result) {
                        return result;
                    }
                }
            }
        }
    } catch {
        // Ignore errors (permission denied, etc.)
    }
    return undefined;
}

async function findLatestInstalledExtension(providedPath?: string): Promise<string> {
    const searchRoots: string[] = [
        join(homedir(), '.vscode', 'extensions'),
        join(homedir(), '.vscode-insiders', 'extensions'),
        join(homedir(), '.vscode-server', 'extensions'),
        join(homedir(), '.vscode-server-insiders', 'extensions')
    ];
    if (providedPath) {
        // find a folder called 'extensions' recursively under the provided path and add it to the front of the search roots
        const extensionsFolderPath = await findExtensionsFolder(providedPath);
        if (extensionsFolderPath) {
            verbose(`Found extensions folder under provided path: ${extensionsFolderPath}`);
            searchRoots.unshift(extensionsFolderPath);
        }
    }

    const installed: InstalledExtension[] = (await Promise.all(searchRoots.map(each => getInstalledExtensions(each)))).flat();
    if (!installed.length) {
        throw new Error(`Unable to find an installed C/C++ extension under ${searchRoots.join(' or ')}.`);
    }

    installed.sort((left, right) => compareVersions(right.version, left.version) || right.modified - left.modified);
    return installed[0].path;
}

/**
 * A few files inside the copied folders are checked into the repo (for example bin/cpp.hint and
 * bin/messages/**). The copy overwrites them with the installed extension's versions, which can differ
 * in line endings or content and then show up as spurious local modifications. Restore any tracked files
 * that the copy changed so only the untracked binaries remain in the working tree.
 */
async function restoreTrackedFiles(): Promise<void> {
    const modified = await Git('ls-files', '--modified', '--', ...foldersToCopy);
    if (modified.code) {
        warn(`Unable to determine which tracked files to restore: ${modified.error.all().join('\n')}`);
        return;
    }

    const files = modified.stdio.all().map(line => line.trim()).filter(line => line.length > 0);
    if (!files.length) {
        return;
    }

    const restored = await Git('checkout', '--', ...files);
    if (restored.code) {
        warn(`Unable to restore tracked files after copy: ${restored.error.all().join('\n')}`);
        return;
    }

    note(`Restored ${files.length} tracked ${files.length === 1 ? 'file' : 'files'} overwritten by the copy.`);
}

export async function main(sourcePath = $args[0]): Promise<string | undefined> {
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

    await restoreTrackedFiles();

    const installedVersion = tryParseVersion(basename(installedExtensionPath));
    return installedVersion?.join('.');
}
