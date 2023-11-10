/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as DebuggerExtension from './Debugger/extension';
import * as LanguageServer from './LanguageServer/extension';
import * as util from './common';
import * as Telemetry from './telemetry';

import * as semver from 'semver';
import { CppToolsApi, CppToolsExtension } from 'vscode-cpptools';
import * as nls from 'vscode-nls';
import { TargetPopulation } from 'vscode-tas-client';
import { CppBuildTaskProvider, cppBuildTaskProvider } from './LanguageServer/cppBuildTaskProvider';
import { getLocaleId, getLocalizedHtmlPath } from './LanguageServer/localization';
import { PersistentState } from './LanguageServer/persistentState';
import { CppSettings } from './LanguageServer/settings';
import { logAndReturn, returns } from './Utility/Async/returns';
import { CppTools1 } from './cppTools1';
import { logMachineIdMappings } from './id';
import { disposeOutputChannels, log } from './logger';
import { PlatformInformation } from './platform';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const cppTools: CppTools1 = new CppTools1();
let languageServiceDisabled: boolean = false;
let reloadMessageShown: boolean = false;
const disposables: vscode.Disposable[] = [];

export async function activate(context: vscode.ExtensionContext): Promise<CppToolsApi & CppToolsExtension> {
    util.setExtensionContext(context);
    Telemetry.activate();
    util.setProgress(0);

    // Register a protocol handler to serve localized versions of the schema for c_cpp_properties.json
    class SchemaProvider implements vscode.TextDocumentContentProvider {
        public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
            console.assert(uri.path[0] === '/', "A preceding slash is expected on schema uri path");
            const fileName: string = uri.path.substring(1);
            const locale: string = getLocaleId();
            let localizedFilePath: string = util.getExtensionFilePath(path.join("dist/schema/", locale, fileName));
            const fileExists: boolean = await util.checkFileExists(localizedFilePath);
            if (!fileExists) {
                localizedFilePath = util.getExtensionFilePath(fileName);
            }
            return util.readFileText(localizedFilePath);
        }
    }

    vscode.workspace.registerTextDocumentContentProvider('cpptools-schema', new SchemaProvider());

    // Initialize the DebuggerExtension and register the related commands and providers.
    await DebuggerExtension.initialize(context);

    const info: PlatformInformation = await PlatformInformation.GetPlatformInformation();
    sendTelemetry(info);

    // Always attempt to make the binaries executable, not just when installedVersion changes.
    // The user may have uninstalled and reinstalled the same version.
    await makeBinariesExecutable();

    // Notify users if debugging may not be supported on their OS.
    util.checkDistro(info);
    await checkVsixCompatibility();
    LanguageServer.UpdateInsidersAccess();
    await LanguageServer.preReleaseCheck();

    const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);
    let isOldMacOs: boolean = false;
    if (info.platform === 'darwin') {
        const releaseParts: string[] = os.release().split(".");
        if (releaseParts.length >= 1) {
            isOldMacOs = parseInt(releaseParts[0]) < 16;
        }
    }

    // Read the setting and determine whether we should activate the language server prior to installing callbacks,
    // to ensure there is no potential race condition. LanguageServer.activate() is called near the end of this
    // function, to allow any further setup to occur here, prior to activation.
    const isIntelliSenseEngineDisabled: boolean = settings.intelliSenseEngine === "disabled";
    const shouldActivateLanguageServer: boolean = !isIntelliSenseEngineDisabled && !isOldMacOs;

    if (isOldMacOs) {
        languageServiceDisabled = true;
        void vscode.window.showErrorMessage(localize("macos.version.deprecated", "Versions of the C/C++ extension more recent than {0} require at least macOS version {1}.", "1.9.8", "10.12"));
    } else {
        if (settings.intelliSenseEngine === "disabled") {
            languageServiceDisabled = true;
        }
        let currentIntelliSenseEngineValue: string | undefined = settings.intelliSenseEngine;
        disposables.push(vscode.workspace.onDidChangeConfiguration(() => {
            const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);
            if (!reloadMessageShown && settings.intelliSenseEngine !== currentIntelliSenseEngineValue) {
                if (currentIntelliSenseEngineValue === "disabled") {
                    // If switching from disabled to enabled, we can continue activation.
                    currentIntelliSenseEngineValue = settings.intelliSenseEngine;
                    languageServiceDisabled = false;
                    return LanguageServer.activate();
                } else {
                    // We can't deactivate or change engines on the fly, so prompt for window reload.
                    reloadMessageShown = true;
                    void util.promptForReloadWindowDueToSettingsChange();
                }
            }
        }));
    }

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        for (let i: number = 0; i < vscode.workspace.workspaceFolders.length; ++i) {
            const config: string = path.join(vscode.workspace.workspaceFolders[i].uri.fsPath, ".vscode/c_cpp_properties.json");
            if (await util.checkFileExists(config)) {
                const doc: vscode.TextDocument = await vscode.workspace.openTextDocument(config);
                void vscode.languages.setTextDocumentLanguage(doc, "jsonc");
                util.setWorkspaceIsCpp();
            }
        }
    }

    disposables.push(vscode.tasks.registerTaskProvider(CppBuildTaskProvider.CppBuildScriptType, cppBuildTaskProvider));

    vscode.tasks.onDidStartTask(event => {
        if (event.execution.task.definition.type === CppBuildTaskProvider.CppBuildScriptType
            || event.execution.task.name.startsWith(LanguageServer.configPrefix)) {
            Telemetry.logLanguageServerEvent('buildTaskStarted');
        }
    });

    vscode.tasks.onDidEndTask(event => {
        if (event.execution.task.definition.type === CppBuildTaskProvider.CppBuildScriptType
            || event.execution.task.name.startsWith(LanguageServer.configPrefix)) {
            Telemetry.logLanguageServerEvent('buildTaskFinished');
        }
    });

    if (shouldActivateLanguageServer) {
        await LanguageServer.activate();
    } else if (isIntelliSenseEngineDisabled) {
        LanguageServer.registerCommands(false);
        // The check here for isIntelliSenseEngineDisabled avoids logging
        // the message on old Macs that we've already displayed a warning for.
        log(localize("intellisense.disabled", "intelliSenseEngine is disabled"));
    }

    return cppTools;
}

