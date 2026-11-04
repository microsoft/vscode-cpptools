/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { deepStrictEqual } from 'assert';
import { describe, it } from 'mocha';
import { getIncludeCleanupPreferences } from '../../src/LanguageServer/includeCleanupEditorConfig';

describe('Include Cleanup editorconfig settings', () => {
    it('maps semantic preference strings', () => {
        deepStrictEqual(getIncludeCleanupPreferences({
            cpp_include_cleanup_alternate_files: 'umbrella.h:internal.h',
            cpp_include_cleanup_excluded_files: 'generated.h',
            cpp_include_cleanup_replacement_files: 'stdio.h:cstdio',
            cpp_include_cleanup_required_files: 'atlwin.h:atlbase.h'
        }), {
            alternateFiles: 'umbrella.h:internal.h',
            excludedFiles: 'generated.h',
            replacementFiles: 'stdio.h:cstdio',
            requiredFiles: 'atlwin.h:atlbase.h',
            removeUnusedErrorTagType: 'none'
        });
    });

    it('maps property names case-insensitively', () => {
        deepStrictEqual(getIncludeCleanupPreferences({
            CPP_INCLUDE_CLEANUP_ALTERNATE_FILES: 'umbrella.h:internal.h',
            Cpp_Include_Cleanup_Excluded_Files: 'generated.h',
            cpp_INCLUDE_cleanup_REPLACEMENT_files: 'stdio.h:cstdio',
            CPP_include_cleanup_required_FILES: 'atlwin.h:atlbase.h',
            CPP_INCLUDE_CLEANUP_REMOVE_UNUSED_ERROR_TAG_TYPE: 'DiMmEd'
        }), {
            alternateFiles: 'umbrella.h:internal.h',
            excludedFiles: 'generated.h',
            replacementFiles: 'stdio.h:cstdio',
            requiredFiles: 'atlwin.h:atlbase.h',
            removeUnusedErrorTagType: 'dimmed'
        });
    });

    it('maps unset and non-string values to empty strings', () => {
        deepStrictEqual(getIncludeCleanupPreferences({
            cpp_include_cleanup_alternate_files: 'unset',
            cpp_include_cleanup_excluded_files: true,
            cpp_include_cleanup_replacement_files: 42,
            cpp_include_cleanup_remove_unused_error_tag_type: 'UNSET'
        }), {
            alternateFiles: '',
            excludedFiles: '',
            replacementFiles: '',
            requiredFiles: '',
            removeUnusedErrorTagType: 'none'
        });
    });

    it('defaults unused-include suggestions to none without EditorConfig settings', () => {
        deepStrictEqual(getIncludeCleanupPreferences(undefined), {
            alternateFiles: '',
            excludedFiles: '',
            replacementFiles: '',
            requiredFiles: '',
            removeUnusedErrorTagType: 'none'
        });
    });

    for (const level of ['none', 'suggestion', 'warning', 'error', 'dimmed']) {
        it(`transports the ${level} unused-include diagnostic level`, () => {
            deepStrictEqual(getIncludeCleanupPreferences({
                cpp_include_cleanup_remove_unused_error_tag_type: level
            }), {
                alternateFiles: '',
                excludedFiles: '',
                replacementFiles: '',
                requiredFiles: '',
                removeUnusedErrorTagType: level
            });
        });
    }
});
