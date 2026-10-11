/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { strictEqual } from 'node:assert';
import { fallbackClangTidyDocVersion, getClangTidyDocumentationUrl } from '../../src/LanguageServer/clangTidyDocumentation';

const bundledDocUrl: string = `https://releases.llvm.org/${fallbackClangTidyDocVersion}/tools/clang/tools/extra/docs/clang-tidy`;

describe('clang-tidy documentation URLs', () => {
    it('points at the clang-tidy version in use', () => {
        strictEqual(
            getClangTidyDocumentationUrl('checks/readability/use-std-min-max.html', '19.1.0'),
            'https://releases.llvm.org/19.1.0/tools/clang/tools/extra/docs/clang-tidy/checks/readability/use-std-min-max.html');
    });

    it('falls back to the bundled version when the version in use is unknown', () => {
        strictEqual(getClangTidyDocumentationUrl('checks/misc/include-cleaner.html'), `${bundledDocUrl}/checks/misc/include-cleaner.html`);
        strictEqual(getClangTidyDocumentationUrl('checks/misc/include-cleaner.html', ''), `${bundledDocUrl}/checks/misc/include-cleaner.html`);
        strictEqual(getClangTidyDocumentationUrl('checks/misc/include-cleaner.html', '23.1'), `${bundledDocUrl}/checks/misc/include-cleaner.html`);
    });
});
