import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { canonical, CompileCommand, mergeCompilationDatabases, parseCompilationDatabase } from './compileCommandsParser';
import { discoverCompilationDatabase } from './databaseDiscovery';

export class CompileCommandsManager implements vscode.Disposable {
    readonly directory: string;
    private commands = new Map<string, CompileCommand>();
    private importedSources: string[] = [];
    private watchers: vscode.Disposable[] = [];
    private timer?: NodeJS.Timeout;
    private queue: Promise<void> = Promise.resolve();
    private disposed = false;
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;
    constructor(readonly root: vscode.WorkspaceFolder, private readonly log: (text: string) => void) {
        this.directory = path.join(root.uri.fsPath, '.vscode', 'hornet', 'compile-db');
    }
    get size() { return this.commands.size; }
    get(file: string) { return this.commands.get(canonical(file)); }
    hasUri(uri: string) { return this.get(vscode.Uri.parse(uri).fsPath) !== undefined; }

    async initialize(): Promise<void> {
        const sidecar = path.join(this.directory, 'sources.json');
        try {
            const metadata = JSON.parse(await fs.readFile(sidecar, 'utf8')) as { sources: string[]; imports?: string[]; automaticSource?: string };
            if (!Array.isArray(metadata.sources) || !metadata.sources.every(source => typeof source === 'string' && path.isAbsolute(source))) {
                throw new Error('Invalid sources.json');
            }
            const legacyDefaults = ['compile_commands.json', path.join('build', 'compile_commands.json')].map(file => canonical(path.join(this.root.uri.fsPath, file)));
            const imported = metadata.imports ?? metadata.sources.filter(source => source !== metadata.automaticSource && !legacyDefaults.includes(canonical(source)));
            if (!Array.isArray(imported) || !imported.every(source => typeof source === 'string' && path.isAbsolute(source))) throw new Error('Invalid imported compilation database paths');
            this.importedSources = imported;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.log(String(error)); }
        }
        await this.reload();
        if (this.disposed) { return; }
        const discovery = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, '**/{compile_commands.json,CMakePresets.json,CMakeUserPresets.json}'));
        const detect = (uri: vscode.Uri) => {
            const relative = path.relative(this.directory, uri.fsPath);
            if (!relative.startsWith('..') && !path.isAbsolute(relative)) return;
            this.scheduleReload();
        };
        discovery.onDidCreate(detect);
        discovery.onDidChange(detect);
        discovery.onDidDelete(detect);
        this.watchers.push(discovery);
    }

    private scheduleReload() {
        if (this.disposed) { return; }
        if (this.timer) { clearTimeout(this.timer); }
        this.timer = setTimeout(() => { void this.reload().catch(error => this.log(String(error))); }, 350);
    }
    private serialize(action: () => Promise<void>): Promise<void> {
        const operation = this.queue.then(async () => { if (!this.disposed) { await action(); } });
        this.queue = operation.catch(() => {});
        return operation;
    }
    async import(paths: string[]): Promise<void> {
        return this.serialize(async () => {
            // Validate every input before replacing any previous database or source list.
            const incoming = paths.map(source => path.resolve(source));
            if (incoming.some(source => canonical(source) === canonical(path.join(this.directory, 'compile_commands.json')))) {
                throw new Error('Select an original compilation database, not Hornet’s merged output.');
            }
            for (const source of incoming) { parseCompilationDatabase(await fs.readFile(source, 'utf8'), source); }
            const next = [...this.importedSources.filter(source => !incoming.includes(source)), ...incoming];
            await this.refreshSources(next);
        });
    }
    async reload(notify = true): Promise<void> { return this.serialize(() => this.refreshSources(this.importedSources, notify)); }

    private async refreshSources(imported: string[], notify = true): Promise<void> {
        const cmake = vscode.workspace.getConfiguration('cmake', this.root.uri);
        const automaticSource = await discoverCompilationDatabase(this.root.uri.fsPath, {
            preset: cmake.get<string>('defaultConfigurePreset'), buildDirectory: cmake.get<string>('buildDirectory'), log: this.log
        });
        const next = automaticSource && !imported.some(source => canonical(source) === canonical(automaticSource)) ? [automaticSource, ...imported] : imported;
        if (automaticSource) this.log(`Using build configuration: ${automaticSource}`);
        await this.loadSources(next, notify, automaticSource, imported);
    }

    private async loadSources(sources: string[], notify: boolean, automaticSource: string | undefined, imported: string[]): Promise<void> {
        const loaded: { path: string; commands: CompileCommand[] }[] = [];
        for (const source of sources) {
            try { loaded.push({ path: source, commands: parseCompilationDatabase(await fs.readFile(source, 'utf8'), source) }); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
                this.log(`Compilation database removed or unavailable: ${source}`);
            }
        }
        const merged = mergeCompilationDatabases(loaded);
        await this.ensureSafeDirectory();
        await this.writeJson('compile_commands.json', merged.commands);
        await this.writeJson('sources.json', { version: 2, sources, automaticSource, imports: imported, provenance: merged.provenance });
        if (this.disposed) { return; }
        this.importedSources = imported;
        this.commands = new Map(merged.commands.map(command => [canonical(command.file), command]));
        // External imported databases also need watching; retain discovery as the last watcher.
        for (const watcher of this.sourceWatchers) { watcher.dispose(); }
        this.sourceWatchers = sources.map(source => {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(source)), path.basename(source)));
            watcher.onDidChange(() => this.scheduleReload());
            watcher.onDidCreate(() => this.scheduleReload());
            watcher.onDidDelete(() => this.scheduleReload());
            return watcher;
        });
        this.log(`Compilation database: ${this.commands.size} files from ${loaded.length} sources`);
        if (notify) { this.changed.fire(); }
    }
    private sourceWatchers: vscode.Disposable[] = [];

    private async ensureSafeDirectory(): Promise<void> {
        const root = canonical(this.root.uri.fsPath);
        let current = this.root.uri.fsPath;
        for (const segment of ['.vscode', 'hornet', 'compile-db']) {
            current = path.join(current, segment);
            try { await fs.mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { throw error; } }
            const relative = path.relative(root, canonical(current));
            if (relative.startsWith('..') || path.isAbsolute(relative)) { throw new Error('Hornet configuration directory escapes the workspace through a symlink.'); }
        }
    }
    private async writeJson(name: string, data: unknown) {
        const destination = path.join(this.directory, name);
        const temp = `${destination}.${process.pid}.tmp`;
        // Exclusive creation prevents following a pre-existing symlink for the temporary output.
        await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
        try { await fs.rename(temp, destination); } finally { await fs.unlink(temp).catch(() => {}); }
    }
    async export(destination: string): Promise<void> {
        await fs.writeFile(destination, JSON.stringify([...this.commands.values()], null, 2) + '\n');
    }
    dispose() {
        this.disposed = true;
        if (this.timer) { clearTimeout(this.timer); }
        [...this.watchers, ...this.sourceWatchers].forEach(watcher => watcher.dispose());
        this.changed.dispose();
    }
}
