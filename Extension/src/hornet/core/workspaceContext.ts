import * as vscode from 'vscode';
import * as lsp from 'vscode-languageserver-protocol';
import { CompileCommandsManager } from '../compdb/compileCommandsManager';
import { CompilerEngine } from '../engines/compilerEngine';
import { HybridEngine } from '../engines/hybridEngine';
import { UnavailableEngine } from '../engines/unavailableEngine';
import { IndexStatus, LanguageEngine, ParseMode } from '../engines/languageEngine';
import { ModeManager } from './modeManager';
import { ProcessManager } from './processManager';
import { CapabilityRouter } from './capabilityRouter';
import { registerLanguageProviders, toCode, toProtocol } from '../providers/languageProviders';
import { BackendNotFoundError } from './binaryManager';
import { resolveMode, ServiceState } from './serviceStatus';

export class WorkspaceContext {
    readonly database: CompileCommandsManager;
    readonly modes: ModeManager;
    readonly router: CapabilityRouter;
    private providers?: vscode.Disposable;
    private readonly diagnostics = vscode.languages.createDiagnosticCollection('hornet-cpp');
    private readonly refresh = new vscode.EventEmitter<void>();
    private readonly subscriptions: vscode.Disposable[] = [];
    private disposed = false;
    private restartTimer?: NodeJS.Timeout;
    private commandExecutions = 0;
    private readonly analysisErrors = new Map<string, string>();
    error?: string;
    state: ServiceState = 'starting';
    modeNotice?: string;
    indexStatus: IndexStatus = { state: 'idle', message: 'Waiting for language service' };
    private readonly indexChanges = new vscode.EventEmitter<IndexStatus>();
    readonly onIndexChanged = this.indexChanges.event;
    private manualIndexBuild?: Promise<void>;
    private restartPending = false;

    setFailure(error: unknown): void {
        this.error = error instanceof Error ? error.message : String(error);
        this.state = this.modes.getActiveEngine() ? 'ready' : error instanceof BackendNotFoundError ? 'needsSetup' : 'stopped';
        this.changed();
    }

