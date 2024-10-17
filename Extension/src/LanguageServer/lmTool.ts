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
import { ChatContextResult, ProjectContextResult } from './client';
import { getClients } from './extension';
import { checkDuration } from './utils';

const MSVC: string = 'MSVC';
const Clang: string = 'Clang';
const GCC: string = 'GCC';
const knownValues: { [Property in keyof ChatContextResult]?: { [id: string]: string } } = {
    language: {
        'c': 'C',
        'cpp': 'C++',
        'cuda-cpp': 'CUDA C++'
    },
    compiler: {
        'msvc': MSVC,
        'clang': Clang,
        'gcc': GCC
    },
    standardVersion: {
        'c++98': 'C++98',
        'c++03': 'C++03',
        'c++11': 'C++11',
        'c++14': 'C++14',
        'c++17': 'C++17',
        'c++20': 'C++20',
        'c++23': 'C++23',
        'c90': "C90",
        'c99': "C99",
        'c11': "C11",
        'c17': "C17",
        'c23': "C23"
    },
    targetPlatform: {
        'windows': 'Windows',
        'Linux': 'Linux',
        'macos': 'macOS'
    }
};

function formatChatContext(context: ChatContextResult | ProjectContextResult): void {
    type KnownKeys = 'language' | 'standardVersion' | 'compiler' | 'targetPlatform';
    for (const key in knownValues) {
        const knownKey = key as KnownKeys;
        if (knownValues[knownKey] && context[knownKey]) {
            // Clear the value if it's not in the known values.
            context[knownKey] = knownValues[knownKey][context[knownKey]] || "";
        }
    }
}

export interface ProjectContext {
    language: string;
    standardVersion: string;
    compiler: string;
    targetPlatform: string;
    targetArchitecture: string;
    compilerArguments: Record<string, string>;
}

export function getCompilerArgumentFilterMap(compiler: string, context: { flags: Record<string, unknown> }): Record<string, string> | undefined {
    // The copilotcppXXXCompilerArgumentFilters are maps.
    // The keys are regex strings and the values, if not empty, are the prompt text to use when no arguments are found.
    let filterMap: Record<string, string> | undefined;
    try {
        switch (compiler) {
            case MSVC:
                if (context.flags.copilotcppMsvcCompilerArgumentFilter !== undefined) {
                    filterMap = JSON.parse(context.flags.copilotcppMsvcCompilerArgumentFilter as string);
                }
                break;
            case Clang:
                if (context.flags.copilotcppClangCompilerArgumentFilter !== undefined) {
                    filterMap = JSON.parse(context.flags.copilotcppClangCompilerArgumentFilter as string);
                }
                break;
            case GCC:
                if (context.flags.copilotcppGccCompilerArgumentFilter !== undefined) {
                    filterMap = JSON.parse(context.flags.copilotcppGccCompilerArgumentFilter as string);
                }
                break;
        }
    }
    catch {
        // Intentionally swallow any exception.
    }
    return filterMap;
}

function filterCompilerArguments(compiler: string, compilerArguments: string[], context: { flags: Record<string, unknown> }, telemetryProperties: Record<string, string>): Record<string, string> {
    const filterMap = getCompilerArgumentFilterMap(compiler, context);
    if (filterMap === undefined) {
        return {};
    }

    const combinedArguments = compilerArguments.join(' ');
    const result: Record<string, string> = {};
    const filteredCompilerArguments: string[] = [];
    for (const key in filterMap) {
        if (!key) {
            continue;
        }
        const filter = new RegExp(key, 'g');
        const filtered = combinedArguments.match(filter);
        if (filtered) {
            filteredCompilerArguments.push(...filtered);
            result[key] = filtered[filtered.length - 1];
        }
    }

    if (filteredCompilerArguments.length > 0) {
        // Telemetry to learn about the argument distribution. The filtered arguments are expected to be non-PII.
        telemetryProperties["filteredCompilerArguments"] = filteredCompilerArguments.join(',');
        telemetryProperties["filters"] = Object.keys(filterMap).filter(filter => !!filter).join(',');
    }

    return result;
}

