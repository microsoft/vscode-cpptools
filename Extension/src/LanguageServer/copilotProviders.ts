/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as util from '../common';
import { GetIncludesResult } from './client';
import { getActiveClient } from './extension';
import { getProjectContext } from './lmTool';

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
                            const cppContext = await getProjectContext(context, token);

                            if (!cppContext) {
                                return undefined;
                            }

                            let traits: CopilotTrait[] = [
                                { name: "intellisense", value: 'intellisense', includeInPrompt: true, promptTextOverride: `IntelliSense is currently configured with the following compiler information. It's best effort to reflect the active configuration, and the project may have more configurations targeting different platforms.` },
                                { name: "intellisenseBegin", value: 'Begin', includeInPrompt: true, promptTextOverride: `Begin of IntelliSense information.` }
                            ];
                            if (cppContext.language) {
                                traits.push({ name: "language", value: cppContext.language, includeInPrompt: true, promptTextOverride: `The language is ${cppContext.language}.` });
                            }
                            if (cppContext.compiler) {
                                traits.push({ name: "compiler", value: cppContext.compiler, includeInPrompt: true, promptTextOverride: `This project compiles using ${cppContext.compiler}.` });
                            }
                            if (cppContext.standardVersion) {
                                traits.push({ name: "standardVersion", value: cppContext.standardVersion, includeInPrompt: true, promptTextOverride: `This project uses the ${cppContext.standardVersion} language standard.` });
                            }
                            if (cppContext.targetPlatform) {
                                traits.push({ name: "targetPlatform", value: cppContext.targetPlatform, includeInPrompt: true, promptTextOverride: `This build targets ${cppContext.targetPlatform}.` });
                            }
                            if (cppContext.targetArchitecture) {
                                traits.push({ name: "targetArchitecture", value: cppContext.targetArchitecture, includeInPrompt: true, promptTextOverride: `This build targets ${cppContext.targetArchitecture}.` });
                            }
                            let directAsks: string = '';
                            if (cppContext.compilerArguments.length > 0) {
                                // Example: JSON.stringify({'-fno-rtti': "Do not generate code using RTTI keywords."})
                                const directAskMap: { [key: string]: string } = JSON.parse(context.flags.copilotcppCompilerArgumentDirectAskMap as string ?? '{}');
                                const updatedArguments = cppContext.compilerArguments.filter(arg => {
                                    if (directAskMap[arg]) {
                                        directAsks += `${directAskMap[arg]} `;
                                        return false;
                                    }
                                    return true;
                                });

                                const compilerArgumentsValue = updatedArguments.join(", ");
                                traits.push({ name: "compilerArguments", value: compilerArgumentsValue, includeInPrompt: true, promptTextOverride: `The compiler arguments include: ${compilerArgumentsValue}.` });
                            }
                            if (directAsks) {
                                traits.push({ name: "directAsks", value: directAsks, includeInPrompt: true, promptTextOverride: directAsks });
                            }

                            traits.push({ name: "intellisenseEnd", value: 'End', includeInPrompt: true, promptTextOverride: `End of IntelliSense information.` });

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
