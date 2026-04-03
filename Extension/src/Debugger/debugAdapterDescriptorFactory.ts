/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as os from 'os';
import * as path from 'path';
import * as vscode from "vscode";
import * as nls from 'vscode-nls';
import { RunWithoutDebuggingAdapter } from './runWithoutDebuggingAdapter';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

// Registers DebugAdapterDescriptorFactory for `cppdbg` and `cppvsdbg`.
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

    async createDebugAdapterDescriptor(session: vscode.DebugSession, _executable?: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor> {
        if (session.configuration.noDebug) {
            return new vscode.DebugAdapterInlineImplementation(new RunWithoutDebuggingAdapter());
        }

        const adapter: string = "./debugAdapters/bin/OpenDebugAD7" + (os.platform() === 'win32' ? ".exe" : "");

        const command: string = path.join(this.context.extensionPath, adapter);

        return new vscode.DebugAdapterExecutable(command, []);
    }
}

export class CppvsdbgDebugAdapterDescriptorFactory extends AbstractDebugAdapterDescriptorFactory {

    async createDebugAdapterDescriptor(session: vscode.DebugSession, _executable?: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor | null> {
        if (session.configuration.noDebug) {
            return new vscode.DebugAdapterInlineImplementation(new RunWithoutDebuggingAdapter());
        }

        if (os.platform() !== 'win32') {
            void vscode.window.showErrorMessage(localize("debugger.not.available", "Debugger type '{0}' is not available for non-Windows machines.", "cppvsdbg"));
            return null;
        } else {
            return new vscode.DebugAdapterExecutable(
                path.join(this.context.extensionPath, './debugAdapters/vsdbg/bin/vsdbg.exe'),
                ['--interpreter=vscode', '--extConfigDir=%USERPROFILE%\\.cppvsdbg\\extensions']
            );
        }
    }
}
