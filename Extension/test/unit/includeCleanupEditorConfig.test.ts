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
            requiredFiles: 'atlwin.h:atlbase.h'
        });
    });

    it('maps property names case-insensitively', () => {
        deepStrictEqual(getIncludeCleanupPreferences({
            CPP_INCLUDE_CLEANUP_ALTERNATE_FILES: 'umbrella.h:internal.h',
            Cpp_Include_Cleanup_Excluded_Files: 'generated.h',
            cpp_INCLUDE_cleanup_REPLACEMENT_files: 'stdio.h:cstdio',
            CPP_include_cleanup_required_FILES: 'atlwin.h:atlbase.h'
        }), {
            alternateFiles: 'umbrella.h:internal.h',
            excludedFiles: 'generated.h',
            replacementFiles: 'stdio.h:cstdio',
            requiredFiles: 'atlwin.h:atlbase.h'
        });
    });

    it('maps unset and non-string values to empty strings', () => {
        deepStrictEqual(getIncludeCleanupPreferences({
            cpp_include_cleanup_alternate_files: 'unset',
            cpp_include_cleanup_excluded_files: true,
            cpp_include_cleanup_replacement_files: 42
        }), {
            alternateFiles: '',
            excludedFiles: '',
            replacementFiles: '',
            requiredFiles: ''
        });
    });
});
