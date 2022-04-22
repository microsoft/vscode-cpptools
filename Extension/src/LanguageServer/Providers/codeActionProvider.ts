/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import {  Position, Range, RequestType, TextEdit } from 'vscode-languageclient';
import * as util from '../../common';
import { CodeActionCodeInfo, CodeActionDiagnosticInfo, codeAnalysisFileToCodeActions, codeAnalysisCodeToFixes,
    codeAnalysisAllFixes, DefaultClient, vscodeRange } from '../client';
import { CppSettings } from '../settings';

type LocalizeStringParams = util.LocalizeStringParams;

interface GetCodeActionsRequestParams {
    uri: string;
    range: Range;
}

interface CodeActionCommand {
    localizeStringParams: LocalizeStringParams;
    command: string;
    arguments?: any[];
    edit?: TextEdit;
    uri?: string;
}

export const GetCodeActionsRequest: RequestType<GetCodeActionsRequestParams, CodeActionCommand[], void, void> =
    new RequestType<GetCodeActionsRequestParams, CodeActionCommand[], void, void>('cpptools/getCodeActions');

export class CodeActionProvider implements vscode.CodeActionProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext, token: vscode.CancellationToken): Promise<(vscode.Command | vscode.CodeAction)[]> {
        return this.client.requestWhenReady(async () => {
            let r: Range;
            if (range instanceof vscode.Selection) {
                if (range.active.isBefore(range.anchor)) {
                    r = Range.create(Position.create(range.active.line, range.active.character),
                        Position.create(range.anchor.line, range.anchor.character));
                } else {
                    r = Range.create(Position.create(range.anchor.line, range.anchor.character),
                        Position.create(range.active.line, range.active.character));
                }
            } else {
                r = Range.create(Position.create(range.start.line, range.start.character),
                    Position.create(range.end.line, range.end.character));
            }

            const params: GetCodeActionsRequestParams = {
                range: r,
                uri: document.uri.toString()
            };

            const commands: CodeActionCommand[] = await this.client.languageClient.sendRequest(
                GetCodeActionsRequest, params, token);
            const resultCodeActions: vscode.CodeAction[] = [];

            // Convert to vscode.CodeAction array
            commands.forEach((command) => {
                const title: string = util.getLocalizedString(command.localizeStringParams);
                let wsEdit: vscode.WorkspaceEdit | undefined;
                let codeActionKind: vscode.CodeActionKind = vscode.CodeActionKind.QuickFix;
                if (command.edit) {
                    codeActionKind = vscode.CodeActionKind.RefactorInline;
                    wsEdit = new vscode.WorkspaceEdit();
                    wsEdit.replace(document.uri, vscodeRange(command.edit.range), command.edit.newText);
                } else if (command.command === "C_Cpp.RemoveAllCodeAnalysisProblems" && command.uri !== undefined) {
                    const vsCodeRange: vscode.Range = vscodeRange(r);
                    const codeActions: CodeActionDiagnosticInfo[] | undefined = codeAnalysisFileToCodeActions.get(command.uri);
                    if (codeActions === undefined) {
                        return;
                    }
                    const fixCodeActions: vscode.CodeAction[] = [];
                    const disableCodeActions: vscode.CodeAction[] = [];
                    const removeCodeActions: vscode.CodeAction[] = [];
                    const docCodeActions: vscode.CodeAction[] = [];
                    const showClear: string = new CppSettings().clangTidyCodeActionShowClear;
                    for (const codeAction of codeActions) {
                        if (!codeAction.range.contains(vsCodeRange)) {
                            continue;
                        }
                        let codeActionCodeInfo: CodeActionCodeInfo | undefined;
                        if (codeAnalysisCodeToFixes.has(codeAction.code)) {
                            codeActionCodeInfo = codeAnalysisCodeToFixes.get(codeAction.code);
                        }
                        if (codeAction.fixCodeAction !== undefined) {
                            codeAction.fixCodeAction.isPreferred = true;
                            fixCodeActions.push(codeAction.fixCodeAction);
                            if (codeActionCodeInfo !== undefined) {
                                if (codeActionCodeInfo.fixAllTypeCodeAction !== undefined &&
                                    (codeActionCodeInfo.uriToInfo.size > 1 ||
                                    codeActionCodeInfo.uriToInfo.values().next().value.workspaceEdits?.length > 1)) {
                                    fixCodeActions.push(codeActionCodeInfo.fixAllTypeCodeAction);
                                }
                            }
                        }
                        let removeAllTypeAvailable: boolean = false;
                        if (codeActionCodeInfo !== undefined) {
                            if (codeActionCodeInfo.disableAllTypeCodeAction !== undefined) {
                                disableCodeActions.push(codeActionCodeInfo.disableAllTypeCodeAction);
                            }
                            if (codeActionCodeInfo.removeAllTypeCodeAction !== undefined &&
                                (codeActionCodeInfo.uriToInfo.size > 1 ||
                                codeActionCodeInfo.uriToInfo.values().next().value.identifiers.length > 1)) {
                                removeAllTypeAvailable = true;
                            }
                        }
                        if (showClear !== "None") {
                            if (!removeAllTypeAvailable || showClear === "AllAndAllTypeAndThis") {
                                removeCodeActions.push(codeAction.removeCodeAction);
                            }
                            if (removeAllTypeAvailable && codeActionCodeInfo?.removeAllTypeCodeAction) {
                                removeCodeActions.push(codeActionCodeInfo.removeAllTypeCodeAction);
                            }
                        }

                        if (codeActionCodeInfo === undefined || codeActionCodeInfo.docCodeAction === undefined) {
                            continue;
                        }
                        docCodeActions.push(codeActionCodeInfo.docCodeAction);
                    }
                    if (fixCodeActions.length > 0) {
                        resultCodeActions.push(...fixCodeActions);
                        if (codeAnalysisAllFixes.fixAllCodeAction.edit !== undefined) {
                            resultCodeActions.push(codeAnalysisAllFixes.fixAllCodeAction);
                        }
                    }
                    if (showClear !== "None") {
                        let showClearAllAvailable: boolean = false;
                        if ((codeActions.length > 1 || codeAnalysisFileToCodeActions.size > 1)) {
                            showClearAllAvailable = true;
                        }
                        if (!showClearAllAvailable || showClear !== "AllOnly") {
                            resultCodeActions.push(...removeCodeActions);
                        }
                        if (showClearAllAvailable) {
                            resultCodeActions.push(codeAnalysisAllFixes.removeAllCodeAction);
                        }
                    }
                    resultCodeActions.push(...disableCodeActions);
                    resultCodeActions.push(...docCodeActions);
                    return;
                }
                const vscodeCodeAction: vscode.CodeAction = {
                    title: title,
                    command: command.command === "edit" ? undefined : {
                        title: title,
                        command: command.command,
                        arguments: command.arguments
                    },
                    edit: wsEdit,
                    kind: codeActionKind
                };
                resultCodeActions.push(vscodeCodeAction);
            });
            return resultCodeActions;
        });
    }
}
