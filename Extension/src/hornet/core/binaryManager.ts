import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { constants } from 'node:fs';

export class BackendNotFoundError extends Error {
    constructor(readonly executable: string, detail?: string) {
        super(detail ? `Automatic clangd setup failed: ${detail}. Click Hornet to retry.`
            : `Cannot find ${executable} on the workspace host. Click Hornet to retry automatic clangd setup.`);
        this.name = 'BackendNotFoundError';
    }
}

export interface BinaryDiscoveryOptions {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    storagePath?: string;
    extraCandidates?: string[];
}

/** Only known tool locations are searched, never workspace executables. */
export function clangdInstallRoots(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, storagePath?: string): string[] {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const roots: string[] = [];
    if (storagePath) {
        roots.push(paths.join(storagePath, 'clangd'));
        roots.push(paths.join(paths.dirname(storagePath), 'llvm-vs-code-extensions.vscode-clangd', 'install'));
    }
    const home = env.USERPROFILE ?? env.HOME;
    const data = platform === 'win32' ? env.APPDATA : platform === 'darwin' && home ? paths.join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME ?? (home && paths.join(home, '.config'));
    if (data) {
        for (const product of ['Code', 'Code - Insiders', 'VSCodium']) {
            roots.push(paths.join(data, product, 'User', 'globalStorage', 'llvm-vs-code-extensions.vscode-clangd', 'install'));
        }
    }
    if (home) {
        for (const server of ['.vscode-server', '.vscode-server-insiders']) {
            roots.push(paths.join(home, server, 'data', 'User', 'globalStorage', 'llvm-vs-code-extensions.vscode-clangd', 'install'));
        }
    }
    return [...new Set(roots)];
}

export function clangdCandidates(configured: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const executable = configured.trim() || 'clangd';
    if (paths.isAbsolute(executable)) { return [executable]; }
    if (/[/\\]/.test(executable)) { throw new Error('hornet-cpp.clangd.path must be an absolute executable path or a name on PATH.'); }
    const filename = platform === 'win32' && !paths.extname(executable) ? `${executable}.exe` : executable;
    const candidates = (env.PATH ?? env.Path ?? '').split(paths.delimiter).map(dir => dir.trim().replace(/^"(.*)"$/, '$1'))
        .filter(dir => dir && paths.isAbsolute(dir)).map(dir => paths.join(dir, filename));
    // Respect explicit custom executable names; auto-discover only the default clangd.
    if (!['clangd', 'clangd.exe'].includes(executable)) { return candidates; }
    if (platform === 'win32') {
        const add = (base: string | undefined, ...segments: string[]) => { if (base && paths.isAbsolute(base)) { candidates.push(paths.join(base, ...segments, 'clangd.exe')); } };
        add(env.ProgramFiles ?? env.PROGRAMFILES, 'LLVM', 'bin');
        add(env['ProgramFiles(x86)'], 'LLVM', 'bin');
        add(env.LOCALAPPDATA, 'Programs', 'LLVM', 'bin');
        add(env.USERPROFILE, 'scoop', 'apps', 'llvm', 'current', 'bin');
        add(env.SCOOP, 'apps', 'llvm', 'current', 'bin');
    } else if (platform === 'darwin') {
        candidates.push('/opt/homebrew/opt/llvm/bin/clangd', '/usr/local/opt/llvm/bin/clangd', '/opt/homebrew/bin/clangd', '/usr/local/bin/clangd', '/usr/bin/clangd');
    } else {
        candidates.push('/usr/bin/clangd', '/usr/local/bin/clangd');
    }
    return [...new Set(candidates)];
}

export class BinaryManager {
    constructor(private readonly options: BinaryDiscoveryOptions = {}) {}
    async ensure(configured: string, install: () => Promise<string>): Promise<string> {
        try { return await this.resolve(configured); }
        catch (error) {
            if (!(error instanceof BackendNotFoundError) || !['', 'clangd', 'clangd.exe'].includes(configured.trim())) { throw error; }
            try { return await install(); }
            catch (failure) { throw new BackendNotFoundError(configured, failure instanceof Error ? failure.message : String(failure)); }
        }
    }
    async resolve(configured: string): Promise<string> {
        const executable = configured.trim() || 'clangd';
        const platform = this.options.platform ?? process.platform;
        const env = this.options.env ?? process.env;
        const candidates = clangdCandidates(configured, platform, env);
        const automatic = ['clangd', 'clangd.exe'].includes(executable);
        if (automatic) { candidates.push(...(this.options.extraCandidates ?? [])); }
        if (platform === 'linux' && automatic) {
            try {
                const versions = (await fs.readdir('/usr/lib')).filter(dir => /^llvm-\d+$/.test(dir))
                    .sort((a, b) => Number(b.slice(5)) - Number(a.slice(5)));
                candidates.push(...versions.map(dir => path.join('/usr/lib', dir, 'bin', 'clangd')));
            } catch { /* Versioned distro installations are optional. */ }
        }
        if (automatic) {
            const filename = platform === 'win32' ? 'clangd.exe' : 'clangd';
            const visit = async (directory: string, depth: number): Promise<void> => {
                if (depth < 0) { return; }
                try {
                    const entries = (await fs.readdir(directory, { withFileTypes: true }))
                        .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
                    for (const entry of entries) {
                        const full = path.join(directory, entry.name);
                        if (entry.isFile() && entry.name === filename) { candidates.push(full); }
                        else if (entry.isDirectory() && !entry.name.startsWith('.')) { await visit(full, depth - 1); }
                    }
                } catch { /* Optional editor-managed installation. */ }
            };
            for (const root of clangdInstallRoots(platform, env, this.options.storagePath)) { await visit(root, 4); }
            if (platform === 'win32') {
                for (const base of [env.ProgramFiles, env['ProgramFiles(x86)']].filter((value): value is string => !!value)) {
                    const root = path.join(base, 'Microsoft Visual Studio');
                    try {
                        for (const year of await fs.readdir(root)) {
                            if (!/^\d{4}$/.test(year)) { continue; }
                            for (const edition of ['Community', 'Professional', 'Enterprise', 'BuildTools']) {
                                candidates.push(path.join(root, year, edition, 'VC', 'Tools', 'Llvm', 'x64', 'bin', filename));
                                candidates.push(path.join(root, year, edition, 'VC', 'Tools', 'Llvm', 'bin', filename));
                            }
                        }
                    } catch { /* Visual Studio is optional. */ }
                }
            }
        }
        for (const candidate of candidates) {
            try {
                await fs.access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
                if ((await fs.stat(candidate)).isFile()) { return await fs.realpath(candidate); }
            } catch { /* Try next PATH entry. */ }
        }
        throw new BackendNotFoundError(executable);
    }
}
