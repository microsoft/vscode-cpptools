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
const os = require("os");
const cp = require("child_process");
const path = require("path");

let compile = function(tsPath) {
    const folderName = path.dirname(tsPath);

    console.log(">> tsc " + tsPath + " --outDir out/" + folderName);
    cp.execSync("tsc " + tsPath + " --outDir out/" + folderName, {stdio:[0, 1, 2]});
};

console.log(">> yarn install");
cp.execSync("yarn install", { stdio: [0, 1, 2] });


const tscCompileListStr = fs.readFileSync("./tscCompileList.txt").toString();

tscCompileListStr.split(/\r?\n/).forEach(filePath => {
    if (!filePath.startsWith("#") && /\S/.test(filePath)) {
        compile(filePath);
    }
});

// If the required debugger file doesn't exist, make sure it is copied.
if (process.env.CPPTOOLS_DEV || !fs.existsSync('./debugAdapters/bin/cppdbg.ad7Engine.json')) {
    const copyDebuggerDependenciesJSFile = './out/tools/copyDebuggerDependencies.js';

    // Required for nightly builds. Nightly builds do not enable CPPTOOLS_DEV.
    console.log(">> node " + copyDebuggerDependenciesJSFile);
    cp.execSync("node " + copyDebuggerDependenciesJSFile, { stdio: [0, 1, 2] });
}
