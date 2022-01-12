/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable no-unused-expressions */
import * as path from 'path';
import {
    TaskDefinition, Task, TaskGroup, ShellExecution, Uri, workspace,
    TaskProvider, TaskScope, CustomExecution, ProcessExecution, TextEditor, Pseudoterminal, EventEmitter, Event, TerminalDimensions, window, WorkspaceFolder
} from 'vscode';
import * as os from 'os';
import * as util from '../common';
import * as telemetry from '../telemetry';
import { Client } from './client';
import * as configs from './configurations';
import * as ext from './extension';
import * as cp from "child_process";
import { OtherSettings } from './settings';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface CppBuildTaskDefinition extends TaskDefinition {
    type: string;
    label: string; // The label appears in tasks.json file.
    command: string;
    args: string[];
    options: cp.ExecOptions | cp.SpawnOptions | undefined;
}

export class CppBuildTask extends Task {
    detail?: string;
}

export class CppBuildTaskProvider implements TaskProvider {
    static CppBuildScriptType: string = 'cppbuild';
    static CppBuildSourceStr: string = "C/C++";

    constructor() { }

    public async provideTasks(): Promise<CppBuildTask[]> {
        return this.getTasks(false);
    }

    // Resolves a task that has no [`execution`](#Task.execution) set.
    public resolveTask(_task: CppBuildTask): CppBuildTask | undefined {
        const execution: ProcessExecution | ShellExecution | CustomExecution | undefined = _task.execution;
        if (!execution) {
            const definition: CppBuildTaskDefinition = <any>_task.definition;
            _task = this.getTask(definition.command, false, definition.args ? definition.args : [], definition, _task.detail);
            return _task;
        }
        return undefined;
    }

