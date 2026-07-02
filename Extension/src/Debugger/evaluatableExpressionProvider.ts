/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { computeEvaluatableExpression, EvaluatableExpressionInfo } from './evaluatableExpression';

// Provides the expression a C/C++ debug data-tip evaluates when hovering a variable. The actual
// computation lives in `evaluatableExpression.ts` (no vscode dependency) so it can be unit tested.
export class EvaluatableExpressionProvider implements vscode.EvaluatableExpressionProvider {
    public provideEvaluatableExpression(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.EvaluatableExpression> {
        const info: EvaluatableExpressionInfo | undefined = computeEvaluatableExpression(document.lineAt(position.line).text, position.character);
        if (info === undefined) {
            return undefined;
        }
        return new vscode.EvaluatableExpression(new vscode.Range(position.line, info.startColumn, position.line, info.endColumn), info.expression);
    }
}
