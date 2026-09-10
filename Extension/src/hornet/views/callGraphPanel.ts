import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { CallHierarchyItem } from 'vscode-languageserver-protocol';
import { CapabilityRouter } from '../core/capabilityRouter';
import { CallGraphModel } from './callGraphModel';

export class CallGraphPanel implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = 'hornet-cpp.graphView';
    private panel?: vscode.WebviewView;
    private viewSubscriptions: vscode.Disposable[] = [];
    private router?: CapabilityRouter;
    private notice?: () => string | undefined;
    private cancellation = new vscode.CancellationTokenSource();
    private readonly model: CallGraphModel;
    constructor(private readonly extensionUri: vscode.Uri) {
        this.model = new CallGraphModel((method, params) => this.router?.request(method, params, this.cancellation.token) ?? Promise.resolve(null), () => this.update());
    }
    resolveWebviewView(view: vscode.WebviewView): void {
        this.viewSubscriptions.forEach(subscription => subscription.dispose());
        this.viewSubscriptions = [];
        this.panel = view;
        const assets = vscode.Uri.joinPath(this.extensionUri, 'assets', 'callGraph');
        const webview = view.webview;
        webview.options = { enableScripts: true, localResourceRoots: [assets] };
        const nonce = randomBytes(24).toString('hex');
        const script = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'graph.js'));
        const layout = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'layout.js'));
        const css = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'graph.css'));
        webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}"><title>函数调用关系图</title></head><body>
<header><div><h1>函数调用关系图</h1><p>左侧 ＋/− 查看调用者 · 右侧 ＋/− 查看被调用函数 · 箭头指向被调用函数</p></div>
<div class="toolbar"><label>连线 <select id="edgeStyle"><option value="rounded">圆角折线</option><option value="straight">直角折线</option></select></label>
<button id="refresh">刷新</button><button id="fit">适应画布</button><button id="zoomOut" aria-label="缩小">−</button><button id="zoomIn" aria-label="放大">＋</button></div></header>
<div class="legend"><span class="caller">调用者</span><span class="root">中心函数</span><span class="callee">被调用函数</span><span id="counts"></span></div>
<main id="canvas"><svg id="graph" role="group" aria-label="交互式函数调用关系图"><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><g id="scene"><g id="edges"></g><g id="nodes"></g></g></svg><div id="empty">正在加载函数调用关系…</div></main>
<footer><span id="message" role="status" aria-live="polite"></span><div><button id="open" disabled>跳转源码</button><button id="setRoot" disabled>设为中心</button></div></footer>
<script nonce="${nonce}" src="${layout}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
        this.viewSubscriptions.push(view.onDidDispose(() => { if (this.panel === view) { this.panel = undefined; } }),
            view.onDidChangeVisibility(() => { if (view.visible) { this.update(); } }),
            webview.onDidReceiveMessage(message => { void this.receive(message).catch(error => {
                void this.panel?.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            }); }));
        this.update();
    }
    async show(items: CallHierarchyItem[], router: CapabilityRouter, notice?: () => string | undefined): Promise<void> {
        let item: CallHierarchyItem | undefined = items[0];
        if (items.length > 1) {
            item = (await vscode.window.showQuickPick(items.map(value => ({ label: value.name, description: value.detail, item: value })), { title: '选择要查看调用关系的函数' }))?.item;
            if (!item) { return; }
        }
        this.cancel(); this.router = router; this.notice = notice;
        this.model.reset(item, item ? undefined : '此位置没有可用的函数调用关系。请右键函数名重试，并确认语言服务已启动。');
        const generation = this.model.snapshot().generation;
        await vscode.commands.executeCommand(`${CallGraphPanel.viewId}.focus`);
        this.panel?.show(true);
        const snapshot = this.model.snapshot();
        if (snapshot.generation !== generation) { return; }
        const root = snapshot.root;
        if (root) { await this.model.expand(root); await this.model.probeVisible(); }
    }
    private async receive(message: unknown): Promise<void> {
        if (!message || typeof message !== 'object') { return; }
        const input = message as { type?: string; id?: string; generation?: number; direction?: string };
        if (input.type === 'ready') { this.update(); return; }
        if (input.generation !== this.model.snapshot().generation) { return; }
        const item = typeof input.id === 'string' ? this.model.item(input.id) : undefined;
        if (item && (input.direction === 'incoming' || input.direction === 'outgoing')) {
            if (input.type === 'expand') { await this.model.expand(input.id!, input.direction); await this.model.probeVisible(); }
            if (input.type === 'collapse') { this.model.collapse(input.id!, input.direction); }
        }
        if (input.type === 'open' && item) {
            const uri = vscode.Uri.parse(item.uri);
            if (uri.scheme !== 'file') { return; }
            const range = item.selectionRange;
            await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character) });
        }
        if (input.type === 'setRoot' && item && this.router) { await this.show([item], this.router, this.notice); }
        if (input.type === 'refresh') {
            const root = this.model.snapshot().root;
            const rootItem = root && this.model.item(root);
            if (rootItem && this.router) { await this.show([rootItem], this.router, this.notice); }
        }
    }
    clear(router: CapabilityRouter): void {
        if (router !== this.router) { return; }
        this.cancel(); this.router = undefined; this.notice = undefined;
        this.model.reset(undefined, '语言服务已更新。请重新右键函数并打开调用关系图。');
    }
    private update(): void {
        const graph = this.model.snapshot();
        graph.message = [graph.message, this.notice?.()].filter(Boolean).join(' ');
        if (this.panel) { this.panel.title = 'Hornet Graph'; this.panel.description = graph.nodes.find(node => node.id === graph.root)?.name; }
        void this.panel?.webview.postMessage({ type: 'graph', graph });
    }
    private cancel(): void { this.cancellation.cancel(); this.cancellation.dispose(); this.cancellation = new vscode.CancellationTokenSource(); }
    dispose(): void {
        this.viewSubscriptions.forEach(subscription => subscription.dispose()); this.viewSubscriptions = [];
        this.panel = undefined; this.router = undefined;
        this.cancellation.cancel(); this.cancellation.dispose(); this.model.reset();
    }
}
