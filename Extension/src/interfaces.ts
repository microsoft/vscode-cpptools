/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

export interface ICppTools {
    registerConfigurations(configurations: Configuration[]): void;
}

export interface Browse {
    path?: string[];
    limitSymbolsToIncludedHeaders?: boolean;
    databaseFilename?: string;
}

export interface Configuration {
    name: string;
    compilerPath?: string;
    cStandard?: string;
    cppStandard?: string;
    includePath?: string[];
    macFrameworkPath?: string[];
    defines?: string[];
    intelliSenseMode?: string;
    compileCommands?: string;
    forcedInclude?: string[];
    browse?: Browse;
}

export interface CompilerDefaults {
    compilerPath: string;
    cStandard: string;
    cppStandard: string;
    includes: string[];
    frameworks: string[];
}

export interface ConfigurationJson {
    configurations: Configuration[];
    version: number;
}