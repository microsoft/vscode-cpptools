import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { ok } from 'assert';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir as md, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { resolve } from 'path';

// The folder containing the Extension Manifest package.json
// Passed to `--extensionDevelopmentPath`
const extensionDevelopmentPath = resolve(__dirname, '../../../../');

const isolated = resolve(tmpdir(), '.vscode-test', createHash('sha256').update(extensionDevelopmentPath).digest('hex').substring(0,6) );

const options = {
    cachePath: `${isolated}/cache`,
    launchArgs: ['--no-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes', `--extensions-dir=${isolated}/extensions`, `--user-data-dir=${isolated}/user-data`]
};
async function mkdir(filePath:string) {
    filePath = resolve(filePath);
    try { 
        const s = await stat(filePath);
        if( s.isDirectory() ) {
            return filePath;
        }
        throw new Error(`Cannot create directory '${filePath}' because thre is a file there.`);
    } catch { 
        // no worries
    }
   
    await md(filePath, { recursive: true })
    return filePath;
}

async function main() {
    try {
        // create a folder for the isolated test environment
        await mkdir(isolated);

        // download VSCode to that location
        const vscodeExecutablePath = await downloadAndUnzipVSCode(options);
        const [cli, ...launchArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath).filter(each => !each.startsWith('--extensions-dir=') && !each.startsWith('--user-data-dir='));

        // clean up args so that it works with the isolate extensions and data directories
        launchArgs.push(`--extensions-dir=${isolated}/extensions`, `--user-data-dir=${isolated}/user-data`);

        // The path to the extension test script
        // Passed to --extensionTestsPath
        const extensionTestsPath = resolve(__dirname, './index');

        // Note, when running tests locally, replace TESTS_WORKSPACE with local path to "~/Vcls-vscode-test/MultirootDeadlockTest/test.code-workspace"
        // in the Launch.json file.
        let testWorkspace: string | undefined = process.env.TESTS_WORKSPACE || resolve(extensionDevelopmentPath, '../../Vcls-vscode-test/MultirootDeadlockTest/test.code-workspace');
        ok(existsSync(testWorkspace), `TESTS_WORKSPACE '${testWorkspace}' does not exist.`);
        
        console.log("TESTS_WORKSPACE: " + testWorkspace);

        launchArgs.push("--disable-extensions", testWorkspace );

        // Download VS Code, unzip it and run the integration test
        await runTests({ 
            ...options,
            launchArgs, 
            extensionDevelopmentPath, 
            extensionTestsPath 
        });
    } catch (err) {
        console.log(err);
        console.log('Failed to run tests.');
        process.exit(1);
    }
}

main();

