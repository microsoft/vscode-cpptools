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
import { isMacOS, isWindows } from '../../../../src/constants';
import { compileProgram } from './compileProgram';

interface TrackerState {
    setBreakpointsRequestReceived: boolean;
    stoppedEventReceived: boolean;
    exitedEventReceived: boolean;
    exitedBeforeStop: boolean;
}

interface TrackerController {
    state: TrackerState;
    lastEvent: Promise<'stopped' | 'exited'>;
    dispose(): void;
}

async function createBreakpointAtResultWriteStatement(sourceUri: vscode.Uri): Promise<vscode.SourceBreakpoint> {
    const document = await vscode.workspace.openTextDocument(sourceUri);
    const resultWriteLine = document.getText().split(/\r?\n/).findIndex((line) => line.includes('resultFile << 37;'));
    assert.notStrictEqual(resultWriteLine, -1, 'Unable to find expected result-write statement for breakpoint placement.');
    const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(sourceUri, new vscode.Position(resultWriteLine, 0)), true);
    vscode.debug.addBreakpoints([breakpoint]);
    return breakpoint;
}

function createSessionTerminatedPromise(sessionName: string): Promise<void> {
    return new Promise<void>((resolve) => {
        const terminateSubscription = vscode.debug.onDidTerminateDebugSession((session) => {
            if (session.name === sessionName) {
                terminateSubscription.dispose();
                resolve();
            }
        });
    });
}

function createTracker(debugType: string, sessionName: string, timeoutMs: number, timeoutMessage: string): TrackerController {
    const state: TrackerState = {
        setBreakpointsRequestReceived: false,
        stoppedEventReceived: false,
        exitedEventReceived: false,
        exitedBeforeStop: false
    };

    let trackerRegistration: vscode.Disposable | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const lastEvent = new Promise<'stopped' | 'exited'>((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
            trackerRegistration?.dispose();
            trackerRegistration = undefined;
            reject(new Error(timeoutMessage));
        }, timeoutMs);

        trackerRegistration = vscode.debug.registerDebugAdapterTrackerFactory(debugType, {
            createDebugAdapterTracker: (session: vscode.DebugSession): vscode.DebugAdapterTracker | undefined => {
                if (session.name !== sessionName) {
                    return undefined;
                }

                return {
                    onWillReceiveMessage: (message: any): void => {
                        if (message?.type === 'request' && message?.command === 'setBreakpoints') {
                            state.setBreakpointsRequestReceived = true;
                        }
                    },
                    onDidSendMessage: (message: any): void => {
                        if (message?.type !== 'event') {
                            return;
                        }

                        if (message.event === 'stopped') {
                            state.stoppedEventReceived = true;
                            if (timeoutHandle) {
                                clearTimeout(timeoutHandle);
                                timeoutHandle = undefined;
                            }
                            resolve('stopped');
                        }

                        if ((message.event === 'terminated' || message.event === 'exited') && !state.exitedEventReceived) {
                            state.exitedEventReceived = true;
                            if (!state.stoppedEventReceived) {
                                state.exitedBeforeStop = true;
                            }
                            if (timeoutHandle) {
                                clearTimeout(timeoutHandle);
                                timeoutHandle = undefined;
                            }
                            resolve('exited');
                        }
                    }
                };
            }
        });
    });

    return {
        state,
        lastEvent,
        dispose(): void {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = undefined;
            }
            trackerRegistration?.dispose();
            trackerRegistration = undefined;
        }
    };
}

async function waitForResultFileValue(filePath: string, timeoutMs: number): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let lastContents = '';

    while (Date.now() < deadline) {
        try {
            lastContents = await util.readFileText(filePath, 'utf8');
            const trimmedContents = lastContents.trim();
            if (trimmedContents.length > 0) {
                const value = Number.parseInt(trimmedContents, 10);
                if (!Number.isNaN(value)) {
                    return value;
                }
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }

        await new Promise<void>(resolve => setTimeout(resolve, 100));
    }

    assert.fail(`Timed out waiting for numeric result in ${filePath}. Last contents: ${lastContents}`);
}

