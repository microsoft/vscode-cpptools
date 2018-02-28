/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

/**
 * This file is used during local debugging of the extension and should not be referenced by any
 * other source files.
 */

const fs = require("fs");
const cp = require("child_process");
const path = require("path");
if (!process.env.CPPTOOLS_DEV && fs.existsSync('./node_modules')) {
    console.log("Skipping npm install since it appears to have been executed already.");
} else {
    console.log(">> npm install");
    cp.execSync("npm install", { stdio: [0, 1, 2] });
}

// If the required debugger file doesn't exist, make sure it is copied.
if (process.env.CPPTOOLS_DEV || !fs.existsSync('./debugAdapters/bin/cpptools.ad7Engine.json')) {
    const outDir = './out/src/Support/'
    const copyDebuggerDependenciesJSFile = path.join(outDir, 'copyDebuggerDependencies.js');
    if (!fs.existsSync('./out/src/Support/copyDebuggerDependencies.js'))
    {
        console.log(">> tsc -p ./src/Support/copyDebuggerDependencies.ts");
        cp.execSync("tsc ./src/Support/copyDebuggerDependencies.ts --outDir " + outDir, { stdio: [0, 1, 2] });
    }

    // Required for nightly builds. Nightly builds do not enable CPPTOOLS_DEV.
    console.log(">> node " + copyDebuggerDependenciesJSFile);
    cp.execSync("node " + copyDebuggerDependenciesJSFile, { stdio: [0, 1, 2] });
}