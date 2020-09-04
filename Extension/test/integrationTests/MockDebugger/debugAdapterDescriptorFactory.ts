/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from "vscode";
import * as path from 'path';

// import * as util from '../src/common' <- DO NOT USE. Also do not use anything with relative paths, it will break during replacing in test/integrationTests/debug/integration.test.ts

abstract class AbstractDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    protected readonly context: vscode.ExtensionContext;

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

    createDebugAdapterDescriptor(session: vscode.DebugSession, executable?: vscode.DebugAdapterExecutable): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        console.warn("This should only appear in a test scenario.");

        return new vscode.DebugAdapterExecutable('node', [path.join(this.context.extensionPath, './out/test/integrationTests/MockDebugger/mockDebug.js')]);
    }
}

export class CppvsdbgDebugAdapterDescriptorFactory extends AbstractDebugAdapterDescriptorFactory {
    public static DEBUG_TYPE: string = "cppvsdbg";

    constructor(context: vscode.ExtensionContext) {
        super(context);
    }

    createDebugAdapterDescriptor(session: vscode.DebugSession, executable?: vscode.DebugAdapterExecutable): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        console.warn("This should only appear in a test scenario.");

        return new vscode.DebugAdapterExecutable('node', [path.join(this.context.extensionPath, './out/test/integrationTests/MockDebugger/mockDebug.js')]);
    }
}
