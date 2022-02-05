/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as DebuggerExtension from './Debugger/extension';
import * as LanguageServer from './LanguageServer/extension';
import * as os from 'os';
import * as path from 'path';
import * as Telemetry from './telemetry';
import * as util from './common';
import * as vscode from 'vscode';

import { CppToolsApi, CppToolsExtension } from 'vscode-cpptools';
import { PlatformInformation } from './platform';
import { CppTools1 } from './cppTools1';
import { CppSettings } from './LanguageServer/settings';
import { PersistentState } from './LanguageServer/persistentState';
import { TargetPopulation } from 'vscode-tas-client';

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
            console.assert(uri.path[0] === '/', "A preceeding slash is expected on schema uri path");
            const fileName: string = uri.path.substr(1);
            const locale: string = util.getLocaleId();
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
    DebuggerExtension.initialize(context);

    const info: PlatformInformation = await PlatformInformation.GetPlatformInformation();
    sendTelemetry(info);

    // Always attempt to make the binaries executable, not just when installedVersion changes.
    // The user may have uninstalled and reinstalled the same version.
    await makeBinariesExecutable();

    // Notify users if debugging may not be supported on their OS.
    util.checkDistro(info);

    const settings: CppSettings = new CppSettings((vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) ? vscode.workspace.workspaceFolders[0]?.uri : undefined);
    if (settings.intelliSenseEngine === "Disabled") {
        languageServiceDisabled = true;
        disposables.push(vscode.workspace.onDidChangeConfiguration(() => {
            if (!reloadMessageShown && settings.intelliSenseEngine !== "Disabled") {
                reloadMessageShown = true;
                util.promptForReloadWindowDueToSettingsChange();
            }
        }));
    } else {
        disposables.push(vscode.workspace.onDidChangeConfiguration(() => {
            if (!reloadMessageShown && settings.intelliSenseEngine === "Disabled") {
                reloadMessageShown = true;
                util.promptForReloadWindowDueToSettingsChange();
            }
        }));
    }
    LanguageServer.activate();

    UpdateInsidersAccess();

    return cppTools;
}

export function deactivate(): Thenable<void> {
    DebuggerExtension.dispose();
    Telemetry.deactivate();
    disposables.forEach(d => d.dispose());

    if (languageServiceDisabled) {
        return Promise.resolve();
    }
    return LanguageServer.deactivate();
}

async function makeBinariesExecutable(): Promise<void> {
    const promises: Thenable<void>[] = [];
    if (process.platform !== 'win32') {
        const commonBinaries: string[] = [
            "./bin/cpptools",
            "./bin/cpptools-srv",
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
}

export function UpdateInsidersAccess(): void {
    let installPrerelease: boolean = false;

    // Only move them to the new prerelease mechanism if using updateChannel of Insiders.
    const settings: CppSettings = new CppSettings();
    const migratedInsiders: PersistentState<boolean> = new PersistentState<boolean>("CPP.migratedInsiders", false);
    if (settings.updateChannel === "Insiders") {
        // Don't do anything while the user has autoUpdate disabled, so we do not cause the extension to be updated.
        if (!migratedInsiders.Value && vscode.workspace.getConfiguration("extensions", null).get<boolean>("autoUpdate")) {
            installPrerelease = true;
            migratedInsiders.Value = true;
        }
    } else {
        // Reset persistent value, so we register again if they switch to "Insiders" again.
        if (migratedInsiders.Value) {
            migratedInsiders.Value = false;
        }
    }

    // Mitigate an issue with VS Code not recognizing a programmatically installed VSIX as Prerelease.
    // If using VS Code Insiders, and updateChannel is not explicitly set, default to Prerelease.
    // Only do this once. If the user manually switches to Release, we don't want to switch them back to Prerelease again.
    if (util.isVsCodeInsiders()) {
        const insidersMitigationDone: PersistentState<boolean> = new PersistentState<boolean>("CPP.insidersMitigationDone", false);
        if (!insidersMitigationDone.Value) {
            if (vscode.workspace.getConfiguration("extensions", null).get<boolean>("autoUpdate")) {
                if (settings.getWithUndefinedDefault<string>("updateChannel") === undefined) {
                    installPrerelease = true;
                }
            }
            insidersMitigationDone.Value = true;
        }
    }

    if (installPrerelease) {
        vscode.commands.executeCommand("workbench.extensions.installExtension", "ms-vscode.cpptools", { installPreReleaseVersion: true });
    }
}