    constructor(readonly root: vscode.WorkspaceFolder, readonly processes: ProcessManager,
        readonly log: (message: string) => void, private readonly changed: () => void,
        private readonly invalidate: (router: CapabilityRouter) => void,
        private readonly resolveBinary?: (configured: string) => Promise<string>) {
        this.database = new CompileCommandsManager(root, log);
        this.modes = new ModeManager(mode => this.createEngine(mode), (engine, error) => {
            this.error = error ? (error instanceof Error ? error.message : String(error)) : undefined;
            this.state = engine ? 'ready' : error ? (error instanceof BackendNotFoundError ? 'needsSetup' : 'stopped') : 'starting';
            this.updateProviders(engine);
            this.changed();
        });
        this.router = new CapabilityRouter(this.modes, uri => this.owns(vscode.Uri.parse(uri)));
    }
    owns(uri: vscode.Uri) { return vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === this.root.uri.toString(); }
    accepts(document: vscode.TextDocument) { return this.owns(document.uri) && ['c', 'cpp', 'cuda-cpp'].includes(document.languageId); }
    callGraphNotice(): string | undefined {
        const parseError = this.analysisErrors.values().next().value;
        if (parseError) { return `部分文件存在解析错误，调用关系可能不完整：${parseError}`; }
        return this.database.size ? undefined : '未找到编译数据库，当前使用自动发现的头文件目录和推断参数。宏与条件编译请以项目的 compile_commands.json 为准。';
    }
    private createEngine(mode: ParseMode): LanguageEngine {
        if (mode === ParseMode.Tag || mode === ParseMode.Flyweight) { return new UnavailableEngine(mode); }
        const compiler = new CompilerEngine(this.processes, {
            root: this.root, databaseDirectory: this.database.directory, log: this.log,
            diagnostics: params => { void this.publishDiagnostics(params).catch(error => this.log(String(error))); },
            changed: () => {
                const engine = this.modes.getActiveEngine();
                this.state = engine && Object.keys(engine.getCapabilities()).length ? 'ready' : 'stopped';
                this.refresh.fire(); this.updateProviders(engine); this.changed();
            },
            refresh: () => this.refresh.fire(),
            canApplyEdit: () => this.commandExecutions > 0,
            resolveBinary: this.resolveBinary,
            indexChanged: status => {
                if (this.disposed) { return; }
                this.indexStatus = status; this.indexChanges.fire(status); this.changed();
            }
        });
        return mode === ParseMode.Hybrid ? new HybridEngine(compiler, uri => this.database.hasUri(uri)) : compiler;
    }
    private updateProviders(engine?: LanguageEngine) {
        if (this.disposed) { return; }
        this.providers?.dispose();
        this.diagnostics.clear();
        this.analysisErrors.clear();
        this.invalidate(this.router);
        if (!engine) { this.indexStatus = { state: 'idle', message: 'Waiting for language service' }; }
        if (engine) {
            const selector = ['c', 'cpp', 'cuda-cpp'].map(language => ({ scheme: 'file', language, pattern: new vscode.RelativePattern(this.root, '**/*') }));
            this.providers = registerLanguageProviders(selector, this.router, engine.getCapabilities(), this.root.uri, this.refresh.event);
            if (Object.keys(engine.getCapabilities()).length) {
                const opened = vscode.workspace.textDocuments.filter(doc => this.accepts(doc))
                    .map(document => engine.notify('textDocument/didOpen', toProtocol.asOpenTextDocumentParams(document)));
                void Promise.all(opened).then(async () => {
                    if (!this.disposed && this.modes.getActiveEngine() === engine) { await engine.buildIndex?.(); }
                }).catch(error => this.log(`Index build: ${String(error)}`));
            }
        }
    }
    private async publishDiagnostics(params: lsp.PublishDiagnosticsParams) {
        if (this.disposed) { return; }
        const uri = vscode.Uri.parse(params.uri);
        if (!this.owns(uri)) { return; }
        const parseError = params.diagnostics.find(diagnostic => diagnostic.severity === lsp.DiagnosticSeverity.Error);
        if (parseError) { this.analysisErrors.set(params.uri, parseError.message); }
        else { this.analysisErrors.delete(params.uri); }
        const engine = this.modes.getActiveEngine();
        if (!engine) { return; }
        const ignore = vscode.workspace.getConfiguration('hornet-cpp', this.root.uri).get<string>('clangd.ignoreDiagnostics', 'not_indexed');
        const covered = this.database.hasUri(params.uri);
        if (ignore === 'all' || (ignore === 'not_indexed' && !covered) || (engine?.mode === ParseMode.Hybrid && !covered)) { this.diagnostics.delete(uri); return; }
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === params.uri);
        if (params.version !== undefined && document && params.version < document.version) { return; }
        const diagnostics = await toCode.asDiagnostics(params.diagnostics);
        if (!this.disposed && engine === this.modes.getActiveEngine()) { this.diagnostics.set(uri, diagnostics); }
    }
    async initialize() {
        await this.database.initialize();
        if (this.disposed) { return; }
        this.subscriptions.push(this.database.onDidChange(() => this.scheduleRestart()));
        const safely = (operation: Promise<void>) => { void operation.catch(error => this.log(String(error))); };
        this.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(document => { if (this.accepts(document)) { safely(this.router.notify('textDocument/didOpen', toProtocol.asOpenTextDocumentParams(document))); } }),
            vscode.workspace.onDidChangeTextDocument(event => { if (this.accepts(event.document) && event.contentChanges.length) { safely(this.router.notify('textDocument/didChange', toProtocol.asChangeTextDocumentParams(event, event.document.uri, event.document.version))); } }),
            vscode.workspace.onDidSaveTextDocument(document => { if (this.accepts(document)) { safely(this.router.notify('textDocument/didSave', toProtocol.asSaveTextDocumentParams(document))); } }),
            vscode.workspace.onDidCloseTextDocument(document => { if (this.accepts(document)) { safely(this.router.notify('textDocument/didClose', toProtocol.asCloseTextDocumentParams(document))); this.diagnostics.delete(document.uri); } }),
            vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('hornet-cpp', this.root.uri) || event.affectsConfiguration('cmake', this.root.uri)) { this.scheduleRestart(); } })
        );
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.root, '**/*.{c,cc,cpp,cxx,h,hh,hpp,hxx,cu,cuh}'));
        const changed = (uri: vscode.Uri, type: lsp.FileChangeType) => {
            if (!this.owns(uri)) { return; }
            safely(this.router.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uri.toString(), type }] }));
            // Inferred databases must rediscover added/removed translation units.
            if (!this.database.size && type !== lsp.FileChangeType.Changed) { this.scheduleRestart(); }
        };
        watcher.onDidCreate(uri => changed(uri, lsp.FileChangeType.Created));
        watcher.onDidChange(uri => changed(uri, lsp.FileChangeType.Changed));
        watcher.onDidDelete(uri => changed(uri, lsp.FileChangeType.Deleted));
        this.subscriptions.push(watcher);
        await this.restart();
    }
    private scheduleRestart() {
        if (this.disposed) { return; }
        if (this.manualIndexBuild) { this.restartPending = true; return; }
        if (this.restartTimer) { clearTimeout(this.restartTimer); }
        this.restartTimer = setTimeout(() => { void this.restart().catch(error => { this.setFailure(error); this.log(this.error!); }); }, 500);
    }
    async restart() {
        if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = undefined; }
        await this.database.reload(false);
        const configured = vscode.workspace.getConfiguration('hornet-cpp', this.root.uri).get<string>('mode', ParseMode.Hybrid);
        const selected = resolveMode(configured);
        this.modeNotice = selected.notice;
        if (selected.notice) { this.log(selected.notice); }
        await this.modes.switchMode(selected.mode);
    }
    async executeCommand(document: vscode.Uri, command: vscode.Command) {
        if (!vscode.workspace.isTrusted) { throw new Error('Workspace trust is required.'); }
        const engine = this.modes.getActiveEngine();
        if (engine?.mode === ParseMode.Hybrid && !this.database.get(document.fsPath)) { throw new Error('This file has no compile command.'); }
        if (!engine?.getCapabilities().executeCommandProvider?.commands.includes(command.command)) { throw new Error('The backend did not advertise this command.'); }
        this.commandExecutions++;
        try { return await this.router.request('workspace/executeCommand', { command: command.command, arguments: command.arguments }); }
        finally { this.commandExecutions--; }
    }
    buildProjectIndex(): Promise<void> {
        if (this.manualIndexBuild) { return this.manualIndexBuild; }
        const build = (async () => {
            // This operation explicitly restarts below; do not enqueue a second restart on completion.
            await this.database.reload(false);
            if (this.disposed) { throw new Error('Workspace was closed.'); }
            await this.restart();
            const engine = this.modes.getActiveEngine();
            if (!engine?.buildIndex) { throw new Error(this.error || 'Language service is unavailable.'); }
            await engine.buildIndex();
        })();
        this.manualIndexBuild = build;
        void build.finally(() => {
            if (this.manualIndexBuild === build) {
                this.manualIndexBuild = undefined;
                if (this.restartPending) { this.restartPending = false; this.scheduleRestart(); }
            }
        }).catch(() => {});
        return build;
    }
    async syncFile(uri: vscode.Uri) {
        await this.router.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uri.toString(), type: lsp.FileChangeType.Changed }] });
    }
    async dispose() {
        this.disposed = true;
        if (this.restartTimer) { clearTimeout(this.restartTimer); }
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.database.dispose();
        this.providers?.dispose();
        this.invalidate(this.router);
        await this.modes.shutdown();
        this.diagnostics.dispose();
        this.refresh.dispose();
        this.indexChanges.dispose();
    }
}
