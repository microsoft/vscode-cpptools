/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';

// VS Code's default data-tip keeps a leading `*`/`&` and clips on the right, so hovering an
// intermediate member of e.g. `*a.b.c` evaluates `*a.b` (deref of the struct `a.b`, which is of course wrong)
// That's why the leading operator needs to be dropped for that case.
export class EvaluatableExpressionProvider implements vscode.EvaluatableExpressionProvider {
    public provideEvaluatableExpression(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.EvaluatableExpression> {
        const line: string = document.lineAt(position.line).text;
        // The same token the default uses: a run of expression characters (brackets, operators
        // and whitespace excluded), with `->` allowed.
        const tokenRegExp: RegExp = /(?:[^()[\]{}<>\s+\-/%~#^;=|,`!]|->)+/g;
        let token: RegExpExecArray | null = null;
        for (let m: RegExpExecArray | null = tokenRegExp.exec(line); m !== null; m = tokenRegExp.exec(line)) {
            if (m.index <= position.character && position.character <= m.index + m[0].length) {
                token = m;
                break;
            }
        }
        if (token === null) {
            return undefined;
        }
        const leading: RegExpMatchArray | null = token[0].match(/^[*&]+/);
        if (leading === null) {
            return undefined; // No leading dereference/address-of: use the default.
        }
        const tokenStart: number = token.index;
        const tokenEnd: number = token.index + token[0].length;
        // Right-clip to the identifier the cursor is on, mirroring the default.
        let clipEnd: number = tokenEnd;
        const wordRegExp: RegExp = /[\p{L}\p{N}_]+/gu;
        for (let w: RegExpExecArray | null = wordRegExp.exec(token[0]); w !== null; w = wordRegExp.exec(token[0])) {
            clipEnd = tokenStart + w.index + w[0].length;
            if (clipEnd >= position.character) {
                break;
            }
        }
        // Only act when the cursor is on an intermediate member (the clipped expression is a
        // proper prefix). If it is on the final segment, the leading operator legitimately
        // applies to the whole expression, so defer to the default.
        const exprStart: number = tokenStart + leading[0].length;
        if (clipEnd >= tokenEnd || clipEnd <= exprStart) {
            return undefined;
        }
        const expression: string = line.substring(exprStart, clipEnd);
        return new vscode.EvaluatableExpression(new vscode.Range(position.line, exprStart, position.line, clipEnd), expression);
    }
}
