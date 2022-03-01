/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as debugUtils from './utils';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CppBuildTask, CppBuildTaskDefinition } from '../LanguageServer/cppBuildTaskProvider';
import * as util from '../common';
import * as fs from 'fs';
import * as Telemetry from '../telemetry';
import { cppBuildTaskProvider, configPrefix } from '../LanguageServer/extension';
import * as logger from '../logger';
import * as nls from 'vscode-nls';
import { IConfiguration, IConfigurationSnippet, DebuggerType, DebuggerEvent, MIConfigurations, WindowsConfigurations, WSLConfigurations, PipeTransportConfigurations, TaskConfigStatus } from './configurations';
import { parse } from 'comment-json';
import { PlatformInformation } from '../platform';
import { Environment, ParsedEnvironmentFile } from './ParsedEnvironmentFile';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

function isDebugLaunchStr(str: string): boolean {
    return str.startsWith("(gdb) ") || str.startsWith("(lldb) ") || str.startsWith("(Windows) ");
}

/*
 * Retrieves configurations from a provider and displays them in a quickpick menu to be selected.
 * Ensures that the selected configuration's preLaunchTask (if existent) is populated in the user's task.json.
 * Automatically starts debugging for "Build and Debug" configurations.
 */
export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider {

    private type: DebuggerType;
    private assetProvider: IConfigurationAssetProvider;
    // Keep a list of tasks detected by cppBuildTaskProvider.
    private static detectedBuildTasks: CppBuildTask[] = [];
    protected static recentBuildTaskLabel: string;

    public constructor(assetProvider: IConfigurationAssetProvider, type: DebuggerType) {
        this.assetProvider = assetProvider;
        this.type = type;
    }

    /**
     * Returns a list of initial debug configurations based on contextual information, e.g. package.json or folder.
     */
    async provideDebugConfigurations(folder?: vscode.WorkspaceFolder, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration[]> {
        let configs: vscode.DebugConfiguration[] | null | undefined = await this.provideDebugConfigurationsForType(this.type, folder, token);
        if (!configs) {
            configs = [];
        }
        const defaultConfig: vscode.DebugConfiguration | undefined = configs.find(config => isDebugLaunchStr(config.name) && config.request === "launch");
        if (!defaultConfig) {
            throw new Error("Default config not found in provideDebugConfigurations()");
        }
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!editor || !util.isCppOrCFile(editor.document.uri) || configs.length <= 1) {
            return [defaultConfig];
        }
        interface MenuItem extends vscode.QuickPickItem {
            configuration: vscode.DebugConfiguration;
        }

        // Find the recently used task and place it at the top of quickpick list.
        let recentlyUsedConfig: vscode.DebugConfiguration | undefined;
        configs = configs.filter(config => {
            if (config.existing !== TaskConfigStatus.recentlyUsed) {
                return true;
            } else {
                recentlyUsedConfig = config;
                return false;
            }
        });
        if (recentlyUsedConfig) {
            configs.unshift(recentlyUsedConfig);
        }

        const items: MenuItem[] = configs.map<MenuItem>(config => {
            const reducedConfig: vscode.DebugConfiguration = {...config};
            // Remove the "detail" property from the DebugConfiguration that will be written in launch.json.
            reducedConfig.detail = undefined;
            reducedConfig.existing = undefined;
            reducedConfig.isDefault = undefined;
            const menuItem: MenuItem = { label: config.name, configuration: reducedConfig, description: config.detail, detail: config.existing };
            // Rename the menu item for the default configuration as its name is non-descriptive.
            if (isDebugLaunchStr(menuItem.label)) {
                menuItem.label = localize("default.configuration.menuitem", "Default Configuration");
            }
            return menuItem;
        });

        const selection: MenuItem | undefined = await vscode.window.showQuickPick(items, {placeHolder: localize("select.configuration", "Select a configuration")});
        if (!selection) {
            Telemetry.logDebuggerEvent(DebuggerEvent.debugPanel, { "debugType": "debug", "folderMode": folder ? "folder" : "singleFile", "cancelled": "true" });
            return []; // User canceled it.
        }

        if (this.isClConfiguration(selection.label)) {
            this.showErrorIfClNotAvailable(selection.label);
        }

        return [selection.configuration];
    }

    /**
	 * Error checks the provided 'config' without any variables substituted.
     * If return "undefined", the debugging will be aborted silently.
     * If return "null", the debugging will be aborted and launch.json will be opened.
	 */
    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        if (!config || !config.type) {
            // When DebugConfigurationProviderTriggerKind is Dynamic, this function will be called with an empty config.
            // Providing debug configs, and debugging should be called manually.
            // Currently, we expect only one debug config to be selected.
            this.provideDebugConfigurations(folder).then(async configs => {
                if (!configs || configs.length === 0) {
                    Telemetry.logDebuggerEvent(DebuggerEvent.debugPanel, { "debugType": "debug", "folderMode": folder ? "folder" : "singleFile", "cancelled": "true" });
                    return undefined; // aborts debugging silently
                } else {
                    console.assert(configs.length === 1, "More than one debug config is selected.");
                    await this.resolvePreLaunchTask(folder, configs[0], DebuggerEvent.debugPanel);
                    await this.startDebugging(folder, configs[0], DebuggerEvent.debugPanel);
                    return configs[0];
                }
            });
        } else {
            // resolveDebugConfigurationWithSubstitutedVariables will be called automatically after this.
            if (config.type === 'cppvsdbg') {
                // Handle legacy 'externalConsole' bool and convert to console: "externalTerminal"
                if (config.hasOwnProperty("externalConsole")) {
                    logger.getOutputChannelLogger().showWarningMessage(localize("debugger.deprecated.config", "The key '{0}' is deprecated. Please use '{1}' instead.", "externalConsole", "console"));
                    if (config.externalConsole && !config.console) {
                        config.console = "externalTerminal";
                    }
                    delete config.externalConsole;
                }

                // Fail if cppvsdbg type is running on non-Windows
                if (os.platform() !== 'win32') {
                    logger.getOutputChannelLogger().showWarningMessage(localize("debugger.not.available", "Debugger of type: '{0}' is only available on Windows. Use type: '{1}' on the current OS platform.", "cppvsdbg", "cppdbg"));
                    return undefined; // Stop debugging
                }
            }
            return config;
        }
    }

    /**
     * This hook is directly called after 'resolveDebugConfiguration' but with all variables substituted.
     * This is also ran after the tasks.json has completed.
     *
	 * Try to add all missing attributes to the debug configuration being launched.
     * If return "undefined", the debugging will be aborted silently.
     * If return "null", the debugging will be aborted and launch.json will be opened.
	 */
    resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        if (!config || !config.type) {
            return undefined;
        }

        if (config.type === 'cppvsdbg') {
            // Disable debug heap by default, enable if 'enableDebugHeap' is set.
            if (!config.enableDebugHeap) {
                const disableDebugHeapEnvSetting: Environment = {"name" : "_NO_DEBUG_HEAP", "value" : "1"};

                if (config.environment && util.isArray(config.environment)) {
                    config.environment.push(disableDebugHeapEnvSetting);
                } else {
                    config.environment = [disableDebugHeapEnvSetting];
                }
            }
        }

        // Add environment variables from .env file
        this.resolveEnvFile(config, folder);

        this.resolveSourceFileMapVariables(config);

        // Modify WSL config for OpenDebugAD7
        if (os.platform() === 'win32' &&
            config.pipeTransport &&
            config.pipeTransport.pipeProgram) {
            let replacedPipeProgram: string | undefined;
            const pipeProgramStr: string = config.pipeTransport.pipeProgram.toLowerCase().trim();

            // OpenDebugAD7 is a 32-bit process. Make sure the WSL pipe transport is using the correct program.
            replacedPipeProgram = debugUtils.ArchitectureReplacer.checkAndReplaceWSLPipeProgram(pipeProgramStr, debugUtils.ArchType.ia32);

            // If pipeProgram does not get replaced and there is a pipeCwd, concatenate with pipeProgramStr and attempt to replace.
            if (!replacedPipeProgram && !path.isAbsolute(pipeProgramStr) && config.pipeTransport.pipeCwd) {
                const pipeCwdStr: string = config.pipeTransport.pipeCwd.toLowerCase().trim();
                const newPipeProgramStr: string = path.join(pipeCwdStr, pipeProgramStr);

                replacedPipeProgram = debugUtils.ArchitectureReplacer.checkAndReplaceWSLPipeProgram(newPipeProgramStr, debugUtils.ArchType.ia32);
            }

            if (replacedPipeProgram) {
                config.pipeTransport.pipeProgram = replacedPipeProgram;
            }
        }

        const macOSMIMode: string = config.osx?.MIMode ?? config.MIMode;
        const macOSMIDebuggerPath: string = config.osx?.miDebuggerPath ?? config.miDebuggerPath;

        const lldb_mi_10_x_path: string = path.join(util.extensionPath, "debugAdapters", "lldb-mi", "bin", "lldb-mi");

        // Validate LLDB-MI
        if (os.platform() === 'darwin' && // Check for macOS
            fs.existsSync(lldb_mi_10_x_path) && // lldb-mi 10.x exists
            (!macOSMIMode || macOSMIMode === 'lldb') &&
            !macOSMIDebuggerPath // User did not provide custom lldb-mi
        ) {
            const frameworkPath: string | undefined = this.getLLDBFrameworkPath();

            if (!frameworkPath) {
                const moreInfoButton: string = localize("lldb.framework.install.xcode", "More Info");
                const LLDBFrameworkMissingMessage: string = localize("lldb.framework.not.found", "Unable to locate 'LLDB.framework' for lldb-mi. Please install XCode or XCode Command Line Tools.");

                vscode.window.showErrorMessage(LLDBFrameworkMissingMessage, moreInfoButton)
                    .then(value => {
                        if (value === moreInfoButton) {
                            const helpURL: string = "https://aka.ms/vscode-cpptools/LLDBFrameworkNotFound";
                            vscode.env.openExternal(vscode.Uri.parse(helpURL));
                        }
                    });

                return undefined;
            }
        }

        if (config.logging?.engineLogging) {
            const outputChannel: logger.Logger = logger.getOutputChannelLogger();
            outputChannel.appendLine(localize("debugger.launchConfig", "Launch configuration:"));
            outputChannel.appendLine(JSON.stringify(config, undefined, 2));
            // TODO: Enable when https://github.com/microsoft/vscode/issues/108619 is resolved.
            // logger.showOutputChannel();
        }

        return config;
    }

    async provideDebugConfigurationsForType(type: DebuggerType, folder?: vscode.WorkspaceFolder, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration[]> {
        const defaultConfig: vscode.DebugConfiguration = this.assetProvider.getInitialConfigurations(type).find((config: any) =>
            isDebugLaunchStr(config.name) && config.request === "launch");
        console.assert(defaultConfig, "Could not find default debug configuration.");

        const platformInfo: PlatformInformation = await PlatformInformation.GetPlatformInformation();
        const platform: string = platformInfo.platform;
        const architecture: string = platformInfo.architecture;

        // Import the existing configured tasks from tasks.json file.
        const configuredBuildTasks: CppBuildTask[] = await cppBuildTaskProvider.getJsonTasks();

        let buildTasks: CppBuildTask[] = [];
        await this.loadDetectedTasks();
        // Remove the tasks that are already configured once in tasks.json.
        const dedupDetectedBuildTasks: CppBuildTask[] = DebugConfigurationProvider.detectedBuildTasks.filter(taskDetected =>
            (!configuredBuildTasks.some(taskJson => (taskJson.definition.label === taskDetected.definition.label))));
        buildTasks = buildTasks.concat(configuredBuildTasks, dedupDetectedBuildTasks);

        if (buildTasks.length === 0) {
            return [];
        }

        // Filter out build tasks that don't match the currently selected debug configuration type.
        buildTasks = buildTasks.filter((task: CppBuildTask) => {
            const command: string = task.definition.command as string;
            if (!command) {
                return false;
            }
            if (defaultConfig.name.startsWith("(Windows) ")) {
                if (command.startsWith("cl.exe")) {
                    return true;
                }
            } else {
                if (!command.startsWith("cl.exe")) {
                    return true;
                }
            }
            return false;
        });

        // Generate new configurations for each build task.
        // Generating a task is async, therefore we must *await* *all* map(task => config) Promises to resolve.
        const configs: vscode.DebugConfiguration[] = await Promise.all(buildTasks.map<Promise<vscode.DebugConfiguration>>(async task => {
            const definition: CppBuildTaskDefinition = task.definition as CppBuildTaskDefinition;
            const compilerPath: string = definition.command;
            const compilerName: string = path.basename(compilerPath);
            const newConfig: vscode.DebugConfiguration = { ...defaultConfig }; // Copy enumerables and properties

            newConfig.name = configPrefix + compilerName + " " + this.buildAndDebugActiveFileStr();
            newConfig.preLaunchTask = task.name;
            if (newConfig.type === "cppdbg") {
                newConfig.externalConsole = false;
            } else {
                newConfig.console = "externalTerminal";
            }
            const isWindows: boolean = platform === 'win32';
            const isMacARM64: boolean = (platform === 'darwin' && architecture === 'arm64');
            const exeName: string = path.join("${fileDirname}", "${fileBasenameNoExtension}");
            newConfig.program = isWindows ? exeName + ".exe" : exeName;
            // Add the "detail" property to show the compiler path in QuickPickItem.
            // This property will be removed before writing the DebugConfiguration in launch.json.
            newConfig.detail = localize("pre.Launch.Task", "preLaunchTask: {0}", task.name);
            newConfig.existing = (task.name === DebugConfigurationProvider.recentBuildTaskLabelStr) ? TaskConfigStatus.recentlyUsed : (task.existing ? TaskConfigStatus.configured : TaskConfigStatus.detected);
            if (isMacARM64) {
                // Workaround to build and debug x86_64 on macARM64 by default.
                // Remove this workaround when native debugging for macARM64 is supported.
                newConfig.targetArchitecture = "x86_64";
            }
            if (task.isDefault) {
                newConfig.isDefault = true;
            }
            const isCl: boolean = compilerName === "cl.exe";
            newConfig.cwd = isWindows && !isCl && !process.env.PATH?.includes(path.dirname(compilerPath)) ? path.dirname(compilerPath) : "${fileDirname}";

            return new Promise<vscode.DebugConfiguration>(resolve => {
                if (platform === "darwin") {
                    return resolve(newConfig);
                } else {
                    let debuggerName: string;
                    if (compilerName.startsWith("clang")) {
                        newConfig.MIMode = "lldb";
                        debuggerName = "lldb-mi";
                        // Search for clang-8, clang-10, etc.
                        if ((compilerName !== "clang-cl.exe") && (compilerName !== "clang-cpp.exe")) {
                            const suffixIndex: number = compilerName.indexOf("-");
                            if (suffixIndex !== -1) {
                                const suffix: string = compilerName.substr(suffixIndex);
                                debuggerName += suffix;
                            }
                        }
                        newConfig.type = "cppdbg";
                    } else if (compilerName === "cl.exe") {
                        newConfig.miDebuggerPath = undefined;
                        newConfig.type = "cppvsdbg";
                        return resolve(newConfig);
                    } else {
                        debuggerName = "gdb";
                    }
                    if (isWindows) {
                        debuggerName = debuggerName.endsWith(".exe") ? debuggerName : (debuggerName + ".exe");
                    }
                    const compilerDirname: string = path.dirname(compilerPath);
                    const debuggerPath: string = path.join(compilerDirname, debuggerName);
                    if (isWindows) {
                        newConfig.miDebuggerPath = debuggerPath;
                        return resolve(newConfig);
                    } else {
                        fs.stat(debuggerPath, (err, stats: fs.Stats) => {
                            if (!err && stats && stats.isFile()) {
                                newConfig.miDebuggerPath = debuggerPath;
                            } else {
                                newConfig.miDebuggerPath = path.join("/usr", "bin", debuggerName);
                            }
                            return resolve(newConfig);
                        });
                    }
                }
            });
        }));
        configs.push(defaultConfig);
        return configs;
    }

    private async loadDetectedTasks(): Promise<void> {
        if (!DebugConfigurationProvider.detectedBuildTasks || DebugConfigurationProvider.detectedBuildTasks.length === 0) {
            DebugConfigurationProvider.detectedBuildTasks = await cppBuildTaskProvider.getTasks(true);
        }
    }

    public static get recentBuildTaskLabelStr(): string {
        return DebugConfigurationProvider.recentBuildTaskLabel;
    }

    public static set recentBuildTaskLabelStr(recentTask: string) {
        DebugConfigurationProvider.recentBuildTaskLabel = recentTask;
    }

    private buildAndDebugActiveFileStr(): string {
        return `${localize("build.and.debug.active.file", 'build and debug active file')}`;
    }

    private isClConfiguration(configurationLabel: string): boolean {
        return configurationLabel.startsWith("C/C++: cl.exe");
    }

    private showErrorIfClNotAvailable(configurationLabel: string): boolean {
        if (!process.env.DevEnvDir || process.env.DevEnvDir.length === 0) {
            vscode.window.showErrorMessage(localize("cl.exe.not.available", "{0} build and debug is only usable when VS Code is run from the Developer Command Prompt for VS.", "cl.exe"));
            return true;
        }
        return false;
    }

    private getLLDBFrameworkPath(): string | undefined {
        const LLDBFramework: string = "LLDB.framework";
        // Note: When adding more search paths, make sure the shipped lldb-mi also has it. See Build/lldb-mi.yml and 'install_name_tool' commands.
        const searchPaths: string[] = [
            "/Library/Developer/CommandLineTools/Library/PrivateFrameworks", // XCode CLI
            "/Applications/Xcode.app/Contents/SharedFrameworks" // App Store XCode
        ];

        for (const searchPath of searchPaths) {
            if (fs.existsSync(path.join(searchPath, LLDBFramework))) {
                // Found a framework that 'lldb-mi' can use.
                return searchPath;
            }
        }

        const outputChannel: logger.Logger = logger.getOutputChannelLogger();

        outputChannel.appendLine(localize("lldb.find.failed", "Missing dependency '{0}' for lldb-mi executable.", LLDBFramework));
        outputChannel.appendLine(localize("lldb.search.paths", "Searched in:"));
        searchPaths.forEach(searchPath => {
            outputChannel.appendLine(`\t${searchPath}`);
        });
        const xcodeCLIInstallCmd: string = "xcode-select --install";
        outputChannel.appendLine(localize("lldb.install.help", "To resolve this issue, either install XCode through the Apple App Store or install the XCode Command Line Tools by running '{0}' in a Terminal window.", xcodeCLIInstallCmd));
        logger.showOutputChannel();

        return undefined;
    }

    private resolveEnvFile(config: vscode.DebugConfiguration, folder?: vscode.WorkspaceFolder): void {
        if (config.envFile) {
            // replace ${env:???} variables
            let envFilePath: string = util.resolveVariables(config.envFile, undefined);

            try {
                if (folder && folder.uri && folder.uri.fsPath) {
                    // Try to replace ${workspaceFolder} or ${workspaceRoot}
                    envFilePath = envFilePath.replace(/(\${workspaceFolder}|\${workspaceRoot})/g, folder.uri.fsPath);
                }

                const parsedFile: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromFile(envFilePath, config["environment"]);

                // show error message if single lines cannot get parsed
                if (parsedFile.Warning) {
                    DebugConfigurationProvider.showFileWarningAsync(parsedFile.Warning, config.envFile);
                }

                config.environment = parsedFile.Env;

                delete config.envFile;
            } catch (errJS) {
                const e: Error = errJS as Error;
                throw new Error(localize("envfile.failed", "Failed to use {0}. Reason: {1}", "envFile", e.message));
            }
        }
    }

    private resolveSourceFileMapVariables(config: vscode.DebugConfiguration): void {
        const messages: string[] = [];
        if (config.sourceFileMap) {
            for (const sourceFileMapSource of Object.keys(config.sourceFileMap)) {
                let message: string = "";
                const sourceFileMapTarget: string = config.sourceFileMap[sourceFileMapSource];

                let source: string = sourceFileMapSource;
                let target: string | object = sourceFileMapTarget;

                // TODO: pass config.environment as 'additionalEnvironment' to resolveVariables when it is { key: value } instead of { "key": key, "value": value }
                const newSourceFileMapSource: string = util.resolveVariables(sourceFileMapSource, undefined);
                if (sourceFileMapSource !== newSourceFileMapSource) {
                    message = "\t" + localize("replacing.sourcepath", "Replacing {0} '{1}' with '{2}'.", "sourcePath", sourceFileMapSource, newSourceFileMapSource);
                    delete config.sourceFileMap[sourceFileMapSource];
                    source = newSourceFileMapSource;
                }

                if (util.isString(sourceFileMapTarget)) {
                    const newSourceFileMapTarget: string = util.resolveVariables(sourceFileMapTarget, undefined);
                    if (sourceFileMapTarget !== newSourceFileMapTarget) {
                        // Add a space if source was changed, else just tab the target message.
                        message +=  (message ? ' ' : '\t');
                        message += localize("replacing.targetpath", "Replacing {0} '{1}' with '{2}'.", "targetPath", sourceFileMapTarget, newSourceFileMapTarget);
                        target = newSourceFileMapTarget;
                    }
                } else if (util.isObject(sourceFileMapTarget)) {
                    const newSourceFileMapTarget: {"editorPath": string; "useForBreakpoints": boolean } = sourceFileMapTarget;
                    newSourceFileMapTarget["editorPath"] = util.resolveVariables(sourceFileMapTarget["editorPath"], undefined);

                    if (sourceFileMapTarget !== newSourceFileMapTarget) {
                        // Add a space if source was changed, else just tab the target message.
                        message +=  (message ? ' ' : '\t');
                        message += localize("replacing.editorPath", "Replacing {0} '{1}' with '{2}'.", "editorPath", sourceFileMapTarget, newSourceFileMapTarget["editorPath"]);
                        target = newSourceFileMapTarget;
                    }
                }

                if (message) {
                    config.sourceFileMap[source] = target;
                    messages.push(message);
                }
            }

            if (messages.length > 0) {
                logger.getOutputChannel().appendLine(localize("resolving.variables.in.sourcefilemap", "Resolving variables in {0}...", "sourceFileMap"));
                messages.forEach((message) => {
                    logger.getOutputChannel().appendLine(message);
                });
                logger.showOutputChannel();
            }
        }
    }

    private static async showFileWarningAsync(message: string, fileName: string): Promise<void> {
        const openItem: vscode.MessageItem = { title: localize("open.envfile", "Open {0}", "envFile") };
        const result: vscode.MessageItem | undefined = await vscode.window.showWarningMessage(message, openItem);
        if (result && result.title === openItem.title) {
            const doc: vscode.TextDocument = await vscode.workspace.openTextDocument(fileName);
            if (doc) {
                vscode.window.showTextDocument(doc);
            }
        }
    }

    public async getLaunchConfigs(folder: vscode.WorkspaceFolder | undefined): Promise<vscode.WorkspaceConfiguration[] | undefined> {
        let configs: vscode.WorkspaceConfiguration[] | undefined = vscode.workspace.getConfiguration('launch', folder).get('configurations');
        if (!configs) {
            return undefined;
        }
        configs = configs.filter(config => (config.name && config.request === "launch" && (config.type === DebuggerType.cppvsdbg || config.type === DebuggerType.cppdbg)));
        return configs;
    }

    public async buildAndRun(textEditor: vscode.TextEditor): Promise<void> {
        // Turn off the debug mode.
        return this.buildAndDebug(textEditor, false);
    }

    public async buildAndDebug(textEditor: vscode.TextEditor, debugModeOn: boolean = true): Promise<void> {

        const folder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
        if (!util.isCppOrCFile(textEditor.document.uri)) {
            vscode.window.showErrorMessage(localize("cannot.build.non.cpp", 'Cannot build and debug because the active file is not a C or C++ source file.'));
            return;
        }

        // Get debug configurations for all debugger types.
        let configs: vscode.DebugConfiguration[] = await this.provideDebugConfigurationsForType(DebuggerType.cppdbg, folder);
        if (os.platform() === 'win32') {
            configs = configs.concat(await this.provideDebugConfigurationsForType(DebuggerType.cppvsdbg, folder));
        }

        if (folder) {
            // Get existing debug configurations from launch.json.
            const existingConfigs: vscode.DebugConfiguration[] | undefined = (await this.getLaunchConfigs(folder))?.map(config => ({
                name: config.name,
                type: config.type,
                request: config.request,
                detail: config.detail ? config.detail : localize("pre.Launch.Task", "preLaunchTask: {0}", config.preLaunchTask),
                preLaunchTask: config.preLaunchTask,
                existing: TaskConfigStatus.configured
            }));
            if (existingConfigs) {
                const areEqual = (config1: vscode.DebugConfiguration, config2: vscode.DebugConfiguration): boolean =>
                    (config1.name === config2.name && config1.preLaunchTask === config2.preLaunchTask
                    && config1.type === config2.type && config1.request === config2.request);
                // Remove the detected configs that are already configured once in launch.json.
                const dedupExistingConfigs: vscode.DebugConfiguration[] = configs.filter(detectedConfig => !existingConfigs.some(config => areEqual(config, detectedConfig)));
                configs = existingConfigs.concat(dedupExistingConfigs);
            }
        }

        const defaultConfig: vscode.DebugConfiguration[] = configs.filter((config: vscode.DebugConfiguration) => (config.hasOwnProperty("isDefault") && config.isDefault));
        interface MenuItem extends vscode.QuickPickItem {
            configuration: vscode.DebugConfiguration;
        }

        const items: MenuItem[] = configs.map<MenuItem>(config => ({ label: config.name, configuration: config, description: config.detail, detail: config.existing }));

        let selection: MenuItem | undefined;

        if (defaultConfig.length !== 0) {
            selection = { label: defaultConfig[0].name, configuration: defaultConfig[0], description: defaultConfig[0].detail, detail: defaultConfig[0].existing };
        } else {
            let sortedItems: MenuItem[] = [];
            // Find the recently used task and place it at the top of quickpick list.
            const recentTask: MenuItem[] = items.filter(item => (item.configuration.preLaunchTask && item.configuration.preLaunchTask === DebugConfigurationProvider.recentBuildTaskLabelStr));
            if (recentTask.length !== 0) {
                recentTask[0].detail = TaskConfigStatus.recentlyUsed;
                sortedItems.push(recentTask[0]);
            }
            sortedItems = sortedItems.concat(items.filter(item => item.detail === TaskConfigStatus.configured));
            sortedItems = sortedItems.concat(items.filter(item => item.detail === TaskConfigStatus.detected));
            selection = await vscode.window.showQuickPick(sortedItems, {
                placeHolder: (items.length === 0 ? localize("no.compiler.found", "No compiler found") : localize("select.debug.configuration", "Select a debug configuration"))
            });
        }

        const debuggerEvent: string = DebuggerEvent.launchPlayButton;
        if (!selection) {
            Telemetry.logDebuggerEvent(debuggerEvent, { "debugType": debugModeOn ? "debug" : "run", "folderMode": folder ? "folder" : "singleFile", "cancelled": "true" });
            return; // User canceled it.
        }

        if (this.isClConfiguration(selection.label) && this.showErrorIfClNotAvailable(selection.label)) {
            return;
        }

        // Resolve config before start debugging.
        let resolvedConfig: vscode.DebugConfiguration | undefined | null;
        if (selection.configuration && selection.configuration.type) {
            resolvedConfig = await this.resolveDebugConfiguration(folder, selection.configuration);
            if (resolvedConfig) {
                resolvedConfig = await this.resolveDebugConfigurationWithSubstitutedVariables(folder, resolvedConfig);
            }
        }
        if (resolvedConfig) {
            await this.resolvePreLaunchTask(folder, resolvedConfig, debuggerEvent, debugModeOn);
            await this.startDebugging(folder, resolvedConfig, debuggerEvent, debugModeOn);
        }
    }

    private async resolvePreLaunchTask(folder: vscode.WorkspaceFolder | undefined, configuration: vscode.DebugConfiguration, debuggerEvent: string, debugModeOn: boolean = true): Promise<void> {
        const debugType: string = debugModeOn ? "debug" : "run";
        const folderMode: string = folder ? "folder" : "singleFile";
        if (configuration.preLaunchTask) {
            try {
                if (folder) {
                    await cppBuildTaskProvider.checkBuildTaskExists(configuration.preLaunchTask);
                    DebugConfigurationProvider.recentBuildTaskLabelStr = configuration.preLaunchTask;
                } else {
                    // In case of singleFile, remove the preLaunch task from the debug configuration and run it here instead.
                    await cppBuildTaskProvider.runBuildTask(configuration.preLaunchTask);
                    DebugConfigurationProvider.recentBuildTaskLabelStr = configuration.preLaunchTask;
                }
            } catch (errJS) {
                const e: Error = errJS as Error;
                if (e && e.message === util.failedToParseJson) {
                    vscode.window.showErrorMessage(util.failedToParseJson);
                }
                Telemetry.logDebuggerEvent(debuggerEvent, { "debugType": debugType, "folderMode": folderMode, "config": "noBuildConfig", "success": "false" });
            }
        }
    }

    private async startDebugging(folder: vscode.WorkspaceFolder | undefined, configuration: vscode.DebugConfiguration, debuggerEvent: string, debugModeOn: boolean = true): Promise<void> {
        const debugType: string = debugModeOn ? "debug" : "run";
        const folderMode: string = folder ? "folder" : "singleFile";
        if (!folder) {
            // In case of singleFile, remove the preLaunch task.
            configuration.preLaunchTask = undefined;
        }
        try {
            // Check if the debug configuration exists in launch.json.
            await cppBuildTaskProvider.checkDebugConfigExists(configuration.name);
            try {
                await vscode.debug.startDebugging(folder, configuration.name, {noDebug: !debugModeOn});
                Telemetry.logDebuggerEvent(debuggerEvent, { "debugType": debugType, "folderMode": folderMode, "config": "launchConfig", "success": "true" });
            } catch (e) {
                Telemetry.logDebuggerEvent(debuggerEvent, { "debugType": debugType, "folderMode": folderMode, "config": "launchConfig", "success": "false" });
            }
        } catch (e) {
            try {
                await vscode.debug.startDebugging(folder, configuration, {noDebug: !debugModeOn});
                Telemetry.logDebuggerEvent(debuggerEvent, { "debugType": debugType, "folderMode": folderMode, "config": "noLaunchConfig", "success": "true" });
            } catch (e) {
                Telemetry.logDebuggerEvent(debuggerEvent, { "debugType": debugType, "folderMode": folderMode, "config": "noLaunchConfig", "success": "false" });
            }
        }
    }
}

