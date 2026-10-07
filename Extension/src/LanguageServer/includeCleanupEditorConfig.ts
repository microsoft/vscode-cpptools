export interface IncludeCleanupPreferences {
    alternateFiles: string;
    excludedFiles: string;
    replacementFiles: string;
    requiredFiles: string;
}

function normalizeSettingKeys(settings: any): Record<string, unknown> {
    return Object.fromEntries(Object.entries(settings ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
}

function getStringSetting(settings: Record<string, unknown>, key: string): string {
    const value: unknown = settings?.[key];
    if (typeof value !== 'string' || value.toLowerCase() === 'unset') {
        return '';
    }
    return value;
}

export function getIncludeCleanupPreferences(settings: any): IncludeCleanupPreferences {
    const normalizedSettings: Record<string, unknown> = normalizeSettingKeys(settings);
    return {
        alternateFiles: getStringSetting(normalizedSettings, 'cpp_include_cleanup_alternate_files'),
        excludedFiles: getStringSetting(normalizedSettings, 'cpp_include_cleanup_excluded_files'),
        replacementFiles: getStringSetting(normalizedSettings, 'cpp_include_cleanup_replacement_files'),
        requiredFiles: getStringSetting(normalizedSettings, 'cpp_include_cleanup_required_files')
    };
}
