import type { CallHierarchyItem, CallHierarchyIncomingCall, CallHierarchyOutgoingCall } from 'vscode-languageserver-protocol';

export type Direction = 'incoming' | 'outgoing';
export interface GraphBranch { open: boolean; loaded: boolean; loading: boolean; count: number; error?: string; action?: 'expand' | 'collapse' | 'none'; }
export interface GraphNode {
    id: string; name: string; detail: string; uri: string; line: number; layer: number;
    incoming: GraphBranch; outgoing: GraphBranch;
}
export interface GraphEdge { from: string; to: string; }
export interface GraphSnapshot { generation: number; root?: string; nodes: GraphNode[]; edges: GraphEdge[]; message?: string; }
type Request = <T>(method: string, params: unknown) => Promise<T | null>;
const branch = (): GraphBranch => ({ open: false, loaded: false, loading: false, count: 0 });

/** Cache symbols separately from visible branches so collapsing never deletes shared functions. */
export class CallGraphModel {
    private generation = 0;
    private root?: string;
    private nodes = new Map<string, GraphNode>();
    private items = new Map<string, CallHierarchyItem>();
    private neighbors = new Map<string, string[]>();
    private pending = new Map<string, Promise<void>>();
    private queries = new Map<string, Promise<CallHierarchyItem[]>>();
    private relations = new Map<string, CallHierarchyItem[]>();
    private identities = new Map<string, string>();
    private message?: string;
    private chainRevision = 0;
    constructor(private readonly request: Request, private readonly changed: () => void, private readonly maxNodes = 250) {}

