import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { BackendNotFoundError, BinaryManager, clangdCandidates, clangdInstallRoots } from '../../src/hornet/core/binaryManager';
import { availableModes, resolveMode, serviceStatus } from '../../src/hornet/core/serviceStatus';
import { ParseMode } from '../../src/hornet/engines/languageEngine';
import { backgroundIndexStatus } from '../../src/hornet/core/indexProgress';

test('Windows discovery handles quoted PATH entries and LLVM outside PATH', () => {
    const candidates = clangdCandidates('clangd', 'win32', {
        Path: '"D:\\Tools With Spaces\\bin";;.;relative', ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\tester'
    });
    assert.equal(candidates[0], 'D:\\Tools With Spaces\\bin\\clangd.exe');
    assert.ok(candidates.includes('C:\\Program Files\\LLVM\\bin\\clangd.exe'));
    assert.ok(candidates.includes('C:\\Users\\tester\\scoop\\apps\\llvm\\current\\bin\\clangd.exe'));
    assert.ok(candidates.every(candidate => path.win32.isAbsolute(candidate)));
});

test('macOS and Linux discovery searches only paths on the workspace host', () => {
    const mac = clangdCandidates('clangd', 'darwin', { PATH: '/custom/bin', ProgramFiles: 'C:\\LLVM' });
    assert.equal(mac[0], '/custom/bin/clangd');
    assert.ok(mac.includes('/opt/homebrew/opt/llvm/bin/clangd'));
    assert.ok(mac.includes('/usr/local/opt/llvm/bin/clangd'));
    assert.ok(!mac.some(candidate => candidate.includes('C:')));
    assert.deepEqual(clangdCandidates('clangd', 'linux', {}), ['/usr/bin/clangd', '/usr/local/bin/clangd']);
});

test('explicit executable paths and names are not silently replaced by another installation', () => {
    assert.deepEqual(clangdCandidates('D:\\Custom\\clangd.exe', 'win32', { ProgramFiles: 'C:\\Program Files' }), ['D:\\Custom\\clangd.exe']);
    assert.deepEqual(clangdCandidates('clangd-custom', 'linux', { PATH: '/custom/bin' }), ['/custom/bin/clangd-custom']);
    assert.throws(() => clangdCandidates('./clangd', 'linux', {}), /absolute/);
});

test('resolver reports missing files and directories as actionable setup errors', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-startup-'));
    try {
        await assert.rejects(new BinaryManager().resolve(path.join(directory, 'missing-clangd')), BackendNotFoundError);
        await assert.rejects(new BinaryManager().resolve(directory), BackendNotFoundError);
        assert.equal(await new BinaryManager().resolve(process.execPath), await fs.realpath(process.execPath));
    } finally { await fs.rmdir(directory); }
});

test('only implemented modes are switchable and unsupported saved modes have an explicit session fallback', () => {
    assert.deepEqual(availableModes, [ParseMode.Compiler, ParseMode.Hybrid]);
    for (const mode of [ParseMode.Tag, ParseMode.Flyweight]) {
        assert.equal(resolveMode(mode).mode, ParseMode.Compiler);
        assert.match(resolveMode(mode).notice!, /for this session/);
    }
    assert.deepEqual(resolveMode('hybrid'), { mode: ParseMode.Hybrid });
});

test('index progress uses clangd counts and displays stages when no percentage is known', () => {
    const progress = backgroundIndexStatus({ message: '7/20' });
    assert.equal(progress.percentage, 35);
    assert.equal(progress.completed, 7);
    assert.equal(progress.total, 20);
    assert.match(serviceStatus('ready', ParseMode.Compiler, progress).text, /35% 7\/20/);
    const unknown = backgroundIndexStatus({ message: 'Loading cached index' });
    assert.equal(unknown.percentage, undefined, 'never invent a percentage');
    assert.match(serviceStatus('starting', ParseMode.Hybrid, { state: 'building', phase: 'discovering', message: 'Scanning' }).text, /Discovering sources/);
    assert.match(serviceStatus('ready', ParseMode.Hybrid, { state: 'building', phase: 'finalizing', message: 'Waiting', elapsedSeconds: 4 }).text, /Finalizing index.*4s/);
    assert.equal(backgroundIndexStatus({ percentage: 56 }).percentage, 56);
    assert.equal(backgroundIndexStatus({ message: '0/0' }).percentage, undefined);
});

