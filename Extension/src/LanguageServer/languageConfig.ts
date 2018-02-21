/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CppSettings } from './settings';
import { getOutputChannel } from '../logger';

export interface CommentPattern {
    begin: string;
    continue: string;
}

const escapeChars: RegExp = /[\\\^\$\*\+\?\{\}\(\)\.\!\=\|\[\]\ \/]/;  // characters that should be escaped.

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
        if (match) {
            let right: string = escape(insert.substr(insert.trimRight().length));
            return `^\\s*${match}(${right}([^\\*]|\\*(?!\\/))*)?$`;
        }
        // else: if the continuation is just whitespace, vscode already does indentation preservation.
    }
    return undefined;
}

function getMLEndPattern(insert: string): string | undefined {
    if (insert) {
        let match: string = escape(insert.trimRight().trimLeft());
        if (match) {
            return `^\\s*${match}[^/]*\\*\\/\\s*$`;
        }
        // else: if the continuation is just whitespace, don't mess with indentation
        // since we don't know if this is a continuation line or not.
    }
    return undefined;
}

function getMLEmptyEndPattern(insert: string): string | undefined {
    if (insert) {
        insert = insert.trimRight();
        if (insert) {
            if (insert.endsWith('*')) {
                insert = insert.substr(0, insert.length - 1);
            }
            let match: string = escape(insert.trimRight());
            return `^\\s*${match}\\*\\/\\s*$`;
        }
        // else: if the continuation is just whitespace, don't mess with indentation
        // since we don't know if this is a continuation line or not.
    }
    return undefined;
}

function getSLBeginPattern(insert: string): string | undefined {
    if (insert) {
        let match: string = escape(insert.trimRight());
        return `^\\s*${match}.*$`;
    }
    return undefined;
}

function getSLContinuePattern(insert: string): string | undefined {
    if (insert) {
        let match: string = escape(insert.trimRight());
        return `^\\s*${match}.+$`;
    }
    return undefined;
}

function getSLEndPattern(insert: string): string | undefined {
    if (insert) {
        let match: string = escape(insert);
        let trimmed: string = escape(insert.trimRight());
        if (match !== trimmed) {
            match = `(${match}|${trimmed})`;
        }
        return `^\\s*${match}$`;
    }
    return undefined;
}

// When Enter is pressed while the cursor is between '/**' and '*/' on the same line.
function getMLSplitRule(comment: CommentPattern): vscode.OnEnterRule | undefined {
    if (comment) {
        let beforePattern: string | undefined = getMLBeginPattern(comment.begin);
        if (beforePattern) {
            return {
                beforeText: new RegExp(beforePattern),
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
                beforeText: new RegExp(continuePattern),
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
                beforeText: new RegExp(endPattern),
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
                beforeText: new RegExp(endPattern),
                action: {
                    indentAction: vscode.IndentAction.None,
                    removeText: comment.continue.length - comment.continue.trimLeft().length
                }
            };
        }
    }
    return undefined;
}

// When the continue rule is different than the begin rule for single line comments
function getSLFirstLineRule(comment: CommentPattern): vscode.OnEnterRule | undefined {
    if (comment) {
        let continuePattern: string = getSLBeginPattern(comment.begin);
        if (continuePattern) {
            return {
                beforeText: new RegExp(continuePattern),
                action: {
                    indentAction: vscode.IndentAction.None,
                    appendText: comment.continue.trimLeft()
                }
            };
        }
    }
    return undefined;
}

// When Enter is pressed while the cursor is after the continuation pattern plus at least one other character.
function getSLContinuationRule(comment: CommentPattern): vscode.OnEnterRule | undefined {
    if (comment) {
        let continuePattern: string = getSLContinuePattern(comment.continue);
        if (continuePattern) {
            return {
                beforeText: new RegExp(continuePattern),
                action: {
                    indentAction: vscode.IndentAction.None,
                    appendText: comment.continue.trimLeft()
                }
            };
        }
    }
    return undefined;
}

// When Enter is pressed while the cursor is immediately after the continuation pattern
function getSLEndRule(comment: CommentPattern): vscode.OnEnterRule | undefined {
    if (comment) {
        let endPattern: string = getSLEndPattern(comment.continue);
        if (endPattern) {
            return {
                beforeText: new RegExp(endPattern),
                action: {
                    indentAction: vscode.IndentAction.None,
                    removeText: comment.continue.length - comment.continue.trimLeft().length
                }
            };
        }
    }
    return undefined;
}

interface Rules {
    begin: vscode.OnEnterRule[];
    continue: vscode.OnEnterRule[];
    end: vscode.OnEnterRule[];
}

export function getLanguageConfig(languageId: string, resource?: vscode.Uri): vscode.LanguageConfiguration {
    let settings: CppSettings = new CppSettings(resource);
    let patterns: (string | CommentPattern)[] = settings.commentContinuationPatterns;
    return getLanguageConfigFromPatterns(languageId, patterns);
}

export function getLanguageConfigFromPatterns(languageId: string, patterns: (string | CommentPattern)[]): vscode.LanguageConfiguration {
    let beginPatterns: string[] = [];       // avoid duplicate rules
    let continuePatterns: string[] = [];    // avoid duplicate rules
    let duplicates: boolean = false;
    let beginRules: vscode.OnEnterRule[] = [];
    let continueRules: vscode.OnEnterRule[] = [];
    let endRules: vscode.OnEnterRule[] = [];
    patterns.forEach(pattern => {
        let c: CommentPattern = (typeof pattern === "string") ? { begin: pattern, continue: pattern.startsWith('/*') ? " * " : pattern } : <CommentPattern>pattern;
        let r: Rules = constructCommentRules(c, languageId);
        if (beginPatterns.indexOf(c.begin) < 0) {
            if (r.begin && r.begin.length > 0) {
                beginRules = beginRules.concat(r.begin);
            }
            beginPatterns.push(c.begin);
        } else {
            duplicates = true;
        }
        if (continuePatterns.indexOf(c.continue) < 0) {
            if (r.continue && r.continue.length > 0) {
                continueRules = continueRules.concat(r.continue);
            }
            if (r.end && r.end.length > 0) {
                endRules = endRules.concat(r.end);
            }
            continuePatterns.push(c.continue);
        }
    });
    if (duplicates) {
        getOutputChannel().appendLine("Duplicate multiline comment patterns detected.");
    }
    return { onEnterRules: beginRules.concat(continueRules).concat(endRules).filter(e => (e)) };    // Remove any 'undefined' entries
}

function constructCommentRules(comment: CommentPattern, languageId: string): Rules {
    if (comment && comment.begin && comment.begin.startsWith('/*') && (languageId === 'c' || languageId === 'cpp')) {
        return {
            begin: [
                getMLSplitRule(comment),
                getMLFirstLineRule(comment)
            ],
            continue: [ getMLContinuationRule(comment) ],
            end: [
                getMLEmptyEndRule(comment),
                getMLEndRule(comment)
            ]
        };
    } else if (comment && comment.begin && comment.begin.startsWith('//') && languageId === 'cpp') {
        return {
            begin: (comment.begin === comment.continue) ? [] : [ getSLFirstLineRule(comment) ],
            continue: [ getSLContinuationRule(comment) ],
            end: [ getSLEndRule(comment) ]
        };
    }
    return {
        begin: [],
        continue: [],
        end: []
    };
}