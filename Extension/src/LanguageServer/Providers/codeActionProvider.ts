/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { Position, Range, RequestType, TextEdit } from 'vscode-languageclient';
import * as nls from 'vscode-nls';
import { DefaultClient } from '../client';
import {
    CodeActionCodeInfo, CodeActionDiagnosticInfo, codeAnalysisAllFixes, codeAnalysisCodeToFixes, codeAnalysisFileToCodeActions
} from '../codeAnalysis';
import { LocalizeStringParams, getLocalizedString } from '../localization';
import { CppSettings } from '../settings';
import { makeVscodeRange } from '../utils';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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
    range?: Range;
    disabledReason?: string;
}

interface GetCodeActionsResult {
    commands: CodeActionCommand[];
}

export const GetCodeActionsRequest: RequestType<GetCodeActionsRequestParams, GetCodeActionsResult, void> =
    new RequestType<GetCodeActionsRequestParams, GetCodeActionsResult, void>('cpptools/getCodeActions');

export class CodeActionProvider implements vscode.CodeActionProvider {
    private client: DefaultClient;
    constructor(client: DefaultClient) {
        this.client = client;
    }

    private static inlineMacroKind: vscode.CodeActionKind = vscode.CodeActionKind.RefactorInline.append("macro");
    private static extractToFunctionKind: vscode.CodeActionKind = vscode.CodeActionKind.RefactorExtract.append("function");
    private static expandSelectionKind: vscode.CodeActionKind = CodeActionProvider.extractToFunctionKind.append("expandSelection");

