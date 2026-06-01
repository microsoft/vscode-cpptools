/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../../../vscode.d.ts" />
import * as assert from 'assert';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as util from '../../../../src/common';
import { isLinux, isMacOS, isWindows } from '../../../../src/constants';
import { getEffectiveEnvironment } from '../../../../src/LanguageServer/devcmd';

interface ProcessResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

function runProcess(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        const child = cp.spawn(command, args, { cwd, env });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

async function setWindowsBuildEnvironment(): Promise<void> {
    const promise = vscode.commands.executeCommand('C_Cpp.SetVsDeveloperEnvironment', 'test');
    const timer = setInterval(() => {
        void vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    }, 1000);
    await promise;
    clearInterval(timer);
    const missingVars = util.getMissingMsvcEnvironmentVariables();
    assert.strictEqual(missingVars.length, 0, `MSVC environment missing: ${missingVars.join(', ')}`);
}

export async function compileProgram(workspacePath: string, sourcePath: string, outputPath: string): Promise<void> {
    if (isWindows) {
        await setWindowsBuildEnvironment();
        const env = getEffectiveEnvironment();
        const result = await runProcess('cl.exe', ['/nologo', '/EHsc', '/Zi', '/std:c++17', `/Fe:${outputPath}`, sourcePath], workspacePath, env);
        assert.strictEqual(result.code, 0, `MSVC compilation failed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
        return;
    }

    if (isMacOS) {
        const result = await runProcess('clang++', ['-std=c++17', '-g', sourcePath, '-o', outputPath], workspacePath);
        assert.strictEqual(result.code, 0, `clang++ compilation failed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
        return;
    }

    if (isLinux) {
        const result = await runProcess('g++', ['-std=c++17', '-g', sourcePath, '-o', outputPath], workspacePath);
        assert.strictEqual(result.code, 0, `g++ compilation failed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
        return;
    }

    assert.fail(`Unsupported test platform: ${process.platform}`);
}
