import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const require = createRequire(import.meta.url);
const extensionRoot = fileURLToPath(new URL('../', import.meta.url));

require('ts-node').register({
    project: fileURLToPath(new URL('tsconfig.json', import.meta.url)),
    transpileOnly: true
});
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');
const { TimeoutError } = require('@vscode/test-electron/out/request');

function networkError(code) {
    return Object.assign(new Error('Controlled acquisition failure'), { code });
}

function createInstaller() {
    const download = sinon.stub().resolves('test-executable');
    const resolveCli = sinon.stub().returns(['test-cli', '--existing-argument', '--extensions-dir=default', '--user-data-dir=default']);
    const wait = sinon.stub().resolves();
    const mkdir = sinon.stub().resolves();
    const write = sinon.stub().resolves();
    const warn = sinon.stub();
    const installer = proxyquire(fileURLToPath(new URL('vscode.ts', import.meta.url)), {
        '@vscode/test-electron': { downloadAndUnzipVSCode: download, resolveCliArgsFromVSCodeExecutablePath: resolveCli },
        'timers/promises': { setTimeout: wait },
        '../src/Utility/Text/streams': { verbose: sinon.stub() },
        './common': { mkdir, write, warn, readJson: sinon.stub().resolves({}) },
        './vscodeTestPath': { getVSCodeTestIsolate: () => join(tmpdir(), 'cpptools-acquisition-unit') }
    });
    return { ...installer, download, resolveCli, wait, mkdir, write, warn };
}

for (const clangToolsFolder of ['bin', join('LLVM', 'bin')]) {
    test(`copies installed clang tools from ${clangToolsFolder} into bin`, async () => {
        const testRoot = mkdtempSync(join(tmpdir(), 'cpptools-binary-copy-'));
        const installedExtension = join(testRoot, 'vscode', 'extensions', 'ms-vscode.cpptools-1.2.3');
        const destination = join(testRoot, 'workspace');
        mkdirSync(join(installedExtension, 'bin'), { recursive: true });
        mkdirSync(join(installedExtension, 'debugAdapters'), { recursive: true });
        mkdirSync(join(installedExtension, clangToolsFolder), { recursive: true });
        writeFileSync(join(installedExtension, 'bin', 'cpptools'), 'cpptools');
        writeFileSync(join(installedExtension, 'debugAdapters', 'OpenDebugAD7'), 'debug adapter');
        writeFileSync(join(installedExtension, clangToolsFolder, 'clang-format'), 'clang-format');
        writeFileSync(join(installedExtension, clangToolsFolder, 'clang-tidy'), 'clang-tidy');
        mkdirSync(join(destination, 'LLVM', 'bin'), { recursive: true });
        writeFileSync(join(destination, 'LLVM', 'bin', 'stale-clang-format'), 'stale');

        const Git = sinon.stub().resolves({ code: 0, stdio: { all: () => [] } });
        const copy = proxyquire(fileURLToPath(new URL('copyExtensionBinaries.ts', import.meta.url)), {
            '../src/Utility/Text/streams': { verbose: sinon.stub() },
            'node:os': { homedir: () => join(testRoot, 'home') },
            './common': {
                $args: [],
                $root: destination,
                Git,
                green: value => value,
                heading: value => value,
                note: sinon.stub(),
                warn: sinon.stub()
            }
        });

        try {
            assert.equal(await copy.main(testRoot), '1.2.3');
            assert.equal(readFileSync(join(destination, 'bin', 'cpptools'), 'utf8'), 'cpptools');
            assert.equal(readFileSync(join(destination, 'bin', 'clang-format'), 'utf8'), 'clang-format');
            assert.equal(readFileSync(join(destination, 'bin', 'clang-tidy'), 'utf8'), 'clang-tidy');
            assert.equal(readFileSync(join(destination, 'debugAdapters', 'OpenDebugAD7'), 'utf8'), 'debug adapter');
            assert.equal(existsSync(join(destination, 'LLVM')), false);
        } finally {
            rmSync(testRoot, { recursive: true, force: true });
        }
    });
}

test('successful acquisition preserves the version, cache and CLI arguments without retries', async () => {
    const installer = createInstaller();
    const result = await installer.install();

    assert.equal(installer.download.callCount, 1);
    assert.equal(installer.download.firstCall.args[0], installer.options);
    assert.equal(installer.options.version, installer.testVSCodeVersion);
    assert.equal(installer.options.cachePath, `${installer.isolated}/cache`);
    assert.deepEqual(result, {
        cli: 'test-cli',
        args: ['--existing-argument', `--extensions-dir=${installer.extensionsDir}`, `--user-data-dir=${installer.userDir}`]
    });
    assert.equal(installer.wait.callCount, 0);
    assert.equal(installer.warn.callCount, 0);
    assert.equal(installer.write.callCount, 1);
});

for (const code of ['EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ETIMEDOUT']) {
    test(`retries ${code} once before a successful acquisition`, async () => {
        const installer = createInstaller();
        installer.download.onFirstCall().rejects(networkError(code));

        await installer.install();

        assert.equal(installer.download.callCount, 2);
        assert.ok(installer.download.getCalls().every(call => call.args[0] === installer.options));
        assert.deepEqual(installer.wait.args, [[1000]]);
        assert.equal(installer.warn.callCount, 1);
        assert.equal(installer.mkdir.callCount, 1);
        assert.equal(installer.write.callCount, 1);
    });
}

