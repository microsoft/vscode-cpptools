import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, MessageConnection } from 'vscode-jsonrpc/node';
import * as lsp from 'vscode-languageserver-protocol';
import { IndexStatus, LanguageEngine, ParseMode } from './languageEngine';
import { ProcessManager } from '../core/processManager';
import { BinaryManager } from '../core/binaryManager';
import { threadCount } from '../core/cpuScheduler';
import { prepareCompilerConfiguration } from '../compdb/fallbackCompilation';
import { canonical } from '../compdb/compileCommandsParser';
import { createConverter } from 'vscode-languageclient/lib/common/protocolConverter';
import { backgroundIndexStatus } from '../core/indexProgress';
export interface CompilerOptions {
    root: vscode.WorkspaceFolder;
    databaseDirectory: string;
    log: (message: string) => void;
    diagnostics: (params: lsp.PublishDiagnosticsParams) => void;
    changed: () => void;
    refresh: () => void;
    canApplyEdit: () => boolean;
    resolveBinary?: (configured: string) => Promise<string>;
    indexChanged?: (status: IndexStatus) => void;
}
export class CompilerEngine implements LanguageEngine {
    readonly mode = ParseMode.Compiler;
    private connection?: MessageConnection;
    private process?: ChildProcessWithoutNullStreams;
    private capabilities: lsp.ServerCapabilities = {};
    private stopping = false;
    private crashes = 0;
    private recovery?: Promise<void>;
    private ready = false;
    private readonly editorDocuments = new Map<string, string>();
    private readonly graphDocuments = new Map<string, Promise<void>>();
    private readonly graphDocumentUris = new Map<string, string>();
    private fallbackSources: string[] = [];
    private fallbackPrepared?: Promise<void>;
    private indexSources: string[] = [];
    private indexBuild?: Promise<void>;
    private indexActivity = 0;
    private indexStarted = 0;
    private indexPresentation?: IndexStatus;
    private reportIndex(status: IndexStatus): void {
        if (status.state === 'building') {
            this.indexStarted ||= Date.now();
            status = { ...status, elapsedSeconds: Math.floor((Date.now() - this.indexStarted) / 1000) };
        } else { this.indexStarted = 0; }
        if (JSON.stringify(status) === JSON.stringify(this.indexPresentation)) { return; }
        this.indexPresentation = status;
        this.options.log(`[Index] ${status.message}${status.percentage === undefined ? '' : ` (${status.percentage}%)`}`);
        this.options.indexChanged?.(status);
    }
    private documentKey(uri: string): string { return uri.startsWith('file:') ? canonical(fileURLToPath(uri)) : uri; }
    private documentUri(uri: string): string {
        if (!uri.startsWith('file:')) { return uri; }
        try { return pathToFileURL(realpathSync.native(fileURLToPath(uri))).toString(); } catch { return uri; }
    }
    private async ensureGraphDocument(uri: string): Promise<void> {
        uri = this.documentUri(uri);
        const key = this.documentKey(uri);
        if (this.editorDocuments.has(key)) { return; }
        const pending = this.graphDocuments.get(key);
        if (pending) { return pending; }
        if (!uri.startsWith('file:')) { return; }
        if (this.graphDocuments.size >= 250) { throw new Error('调用关系涉及的文件超过 250 个，请选择更小的调用链。'); }
        const connection = this.connection;
        const opening = (async () => {
            const filename = fileURLToPath(uri);
            const text = await fs.readFile(filename, 'utf8');
            if (!connection || connection !== this.connection || this.editorDocuments.has(key)) { return; }
            await connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: /\.c$/.test(filename) ? 'c' : 'cpp', version: 0, text } });
            // Wait for the AST. Background-index references alone can omit caller containers such as main().
            await connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri } });
        })();
        this.graphDocuments.set(key, opening);
        this.graphDocumentUris.set(key, uri);
        try { await opening; } catch (error) { this.graphDocuments.delete(key); this.graphDocumentUris.delete(key); throw error; }
    }
    private indexing?: { done: Promise<void>; finish: () => void };
    private beginIndexing(): void {
        if (this.indexing) { return; }
        let finish!: () => void;
        const done = new Promise<void>(resolve => { finish = resolve; });
        this.indexing = { done, finish };
    }
    private endIndexing(): void { this.indexing?.finish(); this.indexing = undefined; }
    constructor(private readonly processes: ProcessManager, private readonly options: CompilerOptions) {
    }
    getCapabilities() {
        return this.capabilities;
    }
    async initialize(): Promise<void> {
        if (!vscode.workspace.isTrusted) {
            throw new Error('Trust this workspace before starting Hornet Compiler.');
        }
        this.stopping = false;
        this.ready = false;
        this.editorDocuments.clear(); this.graphDocuments.clear(); this.graphDocumentUris.clear();
        this.fallbackPrepared = undefined;
        this.indexBuild = undefined;
        const config = vscode.workspace.getConfiguration('hornet-cpp', this.options.root.uri);
        const configured = config.get<string>('clangd.path', 'clangd');
        const binary = await (this.options.resolveBinary?.(configured) ?? new BinaryManager().resolve(configured));
        const extra = config.get<string[]>('clangd.arguments', []);
        if (extra.some(arg => /^--?(query-driver|compile-commands-dir|enable-config|background-index|j)(=|$)/.test(arg))) {
            throw new Error('Use Hornet settings for query-driver, compile database and CPU usage; clangd config execution is disabled.');
        }
        const allowlist = config.get<string[]>('clangd.queryDriver', []);
        this.reportIndex({ state: 'building', phase: 'discovering', message: 'Discovering C/C++ sources and compile commands' });
        const compilation = await prepareCompilerConfiguration(realpathSync.native(this.options.root.uri.fsPath), realpathSync.native(this.options.databaseDirectory));
        this.indexSources = compilation.sources;
        this.reportIndex({ state: 'building', phase: 'starting', message: `Starting clangd for ${this.indexSources.length} source files`, total: this.indexSources.length });
        this.fallbackSources = compilation.inferred ? compilation.sources : [];
        if (compilation.inferred) { this.options.log(`No compilation database: inferred browsing commands for ${compilation.inferred} source files. Build flags and macros may still be incomplete.`); }
        const args = [
            '--background-index', '--enable-config=0',
            `--compile-commands-dir=${compilation.directory}`,
            `-j=${threadCount(config.get<string>('cpuUsage', 'Medium'))}`, ...extra
        ];
        if (allowlist.length) {
            args.push(`--query-driver=${allowlist.join(',')}`);
        }
        this.options.log(`Starting ${binary}`);
        const child = await this.processes.spawn(binary, args, this.options.root.uri.fsPath);
        this.process = child;
        child.stderr.on('data', data => this.options.log(String(data).trimEnd()));
        const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
        this.connection = connection;
        connection.onError(error => this.options.log(`Protocol error : ${String(error[0])}`));
        connection.onNotification('textDocument/publishDiagnostics', (params: lsp.PublishDiagnosticsParams) => {
            if (this.connection === connection && !this.stopping) { this.options.diagnostics(params); }
        });
        connection.onNotification('window/logMessage', (params: lsp.LogMessageParams) => this.options.log(params.message));
        connection.onNotification('window/showMessage', (params: lsp.ShowMessageParams) => this.options.log(params.message));
        connection.onRequest('workspace/configuration', (params: lsp.ConfigurationParams) => params.items.map(() => null));
        connection.onRequest('workspace/workspaceFolders', () => [{ uri: this.documentUri(this.options.root.uri.toString()), name: this.options.root.name }]);
        connection.onRequest('window/workDoneProgress/create', (params: { token: string | number }) => {
            if (this.connection === connection && params.token === 'backgroundIndexProgress') { this.beginIndexing(); }
            return null;
        });
        connection.onNotification('$/progress', (params: { token: string | number; value: { kind: string; message?: string; percentage?: number } }) => {
            if (this.connection !== connection || this.stopping || params.token !== 'backgroundIndexProgress') { return; }
            this.indexActivity = Date.now();
            if (params.value.kind === 'end') {
                this.endIndexing();
                if (!this.indexBuild && !this.stopping) {
                    this.reportIndex({ state: 'ready', message: `Index ready: ${this.indexSources.length} source files`, percentage: 100 });
                } else if (this.indexBuild) {
                    this.reportIndex({ state: 'building', phase: 'finalizing', message: 'Background indexing finished; waiting for pending work' });
                }
            }
            else {
                this.beginIndexing();
                this.reportIndex(backgroundIndexStatus(params.value));
            }
        });
        connection.onRequest('workspace/applyEdit', async (params: lsp.ApplyWorkspaceEditParams) => {
            if (!vscode.workspace.isTrusted || !this.options.canApplyEdit()) { return { applied: false, failureReason: 'No active Hornet code action.' }; }
            const edit = await createConverter(undefined, false, false).asWorkspaceEdit(params.edit);
            return { applied: await vscode.workspace.applyEdit(edit) };
        });
        connection.onRequest('workspace/semanticTokens/refresh', () => {
            this.options.refresh();
            return null;
        });
        connection.onRequest('workspace/inlayHint/refresh', () => {
            this.options.refresh();
            return null;
        });
        connection.onClose(() => {
            if (this.connection !== connection || this.stopping) {
                return;
            }
            this.capabilities = {};
            this.endIndexing();
            const wasReady = this.ready;
            this.ready = false;
            this.options.changed();
            if (wasReady) { this.recovery = this.recover().catch(error => this.options.log(String(error))); }
        });
        connection.listen();
        const initialization: lsp.InitializeParams = {
            processId: process.pid,
            rootUri: this.documentUri(this.options.root.uri.toString()),
            workspaceFolders: [{ uri: this.documentUri(this.options.root.uri.toString()), name: this.options.root.name }],
            clientInfo: { name: 'Hornet C/C++', version: '0.1.9' },
            initializationOptions: { fallbackFlags: compilation.fallbackFlags },
            capabilities: {
                window: { workDoneProgress: true },
                general: { positionEncodings: ['utf-16'] },
                workspace: { configuration: true, workspaceFolders: true, applyEdit: true, workspaceEdit: { documentChanges: true } },
                textDocument: {
                    synchronization: { didSave: true },
                    completion: {
                        completionItem: {
                            snippetSupport: true,
                            documentationFormat: ['markdown', 'plaintext'],
                            resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] }
                        }
                    },
                    hover: { contentFormat: ['markdown', 'plaintext'] },
                    signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } } },
                    definition: { linkSupport: true },
                    declaration: { linkSupport: true },
                    typeDefinition: { linkSupport: true },
                    implementation: { linkSupport: true },
                    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                    rename: { prepareSupport: true },
                    codeAction: {
                        codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'source'] } },
                        resolveSupport: { properties: ['edit'] }
                    },
                    foldingRange: { lineFoldingOnly: true },
                    callHierarchy: {},
                    typeHierarchy: {},
                    inlayHint: {},
                    semanticTokens: {
                        requests: { full: true },
                        tokenTypes: [
                            'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter',
                            'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword',
                            'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator'
                        ],
                        tokenModifiers: [
                            'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'
                        ],
                        formats: ['relative']
                    }
                }
            }
        };
        let timer: NodeJS.Timeout | undefined;
        try {
            const result = await Promise.race([
                connection.sendRequest<lsp.InitializeResult>('initialize', initialization),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('clangd initialization timed out')), 20000); })
            ]);
            this.capabilities = result.capabilities;
            await connection.sendNotification('initialized', {});
            this.ready = true;
            this.options.log('Compiler ready');
        }
        finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
    private async recover(): Promise<void> {
        if (this.stopping) {
            return;
        }
        if (++this.crashes > 2) {
            this.options.log('Compiler stopped after three crashes. Restart language services to retry.');
            void vscode.window.showErrorMessage('Hornet Compiler stopped after three crashes. See Hornet logs.');
            return;
        }
        this.options.log(`Compiler crashed; automatic restart ${this.crashes} / 2`);
        const child = this.process;
        this.connection?.dispose();
        this.connection = undefined;
        if (child) {
            await this.processes.stop(child);
        }
        if (!this.stopping) {
            try { await this.initialize(); }
            catch (error) {
                this.options.log(`Automatic restart failed: ${String(error)}`);
                this.ready = false;
                this.capabilities = {};
                this.disposeConnection();
                if (this.process) { await this.processes.stop(this.process); }
            }
            this.options.changed();
        }
    }
    private disposeConnection(): void {
        this.endIndexing();
        this.connection?.dispose();
        this.connection = undefined;
    }
    async shutdown(): Promise<void> {
        this.stopping = true;
        this.indexStarted = 0; this.indexPresentation = undefined;
        this.endIndexing();
        this.ready = false;
        await this.recovery;
        const connection = this.connection;
        this.connection = undefined;
        this.capabilities = {};
        if (connection) {
            let timer: NodeJS.Timeout | undefined;
            try {
                await Promise.race([connection.sendRequest('shutdown'), new Promise<void>(resolve => { timer = setTimeout(resolve, 1500); })]);
                await connection.sendNotification('exit');
            }
            catch { /* Crashed backends may have already closed the transport. */
            }
            finally {
                if (timer) {
                    clearTimeout(timer);
                }
                connection.dispose();
            }
        }
        if (this.process) {
            await this.processes.stop(this.process);
            this.process = undefined;
        }
    }
    async restart() {
        await this.shutdown();
        this.crashes = 0;
        await this.initialize();
    }
    buildIndex(): Promise<void> {
        if (this.indexBuild) { return this.indexBuild; }
        const connection = this.connection;
        const active = () => connection && connection === this.connection && this.ready && !this.stopping;
        const build = (async () => {
            if (!active()) { throw new Error('Language service is not ready to build the index.'); }
            this.reportIndex({ state: 'building', phase: 'parsing', message: `Loading compilation database (${this.indexSources.length} source files)`, total: this.indexSources.length });
            // Loading one translation unit makes clangd load the compilation database and queue ALL
            // its entries. The background index writes reusable .idx shards, including unopened files.
            const seed = this.indexSources.find(file => {
                try { return realpathSync.native(file); } catch { return false; }
            });
            if (seed) {
                this.reportIndex({ state: 'building', phase: 'parsing', message: `Parsing ${seed}`, total: this.indexSources.length });
                await this.ensureGraphDocument(pathToFileURL(seed).toString());
                await connection!.sendRequest('textDocument/documentSymbol', { textDocument: { uri: this.documentUri(pathToFileURL(seed).toString()) } });
                this.indexActivity = Date.now();
                if (!this.indexing) { this.reportIndex({ state: 'building', phase: 'finalizing', message: 'Checking background work and cached index' }); }
                const deadline = Date.now() + 10 * 60 * 1000;
                // Progress creation is asynchronous. Require a quiet interval after the AST barrier
                // (also handles reopening a completely cached project with no progress work).
                while (this.indexing || Date.now() - this.indexActivity < 1500) {
                    if (!active()) { throw new Error('Index build interrupted by a language-service restart.'); }
                    if (Date.now() > deadline) { throw new Error('Index is still building after 10 minutes. Check Hornet logs and retry.'); }
                    if (this.indexPresentation?.state === 'building') { this.reportIndex(this.indexPresentation); }
                    await new Promise<void>(resolve => setTimeout(resolve, 100));
                }
            } else if (this.indexSources.length) { throw new Error('No compilation-database source file exists on this workspace host.'); }
            if (!active()) { throw new Error('Index build interrupted by a language-service restart.'); }
            const message = seed ? `Index ready: ${this.indexSources.length} source files (cached for next startup)` : 'No C/C++ source files found to index';
            this.options.log(message);
            this.reportIndex({ state: 'ready', message, percentage: 100 });
        })();
        this.indexBuild = build;
        void build.catch(error => {
            if (active()) { this.reportIndex({ state: 'failed', message: String(error) }); }
        }).finally(() => { if (this.indexBuild === build) { this.indexBuild = undefined; } });
        return build;
    }
    async request<T>(method: string, params: unknown, token?: vscode.CancellationToken): Promise<T | null> {
        if (!this.connection || !Object.keys(this.capabilities).length || token?.isCancellationRequested) {
            return null;
        }
        const connection = this.connection;
        const input = params as { textDocument?: { uri: string } };
        if (input?.textDocument) { params = { ...input, textDocument: { ...input.textDocument, uri: this.documentUri(input.textDocument.uri) } }; }
        if (method === 'callHierarchy/incomingCalls' || method === 'callHierarchy/outgoingCalls') {
            const item = (params as { item: lsp.CallHierarchyItem }).item;
            if (this.fallbackSources.length && !this.fallbackPrepared) {
                this.fallbackPrepared = (async () => {
                    if (this.fallbackSources.length > 250) { throw new Error('未配置编译数据库且源文件超过 250 个，请先导入 compile_commands.json 以建立完整调用索引。'); }
                    for (let index = 0; index < this.fallbackSources.length; index += 4) {
                        if (connection !== this.connection || this.stopping) { return; }
                        await Promise.all(this.fallbackSources.slice(index, index + 4).map(file => this.ensureGraphDocument(pathToFileURL(file).toString())));
                    }
                })();
                void this.fallbackPrepared.catch(() => { this.fallbackPrepared = undefined; });
            }
            await this.fallbackPrepared;
            await this.ensureGraphDocument(item.uri);
            const key = this.documentKey(item.uri);
            const sourceUri = this.editorDocuments.get(key) ?? this.graphDocumentUris.get(key) ?? item.uri;
            params = { ...(params as object), item: { ...item, uri: sourceUri } };
            // Call-hierarchy requests can read the index without waiting for pending editor changes.
            await connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri: sourceUri } });
            if (this.indexing) {
                let timer: NodeJS.Timeout | undefined;
                try {
                    await Promise.race([this.indexing.done, new Promise<never>((_, reject) => {
                        timer = setTimeout(() => reject(new Error('项目索引仍在构建，调用关系尚不完整。请稍后刷新调用图。')), 30000);
                    })]);
                } finally { if (timer) { clearTimeout(timer); } }
            }
            if (this.connection !== connection || token?.isCancellationRequested) { return null; }
            if (method === 'callHierarchy/incomingCalls') {
                // Resolve callers from semantic references, then let clangd classify the actual calls.
                // This also avoids treating address-taking references as calls.
                const references = await connection.sendRequest<lsp.Location[] | null>('textDocument/references', {
                    textDocument: { uri: sourceUri }, position: item.selectionRange.start, context: { includeDeclaration: false }
                });
                const files = [...new Set((references ?? []).map(reference => reference.uri))];
                for (let index = 0; index < files.length; index += 4) {
                    if (this.connection !== connection || token?.isCancellationRequested) { return null; }
                    await Promise.all(files.slice(index, index + 4).map(uri => this.ensureGraphDocument(uri)));
                }
            }
        }
        const result = await (token ? connection.sendRequest<T>(method, params, token) : connection.sendRequest<T>(method, params));
        if ((method === 'callHierarchy/incomingCalls' || method === 'callHierarchy/outgoingCalls') && Array.isArray(result)) {
            // clangd may retain an indexed edge after an unsaved edit but return no call sites for it.
            return result.filter((call: lsp.CallHierarchyIncomingCall | lsp.CallHierarchyOutgoingCall) => call.fromRanges.length > 0) as T;
        }
        return result;
    }
    async notify(method: string, params: unknown): Promise<void> {
        let document = (params as { textDocument?: { uri: string; version?: number; text?: string } })?.textDocument;
        if (document) { document = { ...document, uri: this.documentUri(document.uri) }; params = { ...(params as object), textDocument: document }; }
        const key = document && this.documentKey(document.uri);
        if (document && method === 'textDocument/didOpen') {
            await this.graphDocuments.get(key!);
            this.editorDocuments.set(key!, document.uri);
            if (this.graphDocuments.delete(key!)) {
                const graphUri = this.graphDocumentUris.get(key!)!;
                this.graphDocumentUris.delete(key!);
                if (graphUri !== document.uri) {
                    await this.connection?.sendNotification('textDocument/didClose', { textDocument: { uri: graphUri } });
                    await this.connection?.sendNotification(method, params);
                } else {
                    await this.connection?.sendNotification('textDocument/didChange', { textDocument: { uri: document.uri, version: document.version }, contentChanges: [{ text: document.text }] });
                }
                return;
            }
        }
        if (document && method === 'textDocument/didClose') { this.editorDocuments.delete(key!); }
        if (method === 'workspace/didChangeWatchedFiles') {
            for (const change of (params as lsp.DidChangeWatchedFilesParams).changes) {
                const changedKey = this.documentKey(change.uri);
                const pending = this.graphDocuments.get(changedKey);
                if (pending && !this.editorDocuments.has(changedKey)) {
                    await pending.catch(() => {});
                    this.graphDocuments.delete(changedKey);
                    const graphUri = this.graphDocumentUris.get(changedKey) ?? change.uri;
                    this.graphDocumentUris.delete(changedKey);
                    await this.connection?.sendNotification('textDocument/didClose', { textDocument: { uri: graphUri } });
                    this.fallbackPrepared = undefined;
                }
            }
        }
        await this.connection?.sendNotification(method, params);
    }
}
