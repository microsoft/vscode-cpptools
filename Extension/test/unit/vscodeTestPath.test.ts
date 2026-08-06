/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import { createHash } from 'crypto';
import { describe, it } from 'mocha';
import { posix, win32 } from 'path';
import { getVSCodeTestIsolate } from '../../.scripts/vscodeTestPath';

const posixScriptDirectory = '/worktrees/agent/Extension/.scripts';
const windowsScriptDirectory = 'C:\\worktrees\\agent\\Extension\\.scripts';

function getWorktreeHash(scriptDirectory: string): string {
    return createHash('sha256').update(scriptDirectory).digest('hex').substring(0, 6);
}

describe('VS Code test isolate path', () => {
    it('uses XDG_CACHE_HOME on Linux', () => {
        assert.strictEqual(
            getVSCodeTestIsolate(posixScriptDirectory, 'linux', { XDG_CACHE_HOME: '/cache' }, '/home/developer'),
            posix.resolve('/cache', 'vscode-cpptools', 'vscode-test', getWorktreeHash(posixScriptDirectory)));
    });

    it('falls back to the user cache directory on Linux', () => {
        const expected = posix.resolve('/home/developer', '.cache', 'vscode-cpptools', 'vscode-test', getWorktreeHash(posixScriptDirectory));

        assert.strictEqual(
            getVSCodeTestIsolate(posixScriptDirectory, 'linux', {}, '/home/developer'),
            expected);
        assert.strictEqual(
            getVSCodeTestIsolate(posixScriptDirectory, 'linux', { XDG_CACHE_HOME: 'relative-cache' }, '/home/developer'),
            expected);
    });

    it('uses the user cache directory on macOS', () => {
        assert.strictEqual(
            getVSCodeTestIsolate(posixScriptDirectory, 'darwin', {}, '/Users/developer'),
            posix.resolve('/Users/developer', 'Library', 'Caches', 'vscode-cpptools', 'vscode-test', getWorktreeHash(posixScriptDirectory)));
    });

    it('uses LOCALAPPDATA on Windows', () => {
        assert.strictEqual(
            getVSCodeTestIsolate(windowsScriptDirectory, 'win32', { LOCALAPPDATA: 'D:\\LocalAppData' }, 'C:\\Users\\developer'),
            win32.resolve('D:\\LocalAppData', 'Microsoft', 'vscode-cpptools', 'vscode-test', getWorktreeHash(windowsScriptDirectory)));
    });

    it('falls back to the user profile on Windows', () => {
        const expected = win32.resolve('C:\\Users\\developer', 'AppData', 'Local', 'Microsoft', 'vscode-cpptools', 'vscode-test', getWorktreeHash(windowsScriptDirectory));

        assert.strictEqual(
            getVSCodeTestIsolate(windowsScriptDirectory, 'win32', {}, 'C:\\Users\\developer'),
            expected);
        assert.strictEqual(
            getVSCodeTestIsolate(windowsScriptDirectory, 'win32', { LOCALAPPDATA: 'relative-cache' }, 'C:\\Users\\developer'),
            expected);
        assert.strictEqual(
            getVSCodeTestIsolate(windowsScriptDirectory, 'win32', { LOCALAPPDATA: '\\relative-cache' }, 'C:\\Users\\developer'),
            expected);
    });

    it('honors CPPTOOLS_VSCODE_TEST_ROOT without sharing worktree isolates', () => {
        const environment = { CPPTOOLS_VSCODE_TEST_ROOT: '/test-root', XDG_CACHE_HOME: '/cache' };
        const first = getVSCodeTestIsolate('/worktrees/first/Extension/.scripts', 'linux', environment, '/home/developer');
        const firstAgain = getVSCodeTestIsolate('/worktrees/first/Extension/.scripts', 'linux', environment, '/home/developer');
        const second = getVSCodeTestIsolate('/worktrees/second/Extension/.scripts', 'linux', environment, '/home/developer');

        assert.strictEqual(first, firstAgain);
        assert.match(posix.basename(first), /^[0-9a-f]{6}$/);
        assert.notStrictEqual(first, second);
        assert.strictEqual(posix.dirname(first), '/test-root');
        assert.strictEqual(posix.dirname(second), '/test-root');
    });

    it('accepts fully qualified Windows CPPTOOLS_VSCODE_TEST_ROOT values', () => {
        const driveRoot = 'D:\\test-root';
        const uncRoot = '\\\\server\\share\\test-root';

        assert.strictEqual(
            getVSCodeTestIsolate(windowsScriptDirectory, 'win32', { CPPTOOLS_VSCODE_TEST_ROOT: driveRoot }, 'C:\\Users\\developer'),
            win32.resolve(driveRoot, getWorktreeHash(windowsScriptDirectory)));
        assert.strictEqual(
            getVSCodeTestIsolate(windowsScriptDirectory, 'win32', { CPPTOOLS_VSCODE_TEST_ROOT: uncRoot }, 'C:\\Users\\developer'),
            win32.resolve(uncRoot, getWorktreeHash(windowsScriptDirectory)));
    });

    it('rejects non-fully-qualified CPPTOOLS_VSCODE_TEST_ROOT values', () => {
        assert.throws(
            () => getVSCodeTestIsolate(posixScriptDirectory, 'linux', { CPPTOOLS_VSCODE_TEST_ROOT: 'test-root' }, '/home/developer'),
            /CPPTOOLS_VSCODE_TEST_ROOT must be a fully qualified absolute path/);
        assert.throws(
            () => getVSCodeTestIsolate(windowsScriptDirectory, 'win32', { CPPTOOLS_VSCODE_TEST_ROOT: 'C:' }, 'C:\\Users\\developer'),
            /CPPTOOLS_VSCODE_TEST_ROOT must be a fully qualified absolute path/);
        assert.throws(
            () => getVSCodeTestIsolate(windowsScriptDirectory, 'win32', { CPPTOOLS_VSCODE_TEST_ROOT: '\\test-root' }, 'C:\\Users\\developer'),
            /CPPTOOLS_VSCODE_TEST_ROOT must be a fully qualified absolute path/);
        assert.throws(
            () => getVSCodeTestIsolate(windowsScriptDirectory, 'win32', { CPPTOOLS_VSCODE_TEST_ROOT: '/test-root' }, 'C:\\Users\\developer'),
            /CPPTOOLS_VSCODE_TEST_ROOT must be a fully qualified absolute path/);
    });
});
