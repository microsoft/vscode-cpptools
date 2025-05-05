/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as jsonc from 'comment-json';
import * as fs from 'fs';
import * as glob from 'glob';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as util from '../common';
import { isWindows } from '../constants';
import { expandAllStrings, ExpansionOptions, ExpansionVars } from '../expand';
import { CppBuildTask, CppBuildTaskDefinition, cppBuildTaskProvider } from '../LanguageServer/cppBuildTaskProvider';
import { configPrefix } from '../LanguageServer/extension';
import { CppSettings, OtherSettings } from '../LanguageServer/settings';
import * as logger from '../logger';
import { PlatformInformation } from '../platform';
import { rsync, scp, ssh } from '../SSH/commands';
import * as Telemetry from '../telemetry';
import { AttachItemsProvider, AttachPicker, RemoteAttachPicker } from './attachToProcess';
import { ConfigMenu, ConfigMode, ConfigSource, CppDebugConfiguration, DebuggerEvent, DebuggerType, DebugType, IConfiguration, IConfigurationSnippet, isDebugLaunchStr, MIConfigurations, PipeTransportConfigurations, TaskStatus, WindowsConfigurations, WSLConfigurations } from './configurations';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { Environment, ParsedEnvironmentFile } from './ParsedEnvironmentFile';
import * as debugUtils from './utils';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

enum StepType {
    scp = 'scp',
    rsync = 'rsync',
    ssh = 'ssh',
    shell = 'shell',
    remoteShell = 'remoteShell',
    command = 'command'
}

