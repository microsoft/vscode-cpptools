/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { CppSettings } from '../settings';

interface FileData
{
    version: number;
    inlayHints: vscode.InlayHint[];
}

export interface CppInlayHint {
    line: number;
    character: number;
    label: string;
    inlayHintKind: InlayHintKind;
    isValueRef: boolean;
    hasParamName: boolean;
    leftPadding: boolean;
    rightPadding: boolean;
    identifierLength: number;
}

enum InlayHintKind {
    Type = 0,
    Parameter = 1,
}

export class InlayHintsProvider implements vscode.InlayHintsProvider {
    public onDidChangeInlayHintsEvent = new vscode.EventEmitter<void>();
    public onDidChangeInlayHints?: vscode.Event<void> = this.onDidChangeInlayHintsEvent.event;
    private allFileData: Map<string, FileData> = new Map<string, FileData>();

    public async provideInlayHints(document: vscode.TextDocument, _range: vscode.Range, _token: vscode.CancellationToken): Promise<vscode.InlayHint[]> {
        const uri: vscode.Uri = document.uri;
        const uriString: string = uri.toString();
        let fileData: FileData | undefined = this.allFileData.get(uriString);
        if (!fileData || fileData.version !== document.version) {
            fileData = {
                version: document.version,
                inlayHints: []
            };
            this.allFileData.set(uriString, fileData);
        }

        return fileData.inlayHints;
    }

    public deliverInlayHints(uriString: string, cppInlayHints: CppInlayHint[], startNewSet: boolean): void {
        if (!startNewSet && cppInlayHints.length === 0) {
            return;
        }

        const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uriString);
        if (!editor) {
            return;
        }

        // No need to check the file version here, as the caller has already ensured it's current.

        let fileData: FileData | undefined = this.allFileData.get(uriString);
        if (!fileData) {
            fileData = {
                version: editor.document.version,
                inlayHints: []
            };
            this.allFileData.set(uriString, fileData);
        }

        const typeHints: CppInlayHint[] = cppInlayHints.filter(h => h.inlayHintKind === InlayHintKind.Type);
        const paramHints: CppInlayHint[] = cppInlayHints.filter(h => h.inlayHintKind === InlayHintKind.Parameter);

        const settings: CppSettings = new CppSettings(vscode.Uri.parse(uriString));
        if (settings.inlayHintsAutoDeclarationTypes) {
            const resolvedTypeHints: vscode.InlayHint[] = this.resolveTypeHints(settings, typeHints);
            Array.prototype.push.apply(fileData.inlayHints, resolvedTypeHints);
        }
        if (settings.inlayHintsParameterNames || settings.inlayHintsReferenceOperator) {
            const resolvedParameterHints: vscode.InlayHint[] = this.resolveParameterHints(settings, paramHints);
            Array.prototype.push.apply(fileData.inlayHints, resolvedParameterHints);
        }

        this.onDidChangeInlayHintsEvent.fire();
    }

    public removeFile(uriString: string): void {
        const fileData: FileData | undefined = this.allFileData.get(uriString);
        if (!fileData) {
            return;
        }
        this.allFileData.delete(uriString);
    }

    private resolveTypeHints(settings: CppSettings, hints: CppInlayHint[]): vscode.InlayHint[] {
        const resolvedHints: vscode.InlayHint[] = [];
        for (const hint of hints) {
            const showOnLeft: boolean = settings.inlayHintsAutoDeclarationTypesShowOnLeft && hint.identifierLength > 0;
            const inlayHint: vscode.InlayHint = new vscode.InlayHint(
                new vscode.Position(hint.line, hint.character +
                    (showOnLeft ? 0 : hint.identifierLength)),
                showOnLeft ? hint.label : ": " + hint.label,
                vscode.InlayHintKind.Type);
            inlayHint.paddingRight = showOnLeft || hint.rightPadding;
            inlayHint.paddingLeft = showOnLeft && hint.leftPadding;
            resolvedHints.push(inlayHint);
        }
        return resolvedHints;
    }

    private resolveParameterHints(settings: CppSettings, hints: CppInlayHint[]): vscode.InlayHint[] {
        const resolvedHints: vscode.InlayHint[] = [];
        for (const hint of hints) {
            // Build parameter label based on settings.
            let paramHintLabel: string = "";
            if (settings.inlayHintsParameterNames) {
                paramHintLabel = (settings.inlayHintsParameterNamesSuppressName && hint.hasParamName) ? "" : hint.label;
                if (paramHintLabel !== "" && settings.inlayHintsParameterNamesHideLeadingUnderscores) {
                    let nonUnderscoreIndex: number = 0;
                    for (let i: number = 0; i < paramHintLabel.length; ++i) {
                        if (paramHintLabel[i] !== '_') {
                            nonUnderscoreIndex = i;
                            break;
                        }
                    }
                    if (nonUnderscoreIndex > 0) {
                        paramHintLabel = paramHintLabel.substring(nonUnderscoreIndex);
                    }
                }
            }
            let refOperatorString: string = "";
            if (settings.inlayHintsReferenceOperator && hint.isValueRef) {
                refOperatorString = (paramHintLabel !== "" && settings.inlayHintsReferenceOperatorShowSpace) ? "& " : "&";
            }

            if (paramHintLabel === "" && refOperatorString === "") {
                continue;
            }

            const inlayHint: vscode.InlayHint = new vscode.InlayHint(
                new vscode.Position(hint.line, hint.character),
                refOperatorString + paramHintLabel + ":",
                vscode.InlayHintKind.Parameter);
            inlayHint.paddingRight = true;
            resolvedHints.push(inlayHint);
        }
        return resolvedHints;
    }
}
