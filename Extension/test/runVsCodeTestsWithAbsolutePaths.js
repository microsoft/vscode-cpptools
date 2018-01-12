#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

path = require('path');

if (process.env.CODE_TESTS_PATH
    && process.env.CODE_TESTS_PATH.startsWith('.')){
        process.env.CODE_TESTS_PATH = path.join(process.cwd(), process.env.CODE_TESTS_PATH.substr(2));
}

require(path.resolve(__dirname, '../node_modules/vscode/bin/test'));