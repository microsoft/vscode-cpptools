/*--------------------------------------------------------------------------------------------- 
 *  Copyright (c) Microsoft Corporation. All rights reserved. 
 *  Licensed under the MIT License. See License.txt in the project root for license information. 
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as assert from 'assert';
import { getLanguageConfigFromPatterns } from '../../src/LanguageServer/languageConfig';

suite("multiline comment setting tests", function() {
    suiteSetup(async function() { 
        let extension: vscode.Extension<any> = vscode.extensions.getExtension("ms-vscode.cpptools"); 
        if (!extension.isActive) { 
            await extension.activate(); 
        }
    });

    let defaultRules: vscode.OnEnterRule[] = [
        {
            // e.g. /** | */
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            afterText: /^\s*\*\/$/,
            action: { indentAction: vscode.IndentAction.IndentOutdent, appendText: ' * ' }
        }, {
            // e.g. /** ...|
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            action: { indentAction: vscode.IndentAction.None, appendText: ' * ' }
        }, {
            // e.g.  * ...|
            beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
            action: { indentAction: vscode.IndentAction.None, appendText: '* ' }
        }, {
            // e.g.  */|
            beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 1 }
        },
        {
            // e.g.  *-----*/|
            beforeText: /^(\t|(\ \ ))*\ \*[^/]*\*\/\s*$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 1 }
        }
    ];

    test("Check the default OnEnterRules for C", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('c', [ "/**" ]).onEnterRules;

        assert.equal(rules, defaultRules);
    });
});