export interface IConfigurationAssetProvider {
    getInitialConfigurations(debuggerType: DebuggerType): any;
    getConfigurationSnippets(): vscode.CompletionItem[];
}

export class ConfigurationAssetProviderFactory {
    public static getConfigurationProvider(): IConfigurationAssetProvider {
        switch (os.platform()) {
            case 'win32':
                return new WindowsConfigurationProvider();
            case 'darwin':
                return new OSXConfigurationProvider();
            case 'linux':
                return new LinuxConfigurationProvider();
            default:
                throw new Error(localize("unexpected.os", "Unexpected OS type"));
        }
    }
}

abstract class DefaultConfigurationProvider implements IConfigurationAssetProvider {
    configurations: IConfiguration[] = [];

    public getInitialConfigurations(debuggerType: DebuggerType): any {
        const configurationSnippet: IConfigurationSnippet[] = [];

        // Only launch configurations are initial configurations
        this.configurations.forEach(configuration => {
            configurationSnippet.push(configuration.GetLaunchConfiguration());
        });

        const initialConfigurations: any = configurationSnippet.filter(snippet => snippet.debuggerType === debuggerType && snippet.isInitialConfiguration)
            .map(snippet => JSON.parse(snippet.bodyText));

        // If configurations is empty, then it will only have an empty configurations array in launch.json. Users can still add snippets.
        return initialConfigurations;
    }

