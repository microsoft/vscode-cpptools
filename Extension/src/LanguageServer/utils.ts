/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { Range } from 'vscode-languageclient';
import { Location, TextEdit } from './commonTypes';

export function makeCpptoolsRange(vscRange: vscode.Range): Range {
    return { start: { line: vscRange.start.line, character: vscRange.start.character },
        end: { line: vscRange.end.line, character: vscRange.end.character } };
}

export function makeVscodeRange(cpptoolsRange: Range): vscode.Range {
    return new vscode.Range(cpptoolsRange.start.line, cpptoolsRange.start.character, cpptoolsRange.end.line, cpptoolsRange.end.character);
}

export function makeVscodeLocation(cpptoolsLocation: Location): vscode.Location {
    return new vscode.Location(vscode.Uri.parse(cpptoolsLocation.uri), makeVscodeRange(cpptoolsLocation.range));
}

export function makeVscodeTextEdits(cpptoolsTextEdits: TextEdit[]): vscode.TextEdit[] {
    return cpptoolsTextEdits.map(textEdit => new vscode.TextEdit(makeVscodeRange(textEdit.range), textEdit.newText));
}

export function rangeEquals(range1: vscode.Range | Range, range2: vscode.Range | Range): boolean {
    return range1.start.line === range2.start.line && range1.start.character === range2.start.character &&
    range1.end.line === range2.end.line && range1.end.character === range2.end.character;
}
