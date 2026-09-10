import * as path from 'node:path';
import { realpathSync } from 'node:fs';

export interface CompileCommand {
    directory: string;
    file: string;
    arguments?: string[];
    command?: string;
    output?: string;
}

export function canonical(file: string): string {
    let result = path.resolve(file);
    try { result = realpathSync.native(result); } catch { /* Generated sources may not exist yet. */ }
    return process.platform === 'win32' ? result.toLowerCase() : result;
}

export function parseCompilationDatabase(text: string, source: string): CompileCommand[] {
    const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!Array.isArray(data)) { throw new Error(`${source}: expected an array of compile commands`); }
    return data.map((entry: unknown, index) => {
        const error = () => new Error(`${source}: invalid compile command at entry ${index + 1}`);
        if (!entry || typeof entry !== 'object') { throw error(); }
        const row = entry as Record<string, unknown>;
        if (typeof row.directory !== 'string' || !row.directory.trim() || typeof row.file !== 'string' || !row.file.trim()) { throw error(); }
        const hasArgs = Array.isArray(row.arguments) && row.arguments.length > 0 && row.arguments.every(a => typeof a === 'string') && !!row.arguments[0];
        const hasCommand = typeof row.command === 'string' && !!row.command.trim();
        if ((!hasArgs && !hasCommand) || (row.arguments !== undefined && !hasArgs)) { throw error(); }
        const directory = path.resolve(path.dirname(source), row.directory);
        return {
            directory,
            file: path.resolve(directory, row.file),
            ...(hasArgs ? { arguments: row.arguments as string[] } : { command: row.command as string }),
            ...(typeof row.output === 'string' ? { output: path.resolve(directory, row.output) } : {})
        };
    });
}

export function mergeCompilationDatabases(sources: { path: string; commands: CompileCommand[] }[]): {
    commands: CompileCommand[]; provenance: Record<string, string>;
} {
    const merged = new Map<string, CompileCommand>();
    const provenance: Record<string, string> = {};
    for (const source of sources) {
        for (const command of source.commands) {
            const key = canonical(command.file);
            merged.set(key, command);
            provenance[key] = source.path;
        }
    }
    return { commands: [...merged.values()].sort((a, b) => a.file.localeCompare(b.file)), provenance };
}
