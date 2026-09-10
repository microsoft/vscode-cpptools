import * as vscode from 'vscode';
import * as path from 'node:path';
import * as lsp from 'vscode-languageserver-protocol';
import { ProcessManager } from './core/processManager';
import { WorkspaceContext } from './core/workspaceContext';
import { ParseMode } from './engines/languageEngine';
import { HierarchyNode, HierarchyView } from './views/hierarchyView';
import { HornetApiVersion, HornetCppApi, HornetCppExports } from './api/hornetCppApi';
import { textPosition } from './providers/languageProviders';
import { registerBuildTasks } from './tasks/buildTaskProvider';
import { BackendNotFoundError, BinaryManager } from './core/binaryManager';
import { availableModes, serviceStatus } from './core/serviceStatus';
import { CallGraphPanel } from './views/callGraphPanel';
import { installClangd } from './core/clangdInstaller';

const workspaces = new Map<string, WorkspaceContext>();
let processes: ProcessManager;
let stopping = false;

export async function activate(context: vscode.ExtensionContext): Promise<HornetCppExports> {
    stopping = false;
    processes = new ProcessManager();
    context.subscriptions.push(registerBuildTasks());
    const output = vscode.window.createOutputChannel('Hornet C/C++');
    output.appendLine(`Hornet C/C++ ${context.extension.packageJSON.version} (${context.extensionPath})`);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    status.command = 'hornet-cpp.switchMode';
    const modeStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
    modeStatus.name = 'Hornet Parsing Mode';
    status.name = 'Hornet Index';
    const callGraph = new HierarchyView('call');
    const callGraphPanel = new CallGraphPanel(context.extensionUri);
    const typeHierarchy = new HierarchyView('type');
    context.subscriptions.push(output, status, modeStatus, callGraph, callGraphPanel, typeHierarchy,
        vscode.window.registerWebviewViewProvider(CallGraphPanel.viewId, callGraphPanel, { webviewOptions: { retainContextWhenHidden: true } }),
        vscode.window.createTreeView('hornet-cpp.callGraph', { treeDataProvider: callGraph }),
        vscode.window.createTreeView('hornet-cpp.typeHierarchy', { treeDataProvider: typeHierarchy }));

    const current = (uri = vscode.window.activeTextEditor?.document.uri) => {
        const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
        return folder ? workspaces.get(folder.uri.toString()) : undefined;
    };
    const updateStatus = () => {
        const workspace = current() ?? [...workspaces.values()].find(value => value.indexStatus.state === 'building') ?? [...workspaces.values()][0];
        if (!workspace) { status.hide(); modeStatus.hide(); return; }
        const engine = workspace.modes.getActiveEngine();
        const mode = engine?.mode ?? vscode.workspace.getConfiguration('hornet-cpp', workspace.root.uri).get<string>('mode', ParseMode.Hybrid);
        modeStatus.text = `$(symbol-namespace) Hornet: ${mode === ParseMode.Hybrid ? 'Hybrid' : mode === ParseMode.Tag ? 'Tag' : mode === ParseMode.Flyweight ? 'Flyweight' : 'Compiler'} $(chevron-down)`;
        modeStatus.command = { title: 'Switch Hornet Mode', command: 'hornet-cpp.switchMode', arguments: [workspace.root.uri] };
        modeStatus.tooltip = `${workspace.root.name}\nSwitch parsing mode`;
        modeStatus.show();
        const document = vscode.window.activeTextEditor?.document;
        const covered = document && workspace.database.get(document.uri.fsPath);
        const presentation = serviceStatus(workspace.state, engine?.mode, workspace.indexStatus);
        status.text = presentation.text;
        status.command = { title: 'Hornet C/C++', command: presentation.command, arguments: [workspace.root.uri] };
        status.tooltip = [workspace.root.name, workspace.error ?? (covered ? 'Compile command available' : 'No compile command: analysis may be incomplete; diagnostics are filtered by default.'),
            workspace.modeNotice, workspace.indexStatus.message, `${workspace.database.size} compile commands`].filter(Boolean).join('\n');
        status.show();
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatus));
    let setupNoticeShown = false;
    const report = (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`[${new Date().toISOString()}] [ERROR] ${message}`);
        if (error instanceof BackendNotFoundError) {
            if (setupNoticeShown) { return; }
            setupNoticeShown = true;
            void vscode.window.showWarningMessage(message, 'Retry automatic setup', 'Open Logs').then(async action => {
                if (action === 'Retry automatic setup') { await vscode.commands.executeCommand('hornet-cpp.autoSetupClangd'); }
                if (action === 'Open Logs') { output.show(); }
            });
            return;
        }
        void vscode.window.showErrorMessage(`Hornet C/C++: ${message}`);
    };
    const initialize = async (folder: vscode.WorkspaceFolder) => {
        if (!vscode.workspace.isTrusted || stopping || workspaces.has(folder.uri.toString())) { return; }
        const workspace = new WorkspaceContext(folder, processes,
            text => output.appendLine(`[${new Date().toISOString()}] [${folder.name}] [Compiler] ${text}`), updateStatus,
            router => { callGraph.clear(router); callGraphPanel.clear(router); typeHierarchy.clear(router); },
            configured => {
                const existing = vscode.workspace.getConfiguration('clangd', folder.uri).get<string>('path');
                const manager = new BinaryManager({ storagePath: context.globalStorageUri.fsPath,
                    extraCandidates: existing && path.isAbsolute(existing) ? [existing] : [] });
                return manager.ensure(configured, async () => vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
                    title: 'Hornet: Setting up clangd automatically' }, progress => installClangd({
                    storagePath: context.globalStorageUri.fsPath,
                    proxy: vscode.workspace.getConfiguration('http').get<string>('proxy') || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
                    report: message => { progress.report({ message }); output.appendLine(message); }
                })));
            });
        workspaces.set(folder.uri.toString(), workspace);
        try { await workspace.initialize(); }
        catch (error) { workspace.setFailure(error); report(error); }
        updateStatus();
    };
    const chooseWorkspace = async (uri?: vscode.Uri): Promise<WorkspaceContext> => {
        const active = current(uri);
        if (active) { return active; }
        if (workspaces.size === 1) { return [...workspaces.values()][0]; }
        const selected = await vscode.window.showQuickPick([...workspaces.values()].map(workspace => ({ label: workspace.root.name, description: workspace.root.uri.fsPath, workspace })), { title: 'Hornet C/C++: Select workspace' });
        if (!selected) { throw new Error('Open or select a trusted workspace folder.'); }
        return selected.workspace;
    };
    const register = (name: string, action: (...args: any[]) => unknown) => {
        context.subscriptions.push(vscode.commands.registerCommand(`hornet-cpp.${name}`, async (...args: unknown[]) => {
            try { return await action(...args); } catch (error) { report(error); return undefined; }
        }));
    };
    register('openLogs', () => output.show());
    register('autoSetupClangd', async (root?: vscode.Uri) => {
        setupNoticeShown = false;
        await (await chooseWorkspace(root)).restart();
        updateStatus();
    });
    register('configureClangd', async (root?: vscode.Uri) => {
        const workspace = await chooseWorkspace(root);
        const selected = await vscode.window.showOpenDialog({
            title: 'Select clangd on the workspace host', openLabel: 'Use clangd',
            canSelectMany: false, canSelectFolders: false, defaultUri: workspace.root.uri,
            ...(process.platform === 'win32' ? { filters: { Executable: ['exe'] } } : {})
        });
        if (!selected?.length) { return; }
        const binary = await new BinaryManager().resolve(selected[0].fsPath);
        await vscode.workspace.getConfiguration('hornet-cpp', workspace.root.uri).update('clangd.path', binary, vscode.ConfigurationTarget.WorkspaceFolder);
        await workspace.restart();
        setupNoticeShown = false;
        updateStatus();
    });
    register('switchMode', async (root?: vscode.Uri) => {
        const workspace = await chooseWorkspace(root);
        const mode = await vscode.window.showQuickPick([
            ...availableModes.map(value => ({ label: value === ParseMode.Compiler ? 'Compiler' : 'Hybrid', description: value === ParseMode.Hybrid ? 'Compiler analysis with compilation-database routing' : 'clangd semantic analysis', mode: value as ParseMode })),
            { label: 'Tag', description: '尚未实现，暂不可切换', mode: ParseMode.Tag },
            { label: 'Flyweight', description: '尚未实现，暂不可切换', mode: ParseMode.Flyweight }
        ], { title: 'Hornet C/C++ Parsing Mode' });
        if (!mode) { return; }
        if (!availableModes.some(value => value === mode.mode)) {
            void vscode.window.showInformationMessage(`Hornet: ${mode.label} 模式尚未实现，当前解析模式保持不变。`);
            return;
        }
        await workspace.modes.switchMode(mode.mode);
        workspace.modeNotice = undefined;
        await vscode.workspace.getConfiguration('hornet-cpp', workspace.root.uri).update('mode', mode.mode, vscode.ConfigurationTarget.WorkspaceFolder);
    });
    const importDatabases = async () => {
        const workspace = await chooseWorkspace();
        const files = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { 'Compilation database': ['json'] }, title: 'Import compilation databases (last source wins)' });
        if (files?.length) { await workspace.database.import(files.map(file => file.fsPath)); await workspace.restart(); }
    };
    register('importCompilationDatabase', importDatabases);
    register('mergeCompilationDatabases', importDatabases);
    register('exportCompilationDatabase', async () => {
        const workspace = await chooseWorkspace();
        const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(workspace.root.uri.fsPath, 'compile_commands.export.json')), filters: { JSON: ['json'] } });
        if (destination) { await workspace.database.export(destination.fsPath); }
    });
    register('generateCompilationDatabase', async () => {
        const workspace = await chooseWorkspace();
        if (!vscode.workspace.isTrusted) { throw new Error('Trust this workspace before running build tools.'); }
        const method = await vscode.window.showQuickPick(['CMake', 'Bear'], { title: 'Generate compilation database' });
        if (!method) { return; }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Hornet: ${method} compilation database` }, async () => {
            let source: string;
            if (method === 'CMake') {
                const build = path.join(workspace.root.uri.fsPath, 'build');
                await processes.run('cmake', ['-S', workspace.root.uri.fsPath, '-B', build, '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON'], workspace.root.uri.fsPath, workspace.log);
                source = path.join(build, 'compile_commands.json');
            } else {
                const input = await vscode.window.showInputBox({ title: 'Bear build command as a JSON argument array', value: '["make", "-j2"]', prompt: 'This build command will execute in the trusted workspace, without a shell.' });
                if (!input) { return; }
                const args: unknown = JSON.parse(input);
                if (!Array.isArray(args) || !args.length || !args.every(arg => typeof arg === 'string')) { throw new Error('Expected a nonempty JSON array of command arguments.'); }
                source = path.join(workspace.root.uri.fsPath, 'compile_commands.json');
                await processes.run('bear', ['--output', source, '--', ...args], workspace.root.uri.fsPath, workspace.log);
            }
            await workspace.database.import([source]);
            await workspace.restart();
        });
    });
    register('showCompileCommand', async (uri?: vscode.Uri) => {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) { return; }
        const workspace = await chooseWorkspace(target);
        const command = workspace.database.get(target.fsPath);
        const document = await vscode.workspace.openTextDocument({ language: command ? 'json' : 'plaintext', content: command ? JSON.stringify(command, null, 2) : `No compile command for ${target.fsPath}.\nAnalysis may be incomplete.` });
        await vscode.window.showTextDocument(document, { preview: true });
    });
    register('restartLanguageServices', async (root?: vscode.Uri) => { await (await chooseWorkspace(root)).restart(); });
    const buildProjectIndex = async (root?: vscode.Uri) => {
        const workspace = await chooseWorkspace(root);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Hornet: Building index (${workspace.root.name})` }, async progress => {
            let reported = 0;
            const subscription = workspace.onIndexChanged(index => {
                const percentage = Math.max(reported, index.percentage ?? reported);
                progress.report({ message: index.message, increment: percentage - reported });
                reported = percentage;
            });
            try { await workspace.buildProjectIndex(); }
            finally { subscription.dispose(); }
        });
        void vscode.window.showInformationMessage(`Hornet: ${workspace.indexStatus.message}`);
    };
    register('buildProjectIndex', buildProjectIndex);
    register('syncProjectIndex', buildProjectIndex);
    register('syncFileIndex', async (uri?: vscode.Uri) => { const target = uri ?? vscode.window.activeTextEditor?.document.uri; if (target) { await (await chooseWorkspace(target)).syncFile(target); } });
    register('syncFolderIndex', async (uri?: vscode.Uri) => {
        const workspace = await chooseWorkspace(uri);
        const folder = uri ?? workspace.root.uri;
        const exclude = vscode.workspace.getConfiguration('hornet-cpp', workspace.root.uri).get<string[]>('excludePaths', ['**/.git/**', '**/build/**', '**/output/**', '**/.mm/**']);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Hornet: syncing folder', cancellable: true }, async (_progress, token) => {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{c,cc,cpp,cxx,h,hpp,cu,cuh}'), `{${exclude.join(',')}}`, 10001, token);
            if (files.length > 10000) { throw new Error('Folder contains over 10,000 source files. Select a smaller folder or sync the project.'); }
            for (const file of files) { if (token.isCancellationRequested) { break; } await workspace.syncFile(file); }
        });
    });
    const showHierarchy = async (view: HierarchyView) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        const workspace = await chooseWorkspace(editor.document.uri);
        const items = await workspace.router.request<(lsp.CallHierarchyItem | lsp.TypeHierarchyItem)[]>(view.kind === 'call' ? 'textDocument/prepareCallHierarchy' : 'textDocument/prepareTypeHierarchy', textPosition(editor.document, editor.selection.active));
        view.setRoots(items ?? [], workspace.router);
        await vscode.commands.executeCommand(`hornet-cpp.${view.kind === 'call' ? 'callGraph' : 'typeHierarchy'}.focus`);
    };
    register('showCallGraph', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !['c', 'cpp', 'cuda-cpp'].includes(editor.document.languageId)) { return; }
        const workspace = await chooseWorkspace(editor.document.uri);
        if (workspace.state !== 'ready') { throw new Error('语言服务尚未就绪，请先配置或重启 clangd。'); }
        const items = await workspace.router.request<lsp.CallHierarchyItem[]>('textDocument/prepareCallHierarchy', textPosition(editor.document, editor.selection.active));
        callGraph.setRoots(items ?? [], workspace.router);
        await callGraphPanel.show(items ?? [], workspace.router, () => workspace.callGraphNotice());
    });
    register('showTypeHierarchy', () => showHierarchy(typeHierarchy));
    register('refreshHierarchy', () => { callGraph.refresh(); typeHierarchy.refresh(); });
    register('setHierarchyRoot', (node: HierarchyNode) => { (node.kind === 'type' ? typeHierarchy : callGraph).setRoot(node); });
    register('pinCallGraph', () => { void vscode.window.showInformationMessage(`Call graph root ${callGraph.togglePin() ? 'pinned' : 'unpinned'}.`); });
    register('copySymbol', (node: HierarchyNode) => vscode.env.clipboard.writeText(node.item.name));
    register('findNodeReferences', async (node: HierarchyNode) => {
        const locations = await node.router.request<lsp.Location[]>('textDocument/references', { textDocument: { uri: node.item.uri }, position: node.item.selectionRange.start, context: { includeDeclaration: true } });
        await vscode.commands.executeCommand('editor.action.showReferences', vscode.Uri.parse(node.item.uri), new vscode.Position(node.item.selectionRange.start.line, node.item.selectionRange.start.character),
            (locations ?? []).map(location => new vscode.Location(vscode.Uri.parse(location.uri), new vscode.Range(location.range.start.line, location.range.start.character, location.range.end.line, location.range.end.character))));
    });
    register('symbolSearch', () => vscode.commands.executeCommand('workbench.action.showAllSymbols'));
    register('executeServerCommand', async (root: vscode.Uri, document: vscode.Uri, command: vscode.Command) => { return workspaces.get(root.toString())?.executeCommand(document, command); });

    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(event => {
        for (const folder of event.removed) { const workspace = workspaces.get(folder.uri.toString()); workspaces.delete(folder.uri.toString()); void workspace?.dispose().catch(report); }
        for (const folder of event.added) { void initialize(folder); }
        updateStatus();
    }));
    await Promise.all((vscode.workspace.workspaceFolders ?? []).map(initialize));
    const conflicts = ['ms-vscode.cpptools', 'llvm-vs-code-extensions.vscode-clangd'].filter(id => vscode.extensions.getExtension(id)?.isActive);
    if (conflicts.length) { output.appendLine(`[INFO] Other C/C++ extensions are active (${conflicts.join(', ')}). If completions or diagnostics are duplicated, check their language-service settings.`); }
    const apiWorkspace = async (uri?: string) => uri ? workspaces.get(uri) ?? Promise.reject(new Error(`Unknown workspace: ${uri}`)) : chooseWorkspace();
    const api: HornetCppApi = {
        async importCompilationDatabase(file, uri) { await api.importCompilationDatabases([file], uri); },
        async importCompilationDatabases(files, uri) { const workspace = await apiWorkspace(uri); await workspace.database.import(files); await workspace.restart(); },
        async refreshIndex(uri) { await (await apiWorkspace(uri)).buildProjectIndex(); },
        async getCompileCommand(file) { return current(vscode.Uri.file(file))?.database.get(file); }
    };
    return { getApi(version) { if (version !== HornetApiVersion.v1) { throw new Error(`Unsupported Hornet API version: ${version}`); } return api; } };
}

export async function deactivate(): Promise<void> {
    stopping = true;
    await Promise.all([...workspaces.values()].map(workspace => workspace.dispose()));
    workspaces.clear();
    await processes?.dispose();
}
