/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, openFileVersions } from '../client';
import { Position, RequestType } from 'vscode-languageclient';
import { CppSettings } from '../settings';

interface GetInlayHintsParams {
    uri: string;
}

enum InlayHintKind {
    Type = 0,
    Parameter = 1,
}

interface CppInlayHint {
    position: Position;
    label: string;
    inlayHintKind: InlayHintKind;
    isValueRef: boolean;
    hasParamName: boolean;
    leftPadding: boolean;
    rightPadding: boolean;
    identifierLength: number;
}

interface GetInlayHintsResult {
    fileVersion: number;
    canceled: boolean;
    inlayHints: CppInlayHint[];
}

type InlayHintsCacheEntry = {
    FileVersion: number;
    TypeHints: vscode.InlayHint[];
    ParameterHints: CppInlayHint[];
};

const GetInlayHintsRequest: RequestType<GetInlayHintsParams, GetInlayHintsResult, void> =
    new RequestType<GetInlayHintsParams, GetInlayHintsResult, void>('cpptools/getInlayHints');

export class InlayHintsProvider implements vscode.InlayHintsProvider {
    private client: DefaultClient;
    public onDidChangeInlayHintsEvent = new vscode.EventEmitter<void>();
    public onDidChangeInlayHints?: vscode.Event<void>;
    private cache: Map<string, InlayHintsCacheEntry> = new Map<string, InlayHintsCacheEntry>();

    constructor(client: DefaultClient) {
        this.client = client;
        this.onDidChangeInlayHints = this.onDidChangeInlayHintsEvent.event;
    }

    public async provideInlayHints(document: vscode.TextDocument, range: vscode.Range,
        token: vscode.CancellationToken): Promise<vscode.InlayHint[] | undefined> {
        await this.client.awaitUntilLanguageClientReady();
        const uriString: string = document.uri.toString();

        // Get results from cache if available.
        const cacheEntry: InlayHintsCacheEntry | undefined = this.cache.get(uriString);
        if (cacheEntry?.FileVersion === document.version) {
            return this.buildVSCodeHints(cacheEntry);
        }

        // Get new results from the language server
        const params: GetInlayHintsParams = { uri: uriString };
        const inlayHintsResult: GetInlayHintsResult = await this.client.languageClient.sendRequest(GetInlayHintsRequest, params, token);
        if (!inlayHintsResult.canceled) {
            if (inlayHintsResult.fileVersion === openFileVersions.get(uriString)) {
                const cacheEntry: InlayHintsCacheEntry = this.createCacheEntry(inlayHintsResult);
                this.cache.set(uriString, cacheEntry);
                return this.buildVSCodeHints(cacheEntry);
            } else {
                // Force another request because file versions do not match.
                this.onDidChangeInlayHintsEvent.fire();
            }
        }
        return undefined;
    }

    public invalidateFile(uri: string): void {
        this.cache.delete(uri);
        this.onDidChangeInlayHintsEvent.fire();
    }

    private buildVSCodeHints(cacheEntry: InlayHintsCacheEntry): vscode.InlayHint[] {
        let result: vscode.InlayHint[] = [];
        const settings: CppSettings = new CppSettings();
        if (settings.inlayHintsAutoDeclarationTypes) {
            result = result.concat(cacheEntry?.TypeHints);
        }
        const resolvedParameterHints: vscode.InlayHint[] = this.resolveParameterHints(cacheEntry.ParameterHints);
        result = result.concat(resolvedParameterHints);
        return result;
    }

    private resolveParameterHints(hints: CppInlayHint[]): vscode.InlayHint[] {
        const resolvedHints: vscode.InlayHint[] = [];
        const settings: CppSettings = new CppSettings();
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
                refOperatorString = (paramHintLabel.length > 0 && settings.inlayHintsReferenceOperatorShowSpace) ? "& " : "&";
            }
            let label: string = "";
            if (paramHintLabel.length > 0 || refOperatorString.length > 0) {
                label = refOperatorString +  paramHintLabel + ":";
            }

            const inlayHint: vscode.InlayHint = new vscode.InlayHint(
                new vscode.Position(hint.position.line, hint.position.character),
                label,
                vscode.InlayHintKind.Parameter);
            inlayHint.paddingRight = true;
            resolvedHints.push(inlayHint);
        };
        return resolvedHints;
    }

    private createCacheEntry(inlayHintsResults: GetInlayHintsResult): InlayHintsCacheEntry {
        const typeHints: vscode.InlayHint[] = [];
        const settings: CppSettings = new CppSettings();
        for (const h of inlayHintsResults.inlayHints) {
            if (h.inlayHintKind === InlayHintKind.Type) {
                const showOnLeft: boolean = settings.inlayHintsAutoDeclarationTypesShowOnLeft && h.identifierLength > 0;
                const inlayHint: vscode.InlayHint = new vscode.InlayHint(
                    new vscode.Position(h.position.line, h.position.character +
                        (showOnLeft ? 0 : h.identifierLength)),
                    (showOnLeft ? h.label : ": " + h.label),
                    vscode.InlayHintKind.Type);
                inlayHint.paddingRight = showOnLeft || h.rightPadding;
                inlayHint.paddingLeft = showOnLeft && h.leftPadding;
                typeHints.push(inlayHint);
            }
        }
        const paramHints: CppInlayHint[] = inlayHintsResults.inlayHints.filter(h => h.inlayHintKind === InlayHintKind.Parameter);
        const cacheEntry: InlayHintsCacheEntry = {
            FileVersion: inlayHintsResults.fileVersion,
            TypeHints: typeHints,
            ParameterHints: paramHints
        };
        return cacheEntry;
    }
}