    public getConfigurationSnippets(): vscode.CompletionItem[] {
        const completionItems: vscode.CompletionItem[] = [];

        this.configurations.forEach(configuration => {
            completionItems.push(convertConfigurationSnippetToCompletionItem(configuration.GetLaunchConfiguration()));
            completionItems.push(convertConfigurationSnippetToCompletionItem(configuration.GetAttachConfiguration()));
        });

        return completionItems;
    }
}

class WindowsConfigurationProvider extends DefaultConfigurationProvider {
    private executable: string = "a.exe";
    private pipeProgram: string = "<" + localize("path.to.pipe.program", "full path to pipe program such as {0}", "plink.exe").replace(/\"/g, "\\\"") + ">";
    private MIMode: string = 'gdb';
    private setupCommandsBlock: string = `"setupCommands": [
    {
        "description": "${localize("enable.pretty.printing", "Enable pretty-printing for {0}", "gdb").replace(/\"/g, "\\\"")}",
        "text": "-enable-pretty-printing",
        "ignoreFailures": true
    },
    {
        "description":  "${localize("enable.intel.disassembly.flavor", "Set Disassembly Flavor to {0}", "Intel").replace(/\"/g, "\\\"")}",
        "text": "-gdb-set disassembly-flavor intel",
        "ignoreFailures": true
    }
]`;

