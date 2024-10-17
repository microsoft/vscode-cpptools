/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { localize } from 'vscode-nls';
import * as util from '../common';
import * as logger from '../logger';
import * as telemetry from '../telemetry';
import { GetIncludesResult } from './client';
import { getActiveClient } from './extension';
import { getCompilerArgumentFilterMap, getProjectContext } from './lmTool';

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
                    async (uri: vscode.Uri, context: { flags: Record<string, unknown> }, token: vscode.CancellationToken) => {
                        const start = performance.now();
                        const telemetryProperties: Record<string, string> = {};
                        const telemetryMetrics: Record<string, number> = {};
                        try {
                            const getIncludesHandler = async () => (await getIncludesWithCancellation(1, token))?.includedFiles.map(file => vscode.Uri.file(file)) ?? [];
                            const getTraitsHandler = async () => {
                                const projectContext = await getProjectContext(uri, context, token);

                                if (!projectContext) {
                                    return undefined;
                                }

                                let traits: CopilotTrait[] = [
                                    { name: "intelliSenseDisclaimer", value: '', includeInPrompt: true, promptTextOverride: `IntelliSense is currently configured with the following compiler information. It reflects the active configuration, and the project may have more configurations targeting different platforms.` },
                                    { name: "intelliSenseDisclaimerBeginning", value: '', includeInPrompt: true, promptTextOverride: `Beginning of IntelliSense information.` }
                                ];
                                if (projectContext.language) {
                                    traits.push({ name: "language", value: projectContext.language, includeInPrompt: true, promptTextOverride: `The language is ${projectContext.language}.` });
                                }
                                if (projectContext.compiler) {
                                    traits.push({ name: "compiler", value: projectContext.compiler, includeInPrompt: true, promptTextOverride: `This project compiles using ${projectContext.compiler}.` });
                                }
                                if (projectContext.standardVersion) {
                                    traits.push({ name: "standardVersion", value: projectContext.standardVersion, includeInPrompt: true, promptTextOverride: `This project uses the ${projectContext.standardVersion} language standard.` });
                                }
                                if (projectContext.targetPlatform) {
                                    traits.push({ name: "targetPlatform", value: projectContext.targetPlatform, includeInPrompt: true, promptTextOverride: `This build targets ${projectContext.targetPlatform}.` });
                                }
                                if (projectContext.targetArchitecture) {
                                    traits.push({ name: "targetArchitecture", value: projectContext.targetArchitecture, includeInPrompt: true, promptTextOverride: `This build targets ${projectContext.targetArchitecture}.` });
                                }

                                if (projectContext.compiler) {
                                    // We will process compiler arguments based on copilotcppXXXCompilerArgumentFilters and copilotcppCompilerArgumentDirectAskMap feature flags.
                                    // The copilotcppXXXCompilerArgumentFilters are maps. The keys are regex strings for filtering and the values, if not empty,
                                    // are the prompt text to use when no arguments are found.
                                    // copilotcppCompilerArgumentDirectAskMap map individual matched argument to a prompt text.
                                    // For duplicate matches, the last one will be used.
                                    const filterMap = getCompilerArgumentFilterMap(projectContext.compiler, context);
                                    if (filterMap !== undefined) {
                                        const directAskMap: Record<string, string> = context.flags.copilotcppCompilerArgumentDirectAskMap ? JSON.parse(context.flags.copilotcppCompilerArgumentDirectAskMap as string) : {};
                                        let directAsks: string = '';
                                        const remainingArguments: string[] = [];

                                        for (const key in filterMap) {
                                            if (!key) {
                                                continue;
                                            }

                                            const matchedArgument = projectContext.compilerArguments[key] as string;
                                            if (matchedArgument?.length > 0) {
                                                if (directAskMap[matchedArgument]) {
                                                    directAsks += `${directAskMap[matchedArgument]} `;
                                                } else {
                                                    remainingArguments.push(matchedArgument);
                                                }
                                            } else if (filterMap[key]) {
                                                // Use the prompt text in the absence of argument.
                                                directAsks += `${filterMap[key]} `;
                                            }
                                        }

                                        if (remainingArguments.length > 0) {
                                            const compilerArgumentsValue = remainingArguments.join(", ");
                                            traits.push({ name: "compilerArguments", value: compilerArgumentsValue, includeInPrompt: true, promptTextOverride: `The compiler arguments include: ${compilerArgumentsValue}.` });
                                        }

                                        if (directAsks) {
                                            traits.push({ name: "directAsks", value: directAsks, includeInPrompt: true, promptTextOverride: directAsks });
                                        }
                                    }
                                }

                                traits.push({ name: "intelliSenseDisclaimerEnd", value: '', includeInPrompt: true, promptTextOverride: `End of IntelliSense information.` });

                                const includeTraitsArray = context.flags.copilotcppIncludeTraits ? context.flags.copilotcppIncludeTraits as string[] : [];
                                const includeTraits = new Set(includeTraitsArray);
                                telemetryProperties["includeTraits"] = includeTraitsArray.join(',');

                                // standardVersion trait is enabled by default.
                                traits = traits.filter(trait => includeTraits.has(trait.name) || trait.name === 'standardVersion');

                                telemetryProperties["traits"] = traits.map(trait => trait.name).join(',');
                                return traits.length > 0 ? traits : undefined;
                            };

                            // Call both handlers in parallel
                            const traitsPromise = getTraitsHandler();
                            const includesPromise = getIncludesHandler();

                            return { entries: await includesPromise, traits: await traitsPromise };
                        }
                        catch (exception) {
                            try {
                                const err: Error = exception as Error;
                                logger.getOutputChannelLogger().appendLine(localize("copilot.relatedfilesprovider.error", "Error while retrieving result. Reason: {0}", err.message));
                            }
                            catch {
                                // Intentionally swallow any exception.
                            }
                            telemetryProperties["error"] = "true";
                            throw exception; // Throw the exception for auto-retry.
                        } finally {
                            telemetryMetrics['duration'] = performance.now() - start;
                            telemetry.logCopilotEvent('RelatedFilesProvider', telemetryProperties, telemetryMetrics);
                        }
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
