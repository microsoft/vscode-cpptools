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
    cp.execSync("npm install", {stdio:[0, 1, 2]});
}
