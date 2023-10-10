/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { LanguageClient, NotificationType, Range } from 'vscode-languageclient/node';
import * as nls from 'vscode-nls';
import { Location, WorkspaceEdit } from './commonTypes';
import { CppSourceStr } from './extension';
import { LocalizeStringParams, getLocalizedString } from './localization';
import { CppSettings } from './settings';
import { makeVscodeLocation, makeVscodeRange, makeVscodeTextEdits, rangeEquals } from './utils';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

let diagnosticsCollectionCodeAnalysis: vscode.DiagnosticCollection;

export function RegisterCodeAnalysisNotifications(languageClient: LanguageClient): void {
    languageClient.onNotification(PublishCodeAnalysisDiagnosticsNotification, publishCodeAnalysisDiagnostics);
    languageClient.onNotification(PublishRemoveCodeAnalysisCodeActionFixesNotification, publishRemoveCodeAnalysisCodeActionFixes);
}

export interface CodeActionDiagnosticInfo {
    version: number; // Needed due to https://github.com/microsoft/vscode/issues/148723 .

    // Used to work around https://github.com/microsoft/vscode/issues/126393.
    // If that bug were fixed, then we could use the vscode.CodeAction.diagnostic directly.
    range: vscode.Range;
    code: string;

    fixCodeAction?: vscode.CodeAction;
    // suppressCodeAction?: vscode.CodeAction; // TODO?
    removeCodeAction?: vscode.CodeAction;
}

// Used to handle fix invalidation after an edit,
// i.e. it's set to undefined if it becomes invalid.
interface CodeActionWorkspaceEdit {
    workspaceEdit?: vscode.WorkspaceEdit;
}

interface CodeActionPerUriInfo {
    // These two arrays have the same length, i.e. index i of identifiers
    // is used to index into workspaceEdits to get the corresponding edit.
    identifiers: CodeAnalysisDiagnosticIdentifier[];
    workspaceEdits?: CodeActionWorkspaceEdit[];

    // Used to quickly determine how many non-undefined entries are in "workspaceEdits"
    // (so the array doesn't have to be iterated through).
    numValidWorkspaceEdits: number;
}

// Tracks the "type" code actions (i.e. "code" is a synonym for "type" in this context).
export interface CodeActionCodeInfo {
    version: number; // Needed due to https://github.com/microsoft/vscode/issues/148723 .

    // Needed to quickly update the "type" action for a file.
    uriToInfo: Map<string, CodeActionPerUriInfo>;

    fixAllTypeCodeAction?: vscode.CodeAction;
    disableAllTypeCodeAction?: vscode.CodeAction;
    removeAllTypeCodeAction?: vscode.CodeAction;
    docCodeAction?: vscode.CodeAction;
}

interface CodeActionAllInfo {
    version: number; // Needed due to https://github.com/microsoft/vscode/issues/148723 .
    fixAllCodeAction: vscode.CodeAction;
    removeAllCodeAction: vscode.CodeAction;
}

interface CodeAnalysisDiagnosticRelatedInformation {
    location: Location;
    message: string;
    workspaceEdits?: WorkspaceEdit[];
}

interface CodeAnalysisDiagnostic {
    range: Range;
    code: string;
    severity: vscode.DiagnosticSeverity;
    localizeStringParams: LocalizeStringParams;
    relatedInformation?: CodeAnalysisDiagnosticRelatedInformation[];
    workspaceEdits?: WorkspaceEdit[];
}

interface CodeAnalysisDiagnosticIdentifier {
    range: Range;
    code: string;
}

export interface CodeAnalysisDiagnosticIdentifiersAndUri {
    uri: string;
    identifiers: CodeAnalysisDiagnosticIdentifier[];
}

export interface RemoveCodeAnalysisProblemsParams {
    identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[];
    refreshSquigglesOnSave: boolean;
}

interface RemoveCodeAnalysisCodeActionFixesParams {
    identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[];
}

interface PublishCodeAnalysisDiagnosticsParams {
    uri: string;
    diagnostics: CodeAnalysisDiagnostic[];
}

const PublishCodeAnalysisDiagnosticsNotification: NotificationType<PublishCodeAnalysisDiagnosticsParams> = new NotificationType<PublishCodeAnalysisDiagnosticsParams>('cpptools/publishCodeAnalysisDiagnostics');
const PublishRemoveCodeAnalysisCodeActionFixesNotification: NotificationType<RemoveCodeAnalysisCodeActionFixesParams> = new NotificationType<RemoveCodeAnalysisCodeActionFixesParams>('cpptools/publishRemoveCodeAnalysisCodeActionFixes');

