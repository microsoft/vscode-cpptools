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
    TypeHints: CppInlayHint[];
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
            return this.buildVSCodeHints(document.uri, cacheEntry);
        }

        // Get new results from the language server
        const params: GetInlayHintsParams = { uri: uriString };
        const inlayHintsResult: GetInlayHintsResult = await this.client.languageClient.sendRequest(GetInlayHintsRequest, params, token);
        if (token.isCancellationRequested || inlayHintsResult.canceled) {
            throw new vscode.CancellationError();
        }

        if (inlayHintsResult.fileVersion === openFileVersions.get(uriString)) {
            const cacheEntry: InlayHintsCacheEntry = this.createCacheEntry(inlayHintsResult);
            this.cache.set(uriString, cacheEntry);
            return this.buildVSCodeHints(document.uri, cacheEntry);
        }
        // Force another request because file versions do not match.
        this.onDidChangeInlayHintsEvent.fire();
        return undefined;
    }

    public invalidateFile(uri: string): void {
        this.cache.delete(uri);
        this.onDidChangeInlayHintsEvent.fire();
    }

    private buildVSCodeHints(uri: vscode.Uri, cacheEntry: InlayHintsCacheEntry): vscode.InlayHint[] {
        let result: vscode.InlayHint[] = [];
        const settings: CppSettings = new CppSettings(uri);
        if (settings.inlayHintsAutoDeclarationTypes) {
            const resolvedTypeHints: vscode.InlayHint[] = this.resolveTypeHints(uri, cacheEntry.TypeHints);
            result = result.concat(resolvedTypeHints);
        }
        if (settings.inlayHintsParameterNames || settings.inlayHintsReferenceOperator) {
            const resolvedParameterHints: vscode.InlayHint[] = this.resolveParameterHints(uri, cacheEntry.ParameterHints);
            result = result.concat(resolvedParameterHints);
        }
        return result;
    }

    private resolveTypeHints(uri: vscode.Uri, hints: CppInlayHint[]): vscode.InlayHint[] {
        const resolvedHints: vscode.InlayHint[] = [];
        const settings: CppSettings = new CppSettings(uri);
        for (const hint of hints) {
            const showOnLeft: boolean = settings.inlayHintsAutoDeclarationTypesShowOnLeft && hint.identifierLength > 0;
            const inlayHint: vscode.InlayHint = new vscode.InlayHint(
                new vscode.Position(hint.position.line, hint.position.character +
                        (showOnLeft ? 0 : hint.identifierLength)),
                (showOnLeft ? hint.label : ": " + hint.label),
                vscode.InlayHintKind.Type);
            inlayHint.paddingRight = showOnLeft || hint.rightPadding;
            inlayHint.paddingLeft = showOnLeft && hint.leftPadding;
            resolvedHints.push(inlayHint);
        }
        return resolvedHints;
    }

    private resolveParameterHints(uri: vscode.Uri, hints: CppInlayHint[]): vscode.InlayHint[] {
        const resolvedHints: vscode.InlayHint[] = [];
        const settings: CppSettings = new CppSettings(uri);
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
                new vscode.Position(hint.position.line, hint.position.character),
                refOperatorString +  paramHintLabel + ":",
                vscode.InlayHintKind.Parameter);
            inlayHint.paddingRight = true;
            resolvedHints.push(inlayHint);
        };
        return resolvedHints;
    }

    private createCacheEntry(inlayHintsResults: GetInlayHintsResult): InlayHintsCacheEntry {
        const typeHints: CppInlayHint[] = inlayHintsResults.inlayHints.filter(h => h.inlayHintKind === InlayHintKind.Type);
        const paramHints: CppInlayHint[] = inlayHintsResults.inlayHints.filter(h => h.inlayHintKind === InlayHintKind.Parameter);
        const cacheEntry: InlayHintsCacheEntry = {
            FileVersion: inlayHintsResults.fileVersion,
            TypeHints: typeHints,
            ParameterHints: paramHints
        };
        return cacheEntry;
    }
}
