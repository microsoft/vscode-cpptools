import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Bounded first-party discovery for browsing projects that have not been configured yet. */
export async function prepareCompilerConfiguration(root: string, databaseDirectory: string): Promise<{ directory: string; fallbackFlags: string[]; inferred: number; sources: string[] }> {
    const ignored = new Set(['.git', '.vscode', '.cache', 'node_modules', 'build', 'out', 'output', 'dist', 'vendor', 'third_party', 'external', '_deps']);
    const includes = new Set([root]);
    const sources: string[] = [];
    const queue = [{ directory: root, depth: 0 }];
    let visited = 0;
    // Explicit compile commands remain authoritative and are never rewritten.
    let commands: unknown[] = [];
    try { commands = JSON.parse(await fs.readFile(path.join(databaseDirectory, 'compile_commands.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
    if (!Array.isArray(commands)) { throw new Error('Expected a compilation database array.'); }
    if (commands.length) {
        const files = commands.flatMap(value => {
            const command = value as { file?: string; directory?: string };
            return typeof command.file === 'string' ? [path.resolve(command.directory || root, command.file)] : [];
        });
        return { directory: databaseDirectory, fallbackFlags: [], inferred: 0, sources: [...new Set(files)] };
    }
    while (queue.length && visited++ < 500 && sources.length < 1000) {
        const { directory, depth } = queue.shift()!;
        try {
            for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
                const full = path.join(directory, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith('.') && !ignored.has(entry.name.toLowerCase()) && !/^cmake-build-/i.test(entry.name) && depth < 6) {
                    if (/^(include|includes|inc)$/i.test(entry.name)) { includes.add(full); }
                    queue.push({ directory: full, depth: depth + 1 });
                } else if (entry.isFile() && /\.(c|cc|cpp|cxx|c\+\+)$/i.test(entry.name) && sources.length < 1000) { sources.push(full); }
            }
        } catch { /* An unreadable directory does not prevent browsing the rest. */ }
    }
    const fallbackFlags = [...includes].map(directory => `-I${directory}`);
    if (!sources.length) { return { directory: databaseDirectory, fallbackFlags, inferred: 0, sources }; }
    const directory = path.join(databaseDirectory, 'fallback');
    for (const target of [directory, path.join(directory, 'compile_commands.json')]) {
        try { if ((await fs.lstat(target)).isSymbolicLink()) { throw new Error('Fallback database must not be a symbolic link.'); } }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
    }
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'compile_commands.json'), JSON.stringify(sources.map(file => ({ directory: root, file,
        arguments: [path.extname(file) === '.c' ? 'clang' : 'clang++', ...fallbackFlags, '-c', file] })), null, 2));
    return { directory, fallbackFlags, inferred: sources.length, sources };
}