    // Generate tasks to build the current file based on the user's detected compilers, the user's compilerPath setting, and the current file's extension.
    public async getTasks(appendSourceToName: boolean): Promise<CppBuildTask[]> {
        const editor: TextEditor | undefined = window.activeTextEditor;
        const emptyTasks: CppBuildTask[] = [];
        if (!editor) {
            return emptyTasks;
        }

        const fileExt: string = path.extname(editor.document.fileName);
        if (!fileExt) {
            return emptyTasks;
        }

        // Don't offer tasks for header files.
        const fileExtLower: string = fileExt.toLowerCase();
        const isHeader: boolean = !fileExt || [".cuh", ".hpp", ".hh", ".hxx", ".h++", ".hp", ".h", ".ii", ".inl", ".idl", ""].some(ext => fileExtLower === ext);
        if (isHeader) {
            return emptyTasks;
        }

        // Don't offer tasks if the active file's extension is not a recognized C/C++ extension.
        let fileIsCpp: boolean;
        let fileIsC: boolean;
        if (fileExt === ".C") { // ".C" file extensions are both C and C++.
            fileIsCpp = true;
            fileIsC = true;
        } else {
            fileIsCpp = [".cu", ".cpp", ".cc", ".cxx", ".c++", ".cp", ".ino", ".ipp", ".tcc"].some(ext => fileExtLower === ext);
            fileIsC = fileExtLower === ".c";
        }
        if (!(fileIsCpp || fileIsC)) {
            return emptyTasks;
        }

        // Get compiler paths.
        const isWindows: boolean = os.platform() === 'win32';
        let activeClient: Client;
        try {
            activeClient = ext.getActiveClient();
        } catch (errJS) {
            const e: Error = errJS as Error;
            if (!e || e.message !== ext.intelliSenseDisabledError) {
                console.error("Unknown error calling getActiveClient().");
            }
            return emptyTasks; // Language service features may be disabled.
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

        const isCompilerValid: boolean = userCompilerPath ? await util.checkFileExists(userCompilerPath) : false;
        const userCompilerIsCl: boolean = isCompilerValid && !!userCompilerPathAndArgs && userCompilerPathAndArgs.compilerName === "cl.exe";

        // Get known compiler paths. Do not include the known compiler path that is the same as user compiler path.
        // Filter them based on the file type to get a reduced list appropriate for the active file.
        // Only allow one instance of cl.exe to be included, as the user must launch VS Code using a VS command
        // prompt in order to build with cl.exe, so only one can apply.
        const knownCompilerPathsSet: Set<string> = new Set();
        let knownCompilers: configs.KnownCompiler[] | undefined = await activeClient.getKnownCompilers();
        if (knownCompilers) {
            const compiler_condition: (info: configs.KnownCompiler) => boolean = info => ((fileIsCpp && !info.isC) || (fileIsC && info.isC)) &&
                (!isCompilerValid || (!!userCompilerPathAndArgs &&
                (path.basename(info.path) !== userCompilerPathAndArgs.compilerName))) &&
                (!isWindows || !info.path.startsWith("/")); // TODO: Add WSL compiler support.
            const cl_to_add: configs.KnownCompiler | undefined = userCompilerIsCl ? undefined : knownCompilers.find(info =>
                ((path.basename(info.path) === "cl.exe") && compiler_condition(info)));
            knownCompilers = knownCompilers.filter(info =>
                ((info === cl_to_add) || (path.basename(info.path) !== "cl.exe" && compiler_condition(info))));
            knownCompilers.map<void>(info => {
                knownCompilerPathsSet.add(info.path);
            });
        }
        const knownCompilerPaths: string[] | undefined = knownCompilerPathsSet.size ?
            Array.from(knownCompilerPathsSet) : undefined;
        if (!knownCompilerPaths && !userCompilerPath) {
            // Don't prompt a message yet until we can make a data-based decision.
            telemetry.logLanguageServerEvent('noCompilerFound');
            return emptyTasks;
        }

        // Create a build task per compiler path
        let result: CppBuildTask[] = [];
        // Tasks for known compiler paths
        if (knownCompilerPaths) {
            result = knownCompilerPaths.map<Task>(compilerPath => this.getTask(compilerPath, appendSourceToName, undefined));
        }
        // Task for valid user compiler path setting
        if (isCompilerValid && userCompilerPath) {
            result.push(this.getTask(userCompilerPath, appendSourceToName, userCompilerPathAndArgs?.additionalArgs));
        }
        return result;
    }

    private getTask: (compilerPath: string, appendSourceToName: boolean, compilerArgs?: string[], definition?: CppBuildTaskDefinition, detail?: string) => Task = (compilerPath: string, appendSourceToName: boolean, compilerArgs?: string[], definition?: CppBuildTaskDefinition, detail?: string) => {
        const compilerPathBase: string = path.basename(compilerPath);
        const isCl: boolean = compilerPathBase.toLowerCase() === "cl.exe";
        // Double-quote the command if it is not already double-quoted.
        let resolvedcompilerPath: string = isCl ? compilerPathBase : compilerPath;
        if (resolvedcompilerPath && !resolvedcompilerPath.startsWith("\"") && resolvedcompilerPath.includes(" ")) {
            resolvedcompilerPath = "\"" + resolvedcompilerPath + "\"";
        }

        if (!definition) {
            const taskLabel: string = ((appendSourceToName && !compilerPathBase.startsWith(CppBuildTaskProvider.CppBuildSourceStr)) ?
                CppBuildTaskProvider.CppBuildSourceStr + ": " : "") + compilerPathBase + " " + localize("build_active_file", "build active file");
            const filePath: string = path.join('${fileDirname}', '${fileBasenameNoExtension}');
            const isWindows: boolean = os.platform() === 'win32';
            let args: string[] = isCl ? ['/Zi', '/EHsc', '/nologo', '/Fe:', filePath + '.exe', '${file}'] : ['-fdiagnostics-color=always', '-g', '${file}', '-o', filePath + (isWindows ? '.exe' : '')];
            if (compilerArgs && compilerArgs.length > 0) {
                args = args.concat(compilerArgs);
            }
            const cwd: string = isWindows && !isCl && !process.env.PATH?.includes(path.dirname(compilerPath)) ? path.dirname(compilerPath) : "${fileDirname}";
            const options: cp.ExecOptions | cp.SpawnOptions | undefined = { cwd: cwd };
            definition = {
                type: CppBuildTaskProvider.CppBuildScriptType,
                label: taskLabel,
                command: isCl ? compilerPathBase : compilerPath,
                args: args,
                options: options
            };
        }

        const editor: TextEditor | undefined = window.activeTextEditor;
        const folder: WorkspaceFolder | undefined = editor ? workspace.getWorkspaceFolder(editor.document.uri) : undefined;
        // Check uri exists (single-mode files are ignored).
        if (folder) {
            const activeClient: Client = ext.getActiveClient();
            const uri: Uri | undefined = activeClient.RootUri;
            if (!uri) {
                throw new Error("No client URI found in getBuildTasks()");
            }
            if (!workspace.getWorkspaceFolder(uri)) {
                throw new Error("No target WorkspaceFolder found in getBuildTasks()");
            }
        }

        const taskUsesActiveFile: boolean = definition.args.some(arg => arg.indexOf('${file}') >= 0); // Need to check this before ${file} is resolved
        const scope: WorkspaceFolder | TaskScope = folder ? folder : TaskScope.Workspace;
        const task: CppBuildTask = new Task(definition, scope, definition.label, CppBuildTaskProvider.CppBuildSourceStr,
            new CustomExecution(async (resolvedDefinition: TaskDefinition): Promise<Pseudoterminal> =>
                // When the task is executed, this callback will run. Here, we setup for running the task.
                new CustomBuildTaskTerminal(resolvedcompilerPath, resolvedDefinition.args, resolvedDefinition.options, taskUsesActiveFile)
            ), isCl ? '$msCompile' : '$gcc');

        task.group = TaskGroup.Build;
        task.detail = detail ? detail : localize("compiler_details", "compiler:") + " " + resolvedcompilerPath;

        return task;
    };

    public async getJsonTasks(): Promise<CppBuildTask[]> {
        const rawJson: any = await this.getRawTasksJson();
        const rawTasksJson: any = (!rawJson.tasks) ? new Array() : rawJson.tasks;
        const buildTasksJson: CppBuildTask[] = rawTasksJson.map((task: any) => {
            if (!task.label) {
                return null;
            }
            const definition: CppBuildTaskDefinition = {
                type: task.type,
                label: task.label,
                command: task.command,
                args: task.args,
                options: task.options
            };
            const cppBuildTask: CppBuildTask = new Task(definition, TaskScope.Workspace, task.label, "C/C++");
            cppBuildTask.detail = task.detail;
            return cppBuildTask;
        });
        return buildTasksJson.filter((task: CppBuildTask) => task !== null);
    }

    public async ensureBuildTaskExists(taskLabel: string): Promise<void> {
        const rawTasksJson: any = await this.getRawTasksJson();
        if (!rawTasksJson.tasks) {
            rawTasksJson.tasks = new Array();
        }
        // Ensure that the task exists in the user's task.json. Task will not be found otherwise.
        let selectedTask: any = rawTasksJson.tasks.find((task: any) => task.label && task.label === taskLabel);
        if (selectedTask) {
            return;
        }

        // Create the task which should be created based on the selected "debug configuration".
        const buildTasks: CppBuildTask[] = await this.getTasks(true);
        const normalizedLabel: string = (taskLabel.indexOf("ver(") !== -1) ? taskLabel.slice(0, taskLabel.indexOf("ver(")).trim() : taskLabel;
        selectedTask = buildTasks.find(task => task.name === normalizedLabel);
        console.assert(selectedTask);
        if (!selectedTask) {
            throw new Error("Failed to get selectedTask in ensureBuildTaskExists()");
        } else {
            selectedTask.definition.label = taskLabel;
            selectedTask.name = taskLabel;
        }
        rawTasksJson.version = "2.0.0";

        // Modify the current default task
        rawTasksJson.tasks.forEach((task: any) => {
            if (task.label === selectedTask?.definition.label) {
                task.group = { kind: "build", "isDefault": true };
            } else if (task.group.kind && task.group.kind === "build" && task.group.isDefault && task.group.isDefault === true) {
                task.group = "build";
            }
        });

        if (!rawTasksJson.tasks.find((task: any) => task.label === selectedTask?.definition.label)) {
            const newTask: any = {
                ...selectedTask.definition,
                problemMatcher: selectedTask.problemMatchers,
                group: { kind: "build", "isDefault": true },
                detail: localize("task_generated_by_debugger", "Task generated by Debugger.")
            };
            rawTasksJson.tasks.push(newTask);
        }

        const settings: OtherSettings = new OtherSettings();
        const tasksJsonPath: string | undefined = this.getTasksJsonPath();
        if (!tasksJsonPath) {
            throw new Error("Failed to get tasksJsonPath in ensureBuildTaskExists()");
        }

        await util.writeFileText(tasksJsonPath, JSON.stringify(rawTasksJson, null, settings.editorTabSize));
    }

    public async ensureDebugConfigExists(configName: string): Promise<void> {
        const launchJsonPath: string | undefined = this.getLaunchJsonPath();
        if (!launchJsonPath) {
            throw new Error("Failed to get launchJsonPath in ensureDebugConfigExists()");
        }

        const rawLaunchJson: any = await this.getRawLaunchJson();
        // Ensure that the debug configurations exists in the user's launch.json. Config will not be found otherwise.
        if (!rawLaunchJson || !rawLaunchJson.configurations) {
            throw new Error(`Configuration '${configName}' is missing in 'launch.json'.`);
        }
        const selectedConfig: any | undefined = rawLaunchJson.configurations.find((config: any) => config.name && config.name === configName);
        if (!selectedConfig) {
            throw new Error(`Configuration '${configName}' is missing in 'launch.json'.`);
        }
        return;
    }

    // Provide a unique name for a newly defined tasks, which is different from tasks' names in tasks.json.
    public provideUniqueTaskLabel(label: string, buildTasksJson: CppBuildTask[]): string {
        const taskNameDictionary: {[key: string]: any} = {};
        buildTasksJson.forEach(task => {
            taskNameDictionary[task.definition.label] = {};
        });
        let newLabel: string = label;
        let version: number = 0;
        do {
            version = version + 1;
            newLabel = label + ` ver(${version})`;

        } while (taskNameDictionary[newLabel]);

        return newLabel;
    }

    private getLaunchJsonPath(): string | undefined {
        return util.getJsonPath("launch.json");
    }

    private getTasksJsonPath(): string | undefined {
        return util.getJsonPath("tasks.json");
    }

    public getRawLaunchJson(): Promise<any> {
        const path: string | undefined = this.getLaunchJsonPath();
        return util.getRawJson(path);
    }

    public getRawTasksJson(): Promise<any> {
        const path: string | undefined = this.getTasksJsonPath();
        return util.getRawJson(path);
    }
}

class CustomBuildTaskTerminal implements Pseudoterminal {
    private writeEmitter = new EventEmitter<string>();
    private closeEmitter = new EventEmitter<number>();
    public get onDidWrite(): Event<string> { return this.writeEmitter.event; }
    public get onDidClose(): Event<number> { return this.closeEmitter.event; }
    private endOfLine: string = "\r\n";

