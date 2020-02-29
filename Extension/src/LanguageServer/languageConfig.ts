/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CppSettings } from './settings';
import { getOutputChannel } from '../logger';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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
        let continuePattern: string | undefined = getMLContinuePattern(comment.continue);
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
        let endPattern: string | undefined = getMLEndPattern(comment.continue);
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
        let endPattern: string | undefined = getMLEmptyEndPattern(comment.continue);
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
        let continuePattern: string | undefined = getSLBeginPattern(comment.begin);
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
        let continuePattern: string | undefined = getSLContinuePattern(comment.continue);
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
        let endPattern: string | undefined = getSLEndPattern(comment.continue);
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
    let patterns: (string | CommentPattern)[] | undefined = settings.commentContinuationPatterns;
    return getLanguageConfigFromPatterns(languageId, patterns);
}

export function getLanguageConfigFromPatterns(languageId: string, patterns?: (string | CommentPattern)[]): vscode.LanguageConfiguration {
    let beginPatterns: string[] = [];       // avoid duplicate rules
    let continuePatterns: string[] = [];    // avoid duplicate rules
    let duplicates: boolean = false;
    let beginRules: vscode.OnEnterRule[] = [];
    let continueRules: vscode.OnEnterRule[] = [];
    let endRules: vscode.OnEnterRule[] = [];
    if (!patterns) {
        patterns = [ "/**" ];
    }
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
        getOutputChannel().appendLine(localize("duplicate.multiline.patterns", "Duplicate multiline comment patterns detected."));
    }
    return { onEnterRules: beginRules.concat(continueRules).concat(endRules).filter(e => (e)) };    // Remove any 'undefined' entries
}

function constructCommentRules(comment: CommentPattern, languageId: string): Rules {
    if (comment && comment.begin && comment.begin.startsWith('/*') && (languageId === 'c' || languageId === 'cpp')) {
        let mlBegin1: vscode.OnEnterRule | undefined = getMLSplitRule(comment);
        if (!mlBegin1) {
            throw new Error("Failure in constructCommentRules() - mlBegin1");
        }
        let mlBegin2: vscode.OnEnterRule | undefined = getMLFirstLineRule(comment);
        if (!mlBegin2) {
            throw new Error("Failure in constructCommentRules() - mlBegin2");
        }
        let mlContinue: vscode.OnEnterRule | undefined = getMLContinuationRule(comment);
        if (!mlContinue) {
            throw new Error("Failure in constructCommentRules() - mlContinue");
        }
        let mlEnd1: vscode.OnEnterRule | undefined = getMLEmptyEndRule(comment);
        if (!mlEnd1) {
            throw new Error("Failure in constructCommentRules() - mlEnd1");
        }
        let mlEnd2: vscode.OnEnterRule | undefined = getMLEndRule(comment);
        if (!mlEnd2) {
            throw new Error("Failure in constructCommentRules() = mlEnd2");
        }
        return {
            begin: [ mlBegin1, mlBegin2 ],
            continue: [ mlContinue ],
            end: [ mlEnd1, mlEnd2 ]
        };
    } else if (comment && comment.begin && comment.begin.startsWith('//') && languageId === 'cpp') {
        let slContinue: vscode.OnEnterRule | undefined = getSLContinuationRule(comment);
        if (!slContinue) {
            throw new Error("Failure in constructCommentRules() - slContinue");
        }
        let slEnd: vscode.OnEnterRule | undefined = getSLEndRule(comment);
        if (!slEnd) {
            throw new Error("Failure in constructCommentRules() - slEnd");
        }
        if (comment.begin !== comment.continue) {
            let slBegin: vscode.OnEnterRule | undefined = getSLFirstLineRule(comment);
            if (!slBegin) {
                throw new Error("Failure in constructCommentRules() - slBegin");
            }
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
