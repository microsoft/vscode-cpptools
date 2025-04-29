/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { configPrefix } from '../LanguageServer/extension';
import { isWindows } from '../constants';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export function isDebugLaunchStr(str: string): boolean {
    return str.startsWith("(gdb) ") || str.startsWith("(lldb") || str.startsWith("(Windows) ");
}

export interface ConfigMenu extends vscode.QuickPickItem {
    configuration: CppDebugConfiguration;
}

export enum DebuggerType {
    cppvsdbg = "cppvsdbg",
    cppdbg = "cppdbg",
    cpplldb = "cpplldb",
    all = "all"
}

export enum DebuggerEvent {
    debugPanel = "debugPanel", // F5 or "Run and Debug" Panel
    playButton = "playButton", // "Run and Debug" play button
    addConfigGear = "AddConfigGear"
}

export enum TaskStatus {
    recentlyUsed = "Recently Used Task", // A configured task that has been used recently.

    configured = "Configured Task", // The tasks that are configured in tasks.json file.
    detected = "Detected Task" // The tasks that are available based on detected compilers.
}

export enum ConfigSource {
    singleFile = "singleFile", // a debug config defined for a single mode file
    workspaceFolder = "workspaceFolder", // a debug config defined in launch.json
    workspace = "workspace", // a debug config defined in workspace level
    global = "global", // a debug config defined in user level
    unknown = "unknown"
}

export enum ConfigMode {
    launchConfig = "launchConfig",
    noLaunchConfig = "noLaunchConfig",
    unknown = "unknown"
}

export enum DebugType {
    debug = "debug",
    run = "run"
}

export interface CppDebugConfiguration extends vscode.DebugConfiguration {
    detail?: string;
    taskStatus?: TaskStatus;
    isDefault?: boolean; // The debug configuration is considered as default, if the prelaunch task is set as default.
    configSource?: ConfigSource;
    debuggerEvent?: DebuggerEvent;
    debugType?: DebugType;
    existing?: boolean;
}

export interface IConfigurationSnippet {
    label: string;
    description: string;
    body: Record<string, any>;

    // Internal
    isInitialConfiguration?: boolean;
    debuggerType: DebuggerType;
}

