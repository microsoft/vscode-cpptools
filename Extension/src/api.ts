/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';

export interface CppToolsApi {
    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void;
}

export interface SourceFileConfiguration {
    includePaths: string[];   // This must also include the system include path (compiler defaults)
    defines: string[];        // This must also include the compiler default defines (__cplusplus, etc)
    intelliSenseMode: string; // "msvc-x64" or "clang-x64"
    forcedInclude?: string[]; // Any files that need to be included before the source file is parsed
    standard: string;         // The C or C++ standard
}
 
export interface CustomConfigurationProvider {
    name: string;
    provideConfiguration(uri: vscode.Uri): Thenable<SourceFileConfiguration>;
}