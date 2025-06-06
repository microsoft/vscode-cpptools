/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { deepEqual, equal, ok } from 'node:assert';
import * as path from 'path';
import { Uri } from 'vscode';
import { extractCompilerPathAndArgs } from '../../../../src/common';
import { isWindows } from '../../../../src/constants';
import { CppProperties } from '../../../../src/LanguageServer/configurations';

const assetsFolder = Uri.file(path.normalize(path.join(__dirname.replace(/dist[\/\\]/, ''), '..', 'assets')));
const assetsFolderFsPath = assetsFolder.fsPath;

// A simple test counter for the tests that loop over several cases.
// This is to make it easier to see which test failed in the output.
// Start the counter with 1 instead of 0 since we're reporting on test cases, not arrays.
class Counter {
    private count: number = 1;
    public next(): void {
        this.count++;
    }
    public get str(): string {
        return `(test ${this.count})`;
    }
}

if (isWindows) {
    describe('extractCompilerPathAndArgs', () => {
        // [compilerPath, useLegacyBehavior, additionalArgs, result.compilerName, result.allCompilerArgs]
        const nonArgsTests: [string, boolean, string[] | undefined, string, string[]][] = [
            ['cl', false, undefined, 'cl', []],
            ['cl.exe', false, undefined, 'cl.exe', []],
            [path.join(assetsFolderFsPath, 'bin', 'cl.exe'), false, undefined, 'cl.exe', []],
            [path.join(assetsFolderFsPath, 'bin', 'gcc.exe'), false, undefined, 'gcc.exe', []],
            [path.join(assetsFolderFsPath, 'b i n', 'clang++.exe'), false, undefined, 'clang++.exe', []],
            [path.join(assetsFolderFsPath, 'b i n', 'clang++'), false, undefined, 'clang++', []],
            [path.join('bin', 'gcc.exe'), false, undefined, 'gcc.exe', []],
            [path.join('bin', 'gcc'), false, undefined, 'gcc', []]
        ];
        it('Verify various compilerPath strings without args', () => {
            const c = new Counter();
            nonArgsTests.forEach(test => {
                const result = extractCompilerPathAndArgs(test[1], test[0], test[2], assetsFolderFsPath);
                ok(result.compilerPath?.endsWith(test[0]), `${c.str} compilerPath should end with ${test[0]}`);
                equal(result.compilerName, test[3], `${c.str} compilerName should match`);
                deepEqual(result.compilerArgs, test[2], `${c.str} compilerArgs should match`);
                deepEqual(result.compilerArgsFromCommandLineInPath, [], `${c.str} compilerArgsFromCommandLineInPath should be empty`);
                deepEqual(result.allCompilerArgs, test[4], `${c.str} allCompilerArgs should match`);

                // errors and telemetry are set by validateCompilerPath
                equal(result.error, undefined, `${c.str} error should be undefined`);
                equal(result.telemetry, undefined, `${c.str} telemetry should be undefined`);
                c.next();
            });
        });

        const argsTests: [string, boolean, string[] | undefined, string, string[]][] = [
            ['cl.exe /c /Fo"test.obj" test.cpp', false, undefined, 'cl.exe', ['/c', '/Fotest.obj', 'test.cpp']], // extra quotes missing, but not needed.
            ['cl.exe /c /Fo"test.obj" test.cpp', true, undefined, 'cl.exe', ['/c', '/Fo"test.obj"', 'test.cpp']],
            ['cl.exe /c /Fo"test.obj" test.cpp', false, ['/O2'], 'cl.exe', ['/O2', '/c', '/Fotest.obj', 'test.cpp']],
            ['cl.exe /c /Fo"test.obj" test.cpp', true, ['/O2'], 'cl.exe', ['/O2', '/c', '/Fo"test.obj"', 'test.cpp']],
            [`"${path.join(assetsFolderFsPath, 'b i n', 'clang++.exe')}" -std=c++20`, false, undefined, 'clang++.exe', ['-std=c++20']],
            [`"${path.join(assetsFolderFsPath, 'b i n', 'clang++.exe')}" -std=c++20`, true, undefined, 'clang++.exe', ['-std=c++20']],
            [`"${path.join(assetsFolderFsPath, 'b i n', 'clang++.exe')}" -std=c++20`, false, ['-O2'], 'clang++.exe', ['-O2', '-std=c++20']],
            [`"${path.join(assetsFolderFsPath, 'b i n', 'clang++.exe')}" -std=c++20`, true, ['-O2'], 'clang++.exe', ['-O2', '-std=c++20']],
            [`${path.join('bin', 'gcc.exe')} -O2`, false, undefined, 'gcc.exe', ['-O2']],
            [`${path.join('bin', 'gcc.exe')} -O2`, true, undefined, 'gcc.exe', ['-O2']]
        ];
        it('Verify various compilerPath strings with args', () => {
            const c = new Counter();
            argsTests.forEach(test => {
                const result = extractCompilerPathAndArgs(test[1], test[0], test[2]);
                const cp = test[0].substring(test[0].at(0) === '"' ? 1 : 0, test[0].indexOf(test[3]) + test[3].length);
                ok(result.compilerPath?.endsWith(cp), `${c.str} ${result.compilerPath} !endswith ${cp}`);
                equal(result.compilerName, test[3], `${c.str} compilerName should match`);
                deepEqual(result.compilerArgs, test[2], `${c.str} compilerArgs should match`);
                deepEqual(result.compilerArgsFromCommandLineInPath, test[4].filter(a => !test[2]?.includes(a)), `${c.str} compilerArgsFromCommandLineInPath should match those from the command line`);
                deepEqual(result.allCompilerArgs, test[4], `${c.str} allCompilerArgs should match`);

                // errors and telemetry are set by validateCompilerPath
                equal(result.error, undefined, `${c.str} error should be undefined`);
                equal(result.telemetry, undefined, `${c.str} telemetry should be undefined`);
                c.next();
            });
        });

        const negativeTests: [string, boolean, string[] | undefined, string, string[]][] = [
            [`${path.join(assetsFolderFsPath, 'b i n', 'clang++.exe')} -std=c++20`, false, undefined, 'b', ['i', 'n\\clang++.exe', '-std=c++20']]
        ];
        it('Verify various compilerPath strings with args that should fail', () => {
            const c = new Counter();
            negativeTests.forEach(test => {
                const result = extractCompilerPathAndArgs(test[1], test[0], test[2]);
                ok(result.compilerPath?.endsWith(test[3]), `${c.str} ${result.compilerPath} !endswith ${test[3]}`);
                equal(result.compilerName, test[3], `${c.str} compilerName should match`);
                deepEqual(result.compilerArgs, test[2], `${c.str} compilerArgs should match`);
                deepEqual(result.compilerArgsFromCommandLineInPath, test[4], `${c.str} allCompilerArgs should match`);
                deepEqual(result.allCompilerArgs, test[4], `${c.str} allCompilerArgs should match`);

                // errors and telemetry are set by validateCompilerPath
                equal(result.error, undefined, `${c.str} error should be undefined`);
                equal(result.telemetry, undefined, `${c.str} telemetry should be undefined`);
                c.next();
            });
        });
    });
} else {
    describe('extractCompilerPathAndArgs', () => {
        // [compilerPath, useLegacyBehavior, additionalArgs, result.compilerName, result.allCompilerArgs]
        const tests: [string, boolean, string[] | undefined, string, string[]][] = [
            ['clang', false, undefined, 'clang', []],
            [path.join(assetsFolderFsPath, 'bin', 'gcc'), false, undefined, 'gcc', []],
            [path.join(assetsFolderFsPath, 'b i n', 'clang++'), false, undefined, 'clang++', []],
            [path.join('bin', 'gcc'), false, undefined, 'gcc', []]
        ];
        it('Verify various compilerPath strings without args', () => {
            const c = new Counter();
            tests.forEach(test => {
                const result = extractCompilerPathAndArgs(test[1], test[0], test[2]);
                equal(result.compilerName, test[3], `${c.str} compilerName should match`);
                deepEqual(result.allCompilerArgs, test[4], `${c.str} allCompilerArgs should match`);
                equal(result.error, undefined, `${c.str} error should be undefined`);
                equal(result.telemetry, undefined, `${c.str} telemetry should be undefined`);
                c.next();
            });
        });

        const argsTests: [string, boolean, string[] | undefined, string, string[]][] = [
            ['clang -O2 -Wall', false, undefined, 'clang', ['-O2', '-Wall']],
            ['clang -O2 -Wall', true, undefined, 'clang', ['-O2', '-Wall']],
            ['clang -O2 -Wall', false, ['-O3'], 'clang', ['-O3', '-O2', '-Wall']],
            ['clang -O2 -Wall', true, ['-O3'], 'clang', ['-O3', '-O2', '-Wall']],
            [`"${path.join(assetsFolderFsPath, 'b i n', 'clang++')}" -std=c++20`, false, undefined, 'clang++', ['-std=c++20']],
            [`"${path.join(assetsFolderFsPath, 'b i n', 'clang++')}" -std=c++20`, true, undefined, 'clang++', ['-std=c++20']],
            [`"${path.join(assetsFolderFsPath, 'b i n', 'clang++')}" -std=c++20`, false, ['-O2'], 'clang++', ['-O2', '-std=c++20']],
            [`"${path.join(assetsFolderFsPath, 'b i n', 'clang++')}" -std=c++20`, true, ['-O2'], 'clang++', ['-O2', '-std=c++20']],
            [`${path.join('bin', 'gcc')} -O2`, false, undefined, 'gcc', ['-O2']],
            [`${path.join('bin', 'gcc')} -O2`, true, undefined, 'gcc', ['-O2']]
        ];
        it('Verify various compilerPath strings with args', () => {
            const c = new Counter();
            argsTests.forEach(test => {
                const result = extractCompilerPathAndArgs(test[1], test[0], test[2]);
                equal(result.compilerName, test[3], `${c.str} compilerName should match`);
                deepEqual(result.allCompilerArgs, test[4], `${c.str} allCompilerArgs should match`);
                equal(result.error, undefined, `${c.str} error should be undefined`);
                equal(result.telemetry, undefined, `${c.str} telemetry should be undefined`);
                c.next();
            });
        });

        const negativeTests: [string, boolean, string[] | undefined, string, string[]][] = [
            [`${path.join(assetsFolderFsPath, 'b i n', 'clang++')} -std=c++20`, false, undefined, 'b', ['i', 'n/clang++', '-std=c++20']]
        ];
        it('Verify various compilerPath strings with args that should fail', () => {
            const c = new Counter();
            negativeTests.forEach(test => {
                const result = extractCompilerPathAndArgs(test[1], test[0], test[2]);
                equal(result.compilerName, test[3], `${c.str} compilerName should match`);
                deepEqual(result.allCompilerArgs, test[4], `${c.str} allCompilerArgs should match`);

                // errors and telemetry are set by validateCompilerPath
                equal(result.error, undefined, `${c.str} error should be undefined`);
                equal(result.telemetry, undefined, `${c.str} telemetry should be undefined`);
                c.next();
            });
        });
    });
}

