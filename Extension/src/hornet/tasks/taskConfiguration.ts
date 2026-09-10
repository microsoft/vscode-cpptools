export interface QuotedArgument { value: string; quoting: 'escape' | 'strong' | 'weak'; }
export interface BuildConfiguration {
    command: string | QuotedArgument;
    args?: (string | QuotedArgument)[];
    options?: { cwd?: string };
    problemMatcher?: string | string[];
    detail?: string;
}
export interface PlatformBuildConfiguration extends BuildConfiguration {
    windows?: Partial<BuildConfiguration>;
    linux?: Partial<BuildConfiguration>;
    osx?: Partial<BuildConfiguration>;
}

/** VS Code uses `osx` for macOS task overrides, while Node calls the host `darwin`. */
export function resolveBuildConfiguration(configuration: PlatformBuildConfiguration, platform: NodeJS.Platform): BuildConfiguration {
    const override = platform === 'win32' ? configuration.windows : platform === 'darwin' ? configuration.osx : platform === 'linux' ? configuration.linux : undefined;
    return { ...configuration, ...override, options: { ...configuration.options, ...override?.options } };
}