function createLaunchBlock(name: string, type: string, executable: string): Record<string, any> {
    return {
        name: name,
        type: type,
        request: "launch",
        program: localize("enter.program.name", "enter program name, for example {0}", "${workspaceFolder}" + "/" + executable).replace(/"/g, ''),
        args: [],
        stopAtEntry: false,
        cwd: "${fileDirname}",
        environment: [],
        externalConsole: type === DebuggerType.cppdbg ? false : type === DebuggerType.cpplldb ? true : undefined,
        console: type === DebuggerType.cppvsdbg ? "externalTerminal" : undefined
    };
}

function createAttachBlock(name: string, type: string, executable: string): Record<string, any> {
    return {
        name: name,
        type: type,
        request: "attach",
        program: type === DebuggerType.cppdbg ? localize("enter.program.name", "enter program name, for example {0}", "${workspaceFolder}" + "/" + executable).replace(/"/g, '') : undefined
    };
}

function createRemoteAttachBlock(name: string, type: string, executable: string): Record<string, any> {
    return {
        name: name,
        type: type,
        request: "attach",
        program: localize("enter.program.name", "enter program name, for example {0}", "${workspaceFolder}" + "/" + executable).replace(/"/g, ''),
        processId: "${command:pickRemoteProcess}"
    };
}

function createPipeTransportBlock(pipeProgram: string, debuggerProgram: string, pipeArgs: string[] = []): Record<string, any> {
    return {
        pipeTransport: {
            debuggerPath: `/usr/bin/${debuggerProgram}`,
            pipeProgram: pipeProgram,
            pipeArgs: pipeArgs,
            pipeCwd: ""
        }
    };
}

export abstract class Configuration {
    abstract GetLaunchConfiguration(): IConfigurationSnippet;
    abstract GetAttachConfiguration(): IConfigurationSnippet;
}

/** Creates Configurations for an MI debugger */
export class MIConfigurations extends Configuration {

    constructor(public MIMode: string, public executable: string, public additionalProperties: Record<string, any> = {}) {
        super();
    }

    public GetLaunchConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("launch.string", "Launch").replace(/"/g, '')}`;

        return {
            label: configPrefix + name,
            description: localize("launch.with", "Launch with {0}.", this.MIMode).replace(/"/g, ''),
            body: {
                ...createLaunchBlock(name, DebuggerType.cppdbg, this.executable),
                MIMode: this.MIMode,
                miDebuggerPath: isWindows ? "/path/to/gdb" : undefined,
                ...this.additionalProperties
            },
            isInitialConfiguration: true,
            debuggerType: DebuggerType.cppdbg
        };
    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("attach.string", "Attach").replace(/"/g, '')}`;
        return {
            label: configPrefix + name,
            description: localize("attach.with", "Attach with {0}.", this.MIMode).replace(/"/g, ''),
            body: {
                ...createAttachBlock(name, DebuggerType.cppdbg, this.executable),
                MIMode: this.MIMode,
                miDebuggerPath: isWindows ? "/path/to/gdb" : undefined,
                ...this.additionalProperties
            },
            debuggerType: DebuggerType.cppdbg
        };
    }
}

export class PipeTransportConfigurations extends Configuration {

    constructor(public MIMode: string, public executable: string, public pipeProgram: string, public additionalProperties: Record<string, any> = {}) {
        super();
    }
    public GetLaunchConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("pipe.launch", "Pipe Launch").replace(/"/g, '')}`;

        return {
            label: configPrefix + name,
            description: localize("pipe.launch.with", "Pipe Launch with {0}.", this.MIMode).replace(/"/g, ''),
            body: {
                ...createLaunchBlock(name, DebuggerType.cppdbg, this.executable),
                ...createPipeTransportBlock(this.pipeProgram, this.MIMode),
                MIMode: this.MIMode,
                ...this.additionalProperties
            },
            debuggerType: DebuggerType.cppdbg
        };

    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("pipe.attach", "Pipe Attach").replace(/"/g, '')}`;

        return {
            label: configPrefix + name,
            description: localize("pipe.attach.with", "Pipe Attach with {0}.", this.MIMode).replace(/"/g, ''),
            body: {
                ...createRemoteAttachBlock(name, DebuggerType.cppdbg, this.executable),
                ...createPipeTransportBlock(this.pipeProgram, this.MIMode),
                MIMode: this.MIMode,
                ...this.additionalProperties
            },
            debuggerType: DebuggerType.cppdbg
        };

    }
}

export class WindowsConfigurations extends Configuration {
    constructor(public executable: string, public additionalProperties: Record<string, any> = {}) {
        super();
    }

    public GetLaunchConfiguration(): IConfigurationSnippet {
        const name: string = `(Windows) ${localize("launch.string", "Launch").replace(/"/g, '')}`;

        return {
            label: configPrefix + name,
            description: localize("launch.with.vs.debugger", "Launch with the Visual Studio C/C++ debugger.").replace(/"/g, ''),
            body: createLaunchBlock(name, DebuggerType.cppvsdbg, this.executable),
            isInitialConfiguration: true,
            debuggerType: DebuggerType.cppvsdbg
        };

    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        const name: string = `(Windows) ${localize("attach.string", "Attach").replace(/"/g, '')}`;

        return {
            label: configPrefix + name,
            description: localize("attach.with.vs.debugger", "Attach to a process with the Visual Studio C/C++ debugger.").replace(/"/g, ''),
            body: createAttachBlock(name, DebuggerType.cppvsdbg, this.executable),
            debuggerType: DebuggerType.cppvsdbg
        };

    }
}

export class WSLConfigurations extends Configuration {
    constructor(public MIMode: string, public executable: string, public additionalProperties: Record<string, any> = {}) {
        super();
    }
    // Detects if the current VSCode is 32-bit and uses the correct bash.exe
    public bashPipeProgram = process.arch === 'ia32' ? "${env:windir}\\\\sysnative\\\\bash.exe" : "${env:windir}\\\\system32\\\\bash.exe";

    public GetLaunchConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("bash.on.windows.launch", "Bash on Windows Launch").replace(/"/g, '')}`;

        return {
            label: configPrefix + name,
            description: localize("launch.bash.windows", "Launch in Bash on Windows using {0}.", this.MIMode).replace(/"/g, ''),
            body: {
                ...createLaunchBlock(name, DebuggerType.cppdbg, this.executable),
                ...createPipeTransportBlock(this.bashPipeProgram, this.MIMode, ["-c"]),
                ...this.additionalProperties
            },
            debuggerType: DebuggerType.cppdbg
        };
    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("bash.on.windows.attach", "Bash on Windows Attach").replace(/"/g, '')}`;
        return {
            label: configPrefix + name,
            description: localize("remote.attach.bash.windows", "Attach to a remote process running in Bash on Windows using {0}.", this.MIMode).replace(/"/g, ''),
            body: {
                ...createRemoteAttachBlock(name, DebuggerType.cppdbg, this.executable),
                ...createPipeTransportBlock(this.bashPipeProgram, this.MIMode, ["-c"]),
                ...this.additionalProperties
            },
            debuggerType: DebuggerType.cppdbg
        };
    }
}

/** Creates Configurations for an LLDB-DAP debugger */
export class LldbDapConfigurations extends Configuration {

    constructor(public executable: string, public additionalProperties: Record<string, any> = {}) {
        super();
    }

    public GetLaunchConfiguration(): IConfigurationSnippet {
        const name: string = `(lldb-dap) ${localize("launch.string", "Launch").replace(/"/g, '')}`;

        return {
            label: configPrefix + name,
            description: localize("launch.with", "Launch with {0}.", "LLDB-DAP").replace(/"/g, ''),
            body: {
                ...createLaunchBlock(name, DebuggerType.cpplldb, this.executable),
                ...this.additionalProperties
            },
            isInitialConfiguration: true,
            debuggerType: DebuggerType.cpplldb
        };
    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        const name: string = `(lldb-dap) ${localize("attach.string", "Attach").replace(/"/g, '')}`;
        return {
            label: configPrefix + name,
            description: localize("attach.with", "Attach with {0}.", "LLDB-DAP").replace(/"/g, ''),
            body: {
                ...createAttachBlock(name, DebuggerType.cpplldb, this.executable),
                ...this.additionalProperties
            },
            debuggerType: DebuggerType.cpplldb
        };
    }
}
