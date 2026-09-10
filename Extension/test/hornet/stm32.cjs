// Read-only reproduction against a local STM32 workspace; generated data stays in artifacts.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { ProcessManager } = require('../../out/hornet/src/hornet/core/processManager');
const { discoverCompilationDatabase } = require('../../out/hornet/src/hornet/compdb/databaseDiscovery');
const { parseCompilationDatabase } = require('../../out/hornet/src/hornet/compdb/compileCommandsParser');
const loader = require('node:module'), original = loader._load;
const mock = new Proxy({ workspace: { isTrusted: true, getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    window: { showErrorMessage() {} } }, { get: (value, key) => value[key] ?? class {} });
loader._load = (id, ...args) => id === 'vscode' ? mock : original(id, ...args);
const { CompilerEngine } = require('../../out/hornet/src/hornet/engines/compilerEngine');
loader._load = original;
(async () => {
    const project = process.env.HORNET_STM32_PROJECT;
    assert.ok(project, 'Set HORNET_STM32_PROJECT');
    const artifact = path.resolve('artifacts/stm32'), database = path.join(artifact, 'db');
    await fs.mkdir(database, { recursive: true });
    const source = await discoverCompilationDatabase(project, { preset: 'Debug' });
    assert.ok(source?.replaceAll('\\', '/').endsWith('/build/Debug/compile_commands.json'), source);
    const commands = parseCompilationDatabase(await fs.readFile(source, 'utf8'), source);
    await fs.writeFile(path.join(database, 'compile_commands.json'), JSON.stringify(commands));
    const processes = new ProcessManager(), diagnostics = new Map(), logs = [];
    const engine = new CompilerEngine(processes, {
        root: { name: 'stm32', uri: { fsPath: project, toString: () => pathToFileURL(project).toString() } }, databaseDirectory: database,
        log: line => logs.push(line), diagnostics: value => diagnostics.set(value.uri, value.diagnostics), changed() {}, refresh() {}, canApplyEdit: () => false
    });
    try {
        await engine.initialize();
        await engine.buildIndex();
        const file = path.join(project, 'core/src/main.c'), uri = pathToFileURL(file).toString(), text = await fs.readFile(file, 'utf8');
        await engine.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'c', version: 1, text } });
        const line = text.split('\n').findIndex(line => /^void SystemClockConfig\(/.test(line));
        const items = await engine.request('textDocument/prepareCallHierarchy', { textDocument: { uri }, position: { line, character: 7 } });
        const incoming = items?.length ? await engine.request('callHierarchy/incomingCalls', { item: items[0] }) : [];
        const outgoing = items?.length ? await engine.request('callHierarchy/outgoingCalls', { item: items[0] }) : [];
        const errors = [...diagnostics.values()].flat().filter(value => value.severity === 1).map(value => value.message);
        const result = { source, files: commands.length, symbols: items?.map(value => value.name),
            incoming: incoming.map(value => value.from.name), outgoing: outgoing.map(value => value.to.name), errors };
        await fs.writeFile(path.join(artifact, 'result.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
        assert.ok(items?.length, 'selected function must parse');
        assert.ok(incoming.some(value => value.from.name === 'main'));
        assert.ok(outgoing.some(value => value.to.name === 'HAL_RccOscConfig'));
        assert.ok(outgoing.some(value => value.to.name === 'HAL_RccClockConfig'));
        assert.ok(!errors.some(value => /stm32f1xx.h.*not found/.test(value)));
    } finally {
        await engine.shutdown(); await processes.dispose();
        await fs.writeFile(path.join(artifact, 'clangd.log'), logs.join('\n'));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
