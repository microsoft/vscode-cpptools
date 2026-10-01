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

    it('ignores unset and non-string values', () => {
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