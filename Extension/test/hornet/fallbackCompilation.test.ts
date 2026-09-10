import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { prepareCompilerConfiguration } from '../../src/hornet/compdb/fallbackCompilation';

test('unconfigured projects discover include directories and index unopened first-party sources', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-fallback-'));
    try {
        for (const directory of ['src', 'app', 'include', 'module/inc', 'build', 'third_party', '.vscode/hornet/compile-db']) {
            await fs.mkdir(path.join(root, directory), { recursive: true });
        }
        for (const file of ['src/core.c', 'app/main.cpp', 'build/generated.c', 'third_party/vendor.cpp']) { await fs.writeFile(path.join(root, file), ''); }
        const original = path.join(root, '.vscode/hornet/compile-db');
        await fs.writeFile(path.join(original, 'compile_commands.json'), '[]');
        const result = await prepareCompilerConfiguration(root, original);
        assert.equal(result.inferred, 2);
        assert.ok(result.fallbackFlags.includes(`-I${path.join(root, 'include')}`));
        assert.ok(result.fallbackFlags.includes(`-I${path.join(root, 'module/inc')}`));
        const commands = JSON.parse(await fs.readFile(path.join(result.directory, 'compile_commands.json'), 'utf8'));
        assert.equal(commands.length, 2);
        assert.ok(commands.every((command: { arguments: string[] }) => command.arguments.includes(`-I${path.join(root, 'include')}`)));
        assert.equal(await fs.readFile(path.join(original, 'compile_commands.json'), 'utf8'), '[]', 'inferred flags never become authoritative compile commands');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('real compile commands keep their exact flags and directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hornet-real-db-'));
    try {
        const text = JSON.stringify([{ directory: root, file: path.join(root, 'main.c'), arguments: ['cross-clang', '-DPLATFORM=1', '-c', 'main.c'] }]);
        await fs.writeFile(path.join(root, 'compile_commands.json'), text);
        const result = await prepareCompilerConfiguration(root, root);
        assert.deepEqual(result, { directory: root, fallbackFlags: [], inferred: 0, sources: [path.join(root, 'main.c')] });
        assert.equal(await fs.readFile(path.join(root, 'compile_commands.json'), 'utf8'), text);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
