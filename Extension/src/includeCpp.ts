/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const regex: RegExp = /(#)(i)(n)(c)(l)(u)(d)(e)(\s+)(<)([Cc])(\+)(\+)(>)/;

const decorationTypes: (vscode.TextEditorDecorationType | undefined)[] = [
    // These colors come from the HSV color space. S and V are both 100% and H
    // H is incremented by 360 / 14 degrees for each color, providing a unique
    // color for each of the 14 capture groups. The one missing color represents
    // the space between the include and the header name.
    "#FF0000",
    "#FF6D00",
    "#FFDB00",
    "#B6FF00",
    "#49FF00",
    "#00FF24",
    "#00FF92",
    "#00FFFF",
    undefined,
    "#4C6AFF", // S changed to 70 to improve contrast
    "#7F4CFF", // S changed to 70 to improve contrast
    "#B600FF",
    "#FF00DB",
    "#FF006D"
].map((color: string | undefined) =>
    color === undefined ? undefined
        : vscode.window.createTextEditorDecorationType({
            color,
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        }));

const hoverMessage: vscode.MarkdownString = new vscode.MarkdownString(
    localize(
        "includecpp.hover",
        "[#include <C++>](https://www.includecpp.org/) is a global, inclusive, and diverse community for developers interested in C++."
    )
);

function updateDecorationsForEditor(editor: vscode.TextEditor): void {
    const document: vscode.TextDocument = editor.document;
    const content: string = document.getText(
        new vscode.Range(new vscode.Position(0, 0), document.positionAt(4096)));
    const match: RegExpMatchArray | null = content.match(regex);
    if (!match || match.index === undefined) {
        return;
    }

    let offset: number = match.index;
    for (let i: number = 1; i < match.length; ++i) {
        const start: vscode.Position = document.positionAt(offset);
        offset += match[i].length;
        const end: vscode.Position = document.positionAt(offset);

        // Subtract one because the regex match array includes the entire match
        // at index zero.
        const decoration: vscode.TextEditorDecorationType | undefined =
            decorationTypes[i - 1];
        if (decoration) {
            editor.setDecorations(decoration, [{
                range: new vscode.Range(start, end),
                hoverMessage
            }]);
        }
    }

    return;
}

export function activate(context: vscode.ExtensionContext): void {
    vscode.workspace.onDidChangeTextDocument((event) => {
        vscode.window.visibleTextEditors
            .filter((editor) => editor.document === event.document)
            .forEach(updateDecorationsForEditor);
    }, undefined, context.subscriptions);
    vscode.window.onDidChangeActiveTextEditor(
        (editor) => { if (editor) { updateDecorationsForEditor(editor); } },
        undefined, context.subscriptions);
    vscode.window.visibleTextEditors.forEach(updateDecorationsForEditor);
}