export async function getProjectContext(uri: vscode.Uri, context: { flags: Record<string, unknown> }, token: vscode.CancellationToken): Promise<ProjectContext | undefined> {
    const telemetryProperties: Record<string, string> = {};
    const telemetryMetrics: Record<string, number> = {};
    try {
        const projectContext = await checkDuration<ProjectContextResult | undefined>(async () => await getClients()?.ActiveClient?.getProjectContext(uri, token) ?? undefined);
        telemetryMetrics["duration"] = projectContext.duration;
        if (!projectContext.result) {
            return undefined;
        }

        formatChatContext(projectContext.result);

        const result: ProjectContext = {
            language: projectContext.result.language,
            standardVersion: projectContext.result.standardVersion,
            compiler: projectContext.result.compiler,
            targetPlatform: projectContext.result.targetPlatform,
            targetArchitecture: projectContext.result.targetArchitecture,
            compilerArguments: {}
        };

        if (projectContext.result.language) {
            telemetryProperties["language"] = projectContext.result.language;
        }
        if (projectContext.result.compiler) {
            telemetryProperties["compiler"] = projectContext.result.compiler;
        }
        if (projectContext.result.standardVersion) {
            telemetryProperties["standardVersion"] = projectContext.result.standardVersion;
        }
        if (projectContext.result.targetPlatform) {
            telemetryProperties["targetPlatform"] = projectContext.result.targetPlatform;
        }
        if (projectContext.result.targetArchitecture) {
            telemetryProperties["targetArchitecture"] = projectContext.result.targetArchitecture;
        }
        telemetryMetrics["compilerArgumentCount"] = projectContext.result.fileContext.compilerArguments.length;
        result.compilerArguments = filterCompilerArguments(projectContext.result.compiler, projectContext.result.fileContext.compilerArguments, context, telemetryProperties);

        return result;
    }
    catch (exception) {
        try {
            const err: Error = exception as Error;
            logger.getOutputChannelLogger().appendLine(localize("copilot.projectcontext.error", "Error while retrieving the project context. Reason: {0}", err.message));
        }
        catch {
            // Intentionally swallow any exception.
        }
        telemetryProperties["error"] = "true";
        return undefined;
    } finally {
        telemetry.logCopilotEvent('ProjectContext', telemetryProperties, telemetryMetrics);
    }
}

export class CppConfigurationLanguageModelTool implements vscode.LanguageModelTool<void> {
    public async invoke(options: vscode.LanguageModelToolInvocationOptions<void>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(await this.getContext(token))]);
    }

    private async getContext(token: vscode.CancellationToken): Promise<string> {
        const telemetryProperties: Record<string, string> = {};
        try {
            const currentDoc = vscode.window.activeTextEditor?.document;
            if (!currentDoc || (!util.isCpp(currentDoc) && !util.isHeaderFile(currentDoc.uri))) {
                return 'The active document is not a C, C++, or CUDA file.';
            }

            const chatContext: ChatContextResult | undefined = await (getClients()?.ActiveClient?.getChatContext(currentDoc.uri, token) ?? undefined);
            if (!chatContext) {
                return 'No configuration information is available for the active document.';
            }

            formatChatContext(chatContext);

            let contextString = "";
            if (chatContext.language) {
                contextString += `The user is working on a ${chatContext.language} project. `;
                telemetryProperties["language"] = chatContext.language;
            }
            if (chatContext.standardVersion) {
                contextString += `The project uses language version ${chatContext.standardVersion}. `;
                telemetryProperties["standardVersion"] = chatContext.standardVersion;
            }
            if (chatContext.compiler) {
                contextString += `The project compiles using the ${chatContext.compiler} compiler. `;
                telemetryProperties["compiler"] = chatContext.compiler;
            }
            if (chatContext.targetPlatform) {
                contextString += `The project targets the ${chatContext.targetPlatform} platform. `;
                telemetryProperties["targetPlatform"] = chatContext.targetPlatform;
            }
            if (chatContext.targetArchitecture) {
                contextString += `The project targets the ${chatContext.targetArchitecture} architecture. `;
                telemetryProperties["targetArchitecture"] = chatContext.targetArchitecture;
            }

            return contextString;
        }
        catch {
            await this.reportError();
            telemetryProperties["error"] = "true";
            return "";
        } finally {
            telemetry.logCopilotEvent('Chat/Tool/cpp', telemetryProperties);
        }
    }

    private async reportError(): Promise<void> {
        try {
            logger.getOutputChannelLogger().appendLine(localize("copilot.cppcontext.error", "Error while retrieving the #cpp context."));
        }
        catch {
            // Intentionally swallow any exception.
        }
    }
}