    public async provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext, token: vscode.CancellationToken): Promise<(vscode.Command | vscode.CodeAction)[]> {
        await this.client.ready;
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

        let response: GetCodeActionsResult = await this.client.languageClient.sendRequest(
            GetCodeActionsRequest, params, token);

        const resultCodeActions: vscode.CodeAction[] = [];
        if (token.isCancellationRequested || response.commands === undefined) {
            throw new vscode.CancellationError();
        }

        let hasSelectIntelliSenseConfiguration: boolean = false;
        const settings: CppSettings = new CppSettings(this.client.RootUri);
        const hasConfigurationSet: boolean = settings.defaultCompilerPath !== undefined ||
            !!settings.defaultCompileCommands || !!settings.defaultConfigurationProvider ||
            this.client.configuration.CurrentConfiguration?.compilerPath !== undefined ||
            !!this.client.configuration.CurrentConfiguration?.compileCommands ||
            !!this.client.configuration.CurrentConfiguration?.configurationProvider ||
            this.client.configuration.CurrentConfiguration?.compilerPathInCppPropertiesJson !== undefined ||
            !!this.client.configuration.CurrentConfiguration?.compileCommandsInCppPropertiesJson ||
            !!this.client.configuration.CurrentConfiguration?.configurationProviderInCppPropertiesJson;

        // Convert to vscode.CodeAction array
        let hasInlineMacro: boolean = false;
        const processCommand = (command: CodeActionCommand) => {
            let title: string = getLocalizedString(command.localizeStringParams);
            let wsEdit: vscode.WorkspaceEdit | undefined;
            let codeActionKind: vscode.CodeActionKind = vscode.CodeActionKind.QuickFix;
            if (command.edit) {
                wsEdit = new vscode.WorkspaceEdit();
                if (command.command === 'C_Cpp.AddMissingInclude') {
                    command.edit.newText += "\n";
                }
                wsEdit.replace(document.uri, makeVscodeRange(command.edit.range), command.edit.newText);
                if (command.command === "edit") {
                    // Inline macro feature.
                    codeActionKind = CodeActionProvider.inlineMacroKind;
                    hasInlineMacro = true;
                }
            } else if (command.command === "C_Cpp.RemoveAllCodeAnalysisProblems" && command.uri !== undefined) {
                // The "RemoveAll" message is sent for all code analysis squiggles.
                const vsCodeRange: vscode.Range = makeVscodeRange(r);
                const codeActionDiagnosticInfo: CodeActionDiagnosticInfo[] | undefined = codeAnalysisFileToCodeActions.get(command.uri);
                if (codeActionDiagnosticInfo === undefined) {
                    return;
                }
                const fixCodeActions: vscode.CodeAction[] = [];
                const disableCodeActions: vscode.CodeAction[] = [];
                const removeCodeActions: vscode.CodeAction[] = [];
                const docCodeActions: vscode.CodeAction[] = [];
                const showClear: string = new CppSettings().clangTidyCodeActionShowClear;

                // Check which code actions to show.  This can get called a lot
                // (after every cursor change) so all the checks should be relatively fast.
                for (const codeAction of codeActionDiagnosticInfo) {
                    if (!codeAction.range.contains(vsCodeRange)) {
                        continue;
                    }
                    let codeActionCodeInfo: CodeActionCodeInfo | undefined;
                    if (codeAnalysisCodeToFixes.has(codeAction.code)) {
                        codeActionCodeInfo = codeAnalysisCodeToFixes.get(codeAction.code);
                    }
                    if (codeAction.fixCodeAction !== undefined) {
                        // Potentially we could make the "fix all" or "fix all type" preferred instead.
                        codeAction.fixCodeAction.isPreferred = true;
                        fixCodeActions.push(codeAction.fixCodeAction);
                        if (codeActionCodeInfo !== undefined) {
                            if (codeActionCodeInfo.fixAllTypeCodeAction !== undefined &&
                                (codeActionCodeInfo.uriToInfo.size > 1 ||
                                    codeActionCodeInfo.uriToInfo.values().next().value.numValidWorkspaceEdits > 1)) {
                                // Only show the "fix all type" if there is more than one fix for the type.
                                fixCodeActions.push(codeActionCodeInfo.fixAllTypeCodeAction);
                            }
                        }
                    }
                    if (codeAction.removeCodeAction === undefined) {
                        continue;
                    }
                    let removeAllTypeAvailable: boolean = false;
                    if (codeActionCodeInfo !== undefined) {
                        if (codeActionCodeInfo.disableAllTypeCodeAction !== undefined) {
                            disableCodeActions.push(codeActionCodeInfo.disableAllTypeCodeAction);
                        }
                        if (codeActionCodeInfo.removeAllTypeCodeAction !== undefined &&
                            codeActionCodeInfo.uriToInfo.size > 0 &&
                            (codeActionCodeInfo.uriToInfo.size > 1 ||
                                codeActionCodeInfo.uriToInfo.values().next().value.identifiers.length > 1)) {
                            // Only show the "clear all type" if there is more than one fix for the type.
                            removeAllTypeAvailable = true;
                        }
                    }
                    if (showClear !== "None") {
                        if (!removeAllTypeAvailable || showClear === "AllAndAllTypeAndThis") {
                            // The "Clear this" command is useful when you need to manually fix
                            // some of the cases, and then run "fix all type" for the rest.
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
                    if (codeAnalysisAllFixes.fixAllCodeAction.command?.arguments?.[1] !== undefined) {
                        // Only show "fix all" if there are multiple types of fixes.
                        // The arguments[1] only gets set when there are multiple types.
                        resultCodeActions.push(codeAnalysisAllFixes.fixAllCodeAction);
                    }
                }
                if (showClear !== "None") {
                    let showClearAllAvailable: boolean = false;
                    if (codeActionDiagnosticInfo.length > 1 || codeAnalysisFileToCodeActions.size > 1) {
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
            } else if ((command.command === 'C_Cpp.CreateDeclarationOrDefinition' || command.command === 'C_Cpp.CopyDeclarationOrDefinition')
                && (command.arguments ?? []).length === 0 && command.range !== undefined) {
                command.arguments = [];
                command.arguments.push({ sender: 'codeAction', range: command.range });
            } else if (command.command === "C_Cpp.SelectIntelliSenseConfiguration") {
                command.arguments = ['codeAction'];
                hasSelectIntelliSenseConfiguration = true;
                if (hasConfigurationSet) {
                    return;
                }
            } else if (command.command === "C_Cpp.ConfigurationEdit" && hasSelectIntelliSenseConfiguration) {
                if (hasConfigurationSet) {
                    title = title.replace("includePath", "compilerPath");
                } else {
                    return;
                }
            } else if (command.command === "C_Cpp.ExtractToFunction" ||
                command.command === "C_Cpp.ExtractToMemberFunction") {
                codeActionKind = CodeActionProvider.extractToFunctionKind;
            } else if (command.command === "C_Cpp.ExtractToFreeFunction") {
                // TODO: https://github.com/microsoft/vscode-cpptools/issues/11473 needs to be fixed.
                return;
            } else if (command.command === "C_Cpp.ExpandSelection") {
                codeActionKind = CodeActionProvider.expandSelectionKind;
            }
            const vscodeCodeAction: vscode.CodeAction = {
                title: title,
                command: command.command === "edit" ? undefined : {
                    title: title,
                    command: command.command,
                    arguments: command.arguments
                },
                edit: wsEdit,
                kind: codeActionKind,
                disabled: command.disabledReason ? { reason: command.disabledReason } : undefined
            };
            resultCodeActions.push(vscodeCodeAction);
        };

        response.commands.forEach(processCommand);

        // If the refactor.inline.macro code action is specifically invoked by the user,
        // then force a hover to ensure that the "Expands to" info is available.
        if (!hasInlineMacro && context.only?.value === "refactor.inline.macro") {
            const processInlineMacro = async (): Promise<boolean> => {
                const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
                if (!editor) {
                    return false;
                }
                const result: vscode.Hover[] = (await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, range.start)) as vscode.Hover[];
                if (result.length === 0) {
                    return false;
                }
                const hoverResult: vscode.MarkdownString = result[0].contents[0] as vscode.MarkdownString;
                if (!hoverResult.value.includes(localize("expands.to", "Expands to:"))) {
                    return false;
                }
                response = await this.client.languageClient.sendRequest(GetCodeActionsRequest, params, token);
                if (token.isCancellationRequested || response.commands === undefined) {
                    return false;
                }
                for (const command of response.commands) {
                    if (command.edit) {
                        processCommand(command);
                        return true;
                    }
                }
                return false;
            };
            if (!await processInlineMacro()) {
                const disabledCodeAction: vscode.CodeAction = {
                    title: localize({ key: "inline.macro", comment: ["'Inline' is a command and not an adjective, i.e. like 'Expand macro'."] }, "Inline macro"),
                    kind: CodeActionProvider.inlineMacroKind,
                    disabled: { reason: localize("inline.macro.not.available", "Inline macro is not available at this location.") }
                };
                resultCodeActions.push(disabledCodeAction);
            }
        }
        return resultCodeActions;
    }
}