    reset(item?: CallHierarchyItem, message?: string): void {
        this.generation++;
        this.chainRevision++;
        this.nodes.clear(); this.items.clear(); this.neighbors.clear(); this.pending.clear(); this.queries.clear(); this.relations.clear(); this.identities.clear();
        this.message = message;
        this.root = item ? this.add(item, 0) : undefined;
        this.changed();
    }
    private collect(skip?: string) {
        const visible = new Set<string>();
        const edges = new Map<string, GraphEdge>();
        const incoming = new Set<string>(), outgoing = new Set<string>();
        const visit = (id: string, direction: Direction, visited: Set<string>): void => {
            if (visited.has(id)) { return; }
            visited.add(id);
            visible.add(id);
            const node = this.nodes.get(id)!;
            if (node[direction].open && `${id}:${direction}` !== skip) {
                for (const other of this.neighbors.get(`${id}:${direction}`) ?? []) {
                    const edge = direction === 'incoming' ? { from: other, to: id } : { from: id, to: other };
                    edges.set(`${edge.from}:${edge.to}`, edge);
                    visit(other, direction, visited);
                }
            }
        };
        if (this.root) {
            visit(this.root, 'incoming', incoming);
            visit(this.root, 'outgoing', outgoing);
        }
        return { visible, edges, incoming, outgoing };
    }
    snapshot(): GraphSnapshot {
        const scope = this.collect();
        const { visible, edges } = scope;
        const present = (id: string, direction: Direction): GraphBranch => {
            // The center is the scope boundary. Never expose sibling callees of an ancestor,
            // or unrelated callers of a descendant, even after a manual expansion.
            if (!scope[direction].has(id)) { return { open: false, loaded: true, loading: false, count: 0, action: 'none' }; }
            const state = this.nodes.get(id)![direction];
            let action: GraphBranch['action'] = 'expand';
            if (!state.loading && !state.error) {
                const key = `${id}:${direction}`;
                if (state.loaded && state.count === 0) { action = 'none'; }
                else if (state.open) {
                    const collapsed = this.collect(key);
                    action = collapsed.edges.size < edges.size || collapsed.visible.size < visible.size ? 'collapse' : 'none';
                } else if (state.loaded) {
                    const hidden = (this.relations.get(key) ?? []).some(item => {
                        const other = this.identities.get(this.identity(item));
                        const edge = direction === 'incoming' ? `${other}:${id}` : `${id}:${other}`;
                        return !other || !edges.has(edge);
                    });
                    action = hidden ? 'expand' : 'none';
                }
            }
            return { ...state, action };
        };
        return { generation: this.generation, root: this.root, nodes: [...visible].map(id => {
            const node = this.nodes.get(id)!;
            return { ...node, incoming: present(id, 'incoming'), outgoing: present(id, 'outgoing') };
        }), edges: [...edges.values()], message: this.message };
    }
    item(id: string): CallHierarchyItem | undefined { return this.items.get(id); }
    private identity(item: CallHierarchyItem): string {
        if (typeof item.data === 'string') { return `clangd:${item.data}`; }
        return JSON.stringify([item.uri, item.selectionRange.start.line, item.selectionRange.start.character, item.name]);
    }
    private add(item: CallHierarchyItem, layer: number): string | undefined {
        const identity = this.identity(item);
        const existing = this.identities.get(identity);
        if (existing) { return existing; }
        if (this.nodes.size >= this.maxNodes) { this.message = `已加载 ${this.maxNodes} 个函数。选择某个节点并“设为中心”以继续查看。`; return undefined; }
        const id = `n${this.nodes.size}`;
        this.identities.set(identity, id); this.items.set(id, item);
        this.nodes.set(id, { id, name: item.name, detail: item.detail ?? '', uri: item.uri,
            line: item.selectionRange.start.line + 1, layer, incoming: branch(), outgoing: branch() });
        return id;
    }
    collapse(id: string, direction: Direction): void {
        this.chainRevision++;
        const state = this.nodes.get(id)?.[direction];
        if (state) { state.open = false; this.changed(); }
    }
    private query(id: string, direction: Direction): Promise<CallHierarchyItem[]> {
        const key = `${id}:${direction}`;
        const existing = this.queries.get(key);
        if (existing) { return existing; }
        const generation = this.generation;
        const params = { item: this.items.get(id)! };
        const result = (async () => {
            try {
                const items = direction === 'incoming'
                    ? (await this.request<CallHierarchyIncomingCall[]>('callHierarchy/incomingCalls', params) ?? []).map(call => call.from)
                    : (await this.request<CallHierarchyOutgoingCall[]>('callHierarchy/outgoingCalls', params) ?? []).map(call => call.to);
                if (this.generation === generation) { this.relations.set(key, items); }
                return items;
            } catch (error) {
                if (this.generation === generation) { this.queries.delete(key); }
                throw error;
            }
        })();
        this.queries.set(key, result);
        return result;
    }
    /** Follow callers only to the left and callees only to the right, stopping at cycles and the node limit. */
    async expandChains(): Promise<void> {
        const root = this.root;
        if (!root) { return; }
        await Promise.all([this.expandChain(root, 'incoming'), this.expandChain(root, 'outgoing')]);
    }
    /** A side button follows that direction through the entire chain, not just one hop. */
    async expandChain(start: string, direction: Direction): Promise<void> {
        const generation = this.generation, revision = this.chainRevision;
        const current = () => generation === this.generation && revision === this.chainRevision;
        const visited = new Set<string>();
        let frontier = [start];
        while (frontier.length && current()) {
            const next: string[] = [];
            for (let index = 0; index < frontier.length; index += 4) {
                if (!current()) { return; }
                await Promise.all(frontier.slice(index, index + 4).map(async id => {
                    if (visited.has(id)) { return; }
                    visited.add(id);
                    await this.expand(id, direction);
                    if (!current() || !this.nodes.get(id)?.[direction].open) { return; }
                    for (const other of this.neighbors.get(`${id}:${direction}`) ?? []) {
                        if (!visited.has(other)) { next.push(other); }
                    }
                }));
            }
            frontier = [...new Set(next)];
        }
    }
    /** Discover empty sides of visible nodes without expanding or consuming the node budget. */
    async probeVisible(): Promise<void> {
        const generation = this.generation;
        const scope = this.collect();
        const jobs = [...scope.visible].flatMap(id => (['incoming', 'outgoing'] as const)
            .filter(direction => scope[direction].has(id)).map(direction => ({ id, direction })));
        const worker = async () => {
            while (jobs.length && this.generation === generation) {
                const { id, direction } = jobs.shift()!;
                const state = this.nodes.get(id)![direction];
                if (state.loaded || state.loading || state.error) { continue; }
                state.loading = true; this.changed();
                try {
                    const items = await this.query(id, direction);
                    if (this.generation !== generation) { return; }
                    if (!state.open) { state.count = items.length; state.loaded = true; }
                } catch (error) {
                    if (this.generation !== generation) { return; }
                    state.error = error instanceof Error ? error.message : String(error);
                } finally {
                    if (this.generation === generation) { state.loading = false; this.changed(); }
                }
            }
        };
        await Promise.all(Array.from({ length: 4 }, worker));
    }
    async expand(id: string, direction?: Direction): Promise<void> {
        if (!direction) { await Promise.all([this.expand(id, 'incoming'), this.expand(id, 'outgoing')]); return; }
        if (!this.collect()[direction].has(id)) { return; }
        const node = this.nodes.get(id);
        if (!node) { return; }
        const state = node[direction];
        state.open = true;
        const key = `${id}:${direction}`;
        if (this.pending.has(key)) { this.changed(); return this.pending.get(key)!; }
        if (state.loaded && this.neighbors.has(key)) { this.changed(); return; }
        const generation = this.generation;
        state.loading = true; state.error = undefined; this.changed();
        const operation = (async () => {
            try {
                const items = await this.query(id, direction);
                if (this.generation !== generation) { return; }
                const ids = new Set<string>();
                let limited = false;
                for (const item of items) {
                    const other = this.add(item, node.layer + (direction === 'incoming' ? -1 : 1));
                    if (other) { ids.add(other); } else { limited = true; }
                }
                this.neighbors.set(key, [...ids]);
                state.count = ids.size; state.loaded = !limited;
            } catch (error) {
                if (this.generation !== generation) { return; }
                state.error = error instanceof Error ? error.message : String(error);
            } finally {
                if (this.generation === generation) { state.loading = false; this.pending.delete(key); this.changed(); }
            }
        })();
        this.pending.set(key, operation);
        return operation;
    }
}
