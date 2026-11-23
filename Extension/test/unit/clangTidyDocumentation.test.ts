/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { strictEqual } from 'node:assert';
import { bundledClangTidyVersion, clangTidyVersionFromOutput, fallbackClangTidyDocVersion, getClangTidyDocumentationUrl } from '../../src/LanguageServer/clangTidyDocumentation';

const bundledDocUrl: string = `https://releases.llvm.org/${fallbackClangTidyDocVersion}/tools/clang/tools/extra/docs/clang-tidy`;

describe('clang-tidy documentation URLs', () => {
    it('points at the clang-tidy version in use', () => {
        strictEqual(
            getClangTidyDocumentationUrl('checks/readability/use-std-min-max.html', '19.1.0'),
            'https://releases.llvm.org/19.1.0/tools/clang/tools/extra/docs/clang-tidy/checks/readability/use-std-min-max.html');
    });

    it('uses the .1.0 release of that major, since patch releases have no page', () => {
        strictEqual(
            getClangTidyDocumentationUrl('checks/readability/use-std-min-max.html', '23.1.1'),
            'https://releases.llvm.org/23.1.0/tools/clang/tools/extra/docs/clang-tidy/checks/readability/use-std-min-max.html');
        strictEqual(
            getClangTidyDocumentationUrl('checks/misc/include-cleaner.html', '22.1.3'),
            'https://releases.llvm.org/22.1.0/tools/clang/tools/extra/docs/clang-tidy/checks/misc/include-cleaner.html');
    });

    it('falls back to the bundled version when the version in use is unknown', () => {
        strictEqual(getClangTidyDocumentationUrl('checks/misc/include-cleaner.html'), `${bundledDocUrl}/checks/misc/include-cleaner.html`);
        strictEqual(getClangTidyDocumentationUrl('checks/misc/include-cleaner.html', ''), `${bundledDocUrl}/checks/misc/include-cleaner.html`);
        strictEqual(getClangTidyDocumentationUrl('checks/misc/include-cleaner.html', '23.1'), `${bundledDocUrl}/checks/misc/include-cleaner.html`);
    });

    it('keeps the fallback on the release the bundled binary belongs to', () => {
        // The fallback is only correct while it matches what the bundled clang-tidy would produce,
        // which is the point of deriving it from the bundled version instead of a literal URL.
        strictEqual(
            getClangTidyDocumentationUrl('checks/misc/include-cleaner.html', bundledClangTidyVersion),
            getClangTidyDocumentationUrl('checks/misc/include-cleaner.html'));
    });

    it('reads the version token clang-tidy reports, suffix included', () => {
        // What `clang-tidy --version` prints.
        strictEqual(clangTidyVersionFromOutput('LLVM (http://llvm.org/):\n  LLVM version 19.1.0\n  Optimized build.'), '19.1.0');
        strictEqual(clangTidyVersionFromOutput('LLVM (http://llvm.org/):\n  LLVM version 24.0.0git\n  Optimized build.'), '24.0.0git');
        strictEqual(clangTidyVersionFromOutput('LLVM version 19.1.0-rc1'), '19.1.0-rc1');
        strictEqual(clangTidyVersionFromOutput('no version here'), undefined);
    });

    it('falls back for a build whose release has no documentation page yet', () => {
        // 24.0.0git would otherwise produce a 24.1.0 URL, and that page does not exist until the
        // 24.1.0 release ships; the same goes for a prerelease of a published major.
        for (const version of ['24.0.0git', '19.1.0-rc1', '25.0.0svn']) {
            strictEqual(
                getClangTidyDocumentationUrl('checks/readability/use-std-min-max.html', version),
                `${bundledDocUrl}/checks/readability/use-std-min-max.html`,
                version);
        }
    });
});