const globAsync: (pattern: string, options?: glob.IOptions | undefined) => Promise<string[]> = promisify(glob);

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
    private static detectedCppBuildTasks: CppBuildTask[] = [];
    private static detectedCBuildTasks: CppBuildTask[] = [];
    protected static recentBuildTaskLabel: string;

    public constructor(assetProvider: IConfigurationAssetProvider, type: DebuggerType) {
        this.assetProvider = assetProvider;
        this.type = type;
    }

    public static ClearDetectedBuildTasks(): void {
        DebugConfigurationProvider.detectedCppBuildTasks = [];
        DebugConfigurationProvider.detectedCBuildTasks = [];
    }

    /**
     * Returns a list of initial debug configurations based on contextual information, e.g. package.json or folder.
     * resolveDebugConfiguration will be automatically called after this function.
     */
    async provideDebugConfigurations(folder?: vscode.WorkspaceFolder, token?: vscode.CancellationToken): Promise<CppDebugConfiguration[]> {
        let configs: CppDebugConfiguration[] | null | undefined = await this.provideDebugConfigurationsForType(this.type, folder, token);
        if (!configs) {
            configs = [];
        }
        const defaultTemplateConfig: CppDebugConfiguration | undefined = configs.find(config => isDebugLaunchStr(config.name) && config.request === "launch");
        if (!defaultTemplateConfig) {
            throw new Error("Default config not found in provideDebugConfigurations()");
        }
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!editor || !util.isCppOrCFile(editor.document.uri) || configs.length <= 1) {
            return [defaultTemplateConfig];
        }

        const defaultConfig: CppDebugConfiguration[] = this.findDefaultConfig(configs);
        // If there was only one config defined for the default task, choose that config, otherwise ask the user to choose.
        if (defaultConfig.length === 1) {
            if (this.isClConfiguration(defaultConfig[0].name) && await this.showErrorIfClNotAvailable(defaultConfig[0].label)) {
                return []; // Cannot continue with build/debug.
            }
            return defaultConfig;
        }

        // Find the recently used task and place it at the top of quickpick list.
        let recentlyUsedConfig: CppDebugConfiguration | undefined;
        configs = configs.filter(config => {
            if (config.taskStatus !== TaskStatus.recentlyUsed) {
                return true;
            } else {
                recentlyUsedConfig = config;
                return false;
            }
        });
        if (recentlyUsedConfig) {
            configs.unshift(recentlyUsedConfig);
        }

        const items: ConfigMenu[] = configs.map<ConfigMenu>(config => {
            const quickPickConfig: CppDebugConfiguration = { ...config };
            const menuItem: ConfigMenu = { label: config.name, configuration: quickPickConfig, description: config.detail, detail: config.taskStatus };
            // Rename the menu item for the default configuration as its name is non-descriptive.
            if (isDebugLaunchStr(menuItem.label)) {
                menuItem.label = localize("default.configuration.menuitem", "Default Configuration");
            }
            return menuItem;
        });

        const selection: ConfigMenu | undefined = await vscode.window.showQuickPick(this.localizeConfigDetail(items), { placeHolder: localize("select.configuration", "Select a configuration") });
        if (!selection) {
            Telemetry.logDebuggerEvent(DebuggerEvent.debugPanel, { "debugType": "debug", "configSource": ConfigSource.unknown, "configMode": ConfigMode.unknown, "cancelled": "true", "succeeded": "true" });
            return []; // User canceled it.
        }

        if (this.isClConfiguration(selection.label) && await this.showErrorIfClNotAvailable(selection.label)) {
            return []; // Cannot continue with build/debug.
        }

        return [selection.configuration];
    }

    /**
     * Error checks the provided 'config' without any variables substituted.
     * If return "undefined", the debugging will be aborted silently.
     * If return "null", the debugging will be aborted and launch.json will be opened.
     * resolveDebugConfigurationWithSubstitutedVariables will be automatically called after this function.
     */
    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: CppDebugConfiguration, _token?: vscode.CancellationToken): Promise<CppDebugConfiguration | null | undefined> {
        if (!config || !config.type) {
            // When DebugConfigurationProviderTriggerKind is Dynamic, this function will be called with an empty config.
            // Hence, providing debug configs, and start debugging should be done manually.
            // resolveDebugConfiguration will be automatically called after calling provideDebugConfigurations.
            const configs: CppDebugConfiguration[] = await this.provideDebugConfigurations(folder);
            if (!configs || configs.length === 0) {
                Telemetry.logDebuggerEvent(DebuggerEvent.debugPanel, { "debugType": DebugType.debug, "configSource": folder ? ConfigSource.workspaceFolder : ConfigSource.singleFile, "configMode": ConfigMode.noLaunchConfig, "cancelled": "true", "succeeded": "true" });
                return undefined; // aborts debugging silently
            } else {
                // Currently, we expect only one debug config to be selected.
                console.assert(configs.length === 1, "More than one debug config is selected.");
                config = configs[0];
                // Keep track of the entry point where the debug config has been selected, for telemetry purposes.
                config.debuggerEvent = DebuggerEvent.debugPanel;
                config.configSource = folder ? ConfigSource.workspaceFolder : ConfigSource.singleFile;
            }
        }

        /** If the config is coming from the "Run and Debug" debugPanel, there are three cases where the folder is undefined:
         * 1. when debugging is done on a single file where there is no folder open,
         * 2. when the debug configuration is defined at the User level (global).
         * 3. when the debug configuration is defined at the workspace level.
         * If the config is coming from the "Run and Debug" playButton, there is one case where the folder is undefined:
         * 1. when debugging is done on a single file where there is no folder open.
         */

        /** Do not resolve PreLaunchTask for these three cases, and let the Vs Code resolve it:
         * 1: The existing configs that are found for a single file.
         * 2: The existing configs that come from the playButton (the PreLaunchTask should already be defined for these configs).
         * 3: The existing configs that come from the debugPanel where the folder is undefined and the PreLaunchTask cannot be found.
         */

        if (config.preLaunchTask) {
            config.configSource = this.getDebugConfigSource(config, folder);
            const isIntelliSenseDisabled: boolean = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined).intelliSenseEngine === "disabled";
            // Run the build task if IntelliSense is disabled.
            if (isIntelliSenseDisabled) {
                try {
                    await cppBuildTaskProvider.runBuildTask(config.preLaunchTask);
                    config.preLaunchTask = undefined;
                    Telemetry.logDebuggerEvent(DebuggerEvent.debugPanel, { "debugType": DebugType.debug, "configSource": config.configSource || ConfigSource.unknown, "configMode": ConfigMode.launchConfig, "cancelled": "false", "succeeded": "true" });
                } catch (err) {
                    Telemetry.logDebuggerEvent(DebuggerEvent.debugPanel, { "debugType": DebugType.debug, "configSource": config.configSource || ConfigSource.unknown, "configMode": ConfigMode.launchConfig, "cancelled": "false", "succeeded": "false" });
                }
                return config;
            }
            let resolveByVsCode: boolean = false;
            const isDebugPanel: boolean = !config.debuggerEvent || (config.debuggerEvent && config.debuggerEvent === DebuggerEvent.debugPanel);
            const singleFile: boolean = config.configSource === ConfigSource.singleFile;
            const isExistingConfig: boolean = this.isExistingConfig(config, folder);
            const isExistingTask: boolean = await this.isExistingTask(config, folder);
            if (singleFile) {
                if (isExistingConfig) {
                    resolveByVsCode = true;
                }
            } else {
                if (!isDebugPanel && (isExistingConfig || isExistingTask)) {
                    resolveByVsCode = true;
                } else if (isDebugPanel && !folder && isExistingConfig && !isExistingTask) {
                    resolveByVsCode = true;
                }
            }

            // Send the telemetry before writing into files
            config.debugType = config.debugType ? config.debugType : DebugType.debug;
            const configMode: ConfigMode = isExistingConfig ? ConfigMode.launchConfig : ConfigMode.noLaunchConfig;
            // if configuration.debuggerEvent === undefined, it means this configuration is already defined in launch.json and is shown in debugPanel.
            Telemetry.logDebuggerEvent(config.debuggerEvent || DebuggerEvent.debugPanel, { "debugType": config.debugType || DebugType.debug, "configSource": config.configSource || ConfigSource.unknown, "configMode": configMode, "cancelled": "false", "succeeded": "true" });

            if (!resolveByVsCode) {
                if (singleFile || (isDebugPanel && !folder && isExistingTask)) {
                    await this.resolvePreLaunchTask(config, configMode);
                    config.preLaunchTask = undefined;
                } else {
                    await this.resolvePreLaunchTask(config, configMode, folder);
                    DebugConfigurationProvider.recentBuildTaskLabelStr = config.preLaunchTask;
                }
            } else {
                DebugConfigurationProvider.recentBuildTaskLabelStr = config.preLaunchTask;
            }
        }

        // resolveDebugConfigurationWithSubstitutedVariables will be automatically called after this return.
        return config;
    }

    /**
     * This hook is directly called after 'resolveDebugConfiguration' but with all variables substituted.
     * This is also ran after the tasks.json has completed.
     *
     * Try to add all missing attributes to the debug configuration being launched.
     * If return "undefined", the debugging will be aborted silently.
     * If return "null", the debugging will be aborted and launch.json will be opened.
     */
    async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, config: CppDebugConfiguration, token?: vscode.CancellationToken): Promise<CppDebugConfiguration | null | undefined> {
        if (!config || !config.type) {
            return undefined; // Abort debugging silently.
        }

        if (config.type === DebuggerType.cppvsdbg) {
            // Fail if cppvsdbg type is running on non-Windows
            if (os.platform() !== 'win32') {
                void logger.getOutputChannelLogger().showWarningMessage(localize("debugger.not.available", "Debugger of type: '{0}' is only available on Windows. Use type: '{1}' on the current OS platform.", "cppvsdbg", "cppdbg"));
                return undefined; // Abort debugging silently.
            }

            // Handle legacy 'externalConsole' bool and convert to console: "externalTerminal"
            // eslint-disable-next-line no-prototype-builtins
            if (config.hasOwnProperty("externalConsole")) {
                void logger.getOutputChannelLogger().showWarningMessage(localize("debugger.deprecated.config", "The key '{0}' is deprecated. Please use '{1}' instead.", "externalConsole", "console"));
                if (config.externalConsole && !config.console) {
                    config.console = "externalTerminal";
                }
                delete config.externalConsole;
            }

            // Disable debug heap by default, enable if 'enableDebugHeap' is set.
            if (!config.enableDebugHeap) {
                const disableDebugHeapEnvSetting: Environment = { "name": "_NO_DEBUG_HEAP", "value": "1" };

                if (config.environment && util.isArray(config.environment)) {
                    config.environment.push(disableDebugHeapEnvSetting);
                } else {
                    config.environment = [disableDebugHeapEnvSetting];
                }
            }
        }

        // Add environment variables from .env file
        this.resolveEnvFile(config, folder);

        await this.expand(config, folder);

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

                void vscode.window.showErrorMessage(LLDBFrameworkMissingMessage, moreInfoButton)
                    .then(value => {
                        if (value === moreInfoButton) {
                            const helpURL: string = "https://aka.ms/vscode-cpptools/LLDBFrameworkNotFound";
                            void vscode.env.openExternal(vscode.Uri.parse(helpURL));
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

        // Run deploy steps
        if (config.deploySteps && config.deploySteps.length !== 0) {
            const codeVersion: number[] = util.getVsCodeVersion();
            if ((util.isNumber(codeVersion[0]) && codeVersion[0] < 1) || (util.isNumber(codeVersion[0]) && codeVersion[0] === 1 && util.isNumber(codeVersion[1]) && codeVersion[1] < 69)) {
                void logger.getOutputChannelLogger().showErrorMessage(localize("vs.code.1.69+.required", "'deploySteps' require VS Code 1.69+."));
                return undefined;
            }

            const deploySucceeded: boolean = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: localize("running.deploy.steps", "Running deploy steps...")
            }, async () => this.deploySteps(config, token));

            if (!deploySucceeded || token?.isCancellationRequested) {
                return undefined;
            }
        }

        // Pick process if process id is empty
        if (config.request === "attach" && !config.processId) {
            let processId: string | undefined;
            if (config.pipeTransport || config.useExtendedRemote) {
                const remoteAttachPicker: RemoteAttachPicker = new RemoteAttachPicker();
                processId = await remoteAttachPicker.ShowAttachEntries(config);
            } else {
                const attachItemsProvider: AttachItemsProvider = NativeAttachItemsProviderFactory.Get();
                const attacher: AttachPicker = new AttachPicker(attachItemsProvider);
                processId = await attacher.ShowAttachEntries(token);
            }

            if (processId) {
                config.processId = processId;
            } else {
                void logger.getOutputChannelLogger().showErrorMessage("No process was selected.");
                return undefined;
            }
        }

        return config;
    }

    async provideDebugConfigurationsForType(type: DebuggerType, folder?: vscode.WorkspaceFolder, _token?: vscode.CancellationToken): Promise<CppDebugConfiguration[]> {
        const defaultTemplateConfig: CppDebugConfiguration = this.assetProvider.getInitialConfigurations(type).find((config: any) =>
            isDebugLaunchStr(config.name) && config.request === "launch");
        console.assert(defaultTemplateConfig, "Could not find default debug configuration.");

        const platformInfo: PlatformInformation = await PlatformInformation.GetPlatformInformation();

        // Import the existing configured tasks from tasks.json file.
        const configuredBuildTasks: CppBuildTask[] = await cppBuildTaskProvider.getJsonTasks();

        let buildTasks: CppBuildTask[] = [];
        await this.loadDetectedTasks();
        // Remove the tasks that are already configured once in tasks.json.
        const dedupDetectedBuildTasks: CppBuildTask[] = DebugConfigurationProvider.detectedBuildTasks.filter(taskDetected =>
            !configuredBuildTasks.some(taskJson => taskJson.definition.label === taskDetected.definition.label));
        buildTasks = buildTasks.concat(configuredBuildTasks, dedupDetectedBuildTasks);

        // Filter out build tasks that don't match the currently selected debug configuration type.
        if (buildTasks.length !== 0) {
            buildTasks = buildTasks.filter((task: CppBuildTask) => {
                const command: string = task.definition.command as string;
                if (!command) {
                    return false;
                }
                if (defaultTemplateConfig.name.startsWith("(Windows) ")) {
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
        }

        // Generate new configurations for each build task.
        // Generating a task is async, therefore we must *await* *all* map(task => config) Promises to resolve.
        let configs: CppDebugConfiguration[] = [];
        if (buildTasks.length !== 0) {
            configs = (await Promise.all(buildTasks.map<Promise<CppDebugConfiguration | undefined>>(async task => {
                const definition: CppBuildTaskDefinition = task.definition as CppBuildTaskDefinition;
                const compilerPath: string = util.isString(definition.command) ? definition.command : definition.command.value;
                // Filter out the tasks that has an invalid compiler path.
                const compilerPathExists: boolean = path.isAbsolute(compilerPath) ?
                    // Absolute path, just check if it exists
                    await util.checkFileExists(compilerPath) :
                    // Non-absolute. Check on $PATH
                    (await util.whichAsync(compilerPath) !== undefined);
                if (!compilerPathExists) {
                    logger.getOutputChannelLogger().appendLine(localize('compiler.path.not.exists', "Unable to find {0}. {1} task is ignored.", compilerPath, definition.label));
                }
                const compilerName: string = path.basename(compilerPath);
                const newConfig: CppDebugConfiguration = { ...defaultTemplateConfig }; // Copy enumerables and properties
                newConfig.existing = false;

                newConfig.name = configPrefix + compilerName + " " + this.buildAndDebugActiveFileStr();
                newConfig.preLaunchTask = task.name;
                if (newConfig.type === DebuggerType.cppdbg) {
                    newConfig.externalConsole = false;
                } else {
                    newConfig.console = "integratedTerminal";
                }
                // Extract the .exe path from the defined task.
                const definedExePath: string | undefined = util.findExePathInArgs(task.definition.args);
                newConfig.program = definedExePath ? definedExePath : util.defaultExePath();
                // Add the "detail" property to show the compiler path in QuickPickItem.
                // This property will be removed before writing the DebugConfiguration in launch.json.
                newConfig.detail = localize("pre.Launch.Task", "preLaunchTask: {0}", task.name);
                newConfig.taskDetail = task.detail;
                newConfig.taskStatus = task.existing ?
                    (task.name === DebugConfigurationProvider.recentBuildTaskLabelStr) ? TaskStatus.recentlyUsed : TaskStatus.configured :
                    TaskStatus.detected;
                if (task.isDefault) {
                    newConfig.isDefault = true;
                }
                const isCl: boolean = compilerName === "cl.exe";
                newConfig.cwd = isWindows && !isCl && !process.env.PATH?.includes(path.dirname(compilerPath)) ? path.dirname(compilerPath) : "${fileDirname}";

                if (platformInfo.platform !== "darwin") {
                    let debuggerName: string;
                    if (compilerName.startsWith("clang")) {
                        newConfig.MIMode = "lldb";
                        if (isWindows) {
                            debuggerName = "lldb";
                        } else {
                            debuggerName = "lldb-mi";
                            // Search for clang-8, clang-10, etc.
                            if ((compilerName !== "clang-cl.exe") && (compilerName !== "clang-cpp.exe")) {
                                const suffixIndex: number = compilerName.indexOf("-");
                                if (suffixIndex !== -1) {
                                    const suffix: string = compilerName.substring(suffixIndex);
                                    debuggerName += suffix;
                                }
                            }
                        }
                        newConfig.type = DebuggerType.cppdbg;
                    } else if (compilerName === "cl.exe") {
                        newConfig.miDebuggerPath = undefined;
                        newConfig.type = DebuggerType.cppvsdbg;
                        return newConfig;
                    } else {
                        debuggerName = "gdb";
                    }
                    if (isWindows) {
                        debuggerName = debuggerName.endsWith(".exe") ? debuggerName : (debuggerName + ".exe");
                    }
                    const compilerDirname: string = path.dirname(compilerPath);
                    const debuggerPath: string = path.join(compilerDirname, debuggerName);

                    // Check if debuggerPath exists.
                    if (await util.checkFileExists(debuggerPath)) {
                        newConfig.miDebuggerPath = debuggerPath;
                    } else if (await util.whichAsync(debuggerName) !== undefined) {
                        // Check if debuggerName exists on $PATH
                        newConfig.miDebuggerPath = debuggerName;
                    } else {
                        // Try the usr path for non-Windows platforms.
                        const usrDebuggerPath: string = path.join("/usr", "bin", debuggerName);
                        if (!isWindows && await util.checkFileExists(usrDebuggerPath)) {
                            newConfig.miDebuggerPath = usrDebuggerPath;
                        } else {
                            logger.getOutputChannelLogger().appendLine(localize('debugger.path.not.exists', "Unable to find the {0} debugger. The debug configuration for {1} is ignored.", `\"${debuggerName}\"`, compilerName));
                            return undefined;
                        }
                    }
                }
                return newConfig;
            }))).filter((item): item is CppDebugConfiguration => !!item);
        }
        configs.push(defaultTemplateConfig);
        const existingConfigs: CppDebugConfiguration[] | undefined = this.getLaunchConfigs(folder, type)?.map(config => {
            if (!config.detail && config.preLaunchTask) {
                config.detail = localize("pre.Launch.Task", "preLaunchTask: {0}", config.preLaunchTask);
            }
            config.existing = true;
            return config;
        });
        if (existingConfigs) {
            // Remove the detected configs that are already configured once in launch.json.
            const dedupExistingConfigs: CppDebugConfiguration[] = configs.filter(detectedConfig => !existingConfigs.some(config => {
                if (config.preLaunchTask === detectedConfig.preLaunchTask && config.type === detectedConfig.type && config.request === detectedConfig.request) {
                    // Carry the default task information.
                    config.isDefault = detectedConfig.isDefault ? detectedConfig.isDefault : undefined;
                    return true;
                }
                return false;
            }));
            configs = existingConfigs.concat(dedupExistingConfigs);
        }
        return configs;
    }

    private async loadDetectedTasks(): Promise<void> {
        const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        const emptyTasks: CppBuildTask[] = [];
        if (!editor) {
            DebugConfigurationProvider.detectedBuildTasks = emptyTasks;
            return;
        }

        const fileExt: string = path.extname(editor.document.fileName);
        if (!fileExt) {
            DebugConfigurationProvider.detectedBuildTasks = emptyTasks;
            return;
        }

        // Don't offer tasks for header files.
        const isHeader: boolean = util.isHeaderFile(editor.document.uri);
        if (isHeader) {
            DebugConfigurationProvider.detectedBuildTasks = emptyTasks;
            return;
        }

        // Don't offer tasks if the active file's extension is not a recognized C/C++ extension.
        const fileIsCpp: boolean = util.isCppFile(editor.document.uri);
        const fileIsC: boolean = util.isCFile(editor.document.uri);
        if (!(fileIsCpp || fileIsC)) {
            DebugConfigurationProvider.detectedBuildTasks = emptyTasks;
            return;
        }

        if (fileIsCpp) {
            if (!DebugConfigurationProvider.detectedCppBuildTasks || DebugConfigurationProvider.detectedCppBuildTasks.length === 0) {
                DebugConfigurationProvider.detectedCppBuildTasks = await cppBuildTaskProvider.getTasks(true);
            }
            DebugConfigurationProvider.detectedBuildTasks = DebugConfigurationProvider.detectedCppBuildTasks;
        } else {
            if (!DebugConfigurationProvider.detectedCBuildTasks || DebugConfigurationProvider.detectedCBuildTasks.length === 0) {
                DebugConfigurationProvider.detectedCBuildTasks = await cppBuildTaskProvider.getTasks(true);
            }
            DebugConfigurationProvider.detectedBuildTasks = DebugConfigurationProvider.detectedCBuildTasks;
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

    private isClConfiguration(configurationLabel?: string): boolean {
        return !!configurationLabel?.startsWith("C/C++: cl.exe");
    }

    /**
     * @returns `true` if the Developer Environment is not available and an error was shown to the user, `false` if the Developer Environment is available or the user chose to apply it.
     */
    private async showErrorIfClNotAvailable(_configurationLabel: string): Promise<boolean> {
        if (util.hasMsvcEnvironment()) {
            return false; // No error to show
        }

        const applyDevEnv = localize("apply.dev.env", "Apply Developer Environment");
        const cancel = localize("cancel", "Cancel");
        const response = await vscode.window.showErrorMessage(
            localize({
                key: "cl.exe.not.available",
                comment: ["{0} is a command option in a menu."]
            }, "{0} requires the Visual Studio Developer Environment.", `cl.exe ${this.buildAndDebugActiveFileStr()}`),
            applyDevEnv,
            cancel);
        if (response === applyDevEnv) {
            try {
                await vscode.commands.executeCommand('C_Cpp.SetVSDevEnvironment', 'buildAndDebug');
            } catch (e: any) {
                // Ignore the error, the user will be prompted to apply the environment manually.
            }
        }
        if (response === cancel || response === undefined) {
            // A message was already shown, so exit early noting that the environment is not available. We don't need to show another error message.
            return true;
        }

        if (util.hasMsvcEnvironment()) {
            return false;
        }
        void vscode.window.showErrorMessage(
            localize('dev.env.not.applied', 'The source code could not be built because the Visual Studio Developer Environment was not applied.'));
        return true;
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

    private resolveEnvFile(config: CppDebugConfiguration, folder?: vscode.WorkspaceFolder): void {
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
                    void DebugConfigurationProvider.showFileWarningAsync(parsedFile.Warning, config.envFile);
                }

                config.environment = parsedFile.Env;

                delete config.envFile;
            } catch (errJS) {
                const e: Error = errJS as Error;
                throw new Error(localize("envfile.failed", "Failed to use {0}. Reason: {1}", "envFile", e.message));
            }
        }
    }

    private resolveSourceFileMapVariables(config: CppDebugConfiguration): void {
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
                    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                    delete config.sourceFileMap[sourceFileMapSource];
                    source = newSourceFileMapSource;
                }

                if (util.isString(sourceFileMapTarget)) {
                    const newSourceFileMapTarget: string = util.resolveVariables(sourceFileMapTarget, undefined);
                    if (sourceFileMapTarget !== newSourceFileMapTarget) {
                        // Add a space if source was changed, else just tab the target message.
                        message += message ? ' ' : '\t';
                        message += localize("replacing.targetpath", "Replacing {0} '{1}' with '{2}'.", "targetPath", sourceFileMapTarget, newSourceFileMapTarget);
                        target = newSourceFileMapTarget;
                    }
                } else if (util.isObject(sourceFileMapTarget)) {
                    const newSourceFileMapTarget: { "editorPath": string; "useForBreakpoints": boolean } = sourceFileMapTarget;
                    newSourceFileMapTarget["editorPath"] = util.resolveVariables(sourceFileMapTarget["editorPath"], undefined);

                    if (sourceFileMapTarget !== newSourceFileMapTarget) {
                        // Add a space if source was changed, else just tab the target message.
                        message += message ? ' ' : '\t';
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
                void vscode.window.showTextDocument(doc);
            }
        }
    }

    private localizeConfigDetail(items: ConfigMenu[]): ConfigMenu[] {
        items.map((item: ConfigMenu) => {
            switch (item.detail) {
                case TaskStatus.recentlyUsed: {
                    item.detail = localize("recently.used.task", "Recently Used Task");
                    break;
                }
                case TaskStatus.configured: {
                    item.detail = localize("configured.task", "Configured Task");
                    break;
                }
                case TaskStatus.detected: {
                    item.detail = localize("detected.task", "Detected Task");
                    break;
                }
                default: {
                    break;
                }
            }
            if (item.configuration.taskDetail) {
                // Add the compiler path of the preLaunchTask to the description of the debug configuration.
                item.detail = (item.detail ?? "") + " (" + item.configuration.taskDetail + ")";
            }
        });
        return items;
    }

    private findDefaultConfig(configs: CppDebugConfiguration[]): CppDebugConfiguration[] {
        // eslint-disable-next-line no-prototype-builtins
        return configs.filter((config: CppDebugConfiguration) => config.hasOwnProperty("isDefault") && config.isDefault);
    }

    private async isExistingTask(config: CppDebugConfiguration, folder?: vscode.WorkspaceFolder): Promise<boolean> {
        if (config.taskStatus && (config.taskStatus !== TaskStatus.detected)) {
            return true;
        } else if (config.taskStatus && (config.taskStatus === TaskStatus.detected)) {
            return false;
        }
        return cppBuildTaskProvider.isExistingTask(config.preLaunchTask, folder);
    }

    private isExistingConfig(config: CppDebugConfiguration, folder?: vscode.WorkspaceFolder): boolean {
        if (config.existing) {
            return config.existing;
        }
        const configs: CppDebugConfiguration[] | undefined = this.getLaunchConfigs(folder, config.type);
        if (configs && configs.length > 0) {
            const selectedConfig: any | undefined = configs.find((item: any) => item.name && item.name === config.name);
            if (selectedConfig) {
                return true;
            }
        }
        return false;
    }

    private getDebugConfigSource(config: CppDebugConfiguration, folder?: vscode.WorkspaceFolder): ConfigSource | undefined {
        if (config.configSource) {
            return config.configSource;
        }
        const isExistingConfig: boolean = this.isExistingConfig(config, folder);
        if (!isExistingConfig && !folder) {
            return ConfigSource.singleFile;
        } else if (!isExistingConfig) {
            return ConfigSource.workspaceFolder;
        }

        const configs: CppDebugConfiguration[] | undefined = this.getLaunchConfigs(folder, config.type);
        const matchingConfig: CppDebugConfiguration | undefined = configs?.find((item: any) => item.name && item.name === config.name);
        if (matchingConfig?.configSource) {
            return matchingConfig.configSource;
        }
        return ConfigSource.unknown;
    }

    public getLaunchConfigs(folder?: vscode.WorkspaceFolder, type?: DebuggerType | string): CppDebugConfiguration[] | undefined {
        // Get existing debug configurations from launch.json or user/workspace "launch" settings.
        const WorkspaceConfigs: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('launch', folder);
        const configs: any = WorkspaceConfigs.inspect<vscode.DebugConfiguration>('configurations');
        if (!configs) {
            return undefined;
        }
        let detailedConfigs: CppDebugConfiguration[] = [];
        if (configs.workspaceFolderValue !== undefined) {
            detailedConfigs = detailedConfigs.concat(configs.workspaceFolderValue.map((item: CppDebugConfiguration) => {
                item.configSource = ConfigSource.workspaceFolder;
                return item;
            }));
        }
        if (configs.workspaceValue !== undefined) {
            detailedConfigs = detailedConfigs.concat(configs.workspaceValue.map((item: CppDebugConfiguration) => {
                item.configSource = ConfigSource.workspace;
                return item;
            }));
        }
        if (configs.globalValue !== undefined) {
            detailedConfigs = detailedConfigs.concat(configs.globalValue.map((item: CppDebugConfiguration) => {
                item.configSource = ConfigSource.global;
                return item;
            }));
        }
        detailedConfigs = detailedConfigs.filter((config: any) => config.name && config.request === "launch" && type ? (config.type === type) : true);
        return detailedConfigs;
    }

    private getLaunchJsonPath(): string | undefined {
        return util.getJsonPath("launch.json");
    }

    private getRawLaunchJson(): Promise<any> {
        const path: string | undefined = this.getLaunchJsonPath();
        return util.getRawJson(path);
    }

    public async writeDebugConfig(config: vscode.DebugConfiguration, isExistingConfig: boolean, _folder?: vscode.WorkspaceFolder): Promise<void> {
        const launchJsonPath: string | undefined = this.getLaunchJsonPath();

        if (isExistingConfig) {
            if (launchJsonPath) {
                const doc: vscode.TextDocument = await vscode.workspace.openTextDocument(launchJsonPath);
                if (doc) {
                    void vscode.window.showTextDocument(doc);
                }
            }
            return;
        }
        const rawLaunchJson: any = await this.getRawLaunchJson();
        if (!rawLaunchJson.configurations) {
            rawLaunchJson.configurations = [];
        }
        if (!rawLaunchJson.version) {
            rawLaunchJson.version = "2.0.0";
        }

        // Remove the extra properties that are not a part of the vsCode.DebugConfiguration.
        config.detail = undefined;
        config.taskStatus = undefined;
        config.isDefault = undefined;
        config.source = undefined;
        config.debuggerEvent = undefined;
        config.debugType = undefined;
        config.existing = undefined;
        config.taskDetail = undefined;
        rawLaunchJson.configurations.push(config);

        if (!launchJsonPath) {
            throw new Error("Failed to get tasksJsonPath in checkBuildTaskExists()");
        }

        const settings: OtherSettings = new OtherSettings();
        await util.writeFileText(launchJsonPath, jsonc.stringify(rawLaunchJson, null, settings.editorTabSize));
        await vscode.workspace.openTextDocument(launchJsonPath);
        const doc: vscode.TextDocument = await vscode.workspace.openTextDocument(launchJsonPath);
        if (doc) {
            void vscode.window.showTextDocument(doc);
        }
    }

    public async addDebugConfiguration(textEditor: vscode.TextEditor): Promise<void> {
        const folder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
        if (!folder) {
            return;
        }
        const selectedConfig: vscode.DebugConfiguration | undefined = await this.selectConfiguration(textEditor, false, true);
        if (!selectedConfig) {
            Telemetry.logDebuggerEvent(DebuggerEvent.addConfigGear, { "configSource": ConfigSource.workspaceFolder, "configMode": ConfigMode.launchConfig, "cancelled": "true", "succeeded": "true" });
            return; // User canceled it.
        }

        const isExistingConfig: boolean = this.isExistingConfig(selectedConfig, folder);
        // Write preLaunchTask into tasks.json file.
        if (!isExistingConfig && selectedConfig.preLaunchTask && (selectedConfig.taskStatus && selectedConfig.taskStatus === TaskStatus.detected)) {
            await cppBuildTaskProvider.writeBuildTask(selectedConfig.preLaunchTask);
        }
        // Remove the extra properties that are not a part of the DebugConfiguration, as these properties will be written in launch.json.
        selectedConfig.detail = undefined;
        selectedConfig.taskStatus = undefined;
        selectedConfig.isDefault = undefined;
        selectedConfig.source = undefined;
        selectedConfig.debuggerEvent = undefined;
        // Write debug configuration in launch.json file.
        await this.writeDebugConfig(selectedConfig, isExistingConfig, folder);
        Telemetry.logDebuggerEvent(DebuggerEvent.addConfigGear, { "configSource": ConfigSource.workspaceFolder, "configMode": ConfigMode.launchConfig, "cancelled": "false", "succeeded": "true" });
    }

    public async buildAndRun(textEditor: vscode.TextEditor): Promise<void> {
        // Turn off the debug mode.
        return this.buildAndDebug(textEditor, false);
    }

    public async buildAndDebug(textEditor: vscode.TextEditor, debugModeOn: boolean = true): Promise<void> {
        let folder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
        const selectedConfig: CppDebugConfiguration | undefined = await this.selectConfiguration(textEditor);
        if (!selectedConfig) {
            Telemetry.logDebuggerEvent(DebuggerEvent.playButton, { "debugType": debugModeOn ? DebugType.debug : DebugType.run, "configSource": ConfigSource.unknown, "cancelled": "true", "succeeded": "true" });
            return; // User canceled it.
        }

        // Keep track of the entry point where the debug has been selected, for telemetry purposes.
        selectedConfig.debuggerEvent = DebuggerEvent.playButton;
        // If the configs are coming from workspace or global settings and the task is not found in tasks.json, let that to be resolved by VsCode.
        if (selectedConfig.preLaunchTask && selectedConfig.configSource &&
            (selectedConfig.configSource === ConfigSource.global || selectedConfig.configSource === ConfigSource.workspace) &&
            !await this.isExistingTask(selectedConfig)) {
            folder = undefined;
        }
        selectedConfig.debugType = debugModeOn ? DebugType.debug : DebugType.run;
        // startDebugging will trigger a call to resolveDebugConfiguration.
        await vscode.debug.startDebugging(folder, selectedConfig, { noDebug: !debugModeOn });
    }

    private async selectConfiguration(textEditor: vscode.TextEditor, pickDefault: boolean = true, onlyWorkspaceFolder: boolean = false): Promise<CppDebugConfiguration | undefined> {
        const folder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
        if (!util.isCppOrCFile(textEditor.document.uri)) {
            void vscode.window.showErrorMessage(localize("cannot.build.non.cpp", 'Cannot build and debug because the active file is not a C or C++ source file.'));
            return;
        }

        // Get debug configurations for all debugger types.
        let configs: CppDebugConfiguration[] = await this.provideDebugConfigurationsForType(DebuggerType.cppdbg, folder);
        if (os.platform() === 'win32') {
            configs = configs.concat(await this.provideDebugConfigurationsForType(DebuggerType.cppvsdbg, folder));
        }
        if (onlyWorkspaceFolder) {
            configs = configs.filter(item => !item.configSource || item.configSource === ConfigSource.workspaceFolder);
        }

        const defaultConfig: CppDebugConfiguration[] | undefined = pickDefault ? this.findDefaultConfig(configs) : undefined;

        const items: ConfigMenu[] = configs.map<ConfigMenu>(config => ({ label: config.name, configuration: config, description: config.detail, detail: config.taskStatus }));

        let selection: ConfigMenu | undefined;

        // if there was only one config for the default task, choose that config, otherwise ask the user to choose.
        if (defaultConfig && defaultConfig.length === 1) {
            selection = { label: defaultConfig[0].name, configuration: defaultConfig[0], description: defaultConfig[0].detail, detail: defaultConfig[0].taskStatus };
        } else {
            let sortedItems: ConfigMenu[] = [];
            // Find the recently used task and place it at the top of quickpick list.
            const recentTask: ConfigMenu[] = items.filter(item => item.configuration.preLaunchTask && item.configuration.preLaunchTask === DebugConfigurationProvider.recentBuildTaskLabelStr);
            if (recentTask.length !== 0 && recentTask[0].detail !== TaskStatus.detected) {
                recentTask[0].detail = TaskStatus.recentlyUsed;
                sortedItems.push(recentTask[0]);
            }
            sortedItems = sortedItems.concat(items.filter(item => item.detail === TaskStatus.configured));
            sortedItems = sortedItems.concat(items.filter(item => item.detail === TaskStatus.detected));
            sortedItems = sortedItems.concat(items.filter(item => item.detail === undefined));

            selection = await vscode.window.showQuickPick(this.localizeConfigDetail(sortedItems), {
                placeHolder: items.length === 0 ? localize("no.compiler.found", "No compiler found") : localize("select.debug.configuration", "Select a debug configuration")
            });
        }
        if (selection && this.isClConfiguration(selection.configuration.name) && await this.showErrorIfClNotAvailable(selection.configuration.name)) {
            return;
        }
        return selection?.configuration;
    }

    private async resolvePreLaunchTask(config: CppDebugConfiguration, configMode: ConfigMode, folder?: vscode.WorkspaceFolder | undefined): Promise<void> {
        if (config.preLaunchTask) {
            try {
                if (config.configSource === ConfigSource.singleFile) {
                    // In case of singleFile, remove the preLaunch task from the debug configuration and run it here instead.
                    await cppBuildTaskProvider.runBuildTask(config.preLaunchTask);
                } else {
                    await cppBuildTaskProvider.writeDefaultBuildTask(config.preLaunchTask, folder);
                }
            } catch (errJS) {
                const e: Error = errJS as Error;
                if (e && e.message === util.failedToParseJson) {
                    void vscode.window.showErrorMessage(util.failedToParseJson);
                }
                Telemetry.logDebuggerEvent(config.debuggerEvent || DebuggerEvent.debugPanel, { "debugType": config.debugType || DebugType.debug, "configSource": config.configSource || ConfigSource.unknown, "configMode": configMode, "cancelled": "false", "succeeded": "false" });
            }
        }
    }

    private async expand(config: vscode.DebugConfiguration, folder: vscode.WorkspaceFolder | undefined): Promise<void> {
        const folderPath: string | undefined = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const vars: ExpansionVars = config.variables ? config.variables : {};
        vars.workspaceFolder = folderPath || '{workspaceFolder}';
        vars.workspaceFolderBasename = folderPath ? path.basename(folderPath) : '{workspaceFolderBasename}';
        const expansionOptions: ExpansionOptions = { vars, recursive: true };
        return expandAllStrings(config, expansionOptions);
    }

    // Returns true when ALL steps succeed; stop all subsequent steps if one fails
    private async deploySteps(config: vscode.DebugConfiguration, cancellationToken?: vscode.CancellationToken): Promise<boolean> {
        let succeeded: boolean = true;
        const deployStart: number = new Date().getTime();

        for (const step of config.deploySteps) {
            succeeded = await this.singleDeployStep(config, step, cancellationToken);
            if (!succeeded) {
                break;
            }
        }

        const deployEnd: number = new Date().getTime();

        const telemetryProperties: { [key: string]: string } = {
            Succeeded: `${succeeded}`,
            IsDebugging: `${!config.noDebug || false}`
        };
        const telemetryMetrics: { [key: string]: number } = {
            NumSteps: config.deploySteps.length,
            Duration: deployEnd - deployStart
        };
        Telemetry.logDebuggerEvent('deploy', telemetryProperties, telemetryMetrics);

        return succeeded;
    }

    private async singleDeployStep(config: vscode.DebugConfiguration, step: any, cancellationToken?: vscode.CancellationToken): Promise<boolean> {
        if ((config.noDebug && step.debug === true) || (!config.noDebug && step.debug === false)) {
            // Skip steps that doesn't match current launch mode. Explicit true/false check, since a step is always run when debug is undefined.
            return true;
        }
        const stepType: StepType = step.type;
        switch (stepType) {
            case StepType.command: {
                // VS Code commands are the same regardless of which extension invokes them, so just invoke them here.
                if (step.args && !Array.isArray(step.args)) {
                    void logger.getOutputChannelLogger().showErrorMessage(localize('command.args.must.be.array', '"args" in command deploy step must be an array.'));
                    return false;
                }
                const returnCode: unknown = await vscode.commands.executeCommand(step.command, ...step.args);
                return !returnCode;
            }
            case StepType.scp:
            case StepType.rsync: {
                const isScp: boolean = stepType === StepType.scp;
                if (!step.files || !step.targetDir || !step.host) {
                    void logger.getOutputChannelLogger().showErrorMessage(localize('missing.properties.copyFile', '"host", "files", and "targetDir" are required in {0} steps.', isScp ? 'SCP' : 'rsync'));
                    return false;
                }
                const host: util.ISshHostInfo = util.isString(step.host) ? { hostName: step.host } : { hostName: step.host.hostName, user: step.host.user, port: step.host.port };
                const jumpHosts: util.ISshHostInfo[] = step.host.jumpHosts;
                let files: vscode.Uri[] = [];
                if (util.isString(step.files)) {
                    files = files.concat((await globAsync(step.files)).map(file => vscode.Uri.file(file)));
                } else if (util.isArrayOfString(step.files)) {
                    for (const fileGlob of (step.files as string[])) {
                        files = files.concat((await globAsync(fileGlob)).map(file => vscode.Uri.file(file)));
                    }
                } else {
                    void logger.getOutputChannelLogger().showErrorMessage(localize('incorrect.files.type.copyFile', '"files" must be a string or an array of strings in {0} steps.', isScp ? 'SCP' : 'rsync'));
                    return false;
                }

                let scpResult: util.ProcessReturnType;
                if (isScp) {
                    scpResult = await scp(files, host, step.targetDir, config.scpPath, config.recursive, jumpHosts, cancellationToken);
                } else {
                    scpResult = await rsync(files, host, step.targetDir, config.scpPath, config.recursive, jumpHosts, cancellationToken);
                }

                if (!scpResult.succeeded || cancellationToken?.isCancellationRequested) {
                    return false;
                }
                break;
            }
            case StepType.ssh: {
                if (!step.host || !step.command) {
                    void logger.getOutputChannelLogger().showErrorMessage(localize('missing.properties.ssh', '"host" and "command" are required for ssh steps.'));
                    return false;
                }
                const host: util.ISshHostInfo = util.isString(step.host) ? { hostName: step.host } : { hostName: step.host.hostName, user: step.host.user, port: step.host.port };
                const jumpHosts: util.ISshHostInfo[] = step.host.jumpHosts;
                const localForwards: util.ISshLocalForwardInfo[] = step.host.localForwards;
                const continueOn: string = step.continueOn;
                const sshResult: util.ProcessReturnType = await ssh(host, step.command, config.sshPath, jumpHosts, localForwards, continueOn, cancellationToken);
                if (!sshResult.succeeded || cancellationToken?.isCancellationRequested) {
                    return false;
                }
                break;
            }
            case StepType.shell: {
                if (!step.command) {
                    void logger.getOutputChannelLogger().showErrorMessage(localize('missing.properties.shell', '"command" is required for shell steps.'));
                    return false;
                }
                const taskResult: util.ProcessReturnType = await util.spawnChildProcess(step.command, undefined, step.continueOn);
                if (!taskResult.succeeded || cancellationToken?.isCancellationRequested) {
                    void logger.getOutputChannelLogger().showErrorMessage(taskResult.output);
                    return false;
                }
                break;
            }
            default: {
                logger.getOutputChannelLogger().appendLine(localize('deploy.step.type.not.supported', 'Deploy step type {0} is not supported.', step.type));
                return false;
            }
        }
        return true;
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
    private pipeProgram: string = "<" + localize("path.to.pipe.program", "full path to pipe program such as {0}", "plink.exe").replace(/"/g, '') + ">";
    private MIMode: string = 'gdb';
    private setupCommandsBlock: string = `"setupCommands": [
    {
        "description": "${localize("enable.pretty.printing", "Enable pretty-printing for {0}", "gdb").replace(/"/g, '')}",
        "text": "-enable-pretty-printing",
        "ignoreFailures": true
    },
    {
        "description": "${localize("enable.intel.disassembly.flavor", "Set Disassembly Flavor to {0}", "Intel").replace(/"/g, '')}",
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
        "description": "${localize("enable.pretty.printing", "Enable pretty-printing for {0}", "gdb").replace(/"/g, '')}",
        "text": "-enable-pretty-printing",
        "ignoreFailures": true
    },
    {
        "description": "${localize("enable.intel.disassembly.flavor", "Set Disassembly Flavor to {0}", "Intel").replace(/"/g, '')}",
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
    const item: vscode.CompletionItem = new vscode.CompletionItem(snippet.label, vscode.CompletionItemKind.Module);

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
    public resolveCompletionItem(item: vscode.CompletionItem, _token: vscode.CancellationToken): Thenable<vscode.CompletionItem> {
        return Promise.resolve(item);
    }

    // This function will only provide completion items via the Add Configuration Button
    // There are two cases where the configuration array has nothing or has some items.
    // 1. If it has nothing, insert a snippet the user selected.
    // 2. If there are items, the Add Configuration button will append it to the start of the configuration array. This function inserts a comma at the end of the snippet.
    public provideCompletionItems(document: vscode.TextDocument, _position: vscode.Position, _token: vscode.CancellationToken, _context: vscode.CompletionContext): Thenable<vscode.CompletionList> {
        let items: vscode.CompletionItem[] = this.snippets;
        let hasLaunchConfigs: boolean = false;
        try {
            const launch: any = jsonc.parse(document.getText());
            hasLaunchConfigs = launch.configurations.length !== 0;
        } catch {
            // ignore
        }

        // Check to see if the array is empty, so any additional inserted snippets will need commas.
        if (hasLaunchConfigs) {
            items = [];

            // Make a copy of each snippet since we are adding a comma to the end of the insertText.
            this.snippets.forEach((item) => items.push({ ...item }));

            items.map((item) => {
                item.insertText = item.insertText + ','; // Add comma
            });
        }

        return Promise.resolve(new vscode.CompletionList(items, true));
    }
}
