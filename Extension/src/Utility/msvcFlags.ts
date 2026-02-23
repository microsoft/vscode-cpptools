/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export interface IncludePathsFromArgs {
    includePaths: string[];
    externalIncludePaths: string[];
    externalIncludeVars: string[];
}

/**
 * Parses compiler arguments for include-related flags (MSVC/clang-cl style).
 * Supports /I, /imsvc, /external:I, /external:var.
 */
export function extractIncludePathsFromArgs(args: string[]): IncludePathsFromArgs {
    const result: IncludePathsFromArgs = {
        includePaths: [],
        externalIncludePaths: [],
        externalIncludeVars: []
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("/I") || arg.startsWith("-I")) {
            let path = arg.substring(2);
            if (path === "" && i + 1 < args.length) {
                const nextArg = args[i + 1];
                if (!nextArg.startsWith("/") && !nextArg.startsWith("-")) {
                    path = args[++i];
                }
            }
            if (path !== "") {
                result.includePaths.push(path);
            }
        } else if (arg.startsWith("/imsvc") || arg.startsWith("-imsvc")) {
            let path = arg.substring(6);
            if (path === "" && i + 1 < args.length) {
                const nextArg = args[i + 1];
                if (!nextArg.startsWith("/") && !nextArg.startsWith("-")) {
                    path = args[++i];
                }
            }
            if (path !== "") {
                // imsvc is treated as a system include, so we put it in externalIncludePaths
                result.externalIncludePaths.push(path);
            }
        } else if (arg.startsWith("/external:I") || arg.startsWith("-external:I")) {
            let path = arg.substring(11);
            if (path === "" && i + 1 < args.length) {
                const nextArg = args[i + 1];
                if (!nextArg.startsWith("/") && !nextArg.startsWith("-")) {
                    path = args[++i];
                }
            }
            if (path !== "") {
                result.externalIncludePaths.push(path);
            }
        } else if (arg.startsWith("/external:var:") || arg.startsWith("-external:var:")) {

            const varName = arg.substring(14);
            if (varName !== "") {
                result.externalIncludeVars.push(varName);
            }
        }
    }

    return result;
}
