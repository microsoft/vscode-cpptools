/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from "vscode";
import * as util from '../common';
import * as path from 'path';
import * as os from 'os';
import * as nls from 'vscode-nls';

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
    public static DEBUG_TYPE: string = "cppdbg";

    constructor(context: vscode.ExtensionContext) {
        super(context);
    }

    async createDebugAdapterDescriptor(session: vscode.DebugSession, executable?: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor> {
        if (await util.isExtensionReady()) {
            let command: string = path.join(this.context.extensionPath, './debugAdapters/OpenDebugAD7');

            // Windows has the exe in debugAdapters/bin.
            if (os.platform() === 'win32') {
                command = path.join(this.context.extensionPath, "./debugAdapters/bin/OpenDebugAD7.exe");
            }

            return new vscode.DebugAdapterExecutable(command, []);
        } else {
            throw new Error(util.extensionNotReadyString);
        }
    }
}

export class CppvsdbgDebugAdapterDescriptorFactory extends AbstractDebugAdapterDescriptorFactory {
    public static DEBUG_TYPE: string = "cppvsdbg";

    constructor(context: vscode.ExtensionContext) {
        super(context);
    }

    async createDebugAdapterDescriptor(session: vscode.DebugSession, executable?: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor | null> {
        if (os.platform() !== 'win32') {
            vscode.window.showErrorMessage(localize("debugger.not.available", "Debugger type '{0}' is not avaliable for non-Windows machines.", "cppvsdbg"));
            return null;
        } else {
            if (await util.isExtensionReady()) {
                return new vscode.DebugAdapterExecutable(
                    path.join(this.context.extensionPath, './debugAdapters/vsdbg/bin/vsdbg.exe'),
                    ['--interpreter=vscode']
                );
            } else {
                throw new Error(util.extensionNotReadyString);
            }
        }
    }
}
