/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import {
    TaskDefinition, Task2 as Task, TaskGroup, WorkspaceFolder, ShellExecution, Uri, workspace,
    TaskProvider, TaskScope, CustomExecution, ProcessExecution, TextEditor, Pseudoterminal, EventEmitter, Event, TerminalDimensions, window
} from 'vscode';
import * as os from 'os';
import * as util from '../common';
import * as telemetry from '../telemetry';
import { Client } from './client';
import * as configs from './configurations';
import * as ext from './extension';
import * as nls from 'vscode-nls';
import * as cp from "child_process";
import { OtherSettings } from './settings';
import * as jsonc from 'jsonc-parser';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();
export const failedToParseTasksJson: string = localize("failed.to.parse.tasks", "Failed to parse tasks.json, possibly due to comments or trailing commas.");

export interface CppBuildTaskDefinition extends TaskDefinition {
    type: string;
    label: string; // The label appears in tasks.json file.
    command: string;
    args: string[];
    options: cp.ExecOptions | undefined;
}

export class CppBuildTaskProvider implements TaskProvider {
    static CppBuildScriptType: string = 'cppbuild';
    static CppBuildSourceStr: string = "C/C++";
    private tasks: Task[] | undefined;

    constructor() { }

    public async provideTasks(): Promise<Task[]> {
        if (this.tasks) {
            return this.tasks;
        }
        return this.getTasks(false);
    }

    // Resolves a task that has no [`execution`](#Task.execution) set.
    public resolveTask(_task: Task): Task | undefined {
        const execution: ProcessExecution | ShellExecution | CustomExecution | undefined = _task.execution;
        if (!execution) {
            const definition: CppBuildTaskDefinition = <any>_task.definition;
            _task = this.getTask(definition.command, false, definition.args ? definition.args : [], definition);
            return _task;
        }
        return undefined;
    }

