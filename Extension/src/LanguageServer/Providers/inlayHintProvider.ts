/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { DefaultClient, openFileVersions } from '../client';
import { Position, RequestType } from 'vscode-languageclient';

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
    // hasParamName: boolean;
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

const GetInlayHintsRequest: RequestType<GetInlayHintsParams, GetInlayHintsResult, void, void> =
    new RequestType<GetInlayHintsParams, GetInlayHintsResult, void, void>('cpptools/getInlayHints');

export class InlayHintsProvider implements vscode.InlayHintsProvider {
    private client: DefaultClient;
    public onDidChangeInlayHintsEvent = new vscode.EventEmitter<void>();
    public onDidChangeInlayHints?: vscode.Event<void>;
    private cache: Map<string, InlayHintsCacheEntry> = new Map<string, InlayHintsCacheEntry>();

    constructor(client: DefaultClient) {
        this.client = client;
        this.onDidChangeInlayHints = this.onDidChangeInlayHintsEvent.event;
    }

    public async provideInlayHints(document: vscode.TextDocument, range: vscode.Range, token: vscode.CancellationToken):
    Promise<vscode.InlayHint[] | undefined> {
        await this.client.awaitUntilLanguageClientReady();
        const uriString: string = document.uri.toString();

        // Get results from cache if available.
        const cacheEntry: InlayHintsCacheEntry | undefined = this.cache.get(uriString);
        if (cacheEntry?.FileVersion === document.version) {
            return this.getHints(cacheEntry);
        }

        // Get new results from the language server
        const params: GetInlayHintsParams = { uri: uriString };
        const inlayHintsResult: GetInlayHintsResult = await this.client.languageClient.sendRequest(GetInlayHintsRequest, params, token);
        if (!inlayHintsResult.canceled) {
            if (inlayHintsResult.fileVersion === openFileVersions.get(uriString)) {
                const cacheEntry: InlayHintsCacheEntry = this.createCacheEntry(inlayHintsResult);
                this.cache.set(uriString, cacheEntry);
                return this.getHints(cacheEntry);
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

    private getHints(cacheEntry: InlayHintsCacheEntry): vscode.InlayHint[] {
        let result: vscode.InlayHint[] = [];
        const showTypeHintsEnabled: boolean = true; // TODO: get value from settings.
        const showParamHintsEnabled: boolean = true; // TODO: get value from settings.
        if (showTypeHintsEnabled) {
            result = result.concat(cacheEntry?.TypeHints);
        }
        if (showParamHintsEnabled) {
            const resolvedParameterHints: vscode.InlayHint[] = this.resolveParameterHints(cacheEntry.ParameterHints);
            result = result.concat(resolvedParameterHints);
        }
        return result;
    }

    private resolveParameterHints(hints: CppInlayHint[]): vscode.InlayHint[] {
        const resolvedHints: vscode.InlayHint[] = [];
        const showRefEnabled: boolean = true; // TODO: get from settings
        const hideParamNameEnabled: boolean = false; // TODO: get from settings
        hints.forEach((h: CppInlayHint) => {
            // Build parameter label based on settings.
            // TODO: remove label if param includes parameter name or in comments.
            const paramName: string = (hideParamNameEnabled /* && h.hasParamName*/) ? "" : h.label;
            let refString: string = "";
            if (showRefEnabled && h.isValueRef) {
                refString = (paramName.length > 0) ? "& " : "&";
            }
            const colonString: string = (paramName.length > 0 || refString.length > 0) ? ":" : "";
            const label: string = refString + paramName + colonString;

            const inlayHint: vscode.InlayHint = new vscode.InlayHint(
                new vscode.Position(h.position.line, h.position.character),
                label,
                vscode.InlayHintKind.Parameter);
            inlayHint.paddingRight = true;
            resolvedHints.push(inlayHint);
        });
        return resolvedHints;
    }

    private createCacheEntry(inlayHintsResults: GetInlayHintsResult): InlayHintsCacheEntry {
        const typeHints: vscode.InlayHint[] = [];
        inlayHintsResults.inlayHints.forEach((h: CppInlayHint) => {
            if (h.inlayHintKind === InlayHintKind.Type) {
                const inlayHint: vscode.InlayHint = new vscode.InlayHint(
                    new vscode.Position(h.position.line, h.position.character),
                    h.label,
                    vscode.InlayHintKind.Type);
                inlayHint.paddingRight = true;
                typeHints.push(inlayHint);
            }
        });
        const paramHints: CppInlayHint[] = inlayHintsResults.inlayHints.filter(
            h => h.inlayHintKind === InlayHintKind.Parameter);
        const cacheEntry: InlayHintsCacheEntry = {
            FileVersion: inlayHintsResults.fileVersion,
            TypeHints: typeHints,
            ParameterHints: paramHints
        };
        return cacheEntry;
    }
}
