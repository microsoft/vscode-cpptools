import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverCompilationDatabase } from '../../src/hornet/compdb/databaseDiscovery';

async function database(root: string, folder: string, define: string) {
    const directory = path.join(root, folder);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'compile_commands.json');
    await fs.writeFile(file, JSON.stringify([{ directory: root, file: path.join(root, 'main.c'), arguments: ['arm-none-eabi-gcc', `-D${define}`, '-mcpu=cortex-m3', '-Idevice/include', '-c', 'main.c'] }]));
    return file;
}

test('CMake configuration discovery selects one variant and supports nested build directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-discovery-'));
    try {
        const debug = await database(root, 'build/Debug', 'DEBUG'), release = await database(root, 'build/Release', 'NDEBUG');
        assert.equal(await discoverCompilationDatabase(root), debug);
        await fs.writeFile(path.join(root, 'CMakePresets.json'), JSON.stringify({ configurePresets: [
            { name: 'Debug', binaryDir: '${sourceDir}/build/Debug' }, { name: 'Release', binaryDir: '${sourceDir}/build/Release' }
        ] }));
        assert.equal(await discoverCompilationDatabase(root, { preset: 'Release' }), release);
        assert.equal(await discoverCompilationDatabase(root, { preset: 'Debug' }), debug);
        assert.equal(await discoverCompilationDatabase(root, { buildDirectory: '${workspaceFolder}/build/Release' }), release);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('preset include/inheritance expands paths without executing build commands or crawling source trees', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-presets-'));
    try {
        const selected = await database(root, 'custom/board-debug', 'BOARD');
        await fs.writeFile(path.join(root, 'base.json'), JSON.stringify({ configurePresets: [{ name: 'base', hidden: true, binaryDir: '${sourceDir}/custom/${presetName}' }] }));
        await fs.writeFile(path.join(root, 'CMakePresets.json'), JSON.stringify({ include: ['base.json'], configurePresets: [{ name: 'board-debug', inherits: 'base' }] }));
        assert.equal(await discoverCompilationDatabase(root, { preset: 'board-debug' }), selected);
        await fs.unlink(path.join(root, 'CMakePresets.json'));
        await database(root, 'drivers/vendor/deep', 'UNRELATED');
        assert.equal(await discoverCompilationDatabase(root), undefined, 'source/vendor directories are not build roots');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('discovered parameters are automatically written under .vscode, refreshed on configuration changes and preserve explicit imports', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-managed-db-'));
    const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }, original = loader._load;
    let manager: import('../../src/hornet/compdb/compileCommandsManager').CompileCommandsManager | undefined;
    let selected = 'Debug';
    const subscription = () => ({ dispose() {} });
    const mock = {
        EventEmitter: class { event = subscription; fire() {} dispose() {} }, RelativePattern: class {},
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        workspace: { getConfiguration: () => ({ get: (key: string) => key === 'defaultConfigurePreset' ? selected : undefined }),
            createFileSystemWatcher: () => ({ onDidChange: subscription, onDidCreate: subscription, onDidDelete: subscription, dispose() {} }) }
    };
    loader._load = (id, ...args) => id === 'vscode' ? mock : original(id, ...args);
    try {
        const { CompileCommandsManager } = require('../../src/hornet/compdb/compileCommandsManager');
        const debug = await database(root, 'build/Debug', 'STM32F103xE'), release = await database(root, 'build/Release', 'RELEASE');
        await fs.writeFile(path.join(root, 'CMakePresets.json'), JSON.stringify({ configurePresets: [
            { name: 'Debug', binaryDir: '${sourceDir}/build/Debug' }, { name: 'Release', binaryDir: '${sourceDir}/build/Release' }
        ] }));
        const output = path.join(root, '.vscode/hornet/compile-db');
        await fs.mkdir(output, { recursive: true });
        await fs.writeFile(path.join(output, 'sources.json'), JSON.stringify({ sources: [] }));
        manager = new CompileCommandsManager({ uri: { fsPath: root } }, () => {});
        await manager!.initialize();
        assert.equal(manager!.directory, output);
        const read = async () => JSON.parse(await fs.readFile(path.join(output, 'compile_commands.json'), 'utf8'));
        assert.deepEqual(await read(), JSON.parse(await fs.readFile(debug, 'utf8')), 'includes, macros and ARM flags remain intact');
        selected = 'Release'; await manager!.reload(false);
        assert.deepEqual(await read(), JSON.parse(await fs.readFile(release, 'utf8')), 'old automatic variant is replaced, never merged');
        const manual = await database(root, 'manual', 'MANUAL');
        await manager!.import([manual]);
        selected = 'Debug'; await manager!.reload(false);
        assert.deepEqual(await read(), JSON.parse(await fs.readFile(manual, 'utf8')), 'explicit imported commands retain precedence');
        assert.equal(JSON.parse(await fs.readFile(path.join(output, 'sources.json'), 'utf8')).version, 2);
    } finally { manager?.dispose(); loader._load = original; await fs.rm(root, { recursive: true, force: true }); }
});
