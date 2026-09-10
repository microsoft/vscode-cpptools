import * as vscode from 'vscode';
import * as lsp from 'vscode-languageserver-protocol';
import { CapabilityRouter } from '../core/capabilityRouter';
import { toCode } from '../providers/languageProviders';

type Item = lsp.CallHierarchyItem | lsp.TypeHierarchyItem;
type Direction = 'incoming' | 'outgoing' | 'bases' | 'derived';
export interface HierarchyNode {
    kind: 'call' | 'type';
    item: Item;
    router: CapabilityRouter;
    ancestors: Set<string>;
    direction?: Direction;
    group?: boolean;
    cycle?: boolean;
    children?: HierarchyNode[];
}
const key = (item: Item) => `${item.uri}:${item.selectionRange.start.line}:${item.selectionRange.start.character}:${item.name}`;

/** Queries one edge at a time; a cycle terminates only its own branch. */
export class HierarchyView implements vscode.TreeDataProvider<HierarchyNode>, vscode.Disposable {
    private roots: HierarchyNode[] = [];
    private readonly changed = new vscode.EventEmitter<HierarchyNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private cancellation = new vscode.CancellationTokenSource();
    private pinned = false;
    private generation = 0;
    constructor(readonly kind: 'call' | 'type') {}
    setRoots(items: Item[], router: CapabilityRouter, force = false) {
        if (this.pinned && !force) { return; }
        this.cancelRequests();
        this.roots = items.map(item => ({ kind: this.kind, item, router, ancestors: new Set([key(item)]) }));
        this.changed.fire(undefined);
    }
    setRoot(node: HierarchyNode) { this.setRoots([node.item], node.router, true); }
    togglePin() { this.pinned = !this.pinned; this.changed.fire(undefined); return this.pinned; }
    clear(router: CapabilityRouter) {
        if (this.roots.some(node => node.router === router)) { this.cancelRequests(); this.roots = []; this.changed.fire(undefined); }
    }
    refresh() {
        this.cancelRequests();
        this.roots = this.roots.map(node => ({ ...node, children: undefined }));
        this.changed.fire(undefined);
    }
    private cancelRequests() { this.generation++; this.cancellation.cancel(); this.cancellation.dispose(); this.cancellation = new vscode.CancellationTokenSource(); }
    getTreeItem(node: HierarchyNode): vscode.TreeItem {
        const labels: Record<Direction, string> = { incoming: 'Callers', outgoing: 'Callees', bases: 'Bases', derived: 'Derived' };
        const item = new vscode.TreeItem(node.group ? labels[node.direction!] : node.item.name,
            node.cycle ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = `${this.kind}HierarchyNode`;
        if (!node.group) {
            item.description = node.cycle ? 'recursive' : node.item.detail;
            item.tooltip = `${node.item.name}\n${vscode.Uri.parse(node.item.uri).fsPath}:${node.item.selectionRange.start.line + 1}`;
            item.iconPath = new vscode.ThemeIcon(this.kind === 'call' ? 'symbol-method' : 'symbol-class');
            item.command = { title: 'Open Symbol', command: 'vscode.open', arguments: [vscode.Uri.parse(node.item.uri), { selection: toCode.asRange(node.item.selectionRange) }] };
        }
        return item;
    }
    async getChildren(node?: HierarchyNode): Promise<HierarchyNode[]> {
        if (!node) { return this.roots; }
        if (node.cycle) { return []; }
        if (node.children) { return node.children; }
        if (!node.direction) {
            const directions: Direction[] = this.kind === 'call' ? ['incoming', 'outgoing'] : ['bases', 'derived'];
            return node.children = directions.map(direction => ({ ...node, group: true, direction, children: undefined }));
        }
        const generation = this.generation;
        const token = this.cancellation.token;
        let items: Item[];
        try {
            if (node.direction === 'incoming') {
                items = (await node.router.request<lsp.CallHierarchyIncomingCall[]>('callHierarchy/incomingCalls', { item: node.item }, token) ?? []).map(call => call.from);
            } else if (node.direction === 'outgoing') {
                items = (await node.router.request<lsp.CallHierarchyOutgoingCall[]>('callHierarchy/outgoingCalls', { item: node.item }, token) ?? []).map(call => call.to);
            } else {
                items = await node.router.request<lsp.TypeHierarchyItem[]>(node.direction === 'bases' ? 'typeHierarchy/supertypes' : 'typeHierarchy/subtypes', { item: node.item }, token) ?? [];
            }
        } catch (error) {
            if (token.isCancellationRequested) { return []; }
            throw error;
        }
        if (generation !== this.generation || token.isCancellationRequested) { return []; }
        const seen = new Set<string>();
        return node.children = items.filter(item => { const id = key(item); if (seen.has(id)) { return false; } seen.add(id); return true; }).map(item => ({
            kind: this.kind, item, router: node.router, direction: node.direction,
            ancestors: new Set([...node.ancestors, key(item)]), cycle: node.ancestors.has(key(item))
        }));
    }
    dispose() { this.cancellation.cancel(); this.cancellation.dispose(); this.changed.dispose(); }
}
