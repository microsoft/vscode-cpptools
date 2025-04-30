/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { equal } from 'assert';
import { suite } from 'mocha';
import * as vscode from 'vscode';
import * as util from '../../../../src/common';
import { isWindows } from "../../../../src/constants";

suite("set developer environment", () => {
    if (isWindows) {
        test("set developer environment (Windows)", async () => {
            const promise = vscode.commands.executeCommand('C_Cpp.SetDevEnvironment', 'test');
            const timer = setInterval(() => {
                void vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
            }, 1000);
            await promise;
            clearInterval(timer);
            equal(util.hasMsvcEnvironment(), true, "MSVC environment not set correctly.");
        });
    } else {
        test("set developer environment (Linux/macOS)", async () => {
            try {
                await vscode.commands.executeCommand('C_Cpp.SetDevEnvironment', 'test');
                equal(false, true, "Should not be able to set developer environment on non-Windows platform.");
            }
            catch (e) {
                equal((e as Error).message, 'This command is only available on Windows', "Should throw error when trying to set developer environment on non-Windows platform.");
            }
            equal(util.hasMsvcEnvironment(), false, "MSVC environment should not be set on non-Windows platforms.");
        });
    }
});
