/* Shared by the webview and geometry regression tests. No DOM or external dependencies. */
(function (scope) {
    const W = 260, H = 74, X = 440, GAP = 44;
    const edgeKey = edge => JSON.stringify([edge.from, edge.to]);
    const hasControl = state => state && (state.loading || state.error || !(state.action === 'none' || state.loaded && state.count === 0));
    function connectionPoint(node, position, direction) {
        const offset = hasControl(node[direction]) ? 14 : 1;
        return [direction === 'incoming' ? position.x - offset : position.x + W + offset, position.y + H / 2];
    }
    function layoutGraph(graph) {
        const nodes = new Map(graph.nodes.map(node => [node.id, node]));
        const edges = graph.edges.filter(edge => nodes.has(edge.from) && nodes.has(edge.to));
        const outgoing = new Map([...nodes.keys()].map(id => [id, []]));
        const incoming = new Map([...nodes.keys()].map(id => [id, []]));
        for (const edge of edges) { outgoing.get(edge.from).push(edge.to); incoming.get(edge.to).push(edge.from); }
        const compare = (a, b) => nodes.get(a).name.localeCompare(nodes.get(b).name) || a.localeCompare(b);
        const ids = [...nodes.keys()].sort(compare);
        // Condense recursive groups before assigning ranks. Every non-recursive edge must go right.
        const number = new Map(), low = new Map(), stack = [], onStack = new Set(), component = new Map(), groups = [];
        function visit(id) {
            number.set(id, number.size); low.set(id, number.get(id)); stack.push(id); onStack.add(id);
            for (const next of outgoing.get(id)) {
                if (!number.has(next)) { visit(next); low.set(id, Math.min(low.get(id), low.get(next))); }
                else if (onStack.has(next)) low.set(id, Math.min(low.get(id), number.get(next)));
            }
            if (low.get(id) === number.get(id)) {
                const group = []; let next;
                do { next = stack.pop(); onStack.delete(next); component.set(next, groups.length); group.push(next); } while (next !== id);
                groups.push(group);
            }
        }
        ids.forEach(id => { if (!number.has(id)) visit(id); });
        const successors = groups.map(() => new Set()), indegree = groups.map(() => 0), ranks = groups.map(() => 0);
        for (const edge of edges) {
            const a = component.get(edge.from), b = component.get(edge.to);
            if (a !== b && !successors[a].has(b)) { successors[a].add(b); indegree[b]++; }
        }
        const queue = indegree.flatMap((degree, index) => degree ? [] : [index]);
        for (let i = 0; i < queue.length; i++) {
            const current = queue[i];
            for (const next of successors[current]) {
                ranks[next] = Math.max(ranks[next], ranks[current] + 1);
                if (--indegree[next] === 0) queue.push(next);
            }
        }
        const rootRank = ranks[component.get(graph.root)] || 0;
        // For two trees rooted at the selected function, reserve each complete subtree's
        // height before placing any boxes. Growing one branch pushes its siblings away.
        let treeLayout;
        if (graph.root && edges.length === nodes.size - 1) {
            const seen = new Set([graph.root]);
            let valid = true;
            const measure = (id, adjacency) => {
                const children = [];
                for (const child of [...adjacency.get(id)].sort(compare)) {
                    if (seen.has(child)) { valid = false; continue; }
                    seen.add(child);
                    children.push(measure(child, adjacency));
                }
                return { id, children, span: Math.max(H, children.reduce((sum, child) => sum + child.span + GAP, -GAP)) };
            };
            const left = measure(graph.root, incoming), right = measure(graph.root, outgoing);
            if (valid && seen.size === nodes.size) {
                treeLayout = new Map();
                const place = (tree, rank, y, direction) => {
                    treeLayout.set(tree.id, { rank, y });
                    let top = y - tree.span / 2;
                    for (const child of tree.children) {
                        place(child, rank + direction, top + child.span / 2, direction);
                        top += child.span + GAP;
                    }
                };
                place(left, 0, 0, -1); place(right, 0, 0, 1);
            }
        }
        const columns = new Map(), slots = new Map(), chains = new Map(), external = new Set();
        let virtualCount = 0;
        function addSlot(id, rank, real) {
            const slot = { id, rank, real, height: real ? H : 12, before: [], after: [], y: 0 };
            slots.set(id, slot);
            if (!columns.has(rank)) columns.set(rank, []);
            columns.get(rank).push(slot);
            return slot;
        }
        for (const id of ids) addSlot(id, treeLayout?.get(id).rank ?? ranks[component.get(id)] - rootRank, true);
        // A reserved slot in each skipped column keeps long edges out of intervening rectangles.
        for (const edge of [...edges].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))) {
            const from = slots.get(edge.from), to = slots.get(edge.to), chain = [from];
            const count = Math.max(0, to.rank - from.rank - 1);
            if (virtualCount + count > 2000) external.add(edgeKey(edge));
            else {
                virtualCount += count;
                for (let rank = from.rank + 1; rank < to.rank; rank++) chain.push(addSlot(`edge:${edgeKey(edge)}:${rank}`, rank, false));
            }
            chain.push(to); chains.set(edgeKey(edge), chain);
            if (from.rank < to.rank && !external.has(edgeKey(edge))) for (let i = 1; i < chain.length; i++) {
                chain[i - 1].after.push(chain[i]); chain[i].before.push(chain[i - 1]);
            }
        }
        const layers = [...columns.keys()].sort((a, b) => a - b);
        function pack(column) {
            const height = column.reduce((sum, slot) => sum + slot.height + GAP, -GAP);
            let y = -height / 2;
            for (const slot of column) { slot.y = y + slot.height / 2; y += slot.height + GAP; }
        }
        for (const column of columns.values()) {
            column.sort((a, b) => a.id.localeCompare(b.id));
            pack(column);
        }
        const segments = new Map();
        for (const [key, chain] of chains) for (let i = 1; i < chain.length; i++) {
            if (external.has(key)) continue;
            const a = chain[i - 1], b = chain[i];
            if (a.rank >= b.rank) continue;
            if (!segments.has(a.rank)) segments.set(a.rank, []);
            segments.get(a.rank).push({ a, b });
        }
        function quality() {
            let crossings = 0, span = 0;
            for (const values of segments.values()) {
                const sorted = [...values].sort((a, b) => a.a.y - b.a.y || a.b.y - b.b.y);
                const ys = [...new Set(sorted.map(value => value.b.y))].sort((a, b) => a - b);
                const indices = new Map(ys.map((y, i) => [y, i + 1])), tree = new Array(ys.length + 1).fill(0);
                let seen = 0;
                for (const value of sorted) {
                    const index = indices.get(value.b.y); let prefix = 0;
                    for (let i = index; i > 0; i -= i & -i) prefix += tree[i];
                    crossings += seen++ - prefix;
                    for (let i = index; i < tree.length; i += i & -i) tree[i]++;
                    span += Math.abs(value.a.y - value.b.y);
                }
            }
            return { crossings, span };
        }
        let best = quality(), order = new Map([...columns].map(([rank, column]) => [rank, [...column]]));
        // Barycentric sweeps group related branches instead of sorting each column alphabetically.
        for (let pass = 0; pass < 6; pass++) {
            const forward = pass % 2 === 0;
            for (const layer of forward ? layers : [...layers].reverse()) {
                const column = columns.get(layer);
                const score = slot => {
                    const neighbors = forward ? slot.before : slot.after;
                    return neighbors.length ? neighbors.reduce((sum, other) => sum + other.y, 0) / neighbors.length : slot.y;
                };
                const scores = new Map(column.map(slot => [slot, score(slot)]));
                column.sort((a, b) => scores.get(a) - scores.get(b) || a.y - b.y || a.id.localeCompare(b.id));
                pack(column);
            }
            const candidate = quality();
            if (candidate.crossings < best.crossings || candidate.crossings === best.crossings && candidate.span < best.span) {
                best = candidate; order = new Map([...columns].map(([rank, column]) => [rank, [...column]]));
            }
        }
        for (const [rank, column] of order) { columns.set(rank, column); pack(column); }
        // Align single-child chains and allocate room for whole branches across columns.
        // Isotonic compaction finds the closest desired centers while enforcing box/lane clearance.
        function align(column, forward) {
            let offset = 0;
            const offsets = [], blocks = [];
            column.forEach((slot, index) => {
                if (index) offset += (column[index - 1].height + slot.height) / 2 + GAP;
                offsets.push(offset);
                const neighbors = forward ? slot.before : slot.after;
                const desired = neighbors.length ? neighbors.reduce((sum, other) => sum + other.y, 0) / neighbors.length : slot.y;
                blocks.push({ start: index, end: index, sum: desired - offset, weight: 1 });
                while (blocks.length > 1) {
                    const last = blocks.at(-1), prev = blocks.at(-2);
                    if (prev.sum / prev.weight <= last.sum / last.weight) break;
                    blocks.splice(-2, 2, { start: prev.start, end: last.end, sum: prev.sum + last.sum, weight: prev.weight + last.weight });
                }
            });
            for (const block of blocks) for (let i = block.start; i <= block.end; i++) column[i].y = block.sum / block.weight + offsets[i];
        }
        for (let pass = 0; pass < 12; pass++) {
            const forward = pass % 2 === 0;
            for (const layer of forward ? layers : [...layers].reverse()) align(columns.get(layer), forward);
        }
        if (treeLayout) for (const [id, position] of treeLayout) slots.get(id).y = position.y;
        else {
            // Keep uninterrupted chains horizontal, including virtual lanes for long calls.
            // Clamp each chain's shared center to its available space in every column.
            const visited = new Set();
            for (const first of slots.values()) {
                if (first.before.length === 1 && first.before[0].after.length === 1) continue;
                const chain = []; let slot = first;
                while (slot && !visited.has(slot)) {
                    chain.push(slot); visited.add(slot);
                    slot = slot.after.length === 1 && slot.after[0].before.length === 1 ? slot.after[0] : undefined;
                }
                if (chain.length < 2) continue;
                let lower = -Infinity, upper = Infinity;
                for (const member of chain) {
                    const column = columns.get(member.rank), index = column.indexOf(member);
                    if (index) lower = Math.max(lower, column[index - 1].y + (column[index - 1].height + member.height) / 2 + GAP);
                    if (index + 1 < column.length) upper = Math.min(upper, column[index + 1].y - (column[index + 1].height + member.height) / 2 - GAP);
                }
                if (lower <= upper) {
                    const center = Math.max(lower, Math.min(upper, chain.reduce((sum, member) => sum + member.y, 0) / chain.length));
                    for (const member of chain) member.y = center;
                }
            }
        }
        const rootY = slots.get(graph.root)?.y || 0;
        const positions = new Map();
        for (const slot of slots.values()) {
            slot.y -= rootY;
            if (slot.real) positions.set(slot.id, { x: slot.rank * X - W / 2, y: slot.y - H / 2, rank: slot.rank });
        }
        const reachable = adjacency => {
            const result = new Set(); const todo = graph.root ? [graph.root] : [];
            for (let i = 0; i < todo.length; i++) for (const next of adjacency.get(todo[i]) || []) {
                if (!result.has(next)) { result.add(next); todo.push(next); }
            }
            return result;
        };
        const callers = reachable(incoming), callees = reachable(outgoing);
        const roles = new Map(ids.map(id => [id, id === graph.root ? 'root' : callers.has(id) ? 'caller' : callees.has(id) ? 'callee' : 'related']));
        const routes = new Map(), tracks = segments;
        // A fan-out shares one spine on the right; a fan-in shares one spine on the left.
        const trackPositions = new Map();
        for (const [rank, entries] of tracks) {
            entries.sort((a, b) => a.b.y - b.b.y || a.a.y - b.a.y || a.a.id.localeCompare(b.a.id));
            const group = entry => rank < 0 ? entry.b.id : entry.a.id;
            const groups = [...new Set(entries.map(group))];
            entries.forEach(entry => trackPositions.set(JSON.stringify([entry.a.id, entry.b.id]), rank * X + W / 2 + 34 + (X - W - 68) * (groups.indexOf(group(entry)) + 1) / (groups.length + 1)));
        }
        const top = Math.min(0, ...[...positions.values()].map(position => position.y)) - GAP;
        let loop = 0;
        for (const edge of edges) {
            const chain = chains.get(edgeKey(edge)), from = chain[0], to = chain.at(-1);
            const a = positions.get(edge.from), b = positions.get(edge.to);
            const start = connectionPoint(nodes.get(edge.from), a, 'outgoing');
            const end = connectionPoint(nodes.get(edge.to), b, 'incoming');
            const points = [start];
            const recursive = from.rank === to.rank;
            if (recursive) {
                const offset = 32 + (loop++ % 5) * 9;
                const right = a.x + W + offset, left = b.x - offset;
                const corridor = b.y - 22;
                points.push([right, from.y], [right, corridor], [left, corridor], [left, to.y], end);
            } else if (external.has(edgeKey(edge))) {
                // Dense graphs use outside lanes after the dummy-slot budget is exhausted.
                const corridor = top - (loop++ % 12) * 12, right = a.x + W + 32, left = b.x - 32;
                points.push([right, from.y], [right, corridor], [left, corridor], [left, to.y], end);
            } else {
                for (let i = 1; i < chain.length; i++) {
                    const prev = chain[i - 1], next = chain[i];
                    const mid = trackPositions.get(JSON.stringify([prev.id, next.id]));
                    const target = i === chain.length - 1 ? end : [next.rank * X, next.y];
                    points.push([mid, prev.y], [mid, next.y], target);
                }
            }
            routes.set(edgeKey(edge), { points, recursive });
        }
        const allPoints = [...positions.values()].flatMap(p => [[p.x - 16, p.y], [p.x + W + 16, p.y + H]])
            .concat([...routes.values()].flatMap(route => route.points));
        const bounds = allPoints.length ? allPoints.reduce((box, p) => ({ minX: Math.min(box.minX, p[0] - 30), maxX: Math.max(box.maxX, p[0] + 30),
            minY: Math.min(box.minY, p[1] - 30), maxY: Math.max(box.maxY, p[1] + 30) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }) : undefined;
        return { positions, routes, roles, bounds };
    }
    function routePath(points, rounded) {
        // Remove duplicate/collinear waypoints before rounding the remaining orthogonal bends.
        const clean = [];
        for (const point of points) {
            const last = clean.at(-1), prev = clean.at(-2);
            if (last && point[0] === last[0] && point[1] === last[1]) continue;
            if (prev && (prev[0] === last[0] && last[0] === point[0] || prev[1] === last[1] && last[1] === point[1])) clean.pop();
            clean.push(point);
        }
        if (!clean.length) return '';
        let path = `M ${clean[0].join(' ')}`;
        for (let i = 1; i < clean.length; i++) {
            const prev = clean[i - 1], point = clean[i], next = clean[i + 1];
            if (!rounded || !next) { path += ` L ${point.join(' ')}`; continue; }
            const before = Math.hypot(point[0] - prev[0], point[1] - prev[1]), after = Math.hypot(next[0] - point[0], next[1] - point[1]);
            const radius = Math.min(12, before / 2, after / 2);
            const a = point.map((value, axis) => value + (prev[axis] - value) * radius / before);
            const b = point.map((value, axis) => value + (next[axis] - value) * radius / after);
            path += ` L ${a.join(' ')} Q ${point.join(' ')} ${b.join(' ')}`;
        }
        return path;
    }
    const api = { layoutGraph, routePath, edgeKey, connectionPoint, W, H };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else scope.HornetGraphLayout = api;
})(typeof globalThis === 'object' ? globalThis : this);
