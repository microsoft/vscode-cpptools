import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCompilationDatabase, mergeCompilationDatabases, canonical } from '../../src/hornet/compdb/compileCommandsParser';
import { threadCount } from '../../src/hornet/core/cpuScheduler';
import { ModeManager } from '../../src/hornet/core/modeManager';
import { CapabilityRouter } from '../../src/hornet/core/capabilityRouter';
import { LanguageEngine, ParseMode } from '../../src/hornet/engines/languageEngine';
import { HybridEngine, deduplicate } from '../../src/hornet/engines/hybridEngine';

class FakeEngine implements LanguageEngine {
    events: string[] = [];
    fail = false;
    result: unknown = [{ name: 'result' }];
    pending?: Promise<unknown>;
    constructor(readonly mode: ParseMode) {}
    async initialize() { this.events.push('start'); if (this.fail) { throw new Error('start failed'); } }
    async shutdown() { this.events.push('stop'); }
    async restart() { await this.shutdown(); await this.initialize(); }
    getCapabilities() { return { definitionProvider: true, renameProvider: true, workspaceSymbolProvider: true }; }
    async request<T>(method: string): Promise<T | null> { this.events.push(method); return (this.pending ? await this.pending : this.result) as T; }
    async notify(method: string) { this.events.push(method); }
}

test('database resolves relative paths, preserves argument boundaries and gives last source precedence', () => {
    const source = path.resolve('fixture', 'compile_commands.json');
    const commands = parseCompilationDatabase('\uFEFF' + JSON.stringify([
        { directory: './build', file: '../src/a.cpp', arguments: ['clang++', '-DNAME=a b', '../src/a.cpp'] },
        { directory: './build', file: '../src/../src/a.cpp', command: 'clang++ -DSECOND ../src/a.cpp' }
    ]), source);
    assert.equal(commands[0].file, path.resolve('fixture/src/a.cpp'));
    assert.equal(commands[0].arguments?.[1], '-DNAME=a b');
    const merged = mergeCompilationDatabases([{ path: 'first', commands: [commands[0]] }, { path: 'second', commands: [commands[1]] }]);
    assert.equal(merged.commands.length, 1);
    assert.equal(merged.commands[0].command, 'clang++ -DSECOND ../src/a.cpp');
    assert.equal(merged.provenance[canonical(commands[0].file)], 'second');
});

test('database rejects malformed entries rather than silently claiming coverage', () => {
    for (const value of [{}, [null], [{ file: 'x.c', directory: '.' }], [{ file: 'x.c', directory: '.', arguments: [] }], [{ file: 'x.c', directory: '.', arguments: [1] }], [{ file: '', directory: '.', command: 'cc' }]]) {
        assert.throws(() => parseCompilationDatabase(JSON.stringify(value), path.resolve('compile_commands.json')));
    }
    assert.throws(() => parseCompilationDatabase('[', 'compile_commands.json'));
});