test('failure status never says Starting and clicking it offers the correct recovery command', () => {
    assert.doesNotMatch(serviceStatus('needsSetup').text, /Starting/);
    assert.equal(serviceStatus('needsSetup').command, 'hornet-cpp.autoSetupClangd');
    assert.doesNotMatch(serviceStatus('stopped').text, /Starting/);
    assert.equal(serviceStatus('stopped').command, 'hornet-cpp.restartLanguageServices');
    assert.match(serviceStatus('starting').text, /Starting/);
    assert.match(serviceStatus('ready', ParseMode.Compiler).text, /Compiler/);
    assert.match(serviceStatus('ready', ParseMode.Compiler, { state: 'building', message: '1/2', percentage: 50 }).text, /Indexing 50%/);
    assert.equal(serviceStatus('ready', ParseMode.Compiler, { state: 'ready', message: 'Done' }).command, 'hornet-cpp.buildProjectIndex');
    assert.equal(serviceStatus('ready', ParseMode.Compiler, { state: 'failed', message: 'Failed' }).command, 'hornet-cpp.buildProjectIndex');
});

test('editor installation discovery uses workspace-host storage including remote servers', () => {
    const windows = clangdInstallRoots('win32', { APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' }, 'D:\\CodeData\\User\\globalStorage\\hornet.hornet-cpp');
    assert.ok(windows.includes('D:\\CodeData\\User\\globalStorage\\llvm-vs-code-extensions.vscode-clangd\\install'));
    assert.ok(windows.includes('C:\\Users\\tester\\AppData\\Roaming\\Code\\User\\globalStorage\\llvm-vs-code-extensions.vscode-clangd\\install'));
    const remote = clangdInstallRoots('linux', { HOME: '/home/tester' }, '/data/code/User/globalStorage/hornet.hornet-cpp');
    assert.ok(remote.includes('/home/tester/.vscode-server/data/User/globalStorage/llvm-vs-code-extensions.vscode-clangd/install'));
    assert.ok(remote.includes('/data/code/User/globalStorage/llvm-vs-code-extensions.vscode-clangd/install'));
});

test('Windows discovers a downloaded clangd without PATH or a configured executable', { skip: process.platform !== 'win32' }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-discover-'));
    try {
        const storage = path.join(root, 'globalStorage', 'hornet.hornet-cpp');
        const binary = path.join(root, 'globalStorage', 'llvm-vs-code-extensions.vscode-clangd', 'install', '22.1.0', 'clangd_22.1.0', 'bin', 'clangd.exe');
        await fs.mkdir(path.dirname(binary), { recursive: true });
        await fs.writeFile(binary, 'test executable');
        const manager = new BinaryManager({ env: {}, storagePath: storage });
        assert.equal(await manager.ensure('clangd', async () => { throw new Error('Should reuse the installed binary'); }), await fs.realpath(binary));
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('missing default clangd installs automatically and failed downloads can be retried', async () => {
    const manager = new BinaryManager();
    manager.resolve = async configured => { throw new BackendNotFoundError(configured); };
    await assert.rejects(manager.ensure('clangd', async () => { throw new Error('network unavailable'); }), /network unavailable/);
    assert.equal(await manager.ensure('clangd', async () => '/managed/bin/clangd'), '/managed/bin/clangd');
    let attempted = false;
    await assert.rejects(manager.ensure('/explicit/missing/clangd', async () => { attempted = true; return ''; }), BackendNotFoundError);
    assert.equal(attempted, false, 'explicit custom paths are not silently replaced');
});
