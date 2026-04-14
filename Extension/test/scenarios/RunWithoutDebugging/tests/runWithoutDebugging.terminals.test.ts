/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../../../vscode.d.ts" />
import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from '../../../../src/common';
import { isWindows } from '../../../../src/constants';
import { compileProgram } from './compileProgram';

type ConsoleMode = 'integratedTerminal' | 'externalTerminal';
type WindowsTerminalProfile = 'Command Prompt' | 'PowerShell';

/**
 * Waits for the output of a program to be written to a file and returns the lines of output.
 * @param filePath The path to the file containing the program output.
 * @param timeoutMs The maximum time to wait for the output, in milliseconds.
 * @returns A promise that resolves to an array of output lines.
 * @throws An error if the output is not available within the specified timeout.
 */
async function waitForOutput(filePath: string, timeoutMs: number): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    let lastContents = '';

    while (Date.now() < deadline) {
        try {
            lastContents = await util.readFileText(filePath, 'utf8');
            const trimmedContents = lastContents.trimEnd();
            if (trimmedContents.length > 0) {
                return trimmedContents.split(/\r?\n/);
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }

        await new Promise<void>(resolve => setTimeout(resolve, 100));
    }

    assert.fail(`Timed out waiting for argument output in ${filePath}. Last contents: ${lastContents}`);
}

/**
 * Disposes of any terminals whose names match the given program paths. These are the terminals that were created to run the specified programs.
 * @param programs An array of program paths whose corresponding terminals should be disposed.
 */
function disposeTerminals(programs: string[]): void {
    const terminalNames = new Set(programs.map(program => path.normalize(program)));
    for (const terminal of vscode.window.terminals) {
        if (terminalNames.has(terminal.name)) {
            terminal.dispose();
        }
    }
}

/**
 * Sets or clears the setting for the default Windows terminal profile.
 * @param profile The terminal profile to set as the default, or undefined to clear the setting.
 */
async function setWindowsDefaultTerminalProfile(profile?: WindowsTerminalProfile): Promise<void> {
    if (!isWindows) {
        return;
    }

    const config = vscode.workspace.getConfiguration('terminal.integrated');
    await config.update('defaultProfile.windows', profile, vscode.ConfigurationTarget.Workspace);
}

async function runNoDebugLaunch(workspaceFolder: vscode.WorkspaceFolder, sessionName: string, program: string, consoleMode: ConsoleMode, resultFilePath: string, args: string[]): Promise<string[]> {
    const debugType = isWindows ? 'cppvsdbg' : 'cppdbg';
    const launchConfig: vscode.DebugConfiguration = {
        name: sessionName,
        type: debugType,
        request: 'launch',
        program: program,
        args: [resultFilePath, ...args],
        cwd: workspaceFolder.uri.fsPath
    };

    if (debugType === 'cppvsdbg') {
        launchConfig.console = consoleMode;
    } else {
        launchConfig.externalConsole = consoleMode === 'externalTerminal';
    }

    const started = await vscode.debug.startDebugging(workspaceFolder, launchConfig, { noDebug: true });
    assert.strictEqual(started, true, `The ${consoleMode} noDebug launch did not start successfully.`);
    return waitForOutput(resultFilePath, 15000);
}

suite('Run Without Debugging Terminal and Arguments Test', function (this: Mocha.Suite): void {
    this.timeout(120000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0] ?? assert.fail('No workspace folder available');
    const workspacePath = workspaceFolder.uri.fsPath;
    const sourceFile = path.join(workspacePath, 'argsTest.cpp');
    const resultFilePath = path.join(workspacePath, 'test_output.txt');
    const executablePath = path.join(workspacePath, isWindows ? 'argsTestProgram.exe' : 'argsTestProgram');
    const spacedExecutablePath = path.join(workspacePath, isWindows ? 'args Test Program.exe' : 'args Test Program');
    const executablePaths = [executablePath, spacedExecutablePath];
    const expectedArgs = [
        'alpha',
        'two words',
        path.join(workspacePath, 'input folder', 'three words.txt')
    ];

    suiteSetup(async function (): Promise<void> {
        const extension: vscode.Extension<any> = vscode.extensions.getExtension('ms-vscode.cpptools') || assert.fail('Extension not found');
        if (!extension.isActive) {
            await extension.activate();
        }

        await compileProgram(workspacePath, sourceFile, executablePath);
        await compileProgram(workspacePath, sourceFile, spacedExecutablePath);
    });

    teardown(async function (): Promise<void> {
        await util.deleteFile(resultFilePath);
        disposeTerminals(executablePaths);
    });

    setup(async function (): Promise<void> {
        if (await util.checkFileExists(resultFilePath)) {
            await util.deleteFile(resultFilePath);
        }
    });

    suiteTeardown(async function (): Promise<void> {
        await util.deleteFile(resultFilePath);
        disposeTerminals(executablePaths);

        if (isWindows) {
            await vscode.commands.executeCommand('C_Cpp.ClearVsDeveloperEnvironment');
            await util.deleteFile(path.join(workspacePath, '.vscode', 'settings.json'));
        }
    });

    const consoleCases: { label: string; consoleMode: ConsoleMode; windowsProfiles?: (WindowsTerminalProfile | undefined)[] }[] = [
        {
            label: 'integrated terminal',
            consoleMode: 'integratedTerminal',
            windowsProfiles: [undefined, 'Command Prompt', 'PowerShell']
        },
        {
            label: 'external terminal',
            consoleMode: 'externalTerminal'
        }
    ];

    const programCases = [
        {
            label: 'a program name without spaces',
            programPath: executablePath
        },
        {
            label: 'a program name with spaces',
            programPath: spacedExecutablePath
        }
    ];

    for (const consoleCase of consoleCases) {
        for (const programCase of programCases) {
            const profiles: (WindowsTerminalProfile | undefined)[] = isWindows && consoleCase.consoleMode === 'integratedTerminal' ? consoleCase.windowsProfiles ?? [undefined] : [undefined];

            for (const profile of profiles) {
                const profileSuffix = profile ? ` with ${profile} as the default terminal` : consoleCase.consoleMode === 'integratedTerminal' ? ' with default terminal' : '';
                test(`No-debug launch via ${consoleCase.label} handles ${programCase.label}${profileSuffix}`, async () => {
                    await setWindowsDefaultTerminalProfile(profile);

                    disposeTerminals(executablePaths);
                    const sessionName = `Run Without Debugging Args (${consoleCase.consoleMode}, ${path.basename(programCase.programPath)}${profile ? `, ${profile}` : ''})`;
                    const actualArgs = await runNoDebugLaunch(
                        workspaceFolder,
                        sessionName,
                        programCase.programPath,
                        consoleCase.consoleMode,
                        resultFilePath,
                        expectedArgs);

                    assert.deepStrictEqual(actualArgs, expectedArgs, `Unexpected arguments received for ${consoleCase.label} using ${programCase.label}${profileSuffix}.`);
                });
            }
        }
    }
});
