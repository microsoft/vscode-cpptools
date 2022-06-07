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

enum CppInlayHintKind {
    Type = 0,
    Parameter = 1,
}

interface CppInlayHint {
    position: Position;
    label: string;
    kind: CppInlayHintKind;
}

interface GetInlayHintsResult {
    fileVersion: number;
    canceled: boolean;
    inlayHints: CppInlayHint[];
}

type InlayHintsCacheEntry = {
    FileVersion: number;
    TypeHints: vscode.InlayHint[];
    ParameterHints: vscode.InlayHint[];
};

const GetInlayHintsRequest: RequestType<GetInlayHintsParams, GetInlayHintsResult, void, void> =
    new RequestType<GetInlayHintsParams, GetInlayHintsResult, void, void>('cpptools/getInlayHints');

export class InlayHintsProvider implements vscode.InlayHintsProvider {
    private client: DefaultClient;
    public onDidChangeInlayHintsEvent = new vscode.EventEmitter<void>();
    onDidChangeInlayHints?: vscode.Event<void>;
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
            return this.getHintsBasedOnSettings(cacheEntry);
        }

        // Get new results from the language server
        const params: GetInlayHintsParams = { uri: uriString };
        const inlayHintsResult: GetInlayHintsResult = await this.client.languageClient.sendRequest(GetInlayHintsRequest, params, token);
        if (!inlayHintsResult.canceled) {
            if (inlayHintsResult.fileVersion === openFileVersions.get(uriString)) {
                const cacheEntry: InlayHintsCacheEntry | undefined = this.createCacheEntry(inlayHintsResult);
                if (cacheEntry) {
                    this.cache.set(uriString, cacheEntry);
                    return this.getHintsBasedOnSettings(cacheEntry);
                }
            } else {
                // Force another request because file versions do not match.
                // TODO: verify this works when data is available.
                this.onDidChangeInlayHintsEvent.fire();
            }
        }
        return undefined;
    }

    public invalidateFile(uri: string): void {
        this.cache.delete(uri);
        this.onDidChangeInlayHintsEvent.fire();
    }

    private CppToVsCodeInlayHintKind(hintKind: CppInlayHintKind): vscode.InlayHintKind | undefined {
        switch (hintKind) {
            case CppInlayHintKind.Type:
                return vscode.InlayHintKind.Type;
            case CppInlayHintKind.Parameter:
                return vscode.InlayHintKind.Parameter;
            default:
                break;
        }
        return undefined;
    }

    private createCacheEntry(results: GetInlayHintsResult): InlayHintsCacheEntry | undefined {
        if (results.inlayHints.length === 0) {
            return undefined;
        }
        const typeHints: vscode.InlayHint[] = [];
        const paramHints: vscode.InlayHint[] = [];
        results.inlayHints.forEach((h: CppInlayHint) => {
            const inlayHint: vscode.InlayHint = new vscode.InlayHint(
                // Place hints on column of first character minus 1.
                // TODO: this depends on what language server returns.
                new vscode.Position(h.position.line, h.position.character - 1),
                h.label,
                this.CppToVsCodeInlayHintKind(h.kind)
            );
            inlayHint.paddingRight = true;
            if (inlayHint.kind === vscode.InlayHintKind.Type) {
                typeHints.push(inlayHint);
            } else if (inlayHint.kind === vscode.InlayHintKind.Parameter) {
                paramHints.push(inlayHint);
            }
        });
        const cacheEntry: InlayHintsCacheEntry = {
            FileVersion: results.fileVersion,
            TypeHints: typeHints,
            ParameterHints: paramHints
        };
        return cacheEntry;
    }

    private getHintsBasedOnSettings(cacheEntry: InlayHintsCacheEntry): vscode.InlayHint[] {
        // TODO: rename function and return hint kinds based on settings.
        return cacheEntry?.TypeHints.concat(cacheEntry?.ParameterHints);
    }
}
