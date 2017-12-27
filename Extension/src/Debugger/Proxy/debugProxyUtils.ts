/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// This file is a minimal version of commons.ts for debuggerProxy.ts

// WARNING: This file cannot import vscode or it will break the cpptools build.
// Also, this runs outside of the VS Code instance and needs to not have dependencies on vscode or else it won’t run properly.
//import * as vscode from 'vscode';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as child_process from 'child_process';

var extensionPath: string;

/** Get the root path of the extension */
export function getExtensionPath(): string {
    extensionPath = path.resolve(__dirname, '../../../../');
    console.log(extensionPath)
    return extensionPath;
}

/** Get the path to debugAdapters under the extension folder */
export function getDebugAdaptersPath(file: string): string {
    return path.resolve(getExtensionPath(), "debugAdapters", file);
}

export function checkInstallLockFile(): Promise<boolean> {
    return checkFileExists(getInstallLockPath());
}

export function checkPackageLockFile() : Promise<boolean> {
    return checkFileExists(getPackageLockPath());
}

/** Test whether a file exists */
export function checkFileExists(filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        fs.stat(filePath, (err, stats) => {
            if (stats && stats.isFile()) {
                resolve(true);
            }
            else {
                resolve(false);
            }
        })
    });
}

function touchFile(file: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.writeFile(file, "", (err) => {
            if (err) {
                reject(err);
            }
            resolve();
        });
    });
}

export function touchDebuggerReloadFile(): Promise<void> {
    return touchFile(getDebuggerReloadPath());
}

/** Get the path of the lock file. This is used to indicate that the platform-specific dependencies have been downloaded.
 */
export function getInstallLockPath(): string {
    return path.resolve(getExtensionPath(), `install.lock`);
}

export function getPackageLockPath(): string {
    return path.resolve(getExtensionPath(), `package.lock`);
}

export function getDebuggerReloadPath(): string {
    return path.resolve(getExtensionPath(), `debugger.reload`);
}

/** Used for diagnostics only */
export function logToFile(message: string): void {
    var logFolder = path.resolve(getExtensionPath(), "extension.log");
    fs.writeFileSync(logFolder, `${message}${os.EOL}`, { flag: 'a' });
}