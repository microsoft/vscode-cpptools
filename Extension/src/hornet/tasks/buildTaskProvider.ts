import * as vscode from 'vscode';
import { PlatformBuildConfiguration, QuotedArgument, resolveBuildConfiguration } from './taskConfiguration';

function argument(value: string | QuotedArgument): string | vscode.ShellQuotedString {
    if (typeof value === 'string') { return value; }
    const quoting = { escape: vscode.ShellQuoting.Escape, strong: vscode.ShellQuoting.Strong, weak: vscode.ShellQuoting.Weak };
    if (!value || typeof value.value !== 'string' || !(value.quoting in quoting)) { throw new Error('Invalid Hornet build argument.'); }
    return { value: value.value, quoting: quoting[value.quoting] };
}

export function registerBuildTasks(): vscode.Disposable {
    const provider: vscode.TaskProvider = {
        provideTasks: () => [],
        resolveTask(task) {
            if (!vscode.workspace.isTrusted) { return undefined; }
            const definition = task.definition as vscode.TaskDefinition & PlatformBuildConfiguration;
            const configuration = resolveBuildConfiguration(definition, process.platform);
            if (!configuration.command) { return undefined; }
            const execution = new vscode.ShellExecution(argument(configuration.command), (configuration.args ?? []).map(argument), configuration.options);
            const resolved = new vscode.Task(task.definition, task.scope ?? vscode.TaskScope.Workspace, task.name,
                'Hornet C/C++', execution, configuration.problemMatcher ?? task.problemMatchers);
            resolved.group = task.group;
            resolved.presentationOptions = task.presentationOptions;
            resolved.runOptions = task.runOptions;
            resolved.isBackground = task.isBackground;
            resolved.detail = configuration.detail ?? task.detail;
            return resolved;
        }
    };
    // cppbuild keeps existing tasks.json files usable without the Microsoft extension.
    return vscode.Disposable.from(vscode.tasks.registerTaskProvider('hornet-cpp.build', provider),
        vscode.tasks.registerTaskProvider('cppbuild', provider));
}
