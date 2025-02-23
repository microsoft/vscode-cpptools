/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { ContextProviderApiV1 } from '@github/copilot-language-server';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as util from '../common';
import * as logger from '../logger';
import * as telemetry from '../telemetry';
import { GetIncludesResult } from './client';
import { getClients } from './extension';
import { getProjectContext } from './lmTool';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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
    getContextProviderAPI(version: string): Promise<ContextProviderApiV1 | undefined>;
}

export async function registerRelatedFilesProvider(): Promise<void> {
    const api = await getCopilotApi();
    if (util.extensionContext && api) {
        try {
            for (const languageId of ['c', 'cpp', 'cuda-cpp']) {
                api.registerRelatedFilesProvider(
                    { extensionId: util.extensionContext.extension.id, languageId },
                    async (uri: vscode.Uri, context: { flags: Record<string, unknown> }, cancellationToken: vscode.CancellationToken) => {
                        const start = performance.now();
                        const telemetryProperties: Record<string, string> = {};
                        const telemetryMetrics: Record<string, number> = {};
                        try {
                            const getIncludesHandler = async () => (await getIncludes(uri, 1))?.includedFiles.map(file => vscode.Uri.file(file)) ?? [];
                            const getTraitsHandler = async () => {
                                const projectContext = await getProjectContext(uri, context, cancellationToken, telemetryProperties, telemetryMetrics);

                                if (!projectContext) {
                                    return undefined;
                                }

                                let traits: CopilotTrait[] = [];
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

async function getIncludes(uri: vscode.Uri, maxDepth: number): Promise<GetIncludesResult> {
    const client = getClients().getClientFor(uri);
    const includes = await client.getIncludes(uri, maxDepth);
    const wksFolder = client.RootUri?.toString();

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
