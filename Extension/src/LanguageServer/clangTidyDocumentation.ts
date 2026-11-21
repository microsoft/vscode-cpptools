/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * The clang-tidy documentation is published per major LLVM release, so a check's page lives
 * under the .1.0 release of the major the binary in use comes from: 23.1.0 and 22.1.0 have
 * pages, 23.1.1 and 22.1.3 do not. Checks added in a newer major have no page in an older one,
 * so the URL follows the binary in use rather than the release bundled with the extension.
 * When the version in use could not be determined, fall back to the bundled release.
 */
const versionPattern: RegExp = /^([0-9]+)\.[0-9]+\.[0-9]+$/;

/**
 * The version token `clang-tidy --version` reports, exactly as written.
 *
 * A release prints a plain X.Y.Z, but a development build prints a suffix (24.0.0git) and a
 * prerelease prints one too (19.1.0-rc1). The suffix is kept so that documentationRelease can
 * reject those: the .1.0 page for their major is not published until that release exists, so
 * building a URL from the stripped number points at a 404.
 */
export function clangTidyVersionFromOutput(output: string): string | undefined {
    return output.match(/(\d+\.\d+\.\d+\S*)/)?.[1];
}

/** The release a clang-tidy version's documentation was published under. */
function documentationRelease(clangTidyVersion: string): string | undefined {
    const match: RegExpMatchArray | null = clangTidyVersion.match(versionPattern);
    return match ? `${match[1]}.1.0` : undefined;
}

/**
 * The clang-tidy release bundled with the extension. Its documentation is published under the
 * .1.0 release of its major, so the fallback follows this rather than spelling out a URL version.
 */
export const bundledClangTidyVersion: string = '23.1.1';

export const fallbackClangTidyDocVersion: string = documentationRelease(bundledClangTidyVersion) ?? '23.1.0';

export function getClangTidyDocumentationUrl(docPage: string, clangTidyVersion?: string): string {
    const release: string | undefined = clangTidyVersion ? documentationRelease(clangTidyVersion) : undefined;
    return `https://releases.llvm.org/${release ?? fallbackClangTidyDocVersion}/tools/clang/tools/extra/docs/clang-tidy/${docPage}`;
}
