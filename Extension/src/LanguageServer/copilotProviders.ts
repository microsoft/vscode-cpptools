/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as util from '../common';
import { ChatContextResult, GetIncludesResult } from './client';
import { getActiveClient } from './extension';

export interface CopilotTrait {
    name: string;
    value: string;
    includeInPrompt?: boolean;
    promptTextOverride?: string;
}

export interface CopilotApi {
    registerRelatedFilesProvider(
        providerId: { extensionId: string; languageId: string },
        callback: (
            uri: vscode.Uri,
            context: { flags: Record<string, unknown> },
            cancellationToken: vscode.CancellationToken
        ) => Promise<{ entries: vscode.Uri[]; traits?: CopilotTrait[] }>
    ): Disposable;
}

export async function registerRelatedFilesProvider(): Promise<void> {
    const api = await getCopilotApi();
    if (util.extensionContext && api) {
        try {
            for (const languageId of ['c', 'cpp', 'cuda-cpp']) {
                api.registerRelatedFilesProvider(
                    { extensionId: util.extensionContext.extension.id, languageId },
                    async (_uri: vscode.Uri, context: { flags: Record<string, unknown> }, token: vscode.CancellationToken) => {

                        const getIncludesHandler = async () => (await getIncludesWithCancellation(1, token))?.includedFiles.map(file => vscode.Uri.file(file)) ?? [];
                        const getTraitsHandler = async () => {
                            const chatContext: ChatContextResult | undefined = await (getActiveClient().getChatContext(token) ?? undefined);

                            if (!chatContext) {
                                return undefined;
                            }

                            let traits: CopilotTrait[] = [
                                { name: "language", value: chatContext.language, includeInPrompt: true, promptTextOverride: `The language is ${chatContext.language}.` },
                                { name: "compiler", value: chatContext.compiler, includeInPrompt: true, promptTextOverride: `This project compiles using ${chatContext.compiler}.` },
                                { name: "standardVersion", value: chatContext.standardVersion, includeInPrompt: true, promptTextOverride: `This project uses the ${chatContext.standardVersion} language standard.` },
                                { name: "targetPlatform", value: chatContext.targetPlatform, includeInPrompt: true, promptTextOverride: `This build targets ${chatContext.targetPlatform}.` },
                                { name: "targetArchitecture", value: chatContext.targetArchitecture, includeInPrompt: true, promptTextOverride: `This build targets ${chatContext.targetArchitecture}.` }
                            ];

                            const excludeTraits = context.flags.copilotcppExcludeTraits as string[] ?? [];
                            traits = traits.filter(trait => !excludeTraits.includes(trait.name));

                            return traits.length > 0 ? traits : undefined;
                        };

                        // Call both handlers in parallel
                        const traitsPromise = ((context.flags.copilotcppTraits as boolean) ?? false) ? getTraitsHandler() : Promise.resolve(undefined);
                        const includesPromise = getIncludesHandler();

                        return { entries: await includesPromise, traits: await traitsPromise };
                    }
                );
            }
        } catch {
            console.log("Failed to register Copilot related files provider.");
        }
    }
}

async function getIncludesWithCancellation(maxDepth: number, token: vscode.CancellationToken): Promise<GetIncludesResult> {
    const activeClient = getActiveClient();
    const includes = await activeClient.getIncludes(maxDepth, token);
    const wksFolder = activeClient.RootUri?.toString();

    if (!wksFolder) {
        return includes;
    }

    includes.includedFiles = includes.includedFiles.filter(header => vscode.Uri.file(header).toString().startsWith(wksFolder));
    return includes;
}

export async function getCopilotApi(): Promise<CopilotApi | undefined> {
    const copilotExtension = vscode.extensions.getExtension<CopilotApi>('github.copilot');
    if (!copilotExtension) {
        return undefined;
    }

    if (!copilotExtension.isActive) {
        try {
            return await copilotExtension.activate();
        } catch {
            return undefined;
        }
    } else {
        return copilotExtension.exports;
    }
}