export async function deactivate(): Promise<void> {
    DebuggerExtension.dispose();
    void Telemetry.deactivate().catch(returns.undefined);
    disposables.forEach(d => d.dispose());
    if (languageServiceDisabled) {
        return;
    }
    await LanguageServer.deactivate();
    disposeOutputChannels();
}

async function makeBinariesExecutable(): Promise<void> {
    const promises: Thenable<void>[] = [];
    if (process.platform !== 'win32') {
        const commonBinaries: string[] = [
            "./bin/cpptools",
            "./bin/cpptools-srv",
            "./bin/cpptools-wordexp",
            "./LLVM/bin/clang-format",
            "./LLVM/bin/clang-tidy",
            "./debugAdapters/bin/OpenDebugAD7"
        ];
        commonBinaries.forEach(binary => promises.push(util.allowExecution(util.getExtensionFilePath(binary))));
        if (process.platform === "darwin") {
            const macBinaries: string[] = [
                "./debugAdapters/lldb-mi/bin/lldb-mi"
            ];
            macBinaries.forEach(binary => promises.push(util.allowExecution(util.getExtensionFilePath(binary))));
            if (os.arch() === "x64") {
                const oldMacBinaries: string[] = [
                    "./debugAdapters/lldb/bin/debugserver",
                    "./debugAdapters/lldb/bin/lldb-mi",
                    "./debugAdapters/lldb/bin/lldb-argdumper",
                    "./debugAdapters/lldb/bin/lldb-launcher"
                ];
                oldMacBinaries.forEach(binary => promises.push(util.allowExecution(util.getExtensionFilePath(binary))));
            }
        }
    }
    await Promise.all(promises);
}

function sendTelemetry(info: PlatformInformation): void {
    const telemetryProperties: { [key: string]: string } = {};
    if (info.distribution) {
        telemetryProperties['linuxDistroName'] = info.distribution.name;
        telemetryProperties['linuxDistroVersion'] = info.distribution.version;
    }
    telemetryProperties['osArchitecture'] = os.arch();
    telemetryProperties['infoArchitecture'] = info.architecture;
    const targetPopulation: TargetPopulation = util.getCppToolsTargetPopulation();
    switch (targetPopulation) {
        case TargetPopulation.Public:
            telemetryProperties['targetPopulation'] = "Public";
            break;
        case TargetPopulation.Internal:
            telemetryProperties['targetPopulation'] = "Internal";
            break;
        case TargetPopulation.Insiders:
            telemetryProperties['targetPopulation'] = "Insiders";
            break;
        default:
            break;
    }
    Telemetry.logDebuggerEvent("acquisition", telemetryProperties);
    logMachineIdMappings().catch(logAndReturn.undefined);
}