suite('Run Without Debugging Test', function (): void {
    const expectedResultValue = 37;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0] ?? assert.fail('No workspace folder available');
    const workspacePath = workspaceFolder.uri.fsPath;
    const sourceFile = path.join(workspacePath, 'debugTest.cpp');
    const sourceUri = vscode.Uri.file(sourceFile);
    const resultFilePath = path.join(workspacePath, 'runWithoutDebuggingResult.txt');
    const executableName = isWindows ? 'debugTestProgram.exe' : 'debugTestProgram';
    const executablePath = path.join(workspacePath, executableName);
    const sessionName = 'Run Without Debugging Result File';
    const debugType = isWindows ? 'cppvsdbg' : 'cppdbg';
    const miMode = isMacOS ? 'lldb' : 'gdb';

    suiteSetup(async function (): Promise<void> {
        const extension: vscode.Extension<any> = vscode.extensions.getExtension('ms-vscode.cpptools') || assert.fail('Extension not found');
        if (!extension.isActive) {
            await extension.activate();
        }
        await compileProgram(workspacePath, sourceFile, executablePath);
    });

    suiteTeardown(async function (): Promise<void> {
        if (isWindows) {
            await vscode.commands.executeCommand('C_Cpp.ClearVsDeveloperEnvironment');
        }
    });

    setup(async function (): Promise<void> {
        await util.deleteFile(resultFilePath);
    });

    test('Run Without Debugging should not break on breakpoints and write the expected result file', async () => {
        const breakpoint = await createBreakpointAtResultWriteStatement(sourceUri);
        const tracker = createTracker(debugType, sessionName, 30000, 'Timed out waiting for debugger event.');
        const debugSessionTerminated = createSessionTerminatedPromise(sessionName);

        try {
            const started = await vscode.debug.startDebugging(
                workspaceFolder,
                {
                    name: sessionName,
                    type: debugType,
                    request: 'launch',
                    program: executablePath,
                    args: [],
                    cwd: workspacePath,
                    externalConsole: debugType === 'cppdbg' ? false : undefined,
                    console: debugType === 'cppvsdbg' ? 'internalConsole' : undefined
                },
                { noDebug: true });

            assert.strictEqual(started, true, 'The noDebug launch did not start successfully.');

            const lastEvent = await tracker.lastEvent;
            await debugSessionTerminated;
            const actualResultValue = await waitForResultFileValue(resultFilePath, 10000);

            assert.strictEqual(lastEvent, 'exited', 'No-debug launch should exit rather than stop on a breakpoint.');
            assert.strictEqual(tracker.state.setBreakpointsRequestReceived, false, 'a "no debug" session should not send setBreakpoints requests.');
            assert.strictEqual(tracker.state.stoppedEventReceived, false, 'a "no debug" session should not emit stopped events.');
            assert.strictEqual(actualResultValue, expectedResultValue, 'Unexpected result value from run without debugging launch.');
        } finally {
            tracker.dispose();
            vscode.debug.removeBreakpoints([breakpoint]);
            await util.deleteFile(resultFilePath);
        }
    });

    test('Debug launch should bind and stop at the breakpoint', async () => {
        const breakpoint = await createBreakpointAtResultWriteStatement(sourceUri);
        const tracker = createTracker(debugType, sessionName, 30000, 'Timed out waiting for debugger event in normal debug mode.');
        const debugSessionTerminated = createSessionTerminatedPromise(sessionName);

        let launchedSession: vscode.DebugSession | undefined;
        const startedSubscription = vscode.debug.onDidStartDebugSession((session) => {
            if (session.name === sessionName) {
                launchedSession = session;
            }
        });

        try {
            const started = await vscode.debug.startDebugging(
                workspaceFolder,
                {
                    name: sessionName,
                    type: debugType,
                    request: 'launch',
                    program: executablePath,
                    args: [],
                    cwd: workspacePath,
                    MIMode: debugType === 'cppdbg' ? miMode : undefined,
                    externalConsole: debugType === 'cppdbg' ? false : undefined,
                    console: debugType === 'cppvsdbg' ? 'internalConsole' : undefined
                },
                { noDebug: false });

            assert.strictEqual(started, true, 'The debug launch did not start successfully.');

            const lastEvent = await tracker.lastEvent;

            assert.strictEqual(lastEvent, 'stopped', 'Debug launch should stop at the breakpoint before exit.');
            assert.strictEqual(tracker.state.setBreakpointsRequestReceived, true, 'Debug mode should send setBreakpoints requests.');
            assert.strictEqual(tracker.state.stoppedEventReceived, true, 'Debug mode should emit a stopped event at the breakpoint.');
            assert.strictEqual(tracker.state.exitedBeforeStop, false, 'Program exited before stopping at breakpoint in debug mode.');
            assert.strictEqual(vscode.debug.activeDebugSession?.name, sessionName, 'Debug session should still be active at breakpoint.');

            const stoppedSession = launchedSession ?? vscode.debug.activeDebugSession;
            assert.ok(stoppedSession, 'Unable to identify the running debug session for termination.');
            await vscode.debug.stopDebugging(stoppedSession);
            await debugSessionTerminated;
        } finally {
            startedSubscription.dispose();
            tracker.dispose();
            vscode.debug.removeBreakpoints([breakpoint]);
            await util.deleteFile(resultFilePath);
        }
    });

});
