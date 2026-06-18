/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as os from 'os';
import * as path from 'path';
import * as vscode from "vscode";
import * as nls from 'vscode-nls';
import { getOutputChannel } from '../logger';
import { logDebuggerEvent } from '../telemetry';
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
        const properties: { [key: string]: string } = { type: 'cppdbg', noDebug: Boolean(session.configuration.noDebug).toString() };
        try {
            if (session.configuration.noDebug) {
                if (noDebugSupported(session.configuration)) {
                    return new vscode.DebugAdapterInlineImplementation(new RunWithoutDebuggingAdapter());
                }
                // If the configuration is not supported, gracefully fall back to a regular debug session and log a message to the user.
                logReasonForNoDebugNotSupported(session.configuration);
                properties.noDebugSkipped = true.toString();
            }

            const adapter: string = "./debugAdapters/bin/OpenDebugAD7" + (os.platform() === 'win32' ? ".exe" : "");

            const command: string = path.join(this.context.extensionPath, adapter);

            return new vscode.DebugAdapterExecutable(command, []);
        } finally {
            logDebuggerEvent('createDebugAdapter', properties);
        }
    }
}

export class CppvsdbgDebugAdapterDescriptorFactory extends AbstractDebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(session: vscode.DebugSession, _executable?: vscode.DebugAdapterExecutable): Promise<vscode.DebugAdapterDescriptor | null> {
        const properties: { [key: string]: string } = { type: 'cppvsdbg', noDebug: Boolean(session.configuration.noDebug).toString() };
        try {
            if (session.configuration.noDebug) {
                if (noDebugSupported(session.configuration)) {
                    return new vscode.DebugAdapterInlineImplementation(new RunWithoutDebuggingAdapter());
                }
                // If the configuration is not supported, gracefully fall back to a regular debug session and log a message to the user.
                logReasonForNoDebugNotSupported(session.configuration);
                properties.noDebugSkipped = true.toString();
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
        } finally {
            logDebuggerEvent('createDebugAdapter', properties);
        }
    }
}

function noDebugSupported(configuration: vscode.DebugConfiguration): boolean {
    // Don't attempt to start a noDebug session if the configuration has any of these properties, which require a debug adapter to function.
    return configuration.request === 'launch' && !configuration.pipeTransport && !configuration.debugServerPath && !configuration.miDebuggerServerAddress && !configuration.coreDumpPath;
}

function logReasonForNoDebugNotSupported(configuration: vscode.DebugConfiguration): void {
    const outputChannel = getOutputChannel();
    if (configuration.request !== 'launch') {
        outputChannel.appendLine(localize("debugger.noDebug.requestType.not.supported", "Run Without Debugging is only supported for launch configurations."));
    }
    if (configuration.pipeTransport) {
        outputChannel.appendLine(localize("debugger.noDebug.pipeTransport.not.supported", "Run Without Debugging is not supported for configurations with 'pipeTransport' set."));
    }
    if (configuration.debugServerPath) {
        outputChannel.appendLine(localize("debugger.noDebug.debugServerPath.not.supported", "Run Without Debugging is not supported for configurations with 'debugServerPath' set."));
    }
    if (configuration.miDebuggerServerAddress) {
        outputChannel.appendLine(localize("debugger.noDebug.miDebuggerServerAddress.not.supported", "Run Without Debugging is not supported for configurations with 'miDebuggerServerAddress' set."));
    }
    if (configuration.coreDumpPath) {
        outputChannel.appendLine(localize("debugger.noDebug.coreDumpPath.not.supported", "Run Without Debugging is not supported for configurations with 'coreDumpPath' set."));
    }
    outputChannel.show(true);
}
