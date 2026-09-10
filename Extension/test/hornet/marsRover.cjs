// Optional regression using a local copy of the user's sample project. Never writes to the source project.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ProcessManager } = require('../../out/hornet/src/hornet/core/processManager');
const loader = require('node:module'), original = loader._load;
const mock = new Proxy({ workspace: { isTrusted: true, getConfiguration: () => ({ get: (_key, fallback) => fallback }) }, window: { showErrorMessage() {} } }, { get: (value, key) => value[key] ?? class {} });
loader._load = (id, ...args) => id === 'vscode' ? mock : original(id, ...args);
const { CompilerEngine } = require('../../out/hornet/src/hornet/engines/compilerEngine');
loader._load = original;
(async () => {
    const project = process.env.HORNET_MARS_PROJECT;
    if (!project) throw new Error('Set HORNET_MARS_PROJECT to the sample project directory');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hornet-mars-'));
    const processes = new ProcessManager();
    let engine;
    try {
        for (const dir of ['include', 'src', 'app']) fs.cpSync(path.join(project, dir), path.join(root, dir), { recursive: true });
        const file = path.join(root, 'src', 'mars_rover.c'), uri = pathToFileURL(file).toString();
        fs.mkdirSync(path.join(root, 'db'));
        fs.writeFileSync(path.join(root, 'db', 'compile_commands.json'), '[]');
        const diagnostics = [];
        engine = new CompilerEngine(processes, { root: { name: 'mars', uri: { fsPath: root, toString: () => pathToFileURL(root).toString() } },
            databaseDirectory: path.join(root, 'db'), log: line => { if (process.env.HORNET_VERBOSE) console.log(line); }, diagnostics: value => diagnostics.push(...value.diagnostics), changed() {}, refresh() {}, canApplyEdit: () => false });
        await engine.initialize();
        const text = fs.readFileSync(file, 'utf8');
        await engine.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'c', version: 1, text } });
        const line = text.split('\n').findIndex(line => line.includes('static MarsRoverStatus MarsRover_Move'));
        const character = text.split('\n')[line].indexOf('MarsRover_Move') + 1;
        const items = await engine.request('textDocument/prepareCallHierarchy', { textDocument: { uri }, position: { line, character } });
        const incoming = await engine.request('callHierarchy/incomingCalls', { item: items[0] });
        const outgoing = await engine.request('callHierarchy/outgoingCalls', { item: items[0] });
        if (process.env.HORNET_VERBOSE) console.log('RAW ITEMS', JSON.stringify({ item: items[0], outgoing }));
        if (process.env.HORNET_VERBOSE) {
            const mainFile = path.join(root, 'app', 'main.c');
            await engine.notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(mainFile).toString(), languageId: 'c', version: 1, text: fs.readFileSync(mainFile, 'utf8') } });
            console.log('MAIN SYMBOLS', await engine.request('textDocument/documentSymbol', { textDocument: { uri: pathToFileURL(mainFile).toString() } }));
        }
        console.log(JSON.stringify({ incoming: incoming.map(call => call.from.name), outgoing: outgoing.map(call => call.to.name), errors: diagnostics.filter(d => d.severity === 1).map(d => d.message) }, null, 2));
        if (process.env.HORNET_EXPECT_FIXED) {
            const assert = require('node:assert/strict');
            assert.deepEqual(incoming.map(call => call.from.name), ['MarsRover_ExecuteOne']);
            assert.deepEqual(outgoing.map(call => call.to.name).sort(), ['MarsRover_GetForwardDelta', 'MarsRover_IsInsideArea', 'MarsRover_WrapTarget', 'MarsSensor_HasObstacle'].sort());
            const { CallGraphModel } = require('../../out/hornet/src/hornet/views/callGraphModel');
            const graph = new CallGraphModel((method, params) => engine.request(method, params), () => {});
            graph.reset(items[0]);
            await graph.expandChains(); await graph.probeVisible();
            const snapshot = graph.snapshot();
            const names = new Map(snapshot.nodes.map(node => [node.id, node.name]));
            const edges = snapshot.edges.map(edge => `${names.get(edge.from)} -> ${names.get(edge.to)}`);
            console.log(JSON.stringify({ chains: edges, controls: snapshot.nodes.map(node => ({ name: node.name, left: node.incoming.action, right: node.outgoing.action })) }, null, 2));
            assert.ok(edges.includes('MarsRover_Execute -> MarsRover_ExecuteOne'));
            assert.ok(edges.includes('MarsRover_ExecuteOne -> MarsRover_Move'));
            assert.ok(edges.includes('main -> MarsRover_Execute'));
            assert.equal(snapshot.nodes.find(node => node.name === 'MarsRover_GetForwardDelta').incoming.action, 'none');
            if (process.env.HORNET_GRAPH_SNAPSHOT) fs.writeFileSync(process.env.HORNET_GRAPH_SNAPSHOT, JSON.stringify(snapshot));
        }
    } finally { await engine?.shutdown(); await processes.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
