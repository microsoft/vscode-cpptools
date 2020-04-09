import * as path from 'path';

import { runTests } from 'vscode-test';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../../../');
        console.log("extensionDevelopmentPath: " + extensionDevelopmentPath);
        console.log("__dirname: " + __dirname);
        // The path to the extension test script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './index');

        //const testWorkspace = path.resolve(extensionDevelopmentPath, 'test/integrationTests/testAssets/SimpleCppProject');
        let testWorkspace2: string | undefined = process.env.TESTS_WORKSPACE;
        if (!testWorkspace2) {
            console.error("Unable to read process.env.TESTS_WORKSPACE");
        } else {
            console.log("testWorkspace: " + testWorkspace2);
        }

        const launchArgs = [ "--disable-extensions", testWorkspace2 ];

        // Download VS Code, unzip it and run the integration test
        await runTests({ launchArgs, extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();
