import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveBuildConfiguration } from '../../src/hornet/tasks/taskConfiguration';

const release = require(path.resolve('release.hornet.js')) as {
    targets: string[];
    plan(args: string[]): { targets: string[]; outputs: { target: string; file: string }[]; preRelease: boolean };
};

test('build tasks retain Windows, Linux and macOS overrides and inherited options', () => {
    const configuration = {
        command: 'clang++', args: ['common.cpp'], options: { cwd: '${workspaceFolder}' },
        windows: { command: 'clang-cl', args: ['/EHsc', 'windows.cpp'] },
        linux: { command: 'g++', options: { cwd: '/linux/build' } },
        osx: { command: '/usr/bin/clang++', args: ['mac.cpp'] }
    };
    assert.equal(resolveBuildConfiguration(configuration, 'win32').command, 'clang-cl');
    assert.deepEqual(resolveBuildConfiguration(configuration, 'win32').args, ['/EHsc', 'windows.cpp']);
    assert.equal(resolveBuildConfiguration(configuration, 'win32').options?.cwd, '${workspaceFolder}');
    assert.equal(resolveBuildConfiguration(configuration, 'linux').options?.cwd, '/linux/build');
    assert.equal(resolveBuildConfiguration(configuration, 'darwin').command, '/usr/bin/clang++');
    assert.deepEqual(resolveBuildConfiguration(configuration, 'darwin').args, ['mac.cpp']);
    assert.equal(configuration.command, 'clang++');
    assert.equal(resolveBuildConfiguration(configuration, 'freebsd').command, 'clang++');
});

test('all desktop/server VSIX targets have package scripts and unique outputs', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.deepEqual(release.targets, ['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'linux-armhf', 'darwin-x64', 'darwin-arm64', 'alpine-x64', 'alpine-arm64']);
    for (const target of release.targets) { assert.ok(manifest.scripts[`package:${target}`]); }
    const plan = release.plan(['package', '--all']);
    assert.equal(new Set(plan.outputs.map(output => output.file)).size, 10);
    assert.ok(plan.targets.includes('universal'));
    assert.ok(!manifest.os && !manifest.cpu, 'Do not restrict extension installation to the build host');
    assert.throws(() => release.plan(['package', '--target', '../../elsewhere']), /Unsupported target/);
    assert.ok(release.plan(['package', '--pre-release']).outputs[0].file.endsWith('-pre-release.vsix'));
});

test('public publishing requires explicit VSIX files and supports no-upload dry runs', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.ok(manifest.scripts['publish:marketplace']);
    assert.ok(manifest.scripts['publish:openvsx']);
    assert.throws(() => release.plan(['marketplace']), /already reviewed package/);
    assert.doesNotThrow(() => release.plan(['marketplace', '--vsix', 'artifact.vsix', '--dry-run']));
    assert.doesNotThrow(() => release.plan(['openvsx', '--vsix', 'artifact.vsix', '--dry-run']));
    assert.doesNotMatch(JSON.stringify(manifest.scripts), /azure-public|MicroBuild|AAD_TOKEN|install-and-copy-binaries/);
});

test('task schemas and portable language contributions remain in the manifest', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    for (const type of ['cppbuild', 'hornet-cpp.build']) {
        const task = manifest.contributes.taskDefinitions.find((task: { type: string }) => task.type === type);
        for (const platform of ['windows', 'linux', 'osx']) { assert.ok(task.properties[platform]); }
    }
    assert.ok(manifest.contributes.languages[0].filenames.includes('vector'));
    assert.ok(manifest.contributes.languages[0].extensions.includes('.cppm'));
    assert.ok(manifest.contributes.problemMatchers.some((matcher: { name: string }) => matcher.name === 'gcc'));
    assert.doesNotMatch(JSON.stringify(manifest.contributes), /%c_cpp\./);
});
