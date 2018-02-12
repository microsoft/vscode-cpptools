/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CppSettings } from './settings';

export interface CommentPattern {
    begin: string;
    end: string;
    continue: string;
}

const escapeChars: RegExp = /[\\\^\$\*\+\?\{\}\(\)\.\!\=\|\[\]\ ]/;  // characters that should be escaped.

// Insert '\\' in front of regexp escape chars.
function escape(chars: string): string {
    let result: string = "";
    for (let char of chars) {
        if (char.match(escapeChars)) {
            result += `\\${char}`;
        } else {
            result += char;
        }
    }
    return result;
}

// BEWARE: below are string representations of regular expressions, so the backslashes must all be escaped.

function getMLBeginPattern(insert: string): string | undefined {
    if (insert && insert.startsWith("/*")) {
        let match: string = escape(insert.substr(2)); // trim the leading '/*' and escape any troublesome characters.
        return `^\\s*\\/\\*${match}(?!\\/)([^\\*]|\\*(?!\\/))*$`;
    }
    return undefined;
}

function getMLSplitAfterPattern(): string {
    return "^\\s*\\*\\/$";
}

function getMLContinuePattern(insert: string): string | undefined {
    if (insert) {
        let match: string = escape(insert.trimRight());
        return `^(\\t|(\\ \\ ))*${match}([^\\*]|\\*(?!\\/))*$`;
    }
    return undefined;
}

function getMLEndPattern(insert: string): string | undefined {
    if (insert) {
        insert = insert.trimRight();
        if (insert.endsWith('*')) {
            insert = insert.substr(0, insert.length - 1);
        }
        let match: string = escape(insert.trimRight());
        return `^(\\t|(\\ \\ ))*${match}[^/]*\\*\\/\\s*$`;
    }
    return undefined;
}

function getMLEmptyEndPattern(insert: string): string | undefined {
    if (insert) {
        insert = insert.trimRight();
        if (insert.endsWith('*')) {
            insert = insert.substr(0, insert.length - 1);
        }
        let match: string = escape(insert.trimRight());
        return `^(\\t|(\\ \\ ))*${match}\\*\\/\\s*$`;
    }
    return undefined;
}

// When Enter is pressed while the cursor is between '/**' and '*/' on the same line.
function getMLSplitRule(comment: CommentPattern): vscode.OnEnterRule | undefined {
    if (comment) {
        let beforePattern: string | undefined = getMLBeginPattern(comment.begin);
        if (beforePattern) {
            return {
                beforeText: new RegExp(beforePattern), // '^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$'
                afterText: new RegExp(getMLSplitAfterPattern()),
                action: {
                    indentAction: vscode.IndentAction.IndentOutdent,
                    appendText: comment.continue ? comment.continue : ''
                }
            };
        }
    }
    return undefined;
}

// When Enter is pressed while the cursor is after '/**' and there is no '*/' on the same line after the cursor
function getMLFirstLineRule(comment: CommentPattern): vscode.OnEnterRule | undefined {
    if (comment) {
        let beforePattern: string | undefined = getMLBeginPattern(comment.begin);
        if (beforePattern) {
            return {
                beforeText: new RegExp(beforePattern),
                action: {
                    indentAction: vscode.IndentAction.None,
                    appendText: comment.continue ? comment.continue : ''
                }
            };
        }
    }
    return undefined;
}

// When Enter is pressed while the cursor is after the continuation pattern
function getMLContinuationRule(comment: CommentPattern): vscode.OnEnterRule | undefined {
    if (comment) {
        let continuePattern: string = getMLContinuePattern(comment.continue);
        if (continuePattern) {
            return {
                beforeText: new RegExp(continuePattern),    // '^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$'
                action: {
                    indentAction: vscode.IndentAction.None,
                    appendText: comment.continue.trimLeft()
                }
            };
        }
    }
    return undefined;
}

// When Enter is pressed while the cursor is after '*/' (and '*/' plus leading whitespace is all that is on the line) 
function getMLEndRule(comment: CommentPattern): vscode.OnEnterRule | undefined {
    if (comment) {
        let endPattern: string = getMLEndPattern(comment.continue);
        if (endPattern) {
            return {
                beforeText: new RegExp(endPattern),     // '^(\t|(\ \ ))*\ \*[^/]*\*\/\s*$'
                action: {
                    indentAction: vscode.IndentAction.None,
                    removeText: comment.continue.length - comment.continue.trimLeft().length
                }
            };
        }
    }
    return undefined;
}

// When Enter is pressed while the cursor is after the continuation pattern and '*/'
function getMLEmptyEndRule(comment: CommentPattern): vscode.OnEnterRule | undefined {
    if (comment) {
        let endPattern: string = getMLEmptyEndPattern(comment.continue);
        if (endPattern) {
            return {
                beforeText: new RegExp(endPattern),     // '^(\t|(\ \ ))*\ \*\/\s*$'
                action: {
                    indentAction: vscode.IndentAction.None,
                    removeText: comment.continue.length - comment.continue.trimLeft().length
                }
            };
        }
    }
    return undefined;
}

export function getLanguageConfig(resource?: vscode.Uri): vscode.LanguageConfiguration {
    let settings: CppSettings = new CppSettings(resource);
    let comments: CommentPattern[] = settings.multilineCommentPatterns; // TODO: support both string and CommentPattern in the array.
    let rules: vscode.OnEnterRule[] = [];
    comments.forEach(comment => {
        let r: vscode.OnEnterRule[] = constructCommentRules(comment);
        if (r && r.length > 0) {
            rules = rules.concat(r);
        }
    });
    return { onEnterRules: rules };
}

function constructCommentRules(comment: CommentPattern): vscode.OnEnterRule[] {
    let rules: vscode.OnEnterRule[] = [];
    if (comment && comment.begin && comment.begin.startsWith('/*')) {
        rules = [
            getMLSplitRule(comment),    // TODO: think about ordering of rules when multiple CommentPatterns are specified.
            getMLFirstLineRule(comment),
            getMLContinuationRule(comment), // TODO: there is a bug in this rule or the EmptyEndRule because Enter after '^\s*\*\/$' is not working.
            getMLEmptyEndRule(comment),  // TODO: look for/remove duplicates?
            getMLEndRule(comment)
        ];
    } else if (comment && comment.begin && comment.begin.startsWith('//')) {
        // TODO: construct rules for single line comments
    }
    return rules;
}