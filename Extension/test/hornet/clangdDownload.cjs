// Optional live download smoke test. Compile first, then run from Extension/.
const assert = require('node:assert/strict');
const path = require('node:path');
const { installClangd } = require('../../out/hornet/src/hornet/core/clangdInstaller');
const { BinaryManager } = require('../../out/hornet/src/hornet/core/binaryManager');
const storagePath = path.resolve('../.npm-cache/clangd-smoke');
const options = { storagePath, report: console.log, proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY };
(async () => {
    const first = installClangd(options);
    assert.equal(installClangd(options), first, 'concurrent workspaces share the download');
    const binary = await first;
    // Explicitly resolve the cache executable to check it remains valid after staging cleanup.
    assert.equal(await new BinaryManager().resolve(binary), binary);
    if (process.platform === 'win32') {
        const manager = new BinaryManager({ storagePath, env: {} });
        assert.equal(await manager.ensure('clangd', async () => { throw new Error('Unexpected second download'); }), binary);
    }
    console.log('PASS: official download, checksum, extraction, executable validation and cache reuse');
    console.log(binary);
})().catch(error => { console.error(error); process.exitCode = 1; });