async function checkVsixCompatibility(): Promise<void> {
    const ignoreMismatchedCompatibleVsix: PersistentState<boolean> = new PersistentState<boolean>("CPP." + util.packageJson.version + ".ignoreMismatchedCompatibleVsix", false);
    let resetIgnoreMismatchedCompatibleVsix: boolean = true;

    // Check to ensure the correct platform-specific VSIX was installed.
    const vsixManifestPath: string = path.join(util.extensionPath, ".vsixmanifest");
    // Skip the check if the file does not exist, such as when debugging cpptools.
    if (await util.checkFileExists(vsixManifestPath)) {
        const content: string = await util.readFileText(vsixManifestPath);
        const matches: RegExpMatchArray | null = content.match(/TargetPlatform="(?<platform>[^"]*)"/);
        if (matches && matches.length > 0 && matches.groups) {
            const vsixTargetPlatform: string = matches.groups['platform'];
            const platformInfo: PlatformInformation = await PlatformInformation.GetPlatformInformation();
            let isPlatformCompatible: boolean = true;
            let isPlatformMatching: boolean = true;
            switch (vsixTargetPlatform) {
                case "win32-x64":
                    isPlatformMatching = platformInfo.platform === "win32" && platformInfo.architecture === "x64";
                    // x64 binaries can also be run on arm64 Windows 11.
                    isPlatformCompatible = platformInfo.platform === "win32" && (platformInfo.architecture === "x64" || (platformInfo.architecture === "arm64" && semver.gte(os.release(), "10.0.22000")));
                    break;
                case "win32-ia32":
                    isPlatformMatching = platformInfo.platform === "win32" && platformInfo.architecture === "x86";
                    // x86 binaries can also be run on x64 and arm64 Windows.
                    isPlatformCompatible = platformInfo.platform === "win32" && (platformInfo.architecture === "x86" || platformInfo.architecture === "x64" || platformInfo.architecture === "arm64");
                    break;
                case "win32-arm64":
                    isPlatformMatching = platformInfo.platform === "win32" && platformInfo.architecture === "arm64";
                    isPlatformCompatible = isPlatformMatching;
                    break;
                case "linux-x64":
                    isPlatformMatching = platformInfo.platform === "linux" && platformInfo.architecture === "x64" && platformInfo.distribution?.name !== "alpine";
                    isPlatformCompatible = isPlatformMatching;
                    break;
                case "linux-arm64":
                    isPlatformMatching = platformInfo.platform === "linux" && platformInfo.architecture === "arm64" && platformInfo.distribution?.name !== "alpine";
                    isPlatformCompatible = isPlatformMatching;
                    break;
                case "linux-armhf":
                    isPlatformMatching = platformInfo.platform === "linux" && platformInfo.architecture === "arm" && platformInfo.distribution?.name !== "alpine";
                    // armhf binaries can also be run on aarch64 linux.
                    isPlatformCompatible = platformInfo.platform === "linux" && (platformInfo.architecture === "arm" || platformInfo.architecture === "arm64") && platformInfo.distribution?.name !== "alpine";
                    break;
                case "alpine-x64":
                    isPlatformMatching = platformInfo.platform === "linux" && platformInfo.architecture === "x64" && platformInfo.distribution?.name === "alpine";
                    isPlatformCompatible = isPlatformMatching;
                    break;
                case "alpine-arm64":
                    isPlatformMatching = platformInfo.platform === "linux" && platformInfo.architecture === "arm64" && platformInfo.distribution?.name === "alpine";
                    isPlatformCompatible = isPlatformMatching;
                    break;
                case "darwin-x64":
                    isPlatformMatching = platformInfo.platform === "darwin" && platformInfo.architecture === "x64";
                    isPlatformCompatible = isPlatformMatching;
                    break;
                case "darwin-arm64":
                    isPlatformMatching = platformInfo.platform === "darwin" && platformInfo.architecture === "arm64";
                    // x64 binaries can also be run on arm64 macOS.
                    isPlatformCompatible = platformInfo.platform === "darwin" && (platformInfo.architecture === "x64" || platformInfo.architecture === "arm64");
                    break;
                default:
                    console.log("Unrecognized TargetPlatform in .vsixmanifest");
                    break;
            }
            const moreInfoButton: string = localize("more.info.button", "More Info");
            const ignoreButton: string = localize("ignore.button", "Ignore");
            let promise: Thenable<string | undefined> | undefined;
            if (!isPlatformCompatible) {
                promise = vscode.window.showErrorMessage(localize("vsix.platform.incompatible", "The C/C++ extension installed does not match your system.", vsixTargetPlatform), moreInfoButton);
            } else if (!isPlatformMatching) {
                if (!ignoreMismatchedCompatibleVsix.Value) {
                    resetIgnoreMismatchedCompatibleVsix = false;
                    promise = vscode.window.showWarningMessage(localize("vsix.platform.mismatching", "The C/C++ extension installed is compatible with but does not match your system.", vsixTargetPlatform), moreInfoButton, ignoreButton);
                }
            }

            void promise?.then((value) => {
                if (value === moreInfoButton) {
                    void vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(getLocalizedHtmlPath("Reinstalling the Extension.md")));
                } else if (value === ignoreButton) {
                    ignoreMismatchedCompatibleVsix.Value = true;
                }
            }, logAndReturn.undefined);
        } else {
            console.log("Unable to find TargetPlatform in .vsixmanifest");
        }
    }
    if (resetIgnoreMismatchedCompatibleVsix) {
        ignoreMismatchedCompatibleVsix.Value = false;
    }
}
