export interface IncludeCleanupPreferences {
    alternateFiles: string;
    excludedFiles: string;
    replacementFiles: string;
    requiredFiles: string;
}

function getStringSetting(settings: any, key: string): string {
    const value: unknown = settings?.[key];
    return typeof value === 'string' && value.toLowerCase() !== 'unset' ? value : '';
}

export function getIncludeCleanupPreferences(settings: any): IncludeCleanupPreferences {
    return {
        alternateFiles: getStringSetting(settings, 'cpp_include_cleanup_alternate_files'),
        excludedFiles: getStringSetting(settings, 'cpp_include_cleanup_excluded_files'),
        replacementFiles: getStringSetting(settings, 'cpp_include_cleanup_replacement_files'),
        requiredFiles: getStringSetting(settings, 'cpp_include_cleanup_required_files')
    };
}