export const codeAnalysisFileToCodeActions: Map<string, CodeActionDiagnosticInfo[]> = new Map<string, CodeActionDiagnosticInfo[]>();
export const codeAnalysisCodeToFixes: Map<string, CodeActionCodeInfo> = new Map<string, CodeActionCodeInfo>();
export const codeAnalysisAllFixes: CodeActionAllInfo = {
    version: 0,
    fixAllCodeAction: {
        title: localize("fix.all.code.analysis.problems", "Fix all code analysis problems"),
        command: {
            title: 'FixAllCodeAnalysisProblems',
            command: 'C_Cpp.FixAllCodeAnalysisProblems',
            arguments: [ 0, undefined, true, [] ]
        },
        kind: vscode.CodeActionKind.QuickFix
    },
    removeAllCodeAction: {
        title: localize("clear.all.code.analysis.problems", "Clear all code analysis problems"),
        command: { title: "RemoveAllCodeAnalysisProblems", command: "C_Cpp.RemoveAllCodeAnalysisProblems" },
        kind: vscode.CodeActionKind.QuickFix
    }
};

// Rebuild codeAnalysisCodeToFixes and codeAnalysisAllFixes.fixAllCodeActions.
function rebuildCodeAnalysisCodeAndAllFixes(): void {
    if (codeAnalysisAllFixes.fixAllCodeAction.command?.arguments !== undefined) {
        codeAnalysisAllFixes.fixAllCodeAction.command.arguments[0] = ++codeAnalysisAllFixes.version;
        codeAnalysisAllFixes.fixAllCodeAction.command.arguments[1] = undefined;
        codeAnalysisAllFixes.fixAllCodeAction.command.arguments[3] = [];
    }

    const identifiersAndUrisForAllFixes: CodeAnalysisDiagnosticIdentifiersAndUri[] = [];
    const uriToEditsForAll: Map<vscode.Uri, vscode.TextEdit[]> = new Map<vscode.Uri, vscode.TextEdit[]>();
    let numFixTypes: number = 0;
    for (const codeToFixes of codeAnalysisCodeToFixes) {
        const identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[] = [];
        const uriToEdits: Map<vscode.Uri, vscode.TextEdit[]> = new Map<vscode.Uri, vscode.TextEdit[]>();
        codeToFixes[1].uriToInfo.forEach((perUriInfo: CodeActionPerUriInfo, uri: string) => {
            const newIdentifiersAndUri: CodeAnalysisDiagnosticIdentifiersAndUri = { uri: uri, identifiers: perUriInfo.identifiers };
            identifiersAndUris.push(newIdentifiersAndUri);
            if (perUriInfo.workspaceEdits === undefined || perUriInfo.numValidWorkspaceEdits === 0) {
                return;
            }
            identifiersAndUrisForAllFixes.push(newIdentifiersAndUri);
            for (const edit of perUriInfo.workspaceEdits) {
                if (edit.workspaceEdit === undefined) {
                    continue;
                }
                for (const [uri, edits] of edit.workspaceEdit.entries()) {
                    const textEdits: vscode.TextEdit[] = uriToEdits.get(uri) ?? [];
                    textEdits.push(...edits);
                    uriToEdits.set(uri, textEdits);
                    const textEditsForAll: vscode.TextEdit[] = uriToEditsForAll.get(uri) ?? [];
                    textEditsForAll.push(...edits);
                    uriToEditsForAll.set(uri, textEdits);
                }
            }
        });
        if (uriToEdits.size > 0) {
            const allTypeWorkspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
            for (const [uri, edits] of uriToEdits.entries()) {
                allTypeWorkspaceEdit.set(uri, edits);
            }
            ++numFixTypes;
            codeToFixes[1].fixAllTypeCodeAction = {
                title: localize("fix.all.type.problems", "Fix all {0} problems", codeToFixes[0]),
                command: {
                    title: 'FixAllTypeCodeAnalysisProblems',
                    command: 'C_Cpp.FixAllTypeCodeAnalysisProblems',
                    arguments: [ codeToFixes[0], ++codeToFixes[1].version, allTypeWorkspaceEdit, true, identifiersAndUris ]
                },
                kind: vscode.CodeActionKind.QuickFix
            };
        }

        if (new CppSettings().clangTidyCodeActionShowDisable) {
            codeToFixes[1].disableAllTypeCodeAction = {
                title: localize("disable.all.type.problems", "Disable all {0} problems", codeToFixes[0]),
                command: {
                    title: 'DisableAllTypeCodeAnalysisProblems',
                    command: 'C_Cpp.DisableAllTypeCodeAnalysisProblems',
                    arguments: [ codeToFixes[0], identifiersAndUris ]
                },
                kind: vscode.CodeActionKind.QuickFix
            };
        } else {
            codeToFixes[1].disableAllTypeCodeAction = undefined;
        }

        if (new CppSettings().clangTidyCodeActionShowClear !== "None") {
            codeToFixes[1].removeAllTypeCodeAction = {
                title: localize("clear.all.type.problems", "Clear all {0} problems", codeToFixes[0]),
                command: {
                    title: 'RemoveAllTypeCodeAnalysisProblems',
                    command: 'C_Cpp.RemoveCodeAnalysisProblems',
                    arguments: [ false, identifiersAndUris ]
                },
                kind: vscode.CodeActionKind.QuickFix
            };
        }
    }
    if (numFixTypes > 1) {
        const allWorkspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
        for (const [uri, edits] of uriToEditsForAll.entries()) {
            allWorkspaceEdit.set(uri, edits);
        }
        if (codeAnalysisAllFixes.fixAllCodeAction.command?.arguments !== undefined) {
            codeAnalysisAllFixes.fixAllCodeAction.command.arguments[1] = allWorkspaceEdit;
            codeAnalysisAllFixes.fixAllCodeAction.command.arguments[3] = identifiersAndUrisForAllFixes;
        }
    } else {
        if (codeAnalysisAllFixes.fixAllCodeAction.command?.arguments !== undefined) {
            codeAnalysisAllFixes.fixAllCodeAction.command.arguments[1] = undefined;
        }
    }
}

