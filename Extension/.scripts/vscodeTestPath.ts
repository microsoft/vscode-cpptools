/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { createHash } from 'crypto';
import { homedir } from 'os';
import { posix, win32 } from 'path';

export function getVSCodeTestIsolate(
    scriptDirectory: string,
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
    homeDirectory: string = homedir()): string {
    const path = platform === 'win32' ? win32 : posix;
    const override = environment.CPPTOOLS_VSCODE_TEST_ROOT;
    let root: string;

    if (override) {
        if (!path.isAbsolute(override)) {
            throw new Error('CPPTOOLS_VSCODE_TEST_ROOT must be an absolute path.');
        }
        root = override;
    } else {
        switch (platform) {
            case 'win32':
                root = path.resolve(environment.LOCALAPPDATA || path.resolve(homeDirectory, 'AppData', 'Local'), 'Microsoft', 'vscode-cpptools', 'vscode-test');
                break;
            case 'darwin':
                root = path.resolve(homeDirectory, 'Library', 'Caches', 'vscode-cpptools', 'vscode-test');
                break;
            default:
                root = path.resolve(environment.XDG_CACHE_HOME || path.resolve(homeDirectory, '.cache'), 'vscode-cpptools', 'vscode-test');
                break;
        }
    }

    const worktreeHash = createHash('sha256').update(scriptDirectory).digest('hex').substring(0, 6);
    return path.resolve(root, worktreeHash);
}
