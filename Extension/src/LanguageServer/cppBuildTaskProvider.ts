/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable no-unused-expressions */
import * as path from 'path';
import {
    TaskDefinition, Task, TaskGroup, ShellExecution, workspace,
    TaskProvider, TaskScope, CustomExecution, ProcessExecution, TextEditor, Pseudoterminal, EventEmitter, Event, TerminalDimensions, window, WorkspaceFolder, tasks, TaskExecution, TaskEndEvent, Disposable
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
    existing?: boolean;
    isDefault?: boolean;
}

export class CppBuildTaskProvider implements TaskProvider {
    static CppBuildScriptType: string = 'cppbuild';

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

    public resolveInsiderTask(_task: CppBuildTask): CppBuildTask | undefined {
        const definition: CppBuildTaskDefinition = <any>_task.definition;
        definition.label = definition.label.replace(ext.configPrefix, "");
        _task = this.getTask(definition.command, false, definition.args ? definition.args : [], definition, _task.detail);
        return _task;
    }

    // Generate tasks to build the current file based on the user's detected compilers, the user's compilerPath setting, and the current file's extension.
    public async getTasks(appendSourceToName: boolean = false): Promise<CppBuildTask[]> {
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
        const isHeader: boolean = util.isHeaderFile (editor.document.uri);
        if (isHeader) {
            return emptyTasks;
        }

        // Don't offer tasks if the active file's extension is not a recognized C/C++ extension.
        const fileIsCpp: boolean = util.isCppFile(editor.document.uri);
        const fileIsC: boolean = util.isCFile(editor.document.uri);
        if (!(fileIsCpp || fileIsC)) {
            return emptyTasks;
        }

        // Get compiler paths.
        const isWindows: boolean = os.platform() === 'win32';
        let activeClient: Client;
        try {
            activeClient = ext.getActiveClient();
        } catch (errJS) {
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
            result.push(this.getTask(userCompilerPath, appendSourceToName, userCompilerPathAndArgs?.allCompilerArgs));
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
            const isWindows: boolean = os.platform() === 'win32';
            const taskLabel: string = ((appendSourceToName && !compilerPathBase.startsWith(ext.configPrefix)) ?
                ext.configPrefix : "") + compilerPathBase + " " + localize("build_active_file", "build active file");
            const programName: string = util.defaultExePath();
            let args: string[] = isCl ? ['/Zi', '/EHsc', '/nologo', '/Fe:', programName, '${file}'] : ['-fdiagnostics-color=always', '-g', '${file}', '-o', programName];
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

        const taskUsesActiveFile: boolean = definition.args.some(arg => arg.indexOf('${file}') >= 0); // Need to check this before ${file} is resolved
        const scope: WorkspaceFolder | TaskScope = folder ? folder : TaskScope.Workspace;
        const task: CppBuildTask = new Task(definition, scope, definition.label, ext.CppSourceStr,
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
            if (!task.label || !task.type || task.type !== CppBuildTaskProvider.CppBuildScriptType) {
                return null;
            }
            const definition: CppBuildTaskDefinition = {
                type: task.type,
                label: task.label,
                command: task.command,
                args: task.args,
                options: task.options
            };
            const cppBuildTask: CppBuildTask = new Task(definition, TaskScope.Workspace, task.label, ext.CppSourceStr);
            cppBuildTask.detail = task.detail;
            cppBuildTask.existing = true;
            if (task.group.isDefault) {
                cppBuildTask.isDefault = true;
            }
            return cppBuildTask;
        });
        return buildTasksJson.filter((task: CppBuildTask) => task !== null);
    }

    public async writeDefaultBuildTask(taskLabel: string): Promise<void> {
        return this.checkBuildTaskExists(taskLabel, true, true);
    }

    public async writeBuildTask(taskLabel: string): Promise<void> {
        return this.checkBuildTaskExists(taskLabel, true);
    }

    public async checkBuildTaskExists(taskLabel: string, createTask: boolean = false, setAsDefault: boolean = false): Promise<void> {
        const rawTasksJson: any = await this.getRawTasksJson();
        if (!rawTasksJson.tasks) {
            rawTasksJson.tasks = new Array();
        }
        // Ensure that the task exists in the user's task.json. Task will not be found otherwise.
        let selectedTask: any;
        if (!createTask) {
            selectedTask = rawTasksJson.tasks.find((task: any) => task.label && task.label === taskLabel);
            if (selectedTask) {
                return;
            }
        }

        // Create the task which should be created based on the selected "debug configuration".
        const buildTasks: CppBuildTask[] = await this.getTasks(true);
        const normalizedLabel: string = (taskLabel.indexOf("ver(") !== -1) ? taskLabel.slice(0, taskLabel.indexOf("ver(")).trim() : taskLabel;
        selectedTask = buildTasks.find(task => task.name === normalizedLabel);
        console.assert(selectedTask);
        if (!selectedTask) {
            throw new Error("Failed to get selectedTask in checkBuildTaskExists()");
        } else {
            selectedTask.definition.label = taskLabel;
            selectedTask.name = taskLabel;
        }
        rawTasksJson.version = "2.0.0";

        // Modify the current default task
        if (setAsDefault) {
            rawTasksJson.tasks.forEach((task: any) => {
                if (task.label === selectedTask?.definition.label) {
                    task.group = { kind: "build", "isDefault": true };
                } else if (task.group.kind && task.group.kind === "build" && task.group.isDefault && task.group.isDefault === true) {
                    task.group = "build";
                }
            });
        }

        if (!rawTasksJson.tasks.find((task: any) => task.label === selectedTask?.definition.label)) {
            const newTask: any = {
                ...selectedTask.definition,
                problemMatcher: selectedTask.problemMatchers,
                group: setAsDefault ? { kind: "build", "isDefault": true } : "build",
                detail: localize("task_generated_by_debugger", "Task generated by Debugger.")
            };
            rawTasksJson.tasks.push(newTask);
        }

        const settings: OtherSettings = new OtherSettings();
        const tasksJsonPath: string | undefined = this.getTasksJsonPath();
        if (!tasksJsonPath) {
            throw new Error("Failed to get tasksJsonPath in checkBuildTaskExists()");
        }
        // Vs Code removes the comments in tasks.json, microsoft/vscode#29453
        await util.writeFileText(tasksJsonPath, JSON.stringify(rawTasksJson, null, settings.editorTabSize));
    }

