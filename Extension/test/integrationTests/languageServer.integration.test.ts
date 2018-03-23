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
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            afterText: /^\s*\*\/$/,
            action: { indentAction: vscode.IndentAction.IndentOutdent, appendText: ' * ' }
        },
        {
            beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
            action: { indentAction: vscode.IndentAction.None, appendText: ' * ' }
        },
        {
            beforeText: /^\s*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
            action: { indentAction: vscode.IndentAction.None, appendText: '* ' }
        },
        {
            beforeText: /^\s*\*\/\s*$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 1 }
        },
        {
            beforeText: /^\s*\*[^/]*\*\/\s*$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 1 }
        }
    ];
    let defaultSLRules: vscode.OnEnterRule[] = [
        {
            beforeText: /^\s*\/\/\/.+$/,
            action: { indentAction: vscode.IndentAction.None, appendText: '///' }
        },
        {
            beforeText: /^\s*\/\/\/$/,
            action: { indentAction: vscode.IndentAction.None, removeText: 0 }
        }
    ];

    test("Check the default OnEnterRules for C", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('c', [ "/**" ]).onEnterRules;
        assert.deepEqual(rules, defaultRules);
    });

    test("Check for removal of single line comment continuations for C", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('c', [ "/**", "///" ]).onEnterRules;
        assert.deepEqual(rules, defaultRules);
    });

    test("Check the default OnEnterRules for C++", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('cpp', [ "/**" ]).onEnterRules;
        assert.deepEqual(rules, defaultRules);
    });

    test("Make sure duplicate rules are removed", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('cpp', [ "/**", { begin: "/**", continue: " * " }, "/**" ]).onEnterRules;
        assert.deepEqual(rules, defaultRules);
    });

    test("Check single line rules for C++", () => {
        let rules: vscode.OnEnterRule[] = getLanguageConfigFromPatterns('cpp', [ "///" ]).onEnterRules;
        assert.deepEqual(rules, defaultSLRules);
    });

});