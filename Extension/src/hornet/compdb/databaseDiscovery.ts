import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface Preset { name: string; binaryDir?: string; inherits?: string | string[]; hidden?: boolean; file: string; }
export interface DiscoveryOptions { preset?: string; buildDirectory?: string; env?: NodeJS.ProcessEnv; log?: (message: string) => void; }

/** Discover build metadata, not the source tree. Never execute CMake or compiler commands. */
export async function discoverCompilationDatabase(root: string, options: DiscoveryOptions = {}): Promise<string | undefined> {
    const env = options.env ?? process.env;
    const expand = (value: string, preset = '', file = root) => value
        .replace(/\$\{(?:sourceDir|workspaceFolder)\}/g, root)
        .replace(/\$\{sourceParentDir\}/g, path.dirname(root)).replace(/\$\{sourceDirName\}/g, path.basename(root))
        .replace(/\$\{presetName\}/g, preset).replace(/\$\{fileDir\}/g, file)
        .replace(/\$(?:p?env)\{([^}]+)\}|\$\{env:([^}]+)\}/g, (_all, a: string, b: string) => env[a || b] ?? '$unresolved');
    const candidates: string[] = [];
    const add = (directory?: string) => {
        if (directory && !directory.includes('$')) candidates.push(path.resolve(root, directory, 'compile_commands.json'));
    };
    const exists = async (file: string) => fs.stat(file).then(value => value.isFile(), () => false);
    const presets = new Map<string, Preset>(), visited = new Set<string>();
    const read = async (file: string): Promise<void> => {
        file = path.resolve(file);
        if (visited.has(file) || visited.size >= 16) return;
        visited.add(file);
        try {
            if ((await fs.stat(file)).size > 2 * 1024 * 1024) return;
            const value = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
            for (const include of Array.isArray(value.include) ? value.include : []) {
                if (typeof include !== 'string') continue;
                const target = expand(include, '', path.dirname(file));
                if (!target.includes('$')) await read(path.resolve(path.dirname(file), target));
            }
            for (const preset of Array.isArray(value.configurePresets) ? value.configurePresets : []) {
                if (typeof preset?.name === 'string') presets.set(preset.name, { ...preset, file });
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') options.log?.(`Cannot read CMake presets ${file}: ${String(error)}`);
        }
    };
    await read(path.join(root, 'CMakePresets.json'));
    await read(path.join(root, 'CMakeUserPresets.json'));
    const binary = (name: string, trail = new Set<string>()): { value: string; file: string } | undefined => {
        if (trail.has(name)) return;
        const preset = presets.get(name); if (!preset) return;
        trail.add(name);
        if (typeof preset.binaryDir === 'string') return { value: preset.binaryDir, file: preset.file };
        for (const parent of typeof preset.inherits === 'string' ? [preset.inherits] : preset.inherits ?? []) {
            const inherited = binary(parent, new Set(trail)); if (inherited) return inherited;
        }
    };
    const addPreset = (name: string) => { const found = binary(name); if (found) add(expand(found.value, name, path.dirname(found.file))); };
    // An explicitly selected configuration wins. Do not merge Debug and Release together.
    if (options.preset) addPreset(options.preset);
    if (options.buildDirectory) add(expand(options.buildDirectory, options.preset));
    add(root); add(path.join(root, 'build'));
    for (const preset of presets.values()) if (!preset.hidden) addPreset(preset.name);
    for (const candidate of [...new Set(candidates)]) if (await exists(candidate)) return candidate;
    // Support ordinary multi-config builds when there are no CMake presets.
    const queue: { directory: string; depth: number }[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory() && /^(build|out|output|cmake-build-.*)$/i.test(entry.name)) queue.push({ directory: path.join(root, entry.name), depth: 0 });
    }
    let count = 0;
    while (queue.length && count++ < 128) {
        const { directory, depth } = queue.shift()!;
        const candidate = path.join(directory, 'compile_commands.json');
        if (await exists(candidate)) return candidate;
        if (depth >= 3) continue;
        try {
            for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
                if (entry.isDirectory() && !entry.name.startsWith('.') && !/^(CMakeFiles|_deps|node_modules)$/i.test(entry.name)) queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
            }
        } catch { /* Other build directories may still be readable. */ }
    }
    return undefined;
}