    // Generate tasks to build the current file based on the user's detected compilers, the user's compilerPath setting, and the current file's extension.
    public async getTasks(appendSourceToName: boolean): Promise<Task[]> {
        if (this.tasks !== undefined) {
            return this.tasks;
        }
        const editor: TextEditor | undefined = window.activeTextEditor;
        const emptyTasks: Task[] = [];
        if (!editor) {
            return emptyTasks;
        }

        const fileExt: string = path.extname(editor.document.fileName);
        if (!fileExt) {
            return emptyTasks;
        }

        // Don't offer tasks for header files.
        const fileExtLower: string = fileExt.toLowerCase();
        const isHeader: boolean = !fileExt || [".hpp", ".hh", ".hxx", ".h++", ".hp", ".h", ".ii", ".inl", ".idl", ""].some(ext => fileExtLower === ext);
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
            fileIsCpp = [".cpp", ".cc", ".cxx", ".c++", ".cp", ".ino", ".ipp", ".tcc"].some(ext => fileExtLower === ext);
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
        } catch (e) {
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

        // Get known compiler paths. Do not include the known compiler path that is the same as user compiler path.
        // Filter them based on the file type to get a reduced list appropriate for the active file.
        const knownCompilerPathsSet: Set<string> = new Set();
        let knownCompilers: configs.KnownCompiler[] | undefined = await activeClient.getKnownCompilers();
        if (knownCompilers) {
            knownCompilers = knownCompilers.filter(info =>
                ((fileIsCpp && !info.isC) || (fileIsC && info.isC)) &&
                userCompilerPathAndArgs &&
                (path.basename(info.path) !== userCompilerPathAndArgs.compilerName) &&
                (!isWindows || !info.path.startsWith("/"))); // TODO: Add WSL compiler support.
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
        let result: Task[] = [];
        // Tasks for known compiler paths
        if (knownCompilerPaths) {
            result = knownCompilerPaths.map<Task>(compilerPath => this.getTask(compilerPath, appendSourceToName, undefined));
        }
        // Task for user compiler path setting
        if (userCompilerPath) {
            result.push(this.getTask(userCompilerPath, appendSourceToName, userCompilerPathAndArgs?.additionalArgs));
        }

        return result;
    }

    private getTask: (compilerPath: string, appendSourceToName: boolean, compilerArgs?: string[], definition?: CppBuildTaskDefinition) => Task = (compilerPath: string, appendSourceToName: boolean, compilerArgs?: string[], definition?: CppBuildTaskDefinition) => {
        const filePath: string = path.join('${fileDirname}', '${fileBasenameNoExtension}');
        const compilerPathBase: string = path.basename(compilerPath);
        const taskLabel: string = ((appendSourceToName && !compilerPathBase.startsWith(CppBuildTaskProvider.CppBuildSourceStr)) ?
            CppBuildTaskProvider.CppBuildSourceStr + ": " : "") + compilerPathBase + " build active file";
        const isCl: boolean = compilerPathBase === "cl.exe";
        const isWindows: boolean = os.platform() === 'win32';
        const cwd: string = isCl ? "${workspaceFolder}" : path.dirname(compilerPath);
        let args: string[] = isCl ? ['/Zi', '/EHsc', '/Fe:', filePath + '.exe', '${file}'] : ['-g', '${file}', '-o', filePath + (isWindows ? '.exe' : '')];
        if (!definition && compilerArgs && compilerArgs.length > 0) {
            args = args.concat(compilerArgs);
        }
        const options: cp.ExecOptions | undefined = { cwd: cwd };

        // Double-quote the command if it is not already double-quoted.
        let resolvedcompilerPath: string = isCl ? compilerPathBase : compilerPath;
        if (resolvedcompilerPath && !resolvedcompilerPath.startsWith("\"") && resolvedcompilerPath.includes(" ")) {
            resolvedcompilerPath = "\"" + resolvedcompilerPath + "\"";
        }

        if (!definition) {
            definition = {
                type: CppBuildTaskProvider.CppBuildScriptType,
                label: taskLabel,
                command: isCl ? compilerPathBase : compilerPath,
                args: args,
                options: options
            };
        }

        const activeClient: Client = ext.getActiveClient();
        const uri: Uri | undefined = activeClient.RootUri;
        if (!uri) {
            throw new Error("No client URI found in getBuildTasks()");
        }
        if (!workspace.getWorkspaceFolder(uri)) {
            throw new Error("No target WorkspaceFolder found in getBuildTasks()");
        }

        const scope: TaskScope = TaskScope.Workspace;
        const task: Task = new Task(definition, scope, taskLabel, CppBuildTaskProvider.CppBuildSourceStr,
            new CustomExecution(async (): Promise<Pseudoterminal> =>
                // When the task is executed, this callback will run. Here, we setup for running the task.
                new CustomBuildTaskTerminal(resolvedcompilerPath, args, options)
            ), isCl ? '$msCompile' : '$gcc');

        task.group = TaskGroup.Build;
        task.detail = "compiler: " + resolvedcompilerPath;

        return task;
    };

    async ensureBuildTaskExists(taskLabel: string): Promise<void> {
        const rawTasksJson: any = await getRawTasksJson();

        // Ensure that the task exists in the user's task.json. Task will not be found otherwise.
        if (!rawTasksJson.tasks) {
            rawTasksJson.tasks = new Array();
        }
        // Find or create the task which should be created based on the selected "debug configuration".
        let selectedTask: Task | undefined = rawTasksJson.tasks.find((task: any) => task.label && task.label === taskLabel);
        if (selectedTask) {
            return;
        }

        const buildTasks: Task[] = await this.getTasks(true);
        selectedTask = buildTasks.find(task => task.name === taskLabel);
        console.assert(selectedTask);
        if (!selectedTask) {
            throw new Error("Failed to get selectedTask in ensureBuildTaskExists()");
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
                detail: "Generated task by Debugger"
            };
            rawTasksJson.tasks.push(newTask);
        }

        // TODO: It's dangerous to overwrite this file. We could be wiping out comments.
        const settings: OtherSettings = new OtherSettings();
        const tasksJsonPath: string | undefined = getTasksJsonPath();
        if (!tasksJsonPath) {
            throw new Error("Failed to get tasksJsonPath in ensureBuildTaskExists()");
        }

        await util.writeFileText(tasksJsonPath, JSON.stringify(rawTasksJson, null, settings.editorTabSize));
    }
}

