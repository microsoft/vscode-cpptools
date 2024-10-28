/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { Position, ResponseError, TextDocumentPositionParams } from 'vscode-languageclient';
import { ManualSignal } from '../../Utility/Async/manualSignal';
import { DefaultClient, HoverRequest } from '../client';
import { RequestCancelled, ServerCancelled } from '../protocolFilter';
import { CppSettings } from '../settings';

export class HoverProvider implements vscode.HoverProvider {
    private client: DefaultClient;
    private lastContent: vscode.MarkdownString[] | undefined;
    private readonly hasContent = new ManualSignal<boolean>(true);
    constructor(client: DefaultClient) {
        this.client = client;
    }

    public async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        this.hasContent.reset();
        const copilotHoverProvider = this.client.getCopilotHoverProvider();
        if (copilotHoverProvider) {
            // Check if this is a reinvocation from Copilot.
            if (!copilotHoverProvider.isNewHover(document, position) && this.lastContent) {
                this.hasContent.resolve(this.lastContent.length > 0);
                return new vscode.Hover(this.lastContent);
            }
        }

        const settings: CppSettings = new CppSettings(vscode.workspace.getWorkspaceFolder(document.uri)?.uri);
        if (settings.hover === "disabled") {
            return undefined;
        }
        const params: TextDocumentPositionParams = {
            textDocument: { uri: document.uri.toString() },
            position: Position.create(position.line, position.character)
        };
        await this.client.ready;
        let hoverResult: vscode.Hover;
        try {
            hoverResult = await this.client.languageClient.sendRequest(HoverRequest, params, token);
        } catch (e: any) {
            if (e instanceof ResponseError && (e.code === RequestCancelled || e.code === ServerCancelled)) {
                throw new vscode.CancellationError();
            }
            throw e;
        }
        if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        // VS Code doesn't like the raw objects returned via RPC, so we need to create proper VS Code objects here.
        const strings: vscode.MarkdownString[] = [];
        for (const element of hoverResult.contents) {
            const oldMarkdownString: vscode.MarkdownString = element as vscode.MarkdownString;
            const newMarkdownString: vscode.MarkdownString = new vscode.MarkdownString(oldMarkdownString.value, oldMarkdownString.supportThemeIcons);
            newMarkdownString.isTrusted = oldMarkdownString.isTrusted;
            newMarkdownString.supportHtml = oldMarkdownString.supportHtml;
            newMarkdownString.baseUri = oldMarkdownString.baseUri;
            strings.push(newMarkdownString);
        }
        let range: vscode.Range | undefined;
        if (hoverResult.range) {
            range = new vscode.Range(hoverResult.range.start.line, hoverResult.range.start.character,
                hoverResult.range.end.line, hoverResult.range.end.character);
        }

        this.hasContent.resolve(strings.length > 0);
        this.lastContent = strings;
        return new vscode.Hover(strings, range);
    }

    get contentReady(): Promise<boolean> {
        return this.hasContent;
    }
}
