/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as LanguageServer from './LanguageServer/extension';

class TemporaryCommandRegistrar {
    // Used to save/re-execute commands used before the extension has activated (e.g. delayed by dependency downloading).
    private delayedCommandsToExecute: Set<string>;
    private tempCommands: vscode.Disposable[]; // Need to save this to unregister/dispose the temporary commands.

    private commandsToRegister: string[] = [
        "C_Cpp.ConfigurationEdit",
        "C_Cpp.ConfigurationSelect",
        "C_Cpp.SwitchHeaderSource",
        "C_Cpp.Navigate",
        "C_Cpp.GoToDeclaration",
        "C_Cpp.PeekDeclaration",
        "C_Cpp.ToggleErrorSquiggles",
        "C_Cpp.ToggleIncludeFallback",
        "C_Cpp.ShowReleaseNotes",
        "C_Cpp.ResetDatabase",
        "C_Cpp.PauseParsing",
        "C_Cpp.ResumeParsing",
        "C_Cpp.ShowParsingCommands",
        "C_Cpp.TakeSurvey"
    ];

    constructor() {
        this.tempCommands = [];
        this.delayedCommandsToExecute = new Set<string>();

        // Add temp commands that invoke the real commands after download/install is complete (preventing an error message)
        this.commandsToRegister.forEach(command => {
            this.registerTempCommand(command);
        });
    }

    public registerTempCommand(command: string): void {
        this.tempCommands.push(vscode.commands.registerCommand(command, () => {
            this.delayedCommandsToExecute.add(command);
        }));
    }

    public activateLanguageServer(): void {
        // Main activation code.
        this.tempCommands.forEach((command) => {
            command.dispose();
        });
        this.tempCommands = [];

        LanguageServer.activate(this.delayedCommandsToExecute.size > 0);
        
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