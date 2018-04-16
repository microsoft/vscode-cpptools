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
    includePaths: string[];    // This must also include the system include path (compiler defaults)
    defines: string[];        // This must also include the compiler default defines (_MSC_VER, __cplusplus, etc)
    intelliSenseMode: string; // Probably just ‘msvc-x64’ for Windows
    forcedInclude?: string[]; // Any files that need to be included before the source file is parsed
   standard: string;         // This is the C or C++ standard (language server will determine if the file is C or C++ based on this)
}
 
export interface CustomConfigurationProvider {
    name: string;
    provideConfiguration(uri: vscode.Uri, callback: (config: SourceFileConfiguration) => any): void;
}