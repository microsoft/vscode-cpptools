/* Optional real Chromium smoke test. Compile tests first; set HORNET_PLAYWRIGHT_MODULE
 * to playwright-core and HORNET_BROWSER_PATH to a local Chromium executable. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.HORNET_PLAYWRIGHT_MODULE || 'playwright-core');
const { CancellationTokenSource } = require('vscode-jsonrpc');
const extension = path.resolve(__dirname, '../..');
const artifact = path.resolve(extension, 'artifacts/graph-browser');
const item = name => ({ name, kind: 12, detail: 'demo.cpp', uri: 'file:///project/demo.cpp',
    range: { start: { line: names.indexOf(name) * 10, character: 0 }, end: { line: names.indexOf(name) * 10 + 9, character: 0 } },
    selectionRange: { start: { line: names.indexOf(name) * 10, character: 4 }, end: { line: names.indexOf(name) * 10, character: 12 } } });
const relations = [['main', 'processFrame'], ['onTimer', 'processFrame'], ['processFrame', 'readSensor'],
    ['processFrame', 'updateState'], ['processFrame', 'logEvent'], ['readSensor', 'spiTransfer'],
    ['readSensor', 'validateSample'], ['calibrate', 'readSensor'], ['updateState', 'updateState'],
    ['logEvent', '<img src=x onerror=alert(1)>']];
const marsRelations = [['TEST_F', 'MarsRover_Execute'], ['main', 'MarsRover_Execute'], ['MarsRover_Execute', 'MarsRover_ExecuteOne'],
    ['MarsRover_ExecuteOne', 'MarsRover_Move'], ['MarsRover_ExecuteOne', 'MarsRover_TurnLeft'], ['MarsRover_ExecuteOne', 'MarsRover_TurnRight'],
    ['MarsRover_Move', 'MarsRover_IsInsideArea'], ['main', 'MarsRover_Init'], ['TEST', 'MarsRover_Init'],
    ['MarsRover_Init', 'MarsRover_IsInsideArea'], ['MarsRover_Init', 'MarsRover_IsDirectionValid'], ['MarsRover_Init', 'MarsRover_IsBoundaryModeValid']];
const dRelations = [['main', 'A'], ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'G'], ['D', 'I'], ['I', 'J'],
    ['main', 'H'], ['A', 'unusedA'], ['B', 'unusedB'], ['C', 'unusedC']];
const names = [...new Set([...relations.flat(), ...marsRelations.flat(), ...dRelations.flat(), 'K', 'L', 'M', 'N'])];

(async () => {
    let browser, host, page, received, disposed, visibilityChanged, view, html, latest, ready = false;
    const navigations = [], errors = [], requests = [];
    const createView = () => ({
        title: '', visible: true, show() {},
        onDidDispose: callback => { disposed = callback; return { dispose() {} }; },
        onDidChangeVisibility: callback => { visibilityChanged = callback; return { dispose() {} }; },
        webview: { cspSource: "'self'", asWebviewUri: uri => `https://hornet.test/assets/${path.basename(uri.pathname)}`,
            set html(value) { html = value; }, onDidReceiveMessage: callback => { received = callback; return { dispose() {} }; },
            postMessage: async value => { latest = value; if (ready) await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), value); return true; }
        }
    });
    const mock = {
        CancellationTokenSource,
        Uri: { joinPath: (base, ...parts) => new URL(`${base.toString().replace(/\/$/, '')}/${parts.join('/')}`), parse: value => ({ scheme: new URL(value).protocol.slice(0, -1), toString: () => value }) },
        ViewColumn: { Beside: 2, One: 1 }, Range: class { constructor(...args) { this.values = args; } },
        commands: { executeCommand: async command => {
            assert.equal(command, 'hornet-cpp.graphView.focus');
            if (!view) { view = createView(); host.resolveWebviewView(view); }
        } },
        window: {
            showTextDocument: async (uri, options) => navigations.push({ uri: uri.toString(), options }),
            showQuickPick: async values => values[0],
            createWebviewPanel: () => { throw new Error('The call graph must never open an editor panel'); }
        }
    };
    const loader = require('node:module'), original = loader._load;
    try {
        loader._load = (id, ...args) => id === 'vscode' ? mock : original(id, ...args);
        const { CallGraphPanel } = require('../../out/hornet/src/hornet/views/callGraphPanel');
        loader._load = original;
        host = new CallGraphPanel(pathToFileURL(extension));
        let activeRelations = relations;
        const router = { request: async (method, params) => {
            const incoming = method.endsWith('incomingCalls');
            requests.push(`${params.item.name}:${incoming ? 'incoming' : 'outgoing'}`);
            return activeRelations.filter(edge => edge[incoming ? 1 : 0] === params.item.name).map(edge =>
                incoming ? { from: item(edge[0]), fromRanges: [] } : { to: item(edge[1]), fromRanges: [] });
        } };
        await host.show([item('processFrame')], router);
        browser = await chromium.launch({ executablePath: process.env.HORNET_BROWSER_PATH, headless: true });
        page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
        await page.route('https://hornet.test/**', route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
            const file = path.basename(url.pathname);
            return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(path.join(extension, 'assets/callGraph', file)) });
        });
        await page.exposeFunction('sendToHost', message => {
            if (message.type === 'ready') ready = true;
            received(message);
        });
        await page.addInitScript(() => { let state; window.acquireVsCodeApi = () => ({ getState: () => state, setState: value => { state = value; }, postMessage: message => window.sendToHost(message) }); });
        await page.goto('https://hornet.test/');
        const count = n => page.waitForFunction(value => document.querySelectorAll('.node').length === value, n);
        const node = name => page.locator('.node').filter({ has: page.getByText(name, { exact: true }) });
        const side = (name, direction) => node(name).locator(`[data-direction="${direction}"]`);
        await count(6);
        assert.equal(await node('spiTransfer').count(), 0, 'initial view contains only one hop');
        await side('readSensor', 'outgoing').click(); await count(8);
        await side('logEvent', 'outgoing').click(); await count(9);
        await side('updateState', 'outgoing').click();
        assert.equal(await page.locator('.expand').count(), 5);
        assert.equal(await side('main', 'incoming').count(), 0, 'empty caller side has no control');
        assert.equal(await side('onTimer', 'incoming').count(), 0);
        const left = await side('processFrame', 'incoming').boundingBox(), right = await side('processFrame', 'outgoing').boundingBox();
        assert.ok(left.x < right.x && Math.abs(left.y - right.y) < 1, 'controls sit on opposite sides of the rectangle');
        assert.equal(await side('readSensor', 'outgoing').getAttribute('aria-expanded'), 'true');
        assert.equal(await side('spiTransfer', 'incoming').count(), 0, 'already drawn caller is not a plus button');
        await side('processFrame', 'incoming').click(); await count(7);
        assert.equal(await side('processFrame', 'incoming').textContent().then(text => text.startsWith('+')), true);
        await side('processFrame', 'incoming').click(); await count(9);
        assert.equal(requests.filter(value => value === 'processFrame:incoming').length, 1);
        await side('readSensor', 'outgoing').click(); await count(7);
        assert.equal(await side('readSensor', 'outgoing').getAttribute('aria-expanded'), 'false');
        await side('readSensor', 'outgoing').click(); await count(9);
        await side('spiTransfer', 'outgoing').waitFor({ state: 'detached' });
        await side('validateSample', 'outgoing').waitFor({ state: 'detached' });
        assert.equal(await side('spiTransfer', 'incoming').count(), 0, 'leaf caller edge is already visible');
        assert.equal(await side('readSensor', 'incoming').count(), 0, 'unrelated callers of descendants cannot be expanded');
        await side('updateState', 'outgoing').click();
        await page.waitForFunction(() => ![...document.querySelectorAll('.edge')].some(edge => edge.dataset.from === edge.dataset.to));
        await side('updateState', 'outgoing').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.edge')].some(edge => edge.dataset.from === edge.dataset.to));
        assert.ok((await page.locator('.edge').evaluateAll(edges => edges.map(edge => edge.getAttribute('d')))).some(d => d.includes('Q')));
        await page.selectOption('#edgeStyle', 'straight');
        assert.ok((await page.locator('.edge').evaluateAll(edges => edges.filter(edge => edge.dataset.from !== edge.dataset.to).map(edge => edge.getAttribute('d')))).every(d => !d.includes('Q')));
        await page.selectOption('#edgeStyle', 'rounded');
        await side('logEvent', 'outgoing').click(); await count(8);
        await side('logEvent', 'outgoing').click(); await count(9);
        assert.equal(await page.locator('img').count(), 0, 'function names are text, never HTML');
        await side('logEvent', 'outgoing').click(); await count(8);
        const transform = await page.locator('#scene').getAttribute('transform');
        await page.click('#zoomIn');
        assert.notEqual(await page.locator('#scene').getAttribute('transform'), transform);
        await page.click('#fit');
        await node('readSensor').locator('.name').dblclick();
        await page.waitForTimeout(100);
        assert.equal(navigations.at(-1).uri, 'file:///project/demo.cpp');
        fs.mkdirSync(artifact, { recursive: true });
        await page.screenshot({ path: path.join(artifact, 'call-graph.png') });
        await page.click('#setRoot'); await count(5);
        await side('processFrame', 'incoming').click(); await count(7);
        assert.equal(await page.locator('.node.root .name').textContent(), 'readSensor');
        received({ type: 'open', id: latest.graph.root, generation: -1 });
        assert.equal(navigations.length, 1, 'stale webview navigation is rejected');
        host.clear(router); await count(0);
        assert.match(await page.locator('#empty').textContent(), /语言服务已更新/);
        await host.show([item('isolated')], router); await count(1);
        assert.equal(await page.locator('.expand').count(), 0, 'isolated functions have neither side control');
        assert.equal(await page.locator('.edge').count(), 0);
        activeRelations = marsRelations;
        await host.show([item('MarsRover_IsInsideArea')], router); await count(3);
        await side('MarsRover_Move', 'incoming').click(); await count(4);
        await side('MarsRover_ExecuteOne', 'incoming').click(); await count(5);
        await side('MarsRover_Execute', 'incoming').click(); await count(7);
        await side('MarsRover_Init', 'incoming').click(); await count(8);
        assert.equal(await side('MarsRover_Init', 'outgoing').count(), 0);
        assert.equal(await side('MarsRover_ExecuteOne', 'outgoing').count(), 0);
        assert.equal(await node('MarsRover_TurnLeft').count(), 0);
        await side('MarsRover_Move', 'incoming').click(); await count(5);
        await side('MarsRover_Move', 'incoming').click(); await count(8);
        const directions = await page.locator('.edge').evaluateAll(edges => edges.filter(edge => !edge.classList.contains('recursive')).map(edge => {
            const nodes = [...document.querySelectorAll('.node')];
            const from = nodes.find(node => node.dataset.id === edge.dataset.from).transform.baseVal.getItem(0).matrix;
            const to = nodes.find(node => node.dataset.id === edge.dataset.to).transform.baseVal.getItem(0).matrix;
            return from.e < to.e;
        }));
        assert.ok(directions.every(Boolean), 'expanded screenshot has no reversed normal calls');
        const beforeProbe = await page.locator('.node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
        await page.evaluate(value => window.dispatchEvent(new MessageEvent('message', { data: value })), latest);
        assert.deepEqual(await page.locator('.node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform'))), beforeProbe, 'status updates do not rearrange nodes');
        await page.screenshot({ path: path.join(artifact, 'mars-expanded-layout.png') });
        const retained = await page.locator('#scene').getAttribute('transform');
        view.visible = false; visibilityChanged();
        view.visible = true; visibilityChanged(); await count(8);
        assert.equal(await page.locator('#scene').getAttribute('transform'), retained, 'switching bottom panel tabs retains the viewport');
        const queryCount = requests.length;
        ready = false; disposed(); view = undefined;
        await mock.commands.executeCommand('hornet-cpp.graphView.focus');
        await page.reload(); await count(8);
        assert.equal(requests.length, queryCount, 'recreating a hidden view restores the existing graph without querying again');
        await page.setViewportSize({ width: 1824, height: 340 });
        await page.click('#fit');
        assert.ok(await page.locator('#canvas').evaluate(canvas => canvas.clientHeight) > 200, 'compact bottom panel leaves room for the graph');
        await page.screenshot({ path: path.join(artifact, 'bottom-panel-graph.png') });
        activeRelations = dRelations;
        await host.show([item('D')], router); await count(4);
        await page.screenshot({ path: path.join(artifact, 'd-initial-one-level.png') });
        assert.deepEqual(latest.graph.nodes.map(node => node.name).sort(), ['C', 'D', 'E', 'I']);
        await side('C', 'incoming').click(); await count(5);
        assert.equal(await node('A').count(), 0, 'one click adds only the next level');
        await side('B', 'incoming').click(); await count(6);
        await side('A', 'incoming').click(); await count(7);
        await side('E', 'outgoing').click(); await count(8);
        await side('F', 'outgoing').click(); await count(9);
        await side('I', 'outgoing').click(); await count(10);
        const assertFitted = async () => {
            const canvas = await page.locator('#canvas').boundingBox();
            for (const rectangle of await page.locator('.node > rect').all()) {
                const box = await rectangle.boundingBox();
                assert.ok(box.x >= canvas.x && box.x + box.width <= canvas.x + canvas.width + 1
                    && box.y >= canvas.y && box.y + box.height <= canvas.y + canvas.height + 1, 'reflow fits every function into the canvas');
            }
        };
        await assertFitted();
        assert.equal(await page.locator('.node.root .name').textContent(), 'D');
        assert.equal(await side('D', 'incoming').getAttribute('aria-expanded'), 'true');
        assert.equal(await side('D', 'outgoing').getAttribute('aria-expanded'), 'true');
        assert.equal(await side('G', 'outgoing').count(), 0);
        assert.equal(await side('J', 'outgoing').count(), 0);
        await page.screenshot({ path: path.join(artifact, 'd-complete-chains.png') });
        await side('D', 'incoming').click(); await count(6);
        await side('D', 'outgoing').click(); await count(1);
        await side('D', 'incoming').click(); await count(5);
        await side('D', 'outgoing').click(); await count(10);
        for (const ancestor of ['main', 'A', 'B', 'C']) {
            assert.equal(await side(ancestor, 'outgoing').count(), 0, 'no control can leak ancestor side branches');
            const id = latest.graph.nodes.find(node => node.name === ancestor).id;
            received({ type: 'expand', id, direction: 'outgoing', generation: latest.graph.generation });
        }
        await count(10);
        assert.ok(!latest.graph.nodes.some(node => ['H', 'unusedA', 'unusedB', 'unusedC'].includes(node.name)));
        activeRelations = [...dRelations, ['E', 'K'], ['K', 'L'], ['K', 'M'], ['M', 'N']];
        await host.show([item('D')], router); await count(4);
        await side('C', 'incoming').click(); await count(5);
        await side('B', 'incoming').click(); await count(6);
        await side('A', 'incoming').click(); await count(7);
        await side('E', 'outgoing').click(); await count(9);
        await side('F', 'outgoing').click(); await count(10);
        await side('I', 'outgoing').click(); await count(11);
        await side('K', 'outgoing').click(); await count(13);
        await side('M', 'outgoing').click(); await count(14);
        await side('E', 'outgoing').click(); await count(8);
        const beforeBranch = await page.locator('.node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.id, node.getAttribute('transform')])));
        await side('E', 'outgoing').click(); await count(14);
        await assertFitted();
        assert.ok(await page.locator('.node').evaluateAll((nodes, before) => nodes.some(node => before[node.dataset.id] && before[node.dataset.id] !== node.getAttribute('transform')), beforeBranch),
            'expanding a descendant subtree moves its sibling boxes');
        await page.screenshot({ path: path.join(artifact, 'd-expanded-branch.png') });
        await page.setViewportSize({ width: 1440, height: 900 });
        activeRelations = marsRelations;
        await host.show([item('MarsRover_ExecuteOne')], router); await count(5);
        await page.screenshot({ path: path.join(artifact, 'execute-one-initial.png') });
        await side('MarsRover_Move', 'outgoing').click(); await count(6);
        assert.equal(await page.locator('#arrow').getAttribute('markerUnits'), 'userSpaceOnUse', 'highlighting never changes arrow size');
        assert.equal(await page.locator('#arrow').getAttribute('refX'), '10', 'marker tip meets the path endpoint');
        const alignedPorts = await page.locator('.edge').evaluateAll(edges => edges.every(edge => {
            const nodes = [...document.querySelectorAll('.node')];
            const from = nodes.find(node => node.dataset.id === edge.dataset.from).transform.baseVal.getItem(0).matrix;
            const to = nodes.find(node => node.dataset.id === edge.dataset.to).transform.baseVal.getItem(0).matrix;
            return Math.abs(edge.getPointAtLength(0).y - from.f - 37) < 0.01
                && Math.abs(edge.getPointAtLength(edge.getTotalLength()).y - to.f - 37) < 0.01;
        }));
        assert.ok(alignedPorts, 'expanded SVG arrows meet the vertical center of every node');
        await page.screenshot({ path: path.join(artifact, 'execute-one-expanded.png') });
        if (process.env.HORNET_GRAPH_SNAPSHOT) {
            const snapshot = JSON.parse(fs.readFileSync(process.env.HORNET_GRAPH_SNAPSHOT, 'utf8'));
            await page.evaluate(graph => window.dispatchEvent(new MessageEvent('message', { data: { type: 'graph', graph } })), snapshot);
            await count(snapshot.nodes.length);
            assert.equal(await side('MarsRover_GetForwardDelta', 'incoming').count(), 0);
            assert.equal(await side('MarsRover_Move', 'incoming').getAttribute('aria-expanded'), 'true');
            assert.equal(await side('MarsRover_Move', 'outgoing').getAttribute('aria-expanded'), 'true');
            await page.screenshot({ path: path.join(artifact, 'mars-rover-call-graph.png') });
        }
        assert.deepEqual(errors, []);
        console.log('PASS: real Chromium rendering, left/right expansion/collapse, caching, cycles, both arrow styles, safe labels, zoom, navigation, reroot and invalidation.');
        console.log(`Screenshot: ${path.join(artifact, 'call-graph.png')}`);
    } finally {
        loader._load = original;
        ready = false;
        host?.dispose();
        await browser?.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
