import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { clangdDownload, extractClangdArchive, verifyClangdArchive } from '../../src/hornet/core/clangdInstaller';

// A minimal uncompressed ZIP entry, including its CRC and central directory.
function archive(name: string, content: string, mode = 0o100644): Buffer {
    const filename = Buffer.from(name), data = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) { crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((mode << 16) >>> 0, 38);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16);
    return Buffer.concat([local, filename, data, central, filename, end]);
}

test('official downloads match native supported targets and reject incompatible archives', () => {
    for (const [platform, arch, name] of [['win32', 'x64', 'windows'], ['linux', 'x64', 'linux'], ['darwin', 'arm64', 'mac'], ['darwin', 'x64', 'mac']]) {
        const asset = clangdDownload(platform as NodeJS.Platform, arch);
        assert.equal(new URL(asset.url).hostname, 'github.com');
        assert.ok(asset.url.endsWith(`clangd-${name}-22.1.6.zip`));
        assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    }
    assert.throws(() => clangdDownload('linux', 'arm64'), /unavailable/);
    assert.throws(() => clangdDownload('linux', 'x64', true), /musl/);
    assert.throws(() => clangdDownload('win32', 'arm64'), /unavailable/);
});

test('archive verification rejects corrupted downloads; extraction preserves resource directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-archive-'));
    try {
        const file = path.join(root, 'test.zip');
        const bytes = archive('clangd_22.1.6/lib/clang/22/include/stddef.h', 'test header');
        await fs.writeFile(file, bytes);
        await verifyClangdArchive(file, createHash('sha256').update(bytes).digest('hex'));
        await assert.rejects(verifyClangdArchive(file, '0'.repeat(64)), /checksum/);
        await extractClangdArchive(file, path.join(root, 'extract'));
        assert.equal(await fs.readFile(path.join(root, 'extract/clangd_22.1.6/lib/clang/22/include/stddef.h'), 'utf8'), 'test header');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('archive extraction rejects traversal and symbolic links', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-unsafe-archive-'));
    try {
        const file = path.join(root, 'test.zip');
        for (const [name, mode] of [['../escaped', 0o100644], ['/absolute', 0o100644], ['clangd/link', 0o120777]] as const) {
            await fs.writeFile(file, archive(name, 'outside', mode));
            await assert.rejects(extractClangdArchive(file, path.join(root, 'extract')));
        }
        await assert.rejects(fs.stat(path.join(root, 'escaped')), { code: 'ENOENT' });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
