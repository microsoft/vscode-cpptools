/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as os from 'os';
import * as path from 'path';
import * as vscode from "vscode";
import * as nls from 'vscode-nls';
import { DebuggerType } from './configurations';
import { findLldbDap, isValidLldbDap } from './lldb-dap';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// Registers DebugAdapterDescriptorFactory for `cppdbg` and `cppvsdbg`. If it is not ready, it will prompt a wait for the download dialog.
// NOTE: This file is not automatically tested.

abstract class AbstractDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    protected readonly context: vscode.ExtensionContext;

    // This is important for the Mock Debugger since it can not use src/common
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    abstract createDebugAdapterDescriptor(session: vscode.DebugSession, executable?: vscode.DebugAdapterExecutable): vscode.ProviderResult<vscode.DebugAdapterDescriptor>;
}

export class CppdbgDebugAdapterDescriptorFactory extends AbstractDebugAdapterDescriptorFactory {

    async createDebugAdapterDescriptor(_session: vscode.DebugSession, _executable?: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor> {
        const adapter: string = "./debugAdapters/bin/OpenDebugAD7" + (os.platform() === 'win32' ? ".exe" : "");

        const command: string = path.join(this.context.extensionPath, adapter);

        return new vscode.DebugAdapterExecutable(command, []);
    }
}

export class CppvsdbgDebugAdapterDescriptorFactory extends AbstractDebugAdapterDescriptorFactory {

    async createDebugAdapterDescriptor(_session: vscode.DebugSession, _executable?: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor | null> {
        if (os.platform() !== 'win32') {
            void vscode.window.showErrorMessage(localize("debugger.not.available", "Debugger type '{0}' is not available for non-Windows machines.", DebuggerType.cppvsdbg));
            return null;
        } else {
            return new vscode.DebugAdapterExecutable(
                path.join(this.context.extensionPath, './debugAdapters/vsdbg/bin/vsdbg.exe'),
                ['--interpreter=vscode', '--extConfigDir=%USERPROFILE%\\.cppvsdbg\\extensions']
            );
        }
    }
}

/** Generates the command line for the LLDB-DAP debugger */
export class CpplldbDebugAdapterDescriptorFactory extends AbstractDebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(session: vscode.DebugSession, executable?: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor | null> {

        // The adapter path can be specified in the launch.json entry.
        let adapter: string | undefined = session.configuration.debuggerPath || executable?.command;

        if (adapter) {
            // Verify that the path is actually valid.
            if (!await isValidLldbDap(adapter)) {
                adapter = await findLldbDap();
                if (adapter) {
                    void vscode.window.showErrorMessage(localize("debugger.not.available", "The specified LLDB-DAP debuggerPath '{0}' is not valid, falling back to {1}.", session.configuration.debuggerPath, adapter));
                } else {
                    void vscode.window.showErrorMessage(localize("debugger.not.available", "The specified LLDB-DAP debuggerPath '{0}' is not valid and no fallback was found.", session.configuration.debuggerPath));
                    return null;
                }
            }
        }

        if (!adapter) {
            adapter = await findLldbDap();
        }

        if (!adapter) {
            void vscode.window.showErrorMessage(localize("debugger.not.available", "No LLDB-DAP debugger found. Please add it to the path, or set the debuggerPath property in the launch.json file."));
            return null;
        }

        // Prepare the command to run the lldb dap executable.
        const debuggerArgs = session.configuration.debuggerArgs || [];

        // Future: add support for pipeTransport (so that the lldb-dap executable can be run on a remote machine or wsl).
        // Future: add support for --server mode (so that the lldb dap executable can be run in server mode).

        // Prepare the command to run the lldb-dap executable.
        return new vscode.DebugAdapterExecutable(adapter, [...debuggerArgs]);
    }
}