    public async runBuildTask(taskLabel: string): Promise<void> {
        let task: CppBuildTask | undefined;
        const configuredBuildTasks: CppBuildTask[] = await this.getJsonTasks();
        task = configuredBuildTasks.find(task => task.name === taskLabel);
        if (!task) {
            const detectedBuildTasks: CppBuildTask[] = await this.getTasks(true);
            task = detectedBuildTasks.find(task => task.name === taskLabel);
        }
        if (!task) {
            throw new Error("Failed to find task in runBuildTask()");
        } else {
            const resolvedTask: CppBuildTask | undefined = this.resolveInsiderTask(task);
            if (resolvedTask) {
                const execution: TaskExecution = await tasks.executeTask(resolvedTask);
                return new Promise<void>((resolve) => {
                    const disposable: Disposable = tasks.onDidEndTask((endEvent: TaskEndEvent) => {
                        if (endEvent.execution.task.group === TaskGroup.Build && endEvent.execution === execution) {
                            disposable.dispose();
                            resolve();
                        }
                    });
                });
            } else {
                throw new Error("Failed to run resolved task in runBuildTask()");
            }
        }
    }

    private getTasksJsonPath(): string | undefined {
        return util.getJsonPath("tasks.json");
    }

    public getRawTasksJson(): Promise<any> {
        const path: string | undefined = this.getTasksJsonPath();
        return util.getRawJson(path);
    }

}

export const cppBuildTaskProvider: CppBuildTaskProvider = new CppBuildTaskProvider();

class CustomBuildTaskTerminal implements Pseudoterminal {
    private writeEmitter = new EventEmitter<string>();
    private closeEmitter = new EventEmitter<number>();
    public get onDidWrite(): Event<string> { return this.writeEmitter.event; }
    public get onDidClose(): Event<number> { return this.closeEmitter.event; }
    private endOfLine: string = "\r\n";

    constructor(private command: string, private args: string[], private options: cp.ExecOptions | cp.SpawnOptions | undefined, private taskUsesActiveFile: boolean) {
    }

    async open(_initialDimensions: TerminalDimensions | undefined): Promise<void> {
        if (this.taskUsesActiveFile && !util.isCppOrCFile(window.activeTextEditor?.document.uri)) {
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

        // Create the exe folder path if it doesn't exists.
        const exePath: string | undefined = util.findExePathInArgs(this.args);
        util.createDirIfNotExistsSync(exePath);

        let child: cp.ChildProcess | undefined;
        try {
            child = cp.spawn(command, this.args, this.options ? this.options : {});
            let error: string = "";
            let stdout: string = "";
            let stderr: string = "";
            const spawnResult: number = await new Promise<number>(resolve => {
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
                        } else {
                            resolve(0);
                        }
                    });
                }
            });
            let result: number = this.printBuildSummary(error, stdout, stderr);
            if (spawnResult === -1) {
                result = -1;
            }
            this.closeEmitter.fire(result);
        } catch {
            this.closeEmitter.fire(-1);
        }
    }

    private printBuildSummary(error: string, stdout: string, stderr: string): number {
        if (error || (!stdout && stderr && stderr.includes("error")) ||
            (stdout && stdout.includes("error C"))) { // cl.exe compiler errors
            telemetry.logLanguageServerEvent("cppBuildTaskError");
            this.writeEmitter.fire(localize("build.finished.with.error", "Build finished with error(s).") + this.endOfLine);
            return -1;
        } else if ((!stdout && stderr) || // gcc/clang
            (stdout && stdout.includes("warning C"))) { // cl.exe compiler warnings
            telemetry.logLanguageServerEvent("cppBuildTaskWarnings");
            this.writeEmitter.fire(localize("build.finished.with.warnings", "Build finished with warning(s).") + this.endOfLine);
            return 0;
        } else {
            this.writeEmitter.fire(localize("build.finished.successfully", "Build finished successfully.") + this.endOfLine);
            return 0;
        }
    }
}
