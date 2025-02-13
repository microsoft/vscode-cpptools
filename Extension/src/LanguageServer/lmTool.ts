/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as util from '../common';
import * as logger from '../logger';
import * as telemetry from '../telemetry';
import { ChatContextResult } from './client';
import { getClients } from './extension';
import { checkDuration } from './utils';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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
        'c89': "C89",
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

function formatChatContext(context: ChatContextResult): void {
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
}

export async function getProjectContext(uri: vscode.Uri, context: { flags: Record<string, unknown> }, cancellationToken: vscode.CancellationToken, telemetryProperties: Record<string, string>, telemetryMetrics: Record<string, number>): Promise<ProjectContext | undefined> {
    try {
        const chatContext = await checkDuration<ChatContextResult | undefined>(async () => await getClients()?.ActiveClient?.getChatContext(uri, cancellationToken) ?? undefined);
        telemetryMetrics["projectContextDuration"] = chatContext.duration;
        if (!chatContext.result) {
            return undefined;
        }

        const originalStandardVersion = chatContext.result.standardVersion;

        formatChatContext(chatContext.result);

        const result: ProjectContext = {
            language: chatContext.result.language,
            standardVersion: chatContext.result.standardVersion,
            compiler: chatContext.result.compiler,
            targetPlatform: chatContext.result.targetPlatform,
            targetArchitecture: chatContext.result.targetArchitecture
        };

        if (result.language) {
            telemetryProperties["language"] = result.language;
        }
        if (result.compiler) {
            telemetryProperties["compiler"] = result.compiler;
        }
        if (result.standardVersion) {
            telemetryProperties["standardVersion"] = result.standardVersion;
        }
        else {
            if (originalStandardVersion) {
                telemetryProperties["originalStandardVersion"] = originalStandardVersion;
            }
        }
        if (result.targetPlatform) {
            telemetryProperties["targetPlatform"] = result.targetPlatform;
        }
        if (result.targetArchitecture) {
            telemetryProperties["targetArchitecture"] = result.targetArchitecture;
        }

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
        telemetryProperties["projectContextError"] = "true";
        throw exception; // Throw the exception for auto-retry.
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
