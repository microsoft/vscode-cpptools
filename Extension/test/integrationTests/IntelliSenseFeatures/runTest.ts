/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';

import { runTests } from 'vscode-test';

async function main(): Promise<void> {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath: string = path.resolve(__dirname, '../../../../');

        // The path to the extension test script
        // Passed to --extensionTestsPath
        const extensionTestsPath: string = path.resolve(__dirname, './index');

        const launchArgs: string[] = [ "--disable-extensions" ];

        // Download VS Code, unzip it and run the integration test
        await runTests({ launchArgs, extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();
