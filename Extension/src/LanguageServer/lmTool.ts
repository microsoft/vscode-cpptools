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
import { ChatContextResult } from './client';
import { getClients } from './extension';

const knownValues: { [Property in keyof ChatContextResult]?: { [id: string]: string } } = {
    language: {
        'c': 'C',
        'cpp': 'C++',
        'cuda-cpp': 'CUDA C++'
    },
    compiler: {
        'msvc': 'MSVC',
        'clang': 'Clang',
        'gcc': 'GCC'
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

const plainTextContentType = 'text/plain';

export class CppConfigurationLanguageModelTool implements vscode.LanguageModelTool<void> {
    public async invoke(options: vscode.LanguageModelToolInvocationOptions<void>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        const result: vscode.LanguageModelToolResult = {};
        if (options.requestedContentTypes.includes(plainTextContentType)) {
            result[plainTextContentType] = await this.getContext(token);
        }
        return result;
    }

    private async getContext(token: vscode.CancellationToken): Promise<string> {
        try {
            const currentDoc = vscode.window.activeTextEditor?.document;
            if (!currentDoc || (!util.isCpp(currentDoc) && !util.isHeaderFile(currentDoc.uri))) {
                return 'The active document is not a C, C++, or CUDA file.';
            }

            const chatContext: ChatContextResult | undefined = await (getClients()?.ActiveClient?.getChatContext(token) ?? undefined);
            if (!chatContext) {
                return 'No configuration information is available for the active document.';
            }

            telemetry.logLanguageModelToolEvent(
                'cpp',
                {
                    "language": chatContext.language,
                    "compiler": chatContext.compiler,
                    "standardVersion": chatContext.standardVersion,
                    "targetPlatform": chatContext.targetPlatform,
                    "targetArchitecture": chatContext.targetArchitecture
                });

            for (const key in knownValues) {
                const knownKey = key as keyof ChatContextResult;
                if (knownValues[knownKey] && chatContext[knownKey]) {
                    chatContext[knownKey] = knownValues[knownKey][chatContext[knownKey]] || chatContext[knownKey];
                }
            }

            return `The user is working on a ${chatContext.language} project. The project uses language version ${chatContext.standardVersion}, compiles using the ${chatContext.compiler} compiler, targets the ${chatContext.targetPlatform} platform, and targets the ${chatContext.targetArchitecture} architecture.`;
        }
        catch {
            await this.reportError();
            return "";
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