test('canonicalization coalesces a symlink and its target when platform permissions allow', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hornet-path-'));
    try {
        fs.writeFileSync(path.join(directory, 'target.cpp'), 'void f() {}');
        try { fs.symlinkSync(path.join(directory, 'target.cpp'), path.join(directory, 'alias.cpp')); }
        catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Symlink creation is unavailable'); return; } throw error; }
        assert.equal(canonical(path.join(directory, 'target.cpp')), canonical(path.join(directory, 'alias.cpp')));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('CPU budgets respect the documented ratios and never allocate zero workers', () => {
    assert.deepEqual(['Maximum', 'High', 'Medium', 'Low'].map(value => threadCount(value, 8)), [8, 6, 4, 2]);
    assert.equal(threadCount('Low', 1), 1);
    assert.equal(threadCount('unknown', 0), 1);
});

test('mode transitions serialize and dispose every previous engine', async () => {
    const engines: FakeEngine[] = [];
    const modes = new ModeManager(mode => { const engine = new FakeEngine(mode); engines.push(engine); return engine; });
    await Promise.all([modes.switchMode(ParseMode.Compiler), modes.switchMode(ParseMode.Hybrid)]);
    assert.deepEqual(engines[0].events, ['start', 'stop']);
    assert.equal(modes.getActiveEngine(), engines[1]);
    await modes.shutdown();
    assert.deepEqual(engines[1].events, ['start', 'stop']);
    await assert.rejects(modes.switchMode(ParseMode.Compiler), /closed/);
});

test('failed mode startup rolls back to the last usable engine', async () => {
    const compiler = new FakeEngine(ParseMode.Compiler);
    const tag = new FakeEngine(ParseMode.Tag); tag.fail = true;
    const modes = new ModeManager(mode => mode === ParseMode.Compiler ? compiler : tag);
    await modes.switchMode(ParseMode.Compiler);
    await assert.rejects(modes.switchMode(ParseMode.Tag), /start failed/);
    assert.equal(modes.getActiveEngine(), compiler);
    assert.deepEqual(compiler.events, ['start', 'stop', 'start']);
    assert.deepEqual(tag.events, ['start', 'stop']);
    await modes.shutdown();
});

test('router ignores unsupported, foreign-workspace and stale responses', async () => {
    const engines: FakeEngine[] = [];
    const modes = new ModeManager(mode => { const engine = new FakeEngine(mode); engines.push(engine); return engine; });
    const router = new CapabilityRouter(modes, uri => uri.startsWith('file:///root/'));
    await modes.switchMode(ParseMode.Compiler);
    assert.equal(await router.request('textDocument/hover', {}), null);
    assert.equal(await router.request('textDocument/definition', { textDocument: { uri: 'file:///elsewhere/a.c' } }), null);
    let finish!: (value: unknown) => void;
    engines[0].pending = new Promise(resolve => { finish = resolve; });
    const response = router.request('textDocument/definition', {});
    await modes.switchMode(ParseMode.Hybrid);
    finish([{ uri: 'file:///root/a.c' }]);
    assert.equal(await response, null);
    await modes.shutdown();
});

test('Hybrid chooses coverage-dependent backends and never falls back for rename', async () => {
    const compiler = new FakeEngine(ParseMode.Compiler);
    const tag = new FakeEngine(ParseMode.Tag);
    const hybrid = new HybridEngine(compiler, uri => uri === 'covered', tag);
    await hybrid.request('textDocument/definition', { textDocument: { uri: 'uncovered' } });
    assert.deepEqual(tag.events, ['textDocument/definition']);
    assert.deepEqual(compiler.events, []);
    assert.equal(await hybrid.request('textDocument/rename', { textDocument: { uri: 'uncovered' } }), null);
    compiler.result = [];
    await hybrid.request('textDocument/definition', { textDocument: { uri: 'covered' } });
    assert.equal(tag.events.length, 2);
    compiler.result = null;
    await hybrid.request('textDocument/rename', { textDocument: { uri: 'covered' } });
    assert.equal(tag.events.length, 2);
});

test('Hybrid merges symbols by location without duplicating identical results', async () => {
    const compiler = new FakeEngine(ParseMode.Compiler);
    const tag = new FakeEngine(ParseMode.Tag);
    const symbol = { name: 'f', location: { uri: 'file:///a.c', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } } };
    compiler.result = [symbol]; tag.result = [symbol, { ...symbol, name: 'g' }];
    assert.equal((await new HybridEngine(compiler, () => true, tag).request<unknown[]>('workspace/symbol', {}))?.length, 2);
    assert.equal(deduplicate([symbol, symbol]).length, 1);
    const file = pathToFileURL(path.resolve('fixture/a.cpp')).toString();
    const first = { ...symbol, location: { ...symbol.location, uri: file } };
    const second = { ...first, location: { ...first.location, uri: file.replace('/a.cpp', '/nested/../a.cpp'), range: { start: { line: 0, character: 0 }, end: { line: 99, character: 1 } } } };
    assert.equal(deduplicate([first, second]).length, 1);
});