test('retries the test-electron request timeout', async () => {
    const installer = createInstaller();
    installer.download.onFirstCall().rejects(new TimeoutError(15000));

    await installer.install();

    assert.equal(installer.download.callCount, 2);
    assert.deepEqual(installer.wait.args, [[1000]]);
});

test('exhausts transient aggregate errors after three attempts with bounded backoff', async () => {
    const installer = createInstaller();
    installer.download.rejects(new AggregateError([networkError('ETIMEDOUT'), networkError('ENETUNREACH')]));

    await assert.rejects(installer.install(), /after 3 attempts: ETIMEDOUT:.*ENETUNREACH:/);

    assert.equal(installer.download.callCount, 3);
    assert.deepEqual(installer.wait.args, [[1000], [2000]]);
    assert.equal(installer.warn.callCount, 2);
    assert.equal(installer.resolveCli.callCount, 0);
    assert.equal(installer.write.callCount, 0);
});

for (const [name, failure] of [
    ['an invalid version', new Error('Invalid version')],
    ['a permissions error', networkError('EACCES')],
    ['a full disk', networkError('ENOSPC')],
    ['a certificate error', networkError('CERT_HAS_EXPIRED')],
    ['the library exhausting its archive retries', new Error('Failed to download and unzip VS Code 1.131.0')],
    ['an unclassified HTTP failure', 'Failed to get JSON'],
    ['an empty aggregate error', new AggregateError([])],
    ['an aggregate containing a permanent error', new AggregateError([networkError('ETIMEDOUT'), networkError('EACCES')])]
]) {
    test(`does not retry ${name}`, async () => {
        const installer = createInstaller();
        installer.download.callsFake(async () => { throw failure; });

        await assert.rejects(installer.install(), /Failed to install VS Code:.*after 1 attempt/);

        assert.equal(installer.download.callCount, 1);
        assert.equal(installer.wait.callCount, 0);
        assert.equal(installer.warn.callCount, 0);
        assert.equal(installer.resolveCli.callCount, 0);
        assert.equal(installer.write.callCount, 0);
    });
}

test('does not retry installation work after acquisition succeeds', async () => {
    const installer = createInstaller();
    installer.write.rejects(networkError('EPIPE'));

    await assert.rejects(installer.install(), /Failed to install VS Code/);

    assert.equal(installer.download.callCount, 1);
    assert.equal(installer.write.callCount, 1);
    assert.equal(installer.wait.callCount, 0);
});

for (const [name, code, attempts, delays] of [
    ['a non-retryable failure', 'EACCES', 1, []],
    ['exhausted transient failures', 'ETIMEDOUT', 3, [1000, 2000]]
]) {
    test(`acquisition CLI exits 1 without downstream work after ${name}`, () => {
        const testRoot = mkdtempSync(join(tmpdir(), 'cpptools-acquisition-'));
        const preload = `
            import { EventEmitter } from 'node:events';
            import { createRequire } from 'node:module';
            import process from 'node:process';
            const require = createRequire(${JSON.stringify(import.meta.url)});
            require('https').get = () => {
                process.stdout.write('ACQUISITION_ATTEMPT\\n');
                const request = new EventEmitter();
                request.destroy = () => request;
                process.nextTick(() => {
                    const failure = Object.assign(new Error('Controlled VS Code acquisition failure'), { code: '${code}' });
                    request.emit('error', '${code}' === 'ETIMEDOUT'
                        ? new AggregateError([failure, Object.assign(new Error('Controlled IPv6 failure'), { code: 'ENETUNREACH' })])
                        : failure);
                });
                return request;
            };
            require('timers/promises').setTimeout = async (milliseconds) => {
                process.stdout.write('ACQUISITION_DELAY:' + milliseconds + '\\n');
            };
            const electronPath = require.resolve('@vscode/test-electron');
            const electron = require(electronPath);
            require.cache[electronPath].exports = {
                ...electron,
                async runVSCodeCommand() {
                    throw new Error('Unexpected extension installation');
                }
            };
            const copyPath = require.resolve('./copyExtensionBinaries.ts');
            require.cache[copyPath] = {
                id: copyPath,
                filename: copyPath,
                loaded: true,
                exports: {
                    async main() {
                        throw new Error('Unexpected binary copying');
                    }
                }
            };
        `;

        try {
            const result = spawnSync(process.execPath, [
                '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
                require.resolve('ts-node/dist/bin.js'), '-T', '.scripts/installAndCopyBinaries.ts'
            ], {
                cwd: extensionRoot,
                env: { ...process.env, CPPTOOLS_VSCODE_TEST_ROOT: testRoot },
                encoding: 'utf8',
                timeout: 15000
            });

            assert.ifError(result.error);
            assert.equal(result.signal, null);
            const output = result.stdout + result.stderr;
            assert.match(output, /Controlled VS Code acquisition failure/);
            assert.match(output, new RegExp(`acquisition failed after ${attempts} attempt`));
            assert.equal(output.match(/^ACQUISITION_ATTEMPT$/gm)?.length, attempts);
            assert.deepEqual([...output.matchAll(/^ACQUISITION_DELAY:(\d+)$/gm)].map(match => Number(match[1])), delays);
            assert.doesNotMatch(output, /Install latest C\/C\+\+ Extension|Unexpected extension installation|Unexpected binary copying/);
            assert.equal(result.status, 1, output);
        } finally {
            rmSync(testRoot, { recursive: true, force: true });
        }
    });
}