export function publishCodeAnalysisDiagnostics(params: PublishCodeAnalysisDiagnosticsParams): void {
    if (!diagnosticsCollectionCodeAnalysis) {
        diagnosticsCollectionCodeAnalysis = vscode.languages.createDiagnosticCollection("clang-tidy");
    }

    // Convert from our Diagnostic objects to vscode Diagnostic objects
    const diagnosticsCodeAnalysis: vscode.Diagnostic[] = [];
    const realUri: vscode.Uri = vscode.Uri.parse(params.uri);

    // Reset codeAnalysisCodeToFixes for the file.
    for (const codeToFixes of codeAnalysisCodeToFixes) {
        ++codeToFixes[1].version;
        if (codeToFixes[1].uriToInfo.has(params.uri)) {
            codeToFixes[1].uriToInfo.delete(params.uri);
        }
    }

    const previousDiagnostics: CodeActionDiagnosticInfo[] | undefined = codeAnalysisFileToCodeActions.get(params.uri);
    let nextVersion: number = 0;
    if (previousDiagnostics !== undefined) {
        for (const diagnostic of previousDiagnostics) {
            if (diagnostic.version > nextVersion) {
                nextVersion = diagnostic.version;
            }
        }
    }
    ++nextVersion;
    const codeActionDiagnosticInfo: CodeActionDiagnosticInfo[] = [];
    for (const d of params.diagnostics) {
        const diagnostic: vscode.Diagnostic = new vscode.Diagnostic(makeVscodeRange(d.range),
            getLocalizedString(d.localizeStringParams), d.severity);
        const identifier: CodeAnalysisDiagnosticIdentifier = { range: d.range, code: d.code };
        const identifiersAndUri: CodeAnalysisDiagnosticIdentifiersAndUri = { uri: params.uri, identifiers: [ identifier ] };
        const codeAction: CodeActionDiagnosticInfo = {
            version: nextVersion,
            range: makeVscodeRange(identifier.range),
            code: identifier.code,
            removeCodeAction: {
                title: localize("clear.this.problem", "Clear this {0} problem", d.code),
                command: {
                    title: 'RemoveCodeAnalysisProblems',
                    command: 'C_Cpp.RemoveCodeAnalysisProblems',
                    arguments: [ false, [ identifiersAndUri ] ]
                },
                kind: vscode.CodeActionKind.QuickFix
            }
        };
        const codeActionWorkspaceEdit: CodeActionWorkspaceEdit = {};
        if (d.workspaceEdits) {
            codeActionWorkspaceEdit.workspaceEdit = new vscode.WorkspaceEdit();
            for (const workspaceEdit of d.workspaceEdits) {
                codeActionWorkspaceEdit.workspaceEdit.set(vscode.Uri.parse(workspaceEdit.file, true), makeVscodeTextEdits(workspaceEdit.edits));
            }
            const fixThisCodeAction: vscode.CodeAction = {
                title: localize("fix.this.problem", "Fix this {0} problem", d.code),
                command: {
                    title: 'FixThisCodeAnalysisProblem',
                    command: 'C_Cpp.FixThisCodeAnalysisProblem',
                    arguments: [ nextVersion, codeActionWorkspaceEdit.workspaceEdit, true, [ identifiersAndUri ] ]
                },
                kind: vscode.CodeActionKind.QuickFix
            };
            codeAction.fixCodeAction = fixThisCodeAction;
        }

        // Edits from clang-tidy can be associated with the related information instead of the root diagnostic.
        const relatedCodeActions: CodeActionDiagnosticInfo[] = [];
        const rootAndRelatedWorkspaceEdits: CodeActionWorkspaceEdit[] = [];
        const rootAndRelatedIdentifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[] = [];
        rootAndRelatedIdentifiersAndUris.push(identifiersAndUri);
        if (codeActionWorkspaceEdit.workspaceEdit !== undefined) {
            rootAndRelatedWorkspaceEdits.push(codeActionWorkspaceEdit);
        }
        if (d.relatedInformation) {
            diagnostic.relatedInformation = [];
            for (const info of d.relatedInformation) {
                diagnostic.relatedInformation.push(new vscode.DiagnosticRelatedInformation(makeVscodeLocation(info.location), info.message));
                if (info.workspaceEdits === undefined) {
                    continue;
                }
                const relatedWorkspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
                for (const workspaceEdit of info.workspaceEdits) {
                    relatedWorkspaceEdit.set(vscode.Uri.parse(workspaceEdit.file, true), makeVscodeTextEdits(workspaceEdit.edits));
                }
                const relatedIdentifier: CodeAnalysisDiagnosticIdentifier = { range: info.location.range, code: d.code };
                const relatedIdentifiersAndUri: CodeAnalysisDiagnosticIdentifiersAndUri = {
                    uri: info.location.uri, identifiers: [ relatedIdentifier ] };
                const relatedCodeAction: vscode.CodeAction = {
                    title: localize("fix.this.problem", "Fix this {0} problem", d.code),
                    command: {
                        title: 'FixThisCodeAnalysisProblem',
                        command: 'C_Cpp.FixThisCodeAnalysisProblem',
                        arguments: [ nextVersion, relatedWorkspaceEdit, true, [ relatedIdentifiersAndUri ] ]
                    },
                    kind: vscode.CodeActionKind.QuickFix
                };
                if (codeAction.fixCodeAction === undefined) {
                    codeAction.fixCodeAction = relatedCodeAction;
                } else {
                    const relatedCodeActionInfo: CodeActionDiagnosticInfo = {
                        version: nextVersion,
                        range: makeVscodeRange(relatedIdentifier.range),
                        code: relatedIdentifier.code,
                        fixCodeAction: relatedCodeAction
                    };
                    relatedCodeActions.push(relatedCodeActionInfo);
                }
                rootAndRelatedWorkspaceEdits.push({ workspaceEdit: relatedWorkspaceEdit});
                rootAndRelatedIdentifiersAndUris.push(relatedIdentifiersAndUri);
            }
        }
        if (identifier.code.length !== 0) {
            const codeActionCodeInfo: CodeActionCodeInfo = codeAnalysisCodeToFixes.get(identifier.code) ??
                { version: 0, uriToInfo: new Map<string, CodeActionPerUriInfo>() };
            let rootAndRelatedWorkspaceEditsIndex: number = 0;
            for (const rootAndRelatedIdentifiersAndUri of rootAndRelatedIdentifiersAndUris) {
                const existingInfo: CodeActionPerUriInfo = codeActionCodeInfo.uriToInfo.get(rootAndRelatedIdentifiersAndUri.uri) ??
                    { identifiers: [], numValidWorkspaceEdits: 0 };
                existingInfo.identifiers.push(...rootAndRelatedIdentifiersAndUri.identifiers);
                const rootAndRelatedWorkspaceEdit: CodeActionWorkspaceEdit = rootAndRelatedWorkspaceEdits[rootAndRelatedWorkspaceEditsIndex];
                if (rootAndRelatedWorkspaceEdit !== undefined) {
                    if (existingInfo.workspaceEdits === undefined) {
                        existingInfo.workspaceEdits = [ rootAndRelatedWorkspaceEdit ];
                    } else {
                        existingInfo.workspaceEdits.push(rootAndRelatedWorkspaceEdit);
                    }
                    ++existingInfo.numValidWorkspaceEdits;
                }
                codeActionCodeInfo.uriToInfo.set(rootAndRelatedIdentifiersAndUri.uri, existingInfo);
                ++rootAndRelatedWorkspaceEditsIndex;
            }
            if (!identifier.code.startsWith("clang-diagnostic-")) {
                const codes: string[] = identifier.code.split(',');
                let codeIndex: number = codes.length - 1;
                if (codes[codeIndex] === "cert-dcl51-cpp") { // Handle aliasing
                    codeIndex = 0;
                }
                // TODO: Is the ideal code always selected as the primary one?
                const primaryCode: string = codes[codeIndex];
                let docPage: string;
                if (primaryCode === "clang-tidy-nolint") {
                    docPage = "index.html#suppressing-undesired-diagnostics";
                } else {
                    const clangAnalyzerString: string = "clang-analyzer";
                    const clangAnalyzerIndex: number = primaryCode.indexOf(clangAnalyzerString);
                    const dashIndex: number = clangAnalyzerIndex === 0 ? clangAnalyzerString.length : primaryCode.indexOf("-");
                    const checksGroup: string = dashIndex > 0 ? `/${primaryCode.substring(0, dashIndex)}` : "";
                    const checksPage: string = dashIndex > 0 ? primaryCode.substring(dashIndex + 1) : primaryCode;
                    docPage = `checks${checksGroup}/${checksPage}.html`;
                }
                // TODO: This should be checking the clang-tidy version used to better support usage of older versions.
                const primaryDocUri: vscode.Uri = vscode.Uri.parse(`https://releases.llvm.org/17.0.1/tools/clang/tools/extra/docs/clang-tidy/${docPage}`);
                diagnostic.code = { value: identifier.code, target: primaryDocUri };

                if (new CppSettings().clangTidyCodeActionShowDocumentation) {
                    if (codeActionCodeInfo.docCodeAction === undefined) {
                        codeActionCodeInfo.docCodeAction = {
                            title: localize("show.documentation.for", "Show documentation for {0}", primaryCode),
                            command: {
                                title: 'ShowDocumentation',
                                command: 'C_Cpp.ShowCodeAnalysisDocumentation',
                                arguments: [ primaryDocUri ]
                            },
                            kind: vscode.CodeActionKind.QuickFix
                        };
                    }
                } else {
                    codeActionCodeInfo.docCodeAction = undefined;
                }
            } else {
                diagnostic.code = d.code;
            }
            codeAnalysisCodeToFixes.set(identifier.code, codeActionCodeInfo);
        } else {
            diagnostic.code = d.code;
        }
        diagnostic.source = CppSourceStr;
        codeActionDiagnosticInfo.push(codeAction);
        if (relatedCodeActions.length > 0) {
            codeActionDiagnosticInfo.push(...relatedCodeActions);
        }
        diagnosticsCodeAnalysis.push(diagnostic);
    }

    codeAnalysisFileToCodeActions.set(params.uri, codeActionDiagnosticInfo);

    rebuildCodeAnalysisCodeAndAllFixes();

    diagnosticsCollectionCodeAnalysis.set(realUri, diagnosticsCodeAnalysis);
}