    constructor() {
        super();
        this.configurations = [
            new MIConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock),
            new PipeTransportConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock),
            new WindowsConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock),
            new WSLConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock)
        ];
    }
}

class OSXConfigurationProvider extends DefaultConfigurationProvider {
    private MIMode: string = 'lldb';
    private executable: string = "a.out";
    private pipeProgram: string = "/usr/bin/ssh";

    constructor() {
        super();
        this.configurations = [
            new MIConfigurations(this.MIMode, this.executable, this.pipeProgram)
        ];
    }
}

class LinuxConfigurationProvider extends DefaultConfigurationProvider {
    private MIMode: string = 'gdb';
    private setupCommandsBlock: string = `"setupCommands": [
    {
        "description": "${localize("enable.pretty.printing", "Enable pretty-printing for {0}", "gdb").replace(/\"/g, "\\\"")}",
        "text": "-enable-pretty-printing",
        "ignoreFailures": true
    },
    {
        "description":  "${localize("enable.intel.disassembly.flavor", "Set Disassembly Flavor to {0}", "Intel").replace(/\"/g, "\\\"")}",
        "text": "-gdb-set disassembly-flavor intel",
        "ignoreFailures": true
    }
]`;
    private executable: string = "a.out";
    private pipeProgram: string = "/usr/bin/ssh";

