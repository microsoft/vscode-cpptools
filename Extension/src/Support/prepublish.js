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
if (!process.env.CPPTOOLS_DEV && fs.existsSync('./node_modules')) {
    console.log("Skipping npm install since it appears to have been executed already.");
} else {
    console.log(">> npm install");
    cp.execSync("npm install", {stdio:[0, 1, 2]});
}

console.log(">> tsc -p ./");
cp.execSync("tsc -p ./", {stdio:[0, 1, 2]});
// Required for nightly builds. Nightly builds do not enable CPPTOOLS_DEV.
console.log(">> node ./out/src/Support/copyDebuggerDependencies.js");
cp.execSync("node ./out/src/Support/copyDebuggerDependencies.js", {stdio:[0, 1, 2]});
