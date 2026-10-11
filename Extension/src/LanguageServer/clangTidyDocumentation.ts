/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * The clang-tidy documentation is published for every LLVM release, so the URL of a check's
 * page depends on the release the clang-tidy binary in use comes from. Checks added in a
 * newer release have no page at all in an older one. When the version in use could not be
 * determined, fall back to the release bundled with the extension.
 */
export const fallbackClangTidyDocVersion: string = '23.1.0';

const versionPattern: RegExp = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export function getClangTidyDocumentationUrl(docPage: string, clangTidyVersion?: string): string {
    const version: string = clangTidyVersion && versionPattern.test(clangTidyVersion) ? clangTidyVersion : fallbackClangTidyDocVersion;
    return `https://releases.llvm.org/${version}/tools/clang/tools/extra/docs/clang-tidy/${docPage}`;
}
