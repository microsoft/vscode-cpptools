/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { strictEqual } from 'node:assert';
import { bundledClangTidyVersion, fallbackClangTidyDocVersion, getClangTidyDocumentationUrl } from '../../src/LanguageServer/clangTidyDocumentation';

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
});