function removeCodeAnalysisCodeActions(identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[],
    removeFixesOnly: boolean): void {
    for (const identifiersAndUri of identifiersAndUris) {
        const codeActionDiagnosticInfo: CodeActionDiagnosticInfo[] | undefined = codeAnalysisFileToCodeActions.get(identifiersAndUri.uri);
        if (codeActionDiagnosticInfo === undefined) {
            return;
        }
        for (const identifier of identifiersAndUri.identifiers) {
            const updatedCodeActions: CodeActionDiagnosticInfo[] = [];
            for (const codeAction of codeActionDiagnosticInfo) {
                if (rangeEquals(codeAction.range, identifier.range) && codeAction.code === identifier.code) {
                    if (removeFixesOnly) {
                        ++codeAction.version;
                        codeAction.fixCodeAction = undefined;
                    } else {
                        continue;
                    }
                }
                updatedCodeActions.push(codeAction);
            }
            codeAnalysisFileToCodeActions.set(identifiersAndUri.uri, updatedCodeActions);

            let codeActionInfoChanged: boolean = false;
            for (const codeFixes of codeAnalysisCodeToFixes) {
                const codeActionInfo: CodeActionPerUriInfo | undefined = codeFixes[1].uriToInfo.get(identifiersAndUri.uri);
                if (codeActionInfo === undefined) {
                    continue;
                }
                let removedCodeActionInfoIndex: number = -1;
                for (let codeActionInfoIndex: number = 0; codeActionInfoIndex < codeActionInfo.identifiers.length; ++codeActionInfoIndex) {
                    if (identifier.code === codeActionInfo.identifiers[codeActionInfoIndex].code &&
                        rangeEquals(identifier.range, codeActionInfo.identifiers[codeActionInfoIndex].range)) {
                        removedCodeActionInfoIndex = codeActionInfoIndex;
                        codeActionInfoChanged = true;
                        break;
                    }
                }
                if (removedCodeActionInfoIndex !== -1) {
                    if (removeFixesOnly) {
                        if (codeActionInfo.workspaceEdits !== undefined) {
                            codeActionInfo.workspaceEdits[removedCodeActionInfoIndex].workspaceEdit = undefined;
                            --codeActionInfo.numValidWorkspaceEdits;
                        }
                    } else {
                        codeActionInfo.identifiers.splice(removedCodeActionInfoIndex, 1);
                        if (codeActionInfo.workspaceEdits !== undefined) {
                            codeActionInfo.workspaceEdits.splice(removedCodeActionInfoIndex, 1);
                            --codeActionInfo.numValidWorkspaceEdits;
                        }
                    }
                    if (codeActionInfo.identifiers.length === 0) {
                        codeFixes[1].uriToInfo.delete(identifiersAndUri.uri);
                    } else {
                        codeFixes[1].uriToInfo.set(identifiersAndUri.uri, codeActionInfo);
                    }
                }
            }
            if (codeActionInfoChanged) {
                rebuildCodeAnalysisCodeAndAllFixes();
            }
        }
    }
}

