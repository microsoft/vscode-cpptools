/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as os from 'os';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export enum DebuggerType {
    cppvsdbg,
    cppdbg
}

export interface IConfigurationSnippet {
    label: string;
    description: string;
    bodyText: string;

    // Internal
    isInitialConfiguration?: boolean;
    debuggerType: DebuggerType;
}

export function indentJsonString(json: string, numTabs: number = 1): string {
    return json.split('\n').map(line => '\t'.repeat(numTabs) + line).join('\n').trim();
}

function formatString(format: string, args: string[]): string {
    args.forEach((arg: string, index: number) => {
        format = format.replace("{" + index + "}", arg);
    });
    return format;
}

function createLaunchString(name: string, type: string, executable: string): string {
    return `"name": "${name}",
"type": "${type}",
"request": "launch",
"program": "${localize("enter.program.name", "enter program name, for example {0}", "$\{workspaceFolder\}" + "/" + executable).replace(/\"/g, "\\\"")}",
"args": [],
"stopAtEntry": false,
"cwd": "$\{fileDirname\}",
"environment": [],
${ type === "cppdbg" ? `"externalConsole": false` : `"console": "externalTerminal"` }
`;
}

function createAttachString(name: string, type: string, executable: string): string {
    return formatString(`
"name": "${name}",
"type": "${type}",
"request": "attach",{0}
"processId": "$\{command:pickProcess\}"
`, [type === "cppdbg" ? `${os.EOL}"program": "${localize("enter.program.name", "enter program name, for example {0}", "$\{workspaceFolder\}" + "/" + executable).replace(/\"/g, "\\\"")}",` : ""]);
}

function createRemoteAttachString(name: string, type: string, executable: string): string {
    return `
"name": "${name}",
"type": "${type}",
"request": "attach",
"program": "${localize("enter.program.name", "enter program name, for example {0}", "$\{workspaceFolder\}" + "/" + executable).replace(/\"/g, "\\\"")}",
"processId": "$\{command:pickRemoteProcess\}"
`;
}

function createPipeTransportString(pipeProgram: string, debuggerProgram: string, pipeArgs: string[] = []): string {
    return `
"pipeTransport": {
\t"debuggerPath": "/usr/bin/${debuggerProgram}",
\t"pipeProgram": "${pipeProgram}",
\t"pipeArgs": ${JSON.stringify(pipeArgs)},
\t"pipeCwd": ""
}`;
}

export interface IConfiguration {
    GetLaunchConfiguration(): IConfigurationSnippet;
    GetAttachConfiguration(): IConfigurationSnippet;
}

abstract class Configuration implements IConfiguration {
    public snippetPrefix = "C/C++: ";

    public executable: string;
    public pipeProgram: string;
    public MIMode: string;
    public additionalProperties: string;

    public miDebugger = "cppdbg";
    public windowsDebugger = "cppvsdbg";

    constructor(MIMode: string, executable: string, pipeProgram: string, additionalProperties: string = "") {
        this.MIMode = MIMode;
        this.executable = executable;
        this.pipeProgram = pipeProgram;
        this.additionalProperties = additionalProperties;
    }

    abstract GetLaunchConfiguration(): IConfigurationSnippet;
    abstract GetAttachConfiguration(): IConfigurationSnippet;
}

export class MIConfigurations extends Configuration {

    public GetLaunchConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("launch.string", "Launch").replace(/\"/g, "\\\"")}`;

        const body: string = formatString(`{
\t${indentJsonString(createLaunchString(name, this.miDebugger, this.executable))},
\t"MIMode": "${this.MIMode}"{0}{1}
}`, [this.miDebugger === "cppdbg" && os.platform() === "win32" ? `,${os.EOL}\t"miDebuggerPath": "/path/to/gdb"` : "",
            this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": localize("launch.with", "Launch with {0}.", this.MIMode).replace(/\"/g, "\\\""),
            "bodyText": body.trim(),
            "isInitialConfiguration": true,
            "debuggerType": DebuggerType.cppdbg
        };
    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("attach.string", "Attach").replace(/\"/g, "\\\"")}`;

        const body: string = formatString(`{
\t${indentJsonString(createAttachString(name, this.miDebugger, this.executable))},
\t"MIMode": "${this.MIMode}"{0}{1}
}`, [this.miDebugger === "cppdbg" && os.platform() === "win32" ? `,${os.EOL}\t"miDebuggerPath": "/path/to/gdb"` : "",
            this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": localize("attach.with", "Attach with {0}.", this.MIMode).replace(/\"/g, "\\\""),
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };

    }
}