describe('validateCompilerPath', () => {
    // [compilerPath, cwd, result.compilerName, result.allCompilerArgs, result.error, result.telemetry]
    const tests: [string, Uri, string, string[]][] = [
        ['cl.exe', assetsFolder, 'cl.exe', []],
        ['cl', assetsFolder, 'cl', []],
        ['clang', assetsFolder, 'clang', []],
        [path.join(assetsFolderFsPath, 'bin', 'cl'), assetsFolder, 'cl', []],
        [path.join(assetsFolderFsPath, 'bin', 'clang-cl'), assetsFolder, 'clang-cl', []],
        [path.join(assetsFolderFsPath, 'bin', 'gcc'), assetsFolder, 'gcc', []],
        [path.join(assetsFolderFsPath, 'b i n', 'clang++'), assetsFolder, 'clang++', []],
        [path.join('bin', 'gcc'), assetsFolder, 'gcc', []],
        [path.join('bin', 'clang-cl'), assetsFolder, 'clang-cl', []],
        ['', assetsFolder, '', []],
        ['  cl.exe  ', assetsFolder, 'cl.exe', []]
    ];
    it('Verify various compilerPath strings without args', () => {
        const c = new Counter();
        tests.forEach(test => {
            // Skip the clang-cl test on non-Windows. That test is for checking the addition of .exe to the compiler name on Windows only.
            if (isWindows || !test[0].includes('clang-cl')) {
                const result = CppProperties.validateCompilerPath(test[0], test[1]);
                equal(result.compilerName, test[2], `${c.str} compilerName should match`);
                deepEqual(result.allCompilerArgs, test[3], `${c.str} allCompilerArgs should match`);
                equal(result.error, undefined, `${c.str} error should be undefined`);
                deepEqual(result.telemetry, test[0] === '' ? undefined : {}, `${c.str} telemetry should be empty`);
            }
            c.next();
        });
    });

    const argsTests: [string, Uri, string, string[]][] = [
        ['cl.exe /std:c++20 /O2', assetsFolder, 'cl.exe', ['/std:c++20', '/O2']], // issue with /Fo"test.obj" argument
        [`"${path.join(assetsFolderFsPath, 'b i n', 'clang++')}" -std=c++20 -O2`, assetsFolder, 'clang++', ['-std=c++20', '-O2']],
        [`${path.join('bin', 'gcc')} -std=c++20 -Wall`, assetsFolder, 'gcc', ['-std=c++20', '-Wall']],
        ['clang -O2 -Wall', assetsFolder, 'clang', ['-O2', '-Wall']]
    ];
    it('Verify various compilerPath strings with args', () => {
        const c = new Counter();
        argsTests.forEach(test => {
            const result = CppProperties.validateCompilerPath(test[0], test[1]);
            equal(result.compilerName, test[2], `${c.str} compilerName should match`);
            deepEqual(result.allCompilerArgs, test[3], `${c.str} allCompilerArgs should match`);
            equal(result.error, undefined, `${c.str} error should be undefined`);
            deepEqual(result.telemetry, {}, `${c.str} telemetry should be empty`);
            c.next();
        });
    });

    it('Verify errors with invalid relative compiler path', async () => {
        const result = CppProperties.validateCompilerPath(path.join('assets', 'bin', 'gcc'), assetsFolder);
        equal(result.compilerName, 'gcc', 'compilerName should be found');
        equal(result.allCompilerArgs.length, 0, 'Should not have any args');
        ok(result.error?.includes('Cannot find'), 'Should have an error for relative paths');
        equal(result.telemetry?.PathNonExistent, 1, 'Should have telemetry for relative paths');
        equal(result.telemetry?.PathNotAFile, undefined, 'Should not have telemetry for invalid paths');
        equal(result.telemetry?.CompilerPathMissingQuotes, undefined, 'Should not have telemetry for missing quotes');
    });

    it('Verify errors with invalid absolute compiler path', async () => {
        const result = CppProperties.validateCompilerPath(path.join(assetsFolderFsPath, 'assets', 'bin', 'gcc'), assetsFolder);
        equal(result.compilerName, 'gcc', 'compilerName should be found');
        equal(result.allCompilerArgs.length, 0, 'Should not have any args');
        ok(result.error?.includes('Cannot find'), 'Should have an error for absolute paths');
        equal(result.telemetry?.PathNonExistent, 1, 'Should have telemetry for absolute paths');
        equal(result.telemetry?.PathNotAFile, undefined, 'Should not have telemetry for invalid paths');
        equal(result.telemetry?.CompilerPathMissingQuotes, undefined, 'Should not have telemetry for missing quotes');
    });

    it('Verify errors with non-file compilerPath', async () => {
        const result = CppProperties.validateCompilerPath('bin', assetsFolder);
        equal(result.compilerName, 'bin', 'compilerName should be found');
        equal(result.allCompilerArgs.length, 0, 'Should not have any args');
        ok(result.error?.includes('Path is not a file'), 'Should have an error for non-file paths');
        equal(result.telemetry?.PathNonExistent, undefined, 'Should not have telemetry for relative paths');
        equal(result.telemetry?.PathNotAFile, 1, 'Should have telemetry for invalid paths');
        equal(result.telemetry?.CompilerPathMissingQuotes, undefined, 'Should not have telemetry for missing quotes');
    });

    it('Verify errors with unknown compiler not in Path', async () => {
        const result = CppProperties.validateCompilerPath('icc', assetsFolder);
        equal(result.compilerName, 'icc', 'compilerName should be found');
        equal(result.allCompilerArgs.length, 0, 'Should not have any args');
        equal(result.telemetry?.PathNonExistent, 1, 'Should have telemetry for relative paths');
        equal(result.telemetry?.PathNotAFile, undefined, 'Should not have telemetry for invalid paths');
        equal(result.telemetry?.CompilerPathMissingQuotes, undefined, 'Should not have telemetry for missing quotes');
    });

    it('Verify errors with unknown compiler not in Path with args', async () => {
        const result = CppProperties.validateCompilerPath('icc -O2', assetsFolder);
        equal(result.compilerName, 'icc', 'compilerName should be found');
        deepEqual(result.allCompilerArgs, ['-O2'], 'args should match');
        ok(result.error?.includes('Cannot find'), 'Should have an error for unknown compiler');
        ok(result.error?.includes('surround the compiler path with double quotes'), 'Should have an error for missing double quotes');
        equal(result.telemetry?.PathNonExistent, 1, 'Should have telemetry for relative paths');
        equal(result.telemetry?.PathNotAFile, undefined, 'Should not have telemetry for invalid paths');
        equal(result.telemetry?.CompilerPathMissingQuotes, 1, 'Should have telemetry for missing quotes');
    });

});