export function publishRemoveCodeAnalysisCodeActionFixes(params: RemoveCodeAnalysisCodeActionFixesParams): void {
    removeCodeAnalysisCodeActions(params.identifiersAndUris, true);
}

export function removeAllCodeAnalysisProblems(): boolean {
    if (!diagnosticsCollectionCodeAnalysis) {
        return false;
    }
    diagnosticsCollectionCodeAnalysis.clear();
    codeAnalysisFileToCodeActions.clear();
    codeAnalysisCodeToFixes.clear();
    rebuildCodeAnalysisCodeAndAllFixes();
    return true;
}

export function removeCodeAnalysisProblems(identifiersAndUris: CodeAnalysisDiagnosticIdentifiersAndUri[]): boolean {
    if (!diagnosticsCollectionCodeAnalysis) {
        return false;
    }

    // Remove the diagnostics.
    for (const identifiersAndUri of identifiersAndUris) {
        const uri: vscode.Uri = vscode.Uri.parse(identifiersAndUri.uri);
        const diagnostics: readonly vscode.Diagnostic[] | undefined = diagnosticsCollectionCodeAnalysis.get(uri);
        if (diagnostics === undefined) {
            continue;
        }
        const newDiagnostics: vscode.Diagnostic[] = [];
        for (const diagnostic of diagnostics) {
            const code: string = typeof diagnostic.code === "string" ? diagnostic.code :
                typeof diagnostic.code === "object" && typeof diagnostic.code.value === "string" ?
                    diagnostic.code.value : "";
            let removed: boolean = false;
            for (const identifier of identifiersAndUri.identifiers) {
                if (code !== identifier.code || !rangeEquals(diagnostic.range, identifier.range)) {
                    continue;
                }
                removed = true;
                break;
            }
            if (!removed) {
                newDiagnostics.push(diagnostic);
            }
        }
        diagnosticsCollectionCodeAnalysis.set(uri, newDiagnostics);
    }

    removeCodeAnalysisCodeActions(identifiersAndUris, false);

    return true;
}
