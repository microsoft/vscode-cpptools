import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProcessManager } from '../../src/hornet/core/processManager';
import type { CompilerEngine as CompilerEngineType } from '../../src/hornet/engines/compilerEngine';
import type { IndexStatus } from '../../src/hornet/engines/languageEngine';

test('real clangd: unopened project builds persistent index, reuses cache and discovers new files on rebuild', {
    skip: !process.env.HORNET_TEST_CLANGD && !process.env.HORNET_TEST_AUTO_CLANGD, timeout: 60000
}, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-index-'));
    const processes = new ProcessManager();
    let engine: CompilerEngineType | undefined;
    const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown };
    const original = loader._load;
    const mock = new Proxy({
        workspace: { isTrusted: true, getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'clangd.path' ? process.env.HORNET_TEST_CLANGD || 'clangd' : key === 'clangd.arguments' ? ['--log=verbose'] : fallback }) },
        window: { showErrorMessage: () => {} }
    } as Record<string, unknown>, { get: (target, key: string) => target[key] ?? class {} });
    loader._load = (id, ...args) => id === 'vscode' ? mock : original(id, ...args);
    try {
        const { CompilerEngine } = require('../../src/hornet/engines/compilerEngine') as { CompilerEngine: typeof CompilerEngineType };
        const database = path.join(root, '.vscode', 'hornet', 'compile-db');
        await fs.mkdir(database, { recursive: true });
        await fs.writeFile(path.join(database, 'compile_commands.json'), '[]');
        await fs.writeFile(path.join(root, 'a.cpp'), 'int seed() { return 1; }\n');
        await fs.writeFile(path.join(root, 'b.cpp'), 'int unopenedFunction() { return 2; }\n');
        const logs: string[] = [];
        const statuses: IndexStatus[] = [];
        engine = new CompilerEngine(processes, {
            root: { name: 'index', index: 0, uri: { fsPath: root, toString: () => pathToFileURL(root).toString() } as never },
            databaseDirectory: database, log: line => logs.push(line), diagnostics: () => {}, changed: () => {},
            refresh: () => {}, canApplyEdit: () => false, indexChanged: status => statuses.push(status)
        });
        await engine.initialize();
        const build = engine.buildIndex();
        assert.equal(engine.buildIndex(), build, 'concurrent requests share the build');
        await build;
        assert.equal(statuses.at(-1)?.state, 'ready', logs.join('\n'));
        for (const phase of ['discovering', 'starting', 'parsing', 'finalizing']) {
            assert.ok(statuses.some(status => status.phase === phase), `Index progress must expose the ${phase} stage`);
        }
        assert.ok(statuses.some(status => status.state === 'building' && (status.elapsedSeconds ?? 0) >= 1), 'quiet/cache waits still show elapsed progress');
        const symbols = await engine.request<{ name: string }[]>('workspace/symbol', { query: 'unopenedFunction' });
        assert.ok(symbols?.some(symbol => symbol.name.startsWith('unopenedFunction')), `${JSON.stringify(symbols)}\n${logs.join('\n')}`);
        const files = await fs.readdir(root, { recursive: true });
        const shards = files.filter(file => file.endsWith('.idx'));
        assert.ok(shards.some(file => file.includes('b.cpp')), `Unopened file must have an on-disk index: ${files.join(', ')}\n${logs.join('\n')}`);
        const shard = path.join(root, shards.find(file => file.includes('b.cpp'))!);
        const timestamp = (await fs.stat(shard)).mtimeMs;
        await engine.restart();
        await engine.buildIndex();
        assert.equal((await fs.stat(shard)).mtimeMs, timestamp, 'unchanged cached index is reused');
        await fs.writeFile(path.join(root, 'new.cpp'), 'int newlyAddedFunction() { return 3; }\n');
        await engine.restart();
        await engine.buildIndex();
        const added = await engine.request<{ name: string }[]>('workspace/symbol', { query: 'newlyAddedFunction' });
        assert.ok(added?.some(symbol => symbol.name.startsWith('newlyAddedFunction')), logs.join('\n'));
        // The same startup path must work with a real compilation database and its flags.
        const realFile = path.join(root, 'real.cpp');
        await fs.writeFile(realFile, '#ifdef REAL_FLAGS\nint configuredFunction() { return 4; }\n#endif\n');
        await fs.writeFile(path.join(database, 'compile_commands.json'), JSON.stringify([{ directory: root, file: realFile, arguments: ['clang++', '-DREAL_FLAGS', '-c', realFile] }]));
        await engine.restart();
        await engine.buildIndex();
        const configured = await engine.request<{ name: string }[]>('workspace/symbol', { query: 'configuredFunction' });
        assert.ok(configured?.some(symbol => symbol.name.startsWith('configuredFunction')), logs.join('\n'));
    } finally {
        await engine?.shutdown();
        await processes.dispose();
        loader._load = original;
        await fs.rm(root, { recursive: true, force: true });
    }
});
