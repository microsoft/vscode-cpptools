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
import * as nls from 'vscode-nls';

import { CppToolsApi, CppToolsExtension } from 'vscode-cpptools';
import { PlatformInformation } from './platform';
import { CppTools1 } from './cppTools1';
import { CppSettings } from './LanguageServer/settings';
import { PersistentState } from './LanguageServer/persistentState';
import { TargetPopulation } from 'vscode-tas-client';

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

    HandleInsidersPrompt();

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
                "./debugAdapters/lldb-mi/bin/lldb-mi",
                "./debugAdapters/lldb/bin/debugserver",
                "./debugAdapters/lldb/bin/lldb-mi",
                "./debugAdapters/lldb/bin/lldb-argdumper",
                "./debugAdapters/lldb/bin/lldb-launcher"
            ];
            macBinaries.forEach(binary => promises.push(util.allowExecution(util.getExtensionFilePath(binary))));
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
    Telemetry.logDebuggerEvent("acquisition", telemetryProperties);
}

export function HandleInsidersPrompt(): void {
    // Only display this prompt to users who have updateChannel configured for Insiders,
    // and who are not already configured to receive pre-release extensions.

    const targetPopulation: TargetPopulation = util.getCppToolsTargetPopulation();
    // Skip the prompt if already using an insiders build of cpptools.
    if (targetPopulation === TargetPopulation.Public) {
        const settings: CppSettings = new CppSettings();
        const displayedInsidersPrompt: PersistentState<boolean> = new PersistentState<boolean>("CPP.displayedInsidersPrompt", false);
        // Skip the prompt if updateChannel was not set to Insiders.
        if (settings.updateChannel === "Insiders") {
            if (!displayedInsidersPrompt.Value) {
                displayedInsidersPrompt.Value = true;
                const message: string = localize('updateChannel.changed', "The `C_Cpp.updateChannel` setting is deprecated. Do you want to enable install of pre-releases of the C/C++ extension via the Marketplace?");
                const yes: string = localize("yes.button", "Yes");
                const no: string = localize("no.button", "No");
                vscode.window.showInformationMessage(message, yes, no).then((selection) => {
                    switch (selection) {
                        case yes:
                            vscode.commands.executeCommand("workbench.extensions.installExtension", "ms-vscode.cpptools", { installPreReleaseVersion: true });
                            break;
                        case no:
                            break;
                        default:
                            break;
                    }
                });
            }
        } else {
            // Reset persistent value, so we prompt again if they switch to "Insiders" again.
            if (displayedInsidersPrompt.Value) {
                displayedInsidersPrompt.Value = false;
            }
        }
    }
}
