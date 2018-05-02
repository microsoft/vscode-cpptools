/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';

/**
 * An interface to allow Custom Configuration Provider extensions to communicate with this extension.
 */
export interface CppToolsApi {
    /**
     * Register the Custom Configuration Provider.
     * This must be called as soon as the provider extension is ready. This is necessary for cpptools
     * to request configurations from the provider.
     * @param provider An instance of the @see CustomConfigurationProvider instance representing the
     * provider extension.
     */
    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void;
    /**
     * Notifies cpptools that the current configuration has changed. Upon receiving this notification,
     * cpptools will request for the new configurations.
     * @param provider An instance of the CustomConfigurationProvider instance representing the
     * provider extension.
     */
    didCustomConfigurationChange(provider: CustomConfigurationProvider): void;
}

/**
 * An interface to allow this extension to communicate with Custom Configuration Provider extensions
 */
export interface CustomConfigurationProvider {
    /**
     * The name of the Custom Configuration Provider extension
     */
    name: string;

    /**
     * A request to determine whether this provider can provide IntelliSense configurations for the given document.
     * @param uri The URI of the document
     * @param token Optional - The cancellation token
     * @returns 'true' if this provider can provide IntelliSense configurations for the given document.
     */
    canProvideConfiguration(uri: vscode.Uri, token?: CancellationToken): Thenable<boolean>;

    /**
     * A request to get Intellisense configurations for the given files.
     * @param uris A list of one of more URIs for the files to provide configurations for
     * @param token Optional - The cancellation token
     * @returns An list of @see SourceFileConfigurationItem for the documents that this provider is able to provide IntelliSense
     * configurations for.
     * Note: If this provider cannot provide configurations for a file in @param uris, then the file will not be included
     * in the return value. An empty list will be returned if the provider cannot provide configurations for any of the files.
     */
    provideConfigurations(uris: vscode.Uri[], token?: CancellationToken): Thenable<SourceFileConfigurationItem[]>;
}

/**
 * The model representing the custom IntelliSense configurations for a source file.
 */
export interface SourceFileConfiguration {
    /**
     * This must also include the system include path (compiler defaults)
     */
    includePaths: string[];

    /**
     * This must also include the compiler default defines (__cplusplus, etc)
     */
    defines: string[];

    /**
     * "msvc-x64" or "clang-x64"
     */
    intelliSenseMode: string;

    /**
     * Any files that need to be included before the source file is parsed
     */
    forcedInclude?: string[];

    /**
     * // The C or C++ standard
     */
    standard: string;
}

/**
 * A model representing a source file and its corresponding configuration.
 */
export interface SourceFileConfigurationItem {
    /**
     * The URI of the source file.
     */
    documentUri: string;

    /**
     * The Intellisense configuration for @param documentUri
     */
    configuration: SourceFileConfiguration;
}
