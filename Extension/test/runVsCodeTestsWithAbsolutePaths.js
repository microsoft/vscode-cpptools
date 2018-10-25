#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

child_process = require('child_process');
path = require('path');
async_child_process = require('async-child-process');

if (process.env.CODE_TESTS_PATH
    && process.env.CODE_TESTS_PATH.startsWith('.')){
        process.env.CODE_TESTS_PATH = path.join(process.cwd(), process.env.CODE_TESTS_PATH.substr(2));
}

let optionsWithFullEnvironment = {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit', 
    env: {
        ...process.env,
    }
};

spawn = child_process.spawn('node', [path.resolve(__dirname, '../node_modules/vscode/bin/test')], optionsWithFullEnvironment);

return async_child_process.join(spawn);