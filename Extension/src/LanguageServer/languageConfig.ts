/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CppSettings } from './settings';
import { getOutputChannel } from '../logger';
import * as nls from 'vscode-nls';
import { isString } from '../common';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface CommentPattern {
    begin: string;
    continue: string;
}

const escapeChars: RegExp = /[\\\^\$\*\+\?\{\}\(\)\.\!\=\|\[\]\ \/]/;  // characters that should be escaped.

export interface TsRules extends vscode.OnEnterRule {
    // This rule will only execute if the text above the line matches this regular expression.
    oneLineAboveText?: RegExp;
}

// Insert '\\' in front of regexp escape chars.
function escape(chars: string): string {
    let result: string = "";
    for (const char of chars) {
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
    if (insert.startsWith("/*")) {
        const match: string = escape(insert.substr(2)); // trim the leading '/*' and escape any troublesome characters.
        return `^\\s*\\/\\*${match}(?!\\/)([^\\*]|\\*(?!\\/))*$`;
    }
    return undefined;
}

function getMLSplitAfterPattern(): string {
    return "^\\s*\\*\\/$";
}

function getMLContinuePattern(insert: string): string | undefined {
    if (insert) {
        const match: string = escape(insert.trimRight());
        if (match) {
            const right: string = escape(insert.substr(insert.trimRight().length));
            return `^\\s*${match}(${right}([^\\*]|\\*(?!\\/))*)?$`;
        }
        // else: if the continuation is just whitespace, vscode already does indentation preservation.
    }
    return undefined;
}

function getMLEndPattern(insert: string): string | undefined {
    const match: string = escape(insert.trimRight().trimLeft());
    if (match) {
        return `^\\s*${match}[^/]*\\*\\/\\s*$`;
    }
    // else: if the continuation is just whitespace, don't mess with indentation
    // since we don't know if this is a continuation line or not.
    return undefined;
}

function getMLEmptyEndPattern(insert: string): string | undefined {
    insert = insert.trimRight();
    if (insert !== "") {
        if (insert.endsWith('*')) {
            insert = insert.substr(0, insert.length - 1);
        }
        const match: string = escape(insert.trimRight());
        return `^\\s*${match}\\*\\/\\s*$`;
    }
    // else: if the continuation is just whitespace, don't mess with indentation
    // since we don't know if this is a continuation line or not.
    return undefined;
}

function getSLBeginPattern(insert: string): string {
    const match: string = escape(insert.trimRight());
    return `^\\s*${match}.*$`;
}

function getSLContinuePattern(insert: string): string {
    const match: string = escape(insert.trimRight());
    return `^\\s*${match}.+$`;
}

function getSLEndPattern(insert: string): string {
    let match: string = escape(insert);
    const trimmed: string = escape(insert.trimRight());
    if (match !== trimmed) {
        match = `(${match}|${trimmed})`;
    }
    return `^\\s*${match}$`;
}

// When Enter is pressed while the cursor is between '/**' and '*/' on the same line.
function getMLSplitRule(comment: CommentPattern): TsRules | undefined {
    const beforePattern: string | undefined = getMLBeginPattern(comment.begin);
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
    return undefined;
}

// When Enter is pressed while the cursor is after '/**' and there is no '*/' on the same line after the cursor
function getMLFirstLineRule(comment: CommentPattern): TsRules | undefined {
    const beforePattern: string | undefined = getMLBeginPattern(comment.begin);
    if (beforePattern) {
        return {
            beforeText: new RegExp(beforePattern),
            action: {
                indentAction: vscode.IndentAction.None,
                appendText: comment.continue ? comment.continue : ''
            }
        };
    }
    return undefined;
}

// When Enter is pressed while the cursor is after the continuation pattern
function getMLContinuationRule(comment: CommentPattern): TsRules | undefined {
    const continuePattern: string | undefined = getMLContinuePattern(comment.continue);
    const beginPattern: string | undefined = getMLBeginPattern(comment.begin);
    if (continuePattern) {
        if (beginPattern) {
            return {
                beforeText: new RegExp(continuePattern),
                oneLineAboveText: new RegExp(beginPattern),
                action: {
                    indentAction: vscode.IndentAction.None,
                    appendText: comment.continue.trimLeft()
                }
            }
        } else {
            return {
                beforeText: new RegExp(continuePattern),
                action: {
                    indentAction: vscode.IndentAction.None,
                    appendText: comment.continue.trimLeft()
                }
            }            
        }
    }
    return undefined;
}

// When Enter is pressed while the cursor is after '*/' (and '*/' plus leading whitespace is all that is on the line)
function getMLEndRule(comment: CommentPattern): TsRules | undefined {
    const endPattern: string | undefined = getMLEndPattern(comment.continue);
    if (endPattern) {
        return {
            beforeText: new RegExp(endPattern),
            action: {
                indentAction: vscode.IndentAction.None,
                removeText: comment.continue.length - comment.continue.trimLeft().length
            }
        };
    }
    return undefined;
}

// When Enter is pressed while the cursor is after the continuation pattern and '*/'
function getMLEmptyEndRule(comment: CommentPattern): TsRules | undefined {
    const endPattern: string | undefined = getMLEmptyEndPattern(comment.continue);
    if (endPattern) {
        return {
            beforeText: new RegExp(endPattern),
            action: {
                indentAction: vscode.IndentAction.None,
                removeText: comment.continue.length - comment.continue.trimLeft().length
            }
        };
    }
    return undefined;
}

// When the continue rule is different than the begin rule for single line comments
function getSLFirstLineRule(comment: CommentPattern): TsRules {
    const continuePattern: string = getSLBeginPattern(comment.begin);
    return {
        beforeText: new RegExp(continuePattern),
        action: {
            indentAction: vscode.IndentAction.None,
            appendText: comment.continue.trimLeft()
        }
    };
}

// When Enter is pressed while the cursor is after the continuation pattern plus at least one other character.
function getSLContinuationRule(comment: CommentPattern): TsRules {
    const continuePattern: string = getSLContinuePattern(comment.continue);
    return {
        beforeText: new RegExp(continuePattern),
        action: {
            indentAction: vscode.IndentAction.None,
            appendText: comment.continue.trimLeft()
        }
    };
}

// When Enter is pressed while the cursor is immediately after the continuation pattern
function getSLEndRule(comment: CommentPattern): TsRules {
    const endPattern: string = getSLEndPattern(comment.continue);
    return {
        beforeText: new RegExp(endPattern),
        action: {
            indentAction: vscode.IndentAction.None,
            removeText: comment.continue.length - comment.continue.trimLeft().length
        }
    };
}

export function getLanguageConfig(languageId: string): vscode.LanguageConfiguration {
    const settings: CppSettings = new CppSettings();
    const patterns: (string | CommentPattern)[] | undefined = settings.commentContinuationPatterns;
    return getLanguageConfigFromPatterns(languageId, patterns);
}

export function getLanguageConfigFromPatterns(languageId: string, patterns?: (string | CommentPattern)[]): vscode.LanguageConfiguration {
    const beginPatterns: string[] = [];       // avoid duplicate rules
    const continuePatterns: string[] = [];    // avoid duplicate rules
    let duplicates: boolean = false;
    let beginRules: TsRules[] = [];
    let continueRules: TsRules[] = [];
    let endRules: TsRules[] = [];
    if (!patterns) {
        patterns = [ "/**" ];
    }
    patterns.forEach(pattern => {
        const c: CommentPattern = isString(pattern) ? { begin: pattern, continue: pattern.startsWith('/*') ? " * " : pattern } : <CommentPattern>pattern;
        const r: Rules = constructCommentRules(c, languageId);
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
        getOutputChannel().appendLine(localize("duplicate.multiline.patterns", "Duplicate multiline comment patterns detected."));
    }
    return { onEnterRules: beginRules.concat(continueRules).concat(endRules).filter(e => (e)) };    // Remove any 'undefined' entries
}

interface Rules {
    begin: TsRules[];
    continue: TsRules[];
    end: TsRules[];
}

function constructCommentRules(comment: CommentPattern, languageId: string): Rules {
    if (comment?.begin?.startsWith('/*') && (languageId === 'c' || languageId === 'cpp')) {
        const mlBegin1: TsRules | undefined = getMLSplitRule(comment);
        if (!mlBegin1) {
            throw new Error("Failure in constructCommentRules() - mlBegin1");
        }
        const mlBegin2: TsRules | undefined = getMLFirstLineRule(comment);
        if (!mlBegin2) {
            throw new Error("Failure in constructCommentRules() - mlBegin2");
        }
        const mlContinue: TsRules | undefined = getMLContinuationRule(comment);
        if (!mlContinue) {
            throw new Error("Failure in constructCommentRules() - mlContinue");
        }
        const mlEnd1: TsRules | undefined = getMLEmptyEndRule(comment);
        if (!mlEnd1) {
            throw new Error("Failure in constructCommentRules() - mlEnd1");
        }
        const mlEnd2: TsRules | undefined = getMLEndRule(comment);
        if (!mlEnd2) {
            throw new Error("Failure in constructCommentRules() = mlEnd2");
        }
        return {
            begin: [ mlBegin1, mlBegin2 ],
            continue: [ mlContinue ],
            end: [ mlEnd1, mlEnd2 ]
        };
    } else if (comment?.begin?.startsWith('//') && languageId === 'cpp') {
        const slContinue: TsRules = getSLContinuationRule(comment);
        const slEnd: TsRules = getSLEndRule(comment);
        if (comment.begin !== comment.continue) {
            const slBegin: TsRules = getSLFirstLineRule(comment);
            return {
                begin: (comment.begin === comment.continue) ? [] : [ slBegin ],
                continue: [ slContinue ],
                end: [ slEnd ]
            };
        } else {
            return {
                begin: [],
                continue: [ slContinue ],
                end: [ slEnd ]
            };
        }
    }
    return {
        begin: [],
        continue: [],
        end: []
    };
}
