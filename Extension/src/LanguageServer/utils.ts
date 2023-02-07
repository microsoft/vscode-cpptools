/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { Range } from 'vscode-languageclient';
import { Location, TextEdit } from './commonTypes';
import { CppSettings } from './settings';
import * as os from 'os';

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

export function getFileFromPath(filePath: string): string {
    const slash: string = (os.platform() === 'win32') ? "\\" : "/";

    if (filePath.includes(slash)) {
        return filePath.split(slash).pop() ?? filePath;
    }
    return filePath;
}

// Check this before attempting to switch a document from C to C++.
export function shouldChangeFromCToCpp(document: vscode.TextDocument): boolean {
    if ((document.fileName.endsWith(".C") || document.fileName.endsWith(".H"))) {
        const cppSettings: CppSettings = new CppSettings();
        if (cppSettings.autoAddFileAssociations) {
            return !docsChangedFromCppToC.has(document.fileName);
        }
        // We could potentially add a new setting to enable switching to cpp even when files.associations isn't changed.
    }
    return false;
}

// Call this before changing from C++ to C.
export function handleChangedFromCppToC(document: vscode.TextDocument): void {
    if (shouldChangeFromCToCpp(document)) {
        docsChangedFromCppToC.add(document.fileName);
    }
}

const docsChangedFromCppToC: Set<string> = new Set<string>();
