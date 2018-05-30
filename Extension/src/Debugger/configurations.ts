/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

 import * as os from 'os';

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
    for (let arg in args) {
        format = format.replace("{" + arg + "}", args[arg]);
    }
    return format;
}

function createLaunchString(name: string, type: string, executable: string): string {
        return `"name": "${name}",
"type": "${type}",
"request": "launch",
"program": "${"enter program name, for example " + "$\{workspaceFolder\}" + "/" + executable}",
"args": [],
"stopAtEntry": false,
"cwd": "$\{workspaceFolder\}",
"environment": [],
"externalConsole": true
`;
    }

function createAttachString(name: string, type: string, executable: string): string {
    return formatString(`
"name": "${name}",
"type": "${type}",
"request": "attach",{0}
"processId": "$\{command:pickProcess\}"
`, [type === "cppdbg" ? `${os.EOL}"program": "${"enter program name, for example $\{workspaceFolder\}/" + executable}",` : ""]);
    }

function createRemoteAttachString(name: string, type: string, executable: string): string {
        return `
"name": "${name}",
"type": "${type}",
"request": "attach",
"program": "${"enter program name, for example $\{workspaceFolder\}/" + executable}",
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
        let name: string = `(${this.MIMode}) Launch`;

        let body: string = formatString(`{
\t${indentJsonString(createLaunchString(name, this.miDebugger, this.executable))},
\t"MIMode": "${this.MIMode}"{0}{1}
}`, [this.miDebugger === "cppdbg" && os.platform() === "win32" ? `,${os.EOL}\t"miDebuggerPath": "/path/to/gdb"` : "", 
this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": `Launch with ${this.MIMode}.`,
            "bodyText": body.trim(),
            "isInitialConfiguration": true,
            "debuggerType": DebuggerType.cppdbg
        };
    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        let name: string = `(${this.MIMode}) Attach`;

        let body: string = formatString(`{ 
\t${indentJsonString(createAttachString(name, this.miDebugger, this.executable))},
\t"MIMode": "${this.MIMode}"{0}{1}
}`, [this.miDebugger === "cppdbg" && os.platform() === "win32" ? `,${os.EOL}\t"miDebuggerPath": "/path/to/gdb"` : "",
this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": `Attach with ${this.MIMode}.`,
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };

    }
}

export class PipeTransportConfigurations extends Configuration {

    public GetLaunchConfiguration(): IConfigurationSnippet {
        let name: string = `(${this.MIMode}) Pipe Launch`;

        let body: string = formatString(`
{
\t${indentJsonString(createLaunchString(name, this.miDebugger, this.executable))},
\t${indentJsonString(createPipeTransportString(this.pipeProgram, this.MIMode))},
\t"MIMode": "${this.MIMode}"{0}
}`, [this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": `Pipe Launch with ${this.MIMode}.`,
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };

    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        let name: string = `(${this.MIMode}) Pipe Attach`;

        let body: string = formatString(`
{
\t${indentJsonString(createRemoteAttachString(name, this.miDebugger, this.executable))},
\t${indentJsonString(createPipeTransportString(this.pipeProgram, this.MIMode))},
\t"MIMode": "${this.MIMode}"{0}
}`, [this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);
        return {
            "label": this.snippetPrefix + name,
            "description": `Pipe Attach with ${this.MIMode}.`,
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };

    }
}

export class WindowsConfigurations extends Configuration {

    public GetLaunchConfiguration(): IConfigurationSnippet {
        let name: string = "(Windows) Launch";

        let body: string = `
{
\t${indentJsonString(createLaunchString(name, this.windowsDebugger, this.executable))}
}`;

        return {
            "label": this.snippetPrefix + name,
            "description": "Launch with the Visual Studio C/C++ debugger.",
            "bodyText": body.trim(),
            "isInitialConfiguration": true,
            "debuggerType": DebuggerType.cppvsdbg
        };

    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        let name: string = "(Windows) Attach";

        let body: string = `
{
\t${indentJsonString(createAttachString(name, this.windowsDebugger, this.executable))}
}`;

        return {
            "label": this.snippetPrefix + name,
            "description": "Attach to a process with the Visual Studio C/C++ debugger.",
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppvsdbg
        };

    }
}

export class WSLConfigurations extends Configuration {
    // Detects if the current VSCode is 32-bit and uses the correct bash.exe
    public bashPipeProgram = process.arch === 'ia32' ? "${env:windir}\\\\sysnative\\\\bash.exe" : "${env:windir}\\\\system32\\\\bash.exe";

    public GetLaunchConfiguration(): IConfigurationSnippet {
        let name: string = `(${this.MIMode}) Bash on Windows Launch`;

        let body: string = formatString(`
{
\t${indentJsonString(createLaunchString(name, this.miDebugger, this.executable))},
\t${indentJsonString(createPipeTransportString(this.bashPipeProgram, this.MIMode, ["-c"]))}{0}
}`, [this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": `Launch in Bash on Windows using ${this.MIMode}.`,
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };
    }

    public GetAttachConfiguration(): IConfigurationSnippet {
        let name: string = `(${this.MIMode}) Bash on Windows Attach`;

        let body: string = formatString(`
{
\t${indentJsonString(createRemoteAttachString(name, this.miDebugger, this.executable))},
\t${indentJsonString(createPipeTransportString(this.bashPipeProgram, this.MIMode, ["-c"]))}{0}
}`, [this.additionalProperties ? `,${os.EOL}\t${indentJsonString(this.additionalProperties)}` : ""]);

        return {
            "label": this.snippetPrefix + name,
            "description": `Attach to a remote process running in Bash on Windows using ${this.MIMode}.`,
            "bodyText": body.trim(),
            "debuggerType": DebuggerType.cppdbg
        };
    }
}
