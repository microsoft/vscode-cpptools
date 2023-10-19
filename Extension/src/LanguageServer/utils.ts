/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as os from 'os';
import * as vscode from 'vscode';
import { Range } from 'vscode-languageclient';
import { SessionState } from '../sessionState';
import { Location, TextEdit } from './commonTypes';
import { CppSettings } from './settings';

export function makeLspRange(vscRange: vscode.Range): Range {
    return {
        start: { line: vscRange.start.line, character: vscRange.start.character },
        end: { line: vscRange.end.line, character: vscRange.end.character }
    };
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

// Check this before attempting to switch a document from C to C++.
export function shouldChangeFromCToCpp(document: vscode.TextDocument): boolean {
    if (document.fileName.endsWith(".C") || document.fileName.endsWith(".H")) {
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

export function showInstallCompilerWalkthrough(): void {
    // Because we need to conditionally enable/disable steps to alter their contents,
    // we need to determine which step is actually visible. If the steps change, this
    // logic will need to change to reflect them.
    enum Step {
        Activation = 'awaiting.activation',
        NoCompilers = 'no.compilers.found',
        Verify = 'verify.compiler'
    }

    const step = (() => {
        if (!SessionState.scanForCompilersDone.get()) {
            return Step.Activation;
        } else if (!SessionState.trustedCompilerFound.get()) {
            return Step.NoCompilers;
        } else {
            return Step.Verify;
        }
    })();

    const platform = (() => {
        switch (os.platform()) {
            case 'win32': return 'windows';
            case 'darwin': return 'mac';
            default: return 'linux';
        }
    })();

    const version = (platform === 'windows') ? SessionState.windowsVersion.get() : '';

    const index = `ms-vscode.cpptools#${step}.${platform}${version}`;

    void vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        { category: 'ms-vscode.cpptools#cppWelcome', step: index },
        false)
        // Run it twice for now because of VS Code bug #187958
        .then(() => vscode.commands.executeCommand(
            "workbench.action.openWalkthrough",
            { category: 'ms-vscode.cpptools#cppWelcome', step: index },
            false)
        );
    return;
}

const docsChangedFromCppToC: Set<string> = new Set<string>();
