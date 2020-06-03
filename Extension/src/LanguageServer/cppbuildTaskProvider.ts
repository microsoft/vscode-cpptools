/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import * as vscode from 'vscode';
import * as os from 'os';
import * as util from '../common';
import * as telemetry from '../telemetry';
import { Client } from './client';
import * as configs from './configurations';
import * as ext from './extension';

interface CppBuildTaskDefinition extends vscode.TaskDefinition {
    type: string; // shell
    label: string;
    command: string;
    args: string[];
    options: undefined | Record<string, string>;
}

export class CppBuildTaskProvider implements vscode.TaskProvider {
    static CppBuildScriptType: string = 'cppbuild';
    private tasks: vscode.Task[] | undefined;

    constructor() {}

    public async provideTasks(): Promise<vscode.Task[]> {
        return this.getTasks();
    }

    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        // return this.getTask(compilerPath, compilerArgs);
        const command: string = _task.definition.command;
        if (command) {
            const definition: CppBuildTaskDefinition = <any>_task.definition;
            return this.getTask(definition.command, definition.args ? definition.args : [], definition);
        }
        return undefined;
    }

    // Generate tasks to build the current file based on the user's detected compilers, the user's compilerPath setting, and the current file's extension.
    public async getTasks(): Promise<vscode.Task[]> {
        this.tasks = [];
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!editor) {
            return [];
        }

        const fileExt: string = path.extname(editor.document.fileName);
        if (!fileExt) {
            return [];
        }

        // Don't offer tasks for header files.
        const fileExtLower: string = fileExt.toLowerCase();
        const isHeader: boolean = !fileExt || [".hpp", ".hh", ".hxx", ".h", ".inl", ""].some(ext => fileExtLower === ext);
        if (isHeader) {
            return [];
        }

        // Don't offer tasks if the active file's extension is not a recognized C/C++ extension.
        let fileIsCpp: boolean;
        let fileIsC: boolean;
        if (fileExt === ".C") { // ".C" file extensions are both C and C++.
            fileIsCpp = true;
            fileIsC = true;
        } else {
            fileIsCpp = [".cpp", ".cc", ".cxx", ".mm", ".ino"].some(ext => fileExtLower === ext);
            fileIsC = fileExtLower === ".c";
        }
        if (!(fileIsCpp || fileIsC)) {
            return [];
        }

        // Get compiler paths.
        const isWindows: boolean = os.platform() === 'win32';
        let activeClient: Client;
        try {
            activeClient = ext.getActiveClient();
        } catch (e) {
            if (!e || e.message !== ext.intelliSenseDisabledError) {
                console.error("Unknown error calling getActiveClient().");
            }
            return []; // Language service features may be disabled.
        }

        // Get user compiler path.
        const userCompilerPathAndArgs: util.CompilerPathAndArgs | undefined = await activeClient.getCurrentCompilerPathAndArgs();
        let userCompilerPath: string | undefined;
        if (userCompilerPathAndArgs) {
            userCompilerPath = userCompilerPathAndArgs.compilerPath;
            if (userCompilerPath && userCompilerPathAndArgs.compilerName) {
                userCompilerPath = userCompilerPath.trim();
                if (isWindows && userCompilerPath.startsWith("/")) { // TODO: Add WSL compiler support.
                    userCompilerPath = undefined;
                } else {
                    userCompilerPath = userCompilerPath.replace(/\\\\/g, "\\");
                }
            }
        }

        // Get known compiler paths. Do not include the known compiler path that is the same as user compiler path.
        // Filter them based on the file type to get a reduced list appropriate for the active file.
        let knownCompilerPaths: string[] | undefined;
        let knownCompilers: configs.KnownCompiler[]  | undefined = await activeClient.getKnownCompilers();
        if (knownCompilers) {
            knownCompilers = knownCompilers.filter(info =>
                ((fileIsCpp && !info.isC) || (fileIsC && info.isC)) &&
                    userCompilerPathAndArgs &&
                    (path.basename(info.path) !== userCompilerPathAndArgs.compilerName) &&
                    (!isWindows || !info.path.startsWith("/"))); // TODO: Add WSL compiler support.
            knownCompilerPaths = knownCompilers.map<string>(info => info.path);
        }

        if (!knownCompilerPaths && !userCompilerPath) {
            // Don't prompt a message yet until we can make a data-based decision.
            telemetry.logLanguageServerEvent('noCompilerFound');
            return [];
        }

        // Create a build task per compiler path

        // Tasks for known compiler paths
        if (knownCompilerPaths) {
            this.tasks  = knownCompilerPaths.map<vscode.Task>(compilerPath => this.getTask(compilerPath, undefined));
        }

        // Task for user compiler path setting
        if (userCompilerPath) {
            this.tasks.push(this.getTask(userCompilerPath, userCompilerPathAndArgs?.additionalArgs));
        }

        return this.tasks;
    }

    private getTask: (compilerPath: string, compilerArgs?: string [], definition?: CppBuildTaskDefinition) => vscode.Task = (compilerPath: string, compilerArgs?: string [], definition?: CppBuildTaskDefinition) => {

        const filePath: string = path.join('${fileDirname}', '${fileBasenameNoExtension}');
        const compilerPathBase: string = path.basename(compilerPath);
        const taskName: string = compilerPathBase + " build and debug active file";
        const isCl: boolean = compilerPathBase === "cl.exe";
        const isWindows: boolean = os.platform() === 'win32';
        const cwd: string = isCl ? "" : path.dirname(compilerPath);
        let args: string[] = isCl ? ['/Zi', '/EHsc', '/Fe:', filePath + '.exe', '${file}'] : ['-g', '${file}', '-o', filePath + (isWindows ? '.exe' : '')];
        if (compilerArgs && compilerArgs.length > 0) {
            args = args.concat(compilerArgs);
        }

        let kind: CppBuildTaskDefinition = {
            type: CppBuildTaskProvider.CppBuildScriptType, // shell
            label: taskName,
            command: isCl ? compilerPathBase : compilerPath,
            args: args,
            options: isCl ? undefined : {"cwd": cwd}
        };

        /* if (returnCompilerPath) {
            kind = kind as CppBuildTaskDefinition;
            kind.compilerPath = isCl ? compilerPathBase : compilerPath;
        }*/

        const command: vscode.ShellExecution = new vscode.ShellExecution(compilerPath, [...args], { cwd: cwd });
        let activeClient: Client = ext.getActiveClient();
        let uri: vscode.Uri | undefined = activeClient.RootUri;
        if (!uri) {
            throw new Error("No client URI found in getBuildTasks()");
        }
        const target: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(uri);
        if (!target) {
            throw new Error("No target WorkspaceFolder found in getBuildTasks()");
        }
        let task: vscode.Task = new vscode.Task(kind, target, taskName, ext.taskSourceStr, command, isCl ? '$msCompile' : '$gcc');
        task.definition = kind; // The constructor for vscode.Task will consume the definition. Reset it by reassigning.
        task.group = vscode.TaskGroup.Build;

        return task;
    };
}


