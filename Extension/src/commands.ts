/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as LanguageServer from './LanguageServer/extension';
import * as util from './common';

class TemporaryCommandRegistrar {
    // Used to save/re-execute commands used before the extension has activated (e.g. delayed by dependency downloading).
    private delayedCommandsToExecute: Set<string>;
    private tempCommands: vscode.Disposable[]; // Need to save this to unregister/dispose the temporary commands.
    private isLanguageServerDisabled: boolean = false;
    private isActivationReady: boolean = false;

    private commandsToRegister: string[] = [
        "C_Cpp.ConfigurationEditJSON",
        "C_Cpp.ConfigurationEditUI",
        "C_Cpp.ConfigurationSelect",
        "C_Cpp.ConfigurationProviderSelect",
        "C_Cpp.SwitchHeaderSource",
        "C_Cpp.Navigate",
        "C_Cpp.GoToDeclaration",
        "C_Cpp.PeekDeclaration",
        "C_Cpp.EnableErrorSquiggles",
        "C_Cpp.DisableErrorSquiggles",
        "C_Cpp.ToggleIncludeFallback",
        "C_Cpp.ToggleDimInactiveRegions",
        "C_Cpp.ShowReleaseNotes",
        "C_Cpp.ResetDatabase",
        "C_Cpp.PauseParsing",
        "C_Cpp.ResumeParsing",
        "C_Cpp.ShowParsingCommands",
        "C_Cpp.TakeSurvey",
        "C_Cpp.LogDiagnostics",
        "C_Cpp.RescanWorkspace",
        "C_Cpp.VcpkgClipboardInstallSuggested",
        "C_Cpp.VcpkgOnlineHelpSuggested"
    ];

    constructor() {
        this.tempCommands = [];
        this.delayedCommandsToExecute = new Set<string>();

        // Add temp commands that invoke the real commands after download/install is complete (preventing an error message)
        if (util.extensionContext) {
            this.commandsToRegister.forEach(command => {
                this.registerTempCommand(command);
            });
        }
    }

    public registerTempCommand(command: string): void {
        this.tempCommands.push(vscode.commands.registerCommand(command, () => {
            if (this.isLanguageServerDisabled) {
                vscode.window.showInformationMessage("The command is disabled because \"C_Cpp.intelliSenseEngine\" is set to \"Disabled\".");
                return;
            }
            this.delayedCommandsToExecute.add(command);
            if (this.isActivationReady) {
                LanguageServer.activate(true);
            }
        }));
    }

    public disableLanguageServer(): void {
        this.isLanguageServerDisabled = true;
    }

    public activateLanguageServer(): void {
        // Main activation code.
        LanguageServer.activate(this.delayedCommandsToExecute.size > 0);
        this.isActivationReady = true;
    }
    
    public clearTempCommands(): void {
        this.tempCommands.forEach((command) => {
            command.dispose();
        });
        this.tempCommands = [];
    }

    public executeDelayedCommands(): void {
        this.delayedCommandsToExecute.forEach((command) => {
            vscode.commands.executeCommand(command);
        });
        this.delayedCommandsToExecute.clear();
    }
}

let tempCommandRegistrar: TemporaryCommandRegistrar;

export function initializeTemporaryCommandRegistrar(): void {
    tempCommandRegistrar = new TemporaryCommandRegistrar();
}

export function getTemporaryCommandRegistrarInstance(): TemporaryCommandRegistrar {
    return tempCommandRegistrar;
}