class CustomBuildTaskTerminal implements Pseudoterminal {
    private writeEmitter = new EventEmitter<string>();
    private closeEmitter = new EventEmitter<number>();
    public get onDidWrite(): Event<string> { return this.writeEmitter.event; }
    public get onDidClose(): Event<number> { return this.closeEmitter.event; }

    constructor(private command: string, private args: string[], private options: cp.ExecOptions | undefined) {
    }

    async open(_initialDimensions: TerminalDimensions | undefined): Promise<void> {
        telemetry.logLanguageServerEvent("cppBuildTaskStarted");
        // At this point we can start using the terminal.
        this.writeEmitter.fire("Starting build...\r\n");
        await this.doBuild();
    }

    close(): void {
        // The terminal has been closed. Shutdown the build.
    }

    private async doBuild(): Promise<any> {
        // Do build.
        let activeCommand: string = util.resolveVariables(this.command, this.AdditionalEnvironment);
        this.args.forEach(value => {
            let temp: string = util.resolveVariables(value, this.AdditionalEnvironment);
            if (temp && temp.includes(" ")) {
                temp = "\"" + temp + "\"";
            }
            activeCommand = activeCommand + " " + temp;
        });
        if (this.options?.cwd) {
            this.options.cwd = util.resolveVariables(this.options.cwd, this.AdditionalEnvironment);
        }

        try {
            const result: number = await new Promise<number>((resolve, reject) => {
                cp.exec(activeCommand, this.options, (_error, stdout, _stderr) => {
                    const endOfLine: string = os.platform() === 'win32' ? "\r\n" : "\n";
                    if (_error) {
                        telemetry.logLanguageServerEvent("cppBuildTaskError");
                        const dot: string = (stdout || _stderr) ? ":" : ".";
                        this.writeEmitter.fire("Build finished with error" + dot + endOfLine);
                        this.writeEmitter.fire(stdout.toString());
                        for (const line of _stderr.toString().split(endOfLine)) {
                            this.writeEmitter.fire(line);
                            this.writeEmitter.fire(endOfLine);
                        }
                        resolve(-1);
                    } else {
                        this.writeEmitter.fire(stdout.toString());
                        this.writeEmitter.fire(endOfLine + "Build finished successfully." + endOfLine);
                        resolve(0);
                    }
                });
            });
            this.closeEmitter.fire(result);
        } catch {
            this.closeEmitter.fire(-1);
        }
    }

    private get AdditionalEnvironment(): { [key: string]: string | string[] } | undefined {
        const editor: TextEditor | undefined = window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        const fileDir: WorkspaceFolder | undefined = workspace.getWorkspaceFolder(editor.document.uri);
        if (!fileDir) {
            window.showErrorMessage('This command is not yet available for single-file mode.');
            return undefined;
        }
        const file: string = editor.document.fileName;
        return {
            "file": file,
            "fileDirname": fileDir.uri.fsPath,
            "fileBasenameNoExtension": path.parse(file).name,
            "workspaceFolder": fileDir.uri.fsPath
        };
    }
}

export async function getRawTasksJson(): Promise<any> {
    const path: string | undefined = getTasksJsonPath();
    if (!path) {
        return {};
    }
    const fileExists: boolean = await util.checkFileExists(path);
    if (!fileExists) {
        return {};
    }

    const fileContents: string = await util.readFileText(path);
    let rawTasks: any = {};
    try {
        rawTasks = jsonc.parse(fileContents);
    } catch (error) {
        throw new Error(failedToParseTasksJson);
    }
    return rawTasks;
}

export function getTasksJsonPath(): string | undefined {
    const editor: TextEditor | undefined = window.activeTextEditor;
    if (!editor) {
        return undefined;
    }
    const folder: WorkspaceFolder | undefined = workspace.getWorkspaceFolder(editor.document.uri);
    if (!folder) {
        return undefined;
    }
    return path.join(folder.uri.fsPath, ".vscode", "tasks.json");
}
