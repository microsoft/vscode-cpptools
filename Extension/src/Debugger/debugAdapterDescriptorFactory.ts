/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from "vscode";
import * as util from '../common';
import * as path from 'path';
import * as os from 'os';

// Registers DebugAdapterDescriptorFactory for `cppdbg` and `cppvsdbg`. If it is not ready, it will prompt a wait for the download dialog.
// Note: util.extensionContext.extensionPath is needed for the commands because VsCode does not support relative paths for adapterExecutableComand

export class CppdbgDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    public static DEBUG_TYPE : string = "cppdbg";

    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return util.isExtensionReady().then(ready => {
            if (ready) {
                let command: string = path.join(util.extensionContext.extensionPath, './debugAdapters/OpenDebugAD7');

                // Windows has the exe in debugAdapters/bin.
                if (os.platform() === 'win32') {
                    command = path.join(util.extensionContext.extensionPath, "./debugAdapters/bin/OpenDebugAD7.exe");
                }

                return new vscode.DebugAdapterExecutable(command);
            } else {
                throw new Error(util.extensionNotReadyString);
            }
        });
    }
}

export class CppvsdbgDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    public static DEBUG_TYPE : string = "cppvsdbg";

    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        if (os.platform() !== 'win32') {
            vscode.window.showErrorMessage("Debugger type 'cppvsdbg' is not avaliable for non-Windows machines.");
            return null;
        } else {
            return util.isExtensionReady().then(ready => {
                if (ready) {
                    return new vscode.DebugAdapterExecutable(
                        path.join(util.extensionContext.extensionPath, './debugAdapters/vsdbg/bin/vsdbg.exe'),
                        ['--interpreter=vscode']
                    );
                } else {
                    throw new Error(util.extensionNotReadyString);
                }
            });
        }
    }
}