/* Runs only inside the sandboxed webview; symbol text is always assigned as textContent. */
(() => {
    const vscode = acquireVsCodeApi();
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.getElementById('graph');
    const scene = document.getElementById('scene');
    const nodesGroup = document.getElementById('nodes');
    const edgesGroup = document.getElementById('edges');
    const message = document.getElementById('message');
    const style = document.getElementById('edgeStyle');
    const saved = vscode.getState() || {};
    style.value = saved.edgeStyle === 'straight' ? 'straight' : 'rounded';
    const { W, H, layoutGraph, routePath, edgeKey, connectionPoint } = globalThis.HornetGraphLayout;
    let graph = { nodes: [], edges: [], generation: -1 };
    let selected, positions = new Map(), scale = 1, tx = 0, ty = 0, autoFit = true;
    let geometry, topology;
    const send = (type, id, direction) => vscode.postMessage({ type, id, direction, generation: graph.generation });
    const element = (tag, attrs, text) => {
        const item = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attrs || {})) item.setAttribute(key, String(value));
        if (text !== undefined) item.textContent = text;
        return item;
    };
    const truncate = (text, length) => text.length > length ? text.slice(0, length - 1) + '…' : text;
    function filename(uri) { try { return decodeURIComponent(uri.split('/').pop()); } catch { return uri.split('/').pop(); } }
    function layout() {
        const next = JSON.stringify([graph.root, graph.nodes.map(node => node.id).sort(), graph.edges.map(edgeKey).sort()]);
        if (next === topology) return;
        // Loading/probing updates only repaint controls; they must not shuffle the graph.
        geometry = layoutGraph(graph);
        positions = geometry.positions; topology = next;
    }
    function edgePath(edge) {
        const route = geometry.routes.get(edgeKey(edge));
        if (!route) return '';
        const points = route.points.map(point => [...point]);
        points[0] = connectionPoint(graph.nodes.find(node => node.id === edge.from), positions.get(edge.from), 'outgoing');
        points[points.length - 1] = connectionPoint(graph.nodes.find(node => node.id === edge.to), positions.get(edge.to), 'incoming');
        return routePath(points, style.value !== 'straight');
    }
    function status() {
        const node = graph.nodes.find(value => value.id === selected);
        document.getElementById('open').disabled = !node;
        document.getElementById('setRoot').disabled = !node;
        const error = node?.incoming.error || node?.outgoing.error;
        const loading = node?.incoming.loading || node?.outgoing.loading;
        message.textContent = graph.message || (error ? `查询失败，可点击 ＋ 重试：${error}` : loading ? `正在查询 ${node.name} 的调用关系…` : node ? `${node.name} · ${filename(node.uri)}:${node.line} · 左侧：调用者 / 右侧：被调用函数` : '点击选择函数 · 双击跳转源码 · 拖动画布平移 · 滚轮缩放');
    }
    function select(id) {
        selected = id;
        for (const node of nodesGroup.children) node.classList.toggle('selected', node.dataset.id === id);
        for (const edge of edgesGroup.children) edge.classList.toggle('highlight', edge.dataset.from === id || edge.dataset.to === id);
        status();
    }
    function draw() {
        const focus = document.activeElement?.getAttribute('data-focus');
        layout(); nodesGroup.replaceChildren(); edgesGroup.replaceChildren();
        const names = new Map(graph.nodes.map(node => [node.id, node.name]));
        for (const edge of graph.edges) {
            const recursive = geometry.routes.get(edgeKey(edge))?.recursive;
            const path = element('path', { class: `edge${recursive ? ' recursive' : ''}`, d: edgePath(edge), 'data-from': edge.from, 'data-to': edge.to });
            path.append(element('title', {}, `${names.get(edge.from)} → ${names.get(edge.to)}${recursive ? '（递归调用）' : ''}`));
            edgesGroup.append(path);
        }
        for (const node of graph.nodes) {
            const position = positions.get(node.id);
            const role = geometry.roles.get(node.id);
            const group = element('g', { class: `node ${role}${node.incoming.error || node.outgoing.error ? ' error' : ''}`, transform: `translate(${position.x} ${position.y})`, 'data-id': node.id,
                'data-focus': node.id, tabindex: 0, role: 'group', 'aria-label': `${node.name}，${filename(node.uri)} 第 ${node.line} 行` });
            group.append(element('rect', { width: W, height: H, rx: 12 }));
            group.append(element('line', { class: 'stripe', x1: 10, x2: 10, y1: 18, y2: H - 18 }));
            group.append(element('text', { class: 'name', x: 23, y: 29 }, truncate(node.name, 29)));
            group.append(element('text', { class: 'file', x: 23, y: 52 }, truncate(`${filename(node.uri)}:${node.line}`, 34)));
            group.append(element('title', {}, `${node.name}\n${node.detail}\n${node.uri}:${node.line}`));
            for (const direction of ['incoming', 'outgoing']) {
                const state = node[direction], label = direction === 'incoming' ? '调用者' : '被调用函数';
                const empty = state.loaded && state.count === 0;
                if ((empty || state.action === 'none') && !state.loading && !state.error) continue;
                const action = state.action === 'collapse' ? 'collapse' : 'expand';
                const caption = `${action === 'collapse' ? '折叠' : '展开'} ${node.name} 的${label}`;
                const expand = element('g', { class: 'expand', transform: `translate(${direction === 'incoming' ? 0 : W} ${H / 2})`, tabindex: 0, role: 'button',
                    'data-focus': `${node.id}-${direction}`, 'data-direction': direction, 'aria-label': caption,
                    'aria-expanded': action === 'collapse', 'aria-disabled': state.loading });
                expand.append(element('rect', { x: -13, y: -12, width: 26, height: 24, rx: 5 }));
                expand.append(element('text', {}, state.loading ? '…' : action === 'collapse' ? '−' : '+'));
                expand.append(element('title', {}, state.loading ? '正在查询…' : caption));
                const trigger = event => { event.stopPropagation(); select(node.id); if (!state.loading) { autoFit = true; send(action, node.id, direction); } };
                expand.addEventListener('click', trigger);
                expand.addEventListener('dblclick', event => event.stopPropagation());
                expand.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); trigger(event); } });
                group.append(expand);
            }
            group.addEventListener('click', () => select(node.id));
            group.addEventListener('dblclick', () => send('open', node.id));
            group.addEventListener('keydown', event => { if (event.key === 'Enter') { select(node.id); send('open', node.id); } });
            nodesGroup.append(group);
        }
        document.getElementById('empty').classList.toggle('hidden', graph.nodes.length > 0);
        document.getElementById('empty').textContent = graph.message || '没有可显示的函数。请在编辑器中右键函数名，选择“Hornet Show Graph”。';
        document.getElementById('counts').textContent = `${graph.nodes.length} 个函数 · ${graph.edges.length} 条调用`;
        if (!graph.nodes.some(node => node.id === selected)) selected = graph.root;
        select(selected);
        if (focus) {
            const targets = [...nodesGroup.querySelectorAll('[data-focus]')];
            (targets.find(item => item.getAttribute('data-focus') === focus)
                || targets.find(item => item.getAttribute('data-focus') === focus.replace(/-(incoming|outgoing)$/, '')))?.focus();
        }
        if (autoFit) fit(); else transform();
    }
    function transform() { scene.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`); }
    function fit() {
        if (!positions.size) return;
        const width = svg.clientWidth, height = svg.clientHeight;
        const { minX, maxX, minY, maxY } = geometry.bounds;
        scale = Math.max(.12, Math.min(1.25, width / (maxX - minX), height / (maxY - minY)));
        tx = width / 2 - (minX + maxX) * scale / 2;
        ty = height / 2 - (minY + maxY) * scale / 2;
        transform();
    }
    function zoom(factor, x = svg.clientWidth / 2, y = svg.clientHeight / 2) {
        const next = Math.max(.12, Math.min(3, scale * factor));
        tx = x - (x - tx) * next / scale; ty = y - (y - ty) * next / scale; scale = next; autoFit = false; transform();
    }
    let drag;
    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('.node')) return;
        drag = { x: event.clientX, y: event.clientY, tx, ty };
        svg.setPointerCapture(event.pointerId); svg.classList.add('dragging'); autoFit = false;
    });
    svg.addEventListener('pointermove', event => { if (drag) { tx = drag.tx + event.clientX - drag.x; ty = drag.ty + event.clientY - drag.y; transform(); } });
    const stopDrag = () => { drag = undefined; svg.classList.remove('dragging'); };
    svg.addEventListener('pointerup', stopDrag); svg.addEventListener('pointercancel', stopDrag);
    svg.addEventListener('wheel', event => { event.preventDefault(); const rect = svg.getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
    document.getElementById('zoomIn').onclick = () => zoom(1.2);
    document.getElementById('zoomOut').onclick = () => zoom(1 / 1.2);
    document.getElementById('fit').onclick = () => { autoFit = true; fit(); };
    document.getElementById('refresh').onclick = () => send('refresh');
    document.getElementById('open').onclick = () => send('open', selected);
    document.getElementById('setRoot').onclick = () => send('setRoot', selected);
    style.onchange = () => { vscode.setState({ edgeStyle: style.value }); draw(); };
    new ResizeObserver(() => { if (autoFit) fit(); }).observe(document.getElementById('canvas'));
    window.addEventListener('message', event => {
        if (event.data?.type === 'graph') {
            const next = event.data.graph;
            if (next.generation !== graph.generation) { autoFit = true; selected = next.root; positions = new Map(); topology = undefined; }
            graph = next; draw();
        } else if (event.data?.type === 'error') message.textContent = event.data.message;
    });
    send('ready');
})();