export class PipeTransportConfigurations extends Configuration {

    public GetLaunchConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("pipe.launch", "Pipe Launch").replace(/\"/g, "\\\"")}`;

        const body: string = formatString(`
{
\t${indentJsonString(createLaunchString(name, this.miDebugger, this.executable))},
\t${indentJsonString(createPipeTransportString(this.pipeProgram, this.MIMode))},
\t"MIMode": "${this.MIMode}"{0}
}`, [this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": localize("pipe.launch.with", "Pipe Launch with {0}.", this.MIMode).replace(/\"/g, "\\\""),
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };

    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("pipe.attach", "Pipe Attach").replace(/\"/g, "\\\"")}`;

        const body: string = formatString(`
{
\t${indentJsonString(createRemoteAttachString(name, this.miDebugger, this.executable))},
\t${indentJsonString(createPipeTransportString(this.pipeProgram, this.MIMode))},
\t"MIMode": "${this.MIMode}"{0}
}`, [this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);
        return {
            "label": this.snippetPrefix + name,
            "description": localize("pipe.attach.with", "Pipe Attach with {0}.", this.MIMode).replace(/\"/g, "\\\""),
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };

    }
}

export class WindowsConfigurations extends Configuration {

    public GetLaunchConfiguration(): IConfigurationSnippet {
        const name: string = `(Windows) ${localize("launch.string", "Launch").replace(/\"/g, "\\\"")}`;

        const body: string = `
{
\t${indentJsonString(createLaunchString(name, this.windowsDebugger, this.executable))}
}`;

        return {
            "label": this.snippetPrefix + name,
            "description": localize("launch.with.vs.debugger", "Launch with the Visual Studio C/C++ debugger.").replace(/\"/g, "\\\""),
            "bodyText": body.trim(),
            "isInitialConfiguration": true,
            "debuggerType": DebuggerType.cppvsdbg
        };

    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        const name: string = `(Windows) ${localize("attach.string", "Attach").replace(/\"/g, "\\\"")}`;

        const body: string = `
{
\t${indentJsonString(createAttachString(name, this.windowsDebugger, this.executable))}
}`;

        return {
            "label": this.snippetPrefix + name,
            "description": localize("attach.with.vs.debugger", "Attach to a process with the Visual Studio C/C++ debugger.").replace(/\"/g, "\\\""),
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppvsdbg
        };

    }
}

export class WSLConfigurations extends Configuration {
    // Detects if the current VSCode is 32-bit and uses the correct bash.exe
    public bashPipeProgram = process.arch === 'ia32' ? "${env:windir}\\\\sysnative\\\\bash.exe" : "${env:windir}\\\\system32\\\\bash.exe";

    public GetLaunchConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("bash.on.windows.launch", "Bash on Windows Launch").replace(/\"/g, "\\\"")}`;

        const body: string = formatString(`
{
\t${indentJsonString(createLaunchString(name, this.miDebugger, this.executable))},
\t${indentJsonString(createPipeTransportString(this.bashPipeProgram, this.MIMode, ["-c"]))}{0}
}`, [this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": localize("launch.bash.windows", "Launch in Bash on Windows using {0}.", this.MIMode).replace(/\"/g, "\\\""),
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };
    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        const name: string = `(${this.MIMode}) ${localize("bash.on.windows.attach", "Bash on Windows Attach").replace(/\"/g, "\\\"")}`;

        const body: string = formatString(`
{
\t${indentJsonString(createRemoteAttachString(name, this.miDebugger, this.executable))},
\t${indentJsonString(createPipeTransportString(this.bashPipeProgram, this.MIMode, ["-c"]))}{0}
}`, [this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": localize("remote.attach.bash.windows", "Attach to a remote process running in Bash on Windows using {0}.", this.MIMode).replace(/\"/g, "\\\""),
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };
    }
}
