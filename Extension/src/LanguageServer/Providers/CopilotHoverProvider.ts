/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import { CppSettings } from '../settings';
import { HoverProvider } from './HoverProvider';

export class CopilotHoverProvider implements vscode.HoverProvider {
    private provider: HoverProvider;
    constructor(provider: HoverProvider) {
        this.provider = provider;
    }

    public async provideHover(document: vscode.TextDocument, _position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        const settings: CppSettings = new CppSettings(vscode.workspace.getWorkspaceFolder(document.uri)?.uri);
        if (settings.hover === "disabled") {
            return undefined;
        }

        // Why does it show "Loading..." and is that vscode?
        // TODO: add intermediate loading state spinner before long ops
        const content = await this.provider.showCopilotHover;
        if (!content) {
            return undefined;
        }

        const markdownContent = new vscode.MarkdownString(content);
        markdownContent.supportThemeIcons = true;

        return new vscode.Hover(markdownContent);
    }
}