    constructor(private command: string, private args: string[], private options: cp.ExecOptions | cp.SpawnOptions | undefined, private taskUsesActiveFile: boolean) {
    }

    async open(_initialDimensions: TerminalDimensions | undefined): Promise<void> {
        if (this.taskUsesActiveFile && !util.fileIsCOrCppSource(window.activeTextEditor?.document.fileName)) {
            this.writeEmitter.fire(localize("cannot.build.non.cpp", 'Cannot build and debug because the active file is not a C or C++ source file.') + this.endOfLine);
            this.closeEmitter.fire(-1);
            return;
        }
        telemetry.logLanguageServerEvent("cppBuildTaskStarted");
        // At this point we can start using the terminal.
        this.writeEmitter.fire(localize("starting_build", "Starting build...") + this.endOfLine);
        await this.doBuild();
    }

    close(): void {
        // The terminal has been closed. Shutdown the build.
    }

    private async doBuild(): Promise<any> {
        // Do build.
        let command: string = util.resolveVariables(this.command);
        let activeCommand: string = command;
        this.args.forEach((value, index) => {
            value = util.normalizeArg(util.resolveVariables(value));
            activeCommand = activeCommand + " " + value;
            this.args[index] = value;
        });
        if (this.options) {
            this.options.shell = true;
        } else {
            this.options = { "shell": true };
        }
        if (this.options.cwd) {
            this.options.cwd = util.resolveVariables(this.options.cwd);
        }

        const splitWriteEmitter = (lines: string | Buffer) => {
            const splitLines: string[] = lines.toString().split(/\r?\n/g);
            for (let i: number = 0; i < splitLines.length; i++) {
                let line: string = splitLines[i];

                // We may not get full lines.
                // Only output an endOfLine when a full line is detected.
                if (i !== splitLines.length - 1) {
                    line += this.endOfLine;
                }
                this.writeEmitter.fire(line);
            }
        };

        if (os.platform() === 'win32') {
            command = `cmd /c chcp 65001>nul && ${command}`;
        }

        this.writeEmitter.fire(activeCommand + this.endOfLine);
        let child: cp.ChildProcess | undefined;
        try {
            child = cp.spawn(command, this.args, this.options ? this.options : {});
            let error: string = "";
            let stdout: string = "";
            let stderr: string = "";
            const result: number = await new Promise<number>(resolve => {
                if (child) {
                    child.on('error', err => {
                        splitWriteEmitter(err.message);
                        error = err.message;
                        resolve(-1);
                    });
                    child.stdout?.on('data', data => {
                        const str: string = data.toString();
                        splitWriteEmitter(str);
                        stdout += str;
                    });
                    child.stderr?.on('data', data => {
                        const str: string = data.toString();
                        splitWriteEmitter(str);
                        stderr += str;
                    });
                    child.on('close', result => {
                        this.writeEmitter.fire(this.endOfLine);
                        if (result === null) {
                            this.writeEmitter.fire(localize("build.run.terminated", "Build run was terminated.") + this.endOfLine);
                            resolve(-1);
                        }
                        resolve(0);
                    });
                }
            });
            this.printBuildSummary(error, stdout, stderr);
            this.closeEmitter.fire(result);
        } catch {
            this.closeEmitter.fire(-1);
        }
    }

    private printBuildSummary(error: string, stdout: string, stderr: string): void {
        if (error || (!stdout && stderr && stderr.includes("error")) ||
            (stdout && stdout.includes("error C"))) { // cl.exe compiler errors
            telemetry.logLanguageServerEvent("cppBuildTaskError");
            this.writeEmitter.fire(localize("build.finished.with.error", "Build finished with error(s).") + this.endOfLine);
        } else if ((!stdout && stderr) || // gcc/clang
            (stdout && stdout.includes("warning C"))) { // cl.exe compiler warnings
            telemetry.logLanguageServerEvent("cppBuildTaskWarnings");
            this.writeEmitter.fire(localize("build.finished.with.warnings", "Build finished with warning(s).") + this.endOfLine);
        } else {
            this.writeEmitter.fire(localize("build.finished.successfully", "Build finished successfully.") + this.endOfLine);
        }
    }
}