    constructor() {
        super();
        this.configurations = [
            new MIConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock),
            new PipeTransportConfigurations(this.MIMode, this.executable, this.pipeProgram, this.setupCommandsBlock)
        ];
    }
}

function convertConfigurationSnippetToCompletionItem(snippet: IConfigurationSnippet): vscode.CompletionItem {
    const item: vscode.CompletionItem = new vscode.CompletionItem(snippet.label, vscode.CompletionItemKind.Snippet);

    item.insertText = snippet.bodyText;

    return item;
}

export class ConfigurationSnippetProvider implements vscode.CompletionItemProvider {
    private provider: IConfigurationAssetProvider;
    private snippets: vscode.CompletionItem[];

    constructor(provider: IConfigurationAssetProvider) {
        this.provider = provider;
        this.snippets = this.provider.getConfigurationSnippets();
    }
    public resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken): Thenable<vscode.CompletionItem> {
        return Promise.resolve(item);
    }

    // This function will only provide completion items via the Add Configuration Button
    // There are two cases where the configuration array has nothing or has some items.
    // 1. If it has nothing, insert a snippet the user selected.
    // 2. If there are items, the Add Configuration button will append it to the start of the configuration array. This function inserts a comma at the end of the snippet.
    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Thenable<vscode.CompletionList> {
        let items: vscode.CompletionItem[] = this.snippets;

        const launch: any = parse(document.getText());
        // Check to see if the array is empty, so any additional inserted snippets will need commas.
        if (launch.configurations.length !== 0) {
            items = [];

            // Make a copy of each snippet since we are adding a comma to the end of the insertText.
            this.snippets.forEach((item) => items.push({...item}));

            items.map((item) => {
                item.insertText = item.insertText + ','; // Add comma
            });
        }

        return Promise.resolve(new vscode.CompletionList(items, true));
    }
}
