import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { findPackageLockPaths } from './packageLockFiles.mjs';
import { applyPackedTarballs, formatError, getPackageNameFromResolvedUrl, loadPackageLocks, updatePackageIntegrity, writePackageLocks } from './updatePackageLockIntegrity.mjs';

const registry = 'https://pkgs.dev.azure.com/azure-public/VisualCpp/_packaging/cpp_PublicPackages/npm/registry/';

function createTemporaryDirectory(t) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cpptools-package-integrity-test-'));
    t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
    return temporaryDirectory;
}

function getPackedTarball(packageId, filename, content) {
    return {
        id: packageId,
        filename,
        shasum: createHash('sha1').update(content).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(content).digest('base64')}`
    };
}

test('extracts scoped and unscoped package names from approved URLs', () => {
    assert.equal(getPackageNameFromResolvedUrl(`${registry}minimist/-/minimist-1.2.8.tgz`), 'minimist');
    assert.equal(getPackageNameFromResolvedUrl(`${registry}@actions/core/-/core-2.0.3.tgz`), '@actions/core');
    assert.equal(getPackageNameFromResolvedUrl('HTTPS://PKGS.DEV.AZURE.COM/azure-public/VisualCpp/_packaging/cpp_PublicPackages/npm/registry/yarn/-/yarn-1.22.22.tgz'), 'yarn');
    assert.equal(getPackageNameFromResolvedUrl(`${registry}@actions/core/-/core-2.0.3.tgz`, false), '@actions/core');
});

test('rejects package URLs outside the approved registry', () => {
    assert.throws(
        () => getPackageNameFromResolvedUrl('https://registry.npmjs.org/minimist/-/minimist-1.2.8.tgz'),
        /not hosted by the approved registry/
    );
});

test('replaces matching SHA-1 integrity with SHA-512', () => {
    const packageEntry = {
        resolved: `${registry}fixture/-/fixture-1.0.0.tgz`,
        integrity: 'sha1-Uc/zwfC8WfYYfnBAzBKk6bHsp6o='
    };

    assert.equal(
        updatePackageIntegrity(packageEntry, Buffer.from('fixture')),
        'sha512-lOlQ7aSocOZWXUThS5DxbAo4HNaTBFKcgfa9QIrxPFFVFrhBfgBfwxCT+qSxPekkNkVt0lKJqyhnw6V2+pSESQ=='
    );
});

test('rejects tarball bytes that do not match locked SHA-1', () => {
    const packageEntry = {
        resolved: `${registry}fixture/-/fixture-1.0.0.tgz`,
        integrity: 'sha1-Lve95gjOVATpfV8EL5X4nxwjKHE='
    };

    assert.throws(() => updatePackageIntegrity(packageEntry, Buffer.from('tampered')), /does not match the locked integrity/);
});

test('discovers package locks while excluding dependency directories', t => {
    const repositoryRoot = createTemporaryDirectory(t);
    const expectedPaths = [
        path.join(repositoryRoot, '.github', 'actions', 'package-lock.json'),
        path.join(repositoryRoot, 'nested', 'package-lock.json')
    ];
    for (const packageLockPath of [...expectedPaths, path.join(repositoryRoot, 'node_modules', 'dependency', 'package-lock.json')]) {
        fs.mkdirSync(path.dirname(packageLockPath), { recursive: true });
        fs.writeFileSync(packageLockPath, '{}\n');
    }

    assert.deepEqual(findPackageLockPaths(repositoryRoot), expectedPaths);
});

test('rejects one tarball URL mapped to multiple package identities', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    const resolved = `${registry}fixture/-/fixture-1.0.0.tgz`;
    fs.writeFileSync(packageLockPath, `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
            'node_modules/fixture-one': { version: '1.0.0', resolved, integrity: 'sha1-Uc/zwfC8WfYYfnBAzBKk6bHsp6o=' },
            'node_modules/fixture-two': { version: '2.0.0', resolved, integrity: 'sha1-Uc/zwfC8WfYYfnBAzBKk6bHsp6o=' }
        }
    }, null, 2)}\n`);

    assert.throws(() => loadPackageLocks([packageLockPath]), /maps to both fixture@1\.0\.0 and fixture@2\.0\.0/);
});

test('rejects one package identity mapped to compliant and legacy URLs', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    fs.writeFileSync(packageLockPath, `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
            'node_modules/fixture-compliant': {
                version: '1.0.0',
                resolved: 'https://registry.example/fixture/-/fixture-1.0.0.tgz',
                integrity: `sha512-${Buffer.alloc(64).toString('base64')}`
            },
            'node_modules/fixture-legacy': {
                version: '1.0.0',
                resolved: `${registry}fixture/-/fixture-1.0.0.tgz`,
                integrity: 'sha1-Uc/zwfC8WfYYfnBAzBKk6bHsp6o='
            }
        }
    }, null, 2)}\n`);

    assert.throws(() => loadPackageLocks([packageLockPath]), /fixture@1\.0\.0 resolves to more than one tarball URL/);
});

test('rejects uppercase network URLs without integrity', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    fs.writeFileSync(packageLockPath, `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
            'node_modules/fixture': { version: '1.0.0', resolved: 'HTTPS://registry.example/fixture/-/fixture-1.0.0.tgz' }
        }
    }, null, 2)}\n`);

    assert.throws(() => loadPackageLocks([packageLockPath]), /does not have locked integrity or an explicit local resolution/);
});

test('rejects non-root package entries without resolution or integrity', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    fs.writeFileSync(packageLockPath, `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
            '': { name: 'fixture' },
            'node_modules/fixture': { version: '1.0.0' }
        }
    }, null, 2)}\n`);

    assert.throws(() => loadPackageLocks([packageLockPath]), /does not have locked integrity or an explicit local resolution/);
});

test('accepts workspace targets and bundled package entries without separate integrity', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    fs.writeFileSync(packageLockPath, `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
            '': { name: 'fixture' },
            'node_modules/local': { resolved: 'packages/local', link: true },
            'packages/local': { name: 'local', version: '1.0.0' },
            'node_modules/bundler': {
                version: '1.0.0',
                resolved: 'https://registry.example/bundler/-/bundler-1.0.0.tgz',
                integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
                bundleDependencies: ['bundled']
            },
            'node_modules/bundler/node_modules/bundled': { version: '1.0.0', inBundle: true }
        }
    }, null, 2)}\n`);

    const { tarballs } = loadPackageLocks([packageLockPath]);
    assert.deepEqual(tarballs, []);
});

test('rejects fake bundled and malformed link entries without integrity', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const fakeBundleLockPath = path.join(temporaryDirectory, 'fake-bundle-lock.json');
    const malformedLinkLockPath = path.join(temporaryDirectory, 'malformed-link-lock.json');
    fs.writeFileSync(fakeBundleLockPath, `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
            '': { name: 'fixture' },
            'node_modules/fake-bundled': { version: '1.0.0', inBundle: true }
        }
    }, null, 2)}\n`);
    fs.writeFileSync(malformedLinkLockPath, `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
            '': { name: 'fixture' },
            'node_modules/malformed-link': { link: true }
        }
    }, null, 2)}\n`);

    assert.throws(() => loadPackageLocks([fakeBundleLockPath]), /does not have locked integrity or an explicit local resolution/);
    assert.throws(() => loadPackageLocks([malformedLinkLockPath]), /does not have locked integrity or an explicit local resolution/);
});

test('rejects a link target that is independently resolved without integrity', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    fs.writeFileSync(packageLockPath, `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
            '': { name: 'fixture' },
            'node_modules/remote': { resolved: 'node_modules/target', link: true },
            'node_modules/target': {
                version: '1.0.0',
                resolved: 'https://registry.example/target/-/target-1.0.0.tgz'
            }
        }
    }, null, 2)}\n`);

    assert.throws(() => loadPackageLocks([packageLockPath]), /does not have locked integrity or an explicit local resolution/);
});

test('rejects duplicate or missing npm pack results', t => {
    const packDestination = createTemporaryDirectory(t);
    const content = Buffer.from('fixture');
    const filename = 'fixture-1.0.0.tgz';
    const packageEntry = {
        resolved: `${registry}fixture/-/fixture-1.0.0.tgz`,
        integrity: 'sha1-Uc/zwfC8WfYYfnBAzBKk6bHsp6o='
    };
    const batch = [
        { packageId: 'fixture@1.0.0', packageEntries: [packageEntry] },
        { packageId: 'other@1.0.0', packageEntries: [] }
    ];
    const packedTarball = getPackedTarball('fixture@1.0.0', filename, content);

    fs.writeFileSync(path.join(packDestination, filename), content);
    assert.throws(() => applyPackedTarballs(batch, [packedTarball, packedTarball], packDestination), /more than once/);

    fs.writeFileSync(path.join(packDestination, filename), content);
    assert.throws(() => applyPackedTarballs(batch, [packedTarball], packDestination), /did not return the requested packages: other@1\.0\.0/);
});

test('rejects npm metadata that does not match downloaded bytes', t => {
    const packDestination = createTemporaryDirectory(t);
    const content = Buffer.from('fixture');
    const filename = 'fixture-1.0.0.tgz';
    const packageEntry = {
        resolved: `${registry}fixture/-/fixture-1.0.0.tgz`,
        integrity: 'sha1-Uc/zwfC8WfYYfnBAzBKk6bHsp6o='
    };
    const packedTarball = getPackedTarball('fixture@1.0.0', filename, content);
    packedTarball.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
    fs.writeFileSync(path.join(packDestination, filename), content);

    assert.throws(
        () => applyPackedTarballs([{ packageId: 'fixture@1.0.0', packageEntries: [packageEntry] }], [packedTarball], packDestination),
        /metadata does not match/
    );
    assert.equal(packageEntry.integrity, 'sha1-Uc/zwfC8WfYYfnBAzBKk6bHsp6o=');
});

test('writes package locks with their existing formatting', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    const originalText = '{\r\n    "lockfileVersion": 3\r\n}\r\n';
    fs.writeFileSync(packageLockPath, originalText);

    writePackageLocks([{
        packageLockPath,
        packageLock: { lockfileVersion: 3, packages: {} },
        indentation: '    ',
        newline: '\r\n',
        originalText
    }]);

    assert.equal(fs.readFileSync(packageLockPath, 'utf8'), '{\r\n    "lockfileVersion": 3,\r\n    "packages": {}\r\n}\r\n');
});

test('does not replace an unchanged package lock', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    const originalText = '{"lockfileVersion":3}\n';
    fs.writeFileSync(packageLockPath, originalText);
    let renameCount = 0;

    writePackageLocks([{
        packageLockPath,
        packageLock: { lockfileVersion: 3 },
        indentation: '',
        newline: '\n',
        originalText
    }], {
        readFileSync: fs.readFileSync,
        writeFileSync: fs.writeFileSync,
        unlinkSync: fs.unlinkSync,
        renameSync() {
            renameCount++;
        }
    });

    assert.equal(renameCount, 0);
});

test('rejects a package lock changed after it was loaded', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    const originalText = '{"value":1}\n';
    fs.writeFileSync(packageLockPath, '{"value":2}\n');

    assert.throws(
        () => writePackageLocks([{
            packageLockPath,
            packageLock: { value: 3 },
            indentation: '  ',
            newline: '\n',
            originalText
        }]),
        error => error instanceof AggregateError && error.errors.some(cause => /changed while package tarballs were being verified/.test(cause.message))
    );
    assert.equal(fs.readFileSync(packageLockPath, 'utf8'), '{"value":2}\n');
});

test('preserves a package lock recreated while its replacement is installed', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    const originalText = '{"value":1}\n';
    const concurrentText = '{"value":2}\n';
    fs.writeFileSync(packageLockPath, originalText);

    const racingFileSystem = {
        copyFileSync: fs.copyFileSync,
        linkSync(source, destination) {
            if (destination === packageLockPath) {
                fs.writeFileSync(destination, concurrentText, { flag: 'wx' });
            }
            fs.linkSync(source, destination);
        },
        readFileSync: fs.readFileSync,
        renameSync: fs.renameSync,
        writeFileSync: fs.writeFileSync,
        unlinkSync: fs.unlinkSync
    };

    assert.throws(
        () => writePackageLocks([{
            packageLockPath,
            packageLock: { value: 3 },
            indentation: '  ',
            newline: '\n',
            originalText
        }], racingFileSystem),
        /Unable to update package-lock\.json files atomically/
    );
    assert.equal(fs.readFileSync(packageLockPath, 'utf8'), concurrentText);
    assert.deepEqual(fs.readdirSync(temporaryDirectory), ['package-lock.json']);
});

test('restores claimed content when hard links fail after preflight', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    const originalText = '{"value":1}\n';
    fs.writeFileSync(packageLockPath, originalText);
    let linkCount = 0;

    const failingFileSystem = {
        copyFileSync: fs.copyFileSync,
        linkSync(source, destination) {
            linkCount++;
            if (linkCount > 1) {
                const error = new Error('hard links stopped working');
                error.code = 'EPERM';
                throw error;
            }
            fs.linkSync(source, destination);
        },
        readFileSync: fs.readFileSync,
        renameSync: fs.renameSync,
        writeFileSync: fs.writeFileSync,
        unlinkSync: fs.unlinkSync
    };

    assert.throws(
        () => writePackageLocks([{
            packageLockPath,
            packageLock: { value: 2 },
            indentation: '  ',
            newline: '\n',
            originalText
        }], failingFileSystem),
        /Unable to update package-lock\.json files atomically/
    );
    assert.equal(fs.readFileSync(packageLockPath, 'utf8'), originalText);
    assert.deepEqual(fs.readdirSync(temporaryDirectory), ['package-lock.json']);
});

test('leaves lockfiles untouched when hard links are unsupported', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPath = path.join(temporaryDirectory, 'package-lock.json');
    const originalText = '{"value":1}\n';
    fs.writeFileSync(packageLockPath, originalText);
    let renameCount = 0;

    const unsupportedFileSystem = {
        linkSync() {
            const error = new Error('hard links are unsupported');
            error.code = 'EPERM';
            throw error;
        },
        readFileSync: fs.readFileSync,
        renameSync(source, destination) {
            renameCount++;
            fs.renameSync(source, destination);
        },
        writeFileSync: fs.writeFileSync,
        unlinkSync: fs.unlinkSync
    };

    assert.throws(
        () => writePackageLocks([{
            packageLockPath,
            packageLock: { value: 2 },
            indentation: '  ',
            newline: '\n',
            originalText
        }], unsupportedFileSystem),
        /Unable to update package-lock\.json files atomically/
    );
    assert.equal(renameCount, 0);
    assert.equal(fs.readFileSync(packageLockPath, 'utf8'), originalText);
    assert.deepEqual(fs.readdirSync(temporaryDirectory), ['package-lock.json']);
});

test('rolls back earlier lock replacements when a later replacement fails', t => {
    const temporaryDirectory = createTemporaryDirectory(t);
    const packageLockPaths = [path.join(temporaryDirectory, 'one.json'), path.join(temporaryDirectory, 'two.json')];
    const originalTexts = ['{"value":1}\n', '{"value":2}\n'];
    for (const [index, packageLockPath] of packageLockPaths.entries()) {
        fs.writeFileSync(packageLockPath, originalTexts[index]);
    }

    let linkCount = 0;
    const failingFileSystem = {
        copyFileSync: fs.copyFileSync,
        linkSync(source, destination) {
            linkCount++;
            if (linkCount === 4) {
                throw new Error('injected link failure');
            }
            fs.linkSync(source, destination);
        },
        readFileSync: fs.readFileSync,
        renameSync: fs.renameSync,
        writeFileSync: fs.writeFileSync,
        unlinkSync: fs.unlinkSync
    };
    const packageLocks = packageLockPaths.map((packageLockPath, index) => ({
        packageLockPath,
        packageLock: { value: index + 10 },
        indentation: '  ',
        newline: '\n',
        originalText: originalTexts[index]
    }));

    assert.throws(() => writePackageLocks(packageLocks, failingFileSystem), /Unable to update package-lock\.json files atomically/);
    for (const [index, packageLockPath] of packageLockPaths.entries()) {
        assert.equal(fs.readFileSync(packageLockPath, 'utf8'), originalTexts[index]);
    }
    assert.deepEqual(fs.readdirSync(temporaryDirectory).sort(), ['one.json', 'two.json']);
});

test('formats nested transaction errors with recovery guidance', () => {
    const formatted = formatError(new AggregateError([
        new Error('first failure'),
        new AggregateError([new Error('nested failure')], 'nested transaction')
    ], 'transaction failed'));

    assert.match(formatted, /transaction failed\n {2}first failure\n {2}nested transaction\n {4}nested failure/);
    assert.match(formatted, /Original or concurrent content may remain in adjacent \.claim or \.current files/);
});