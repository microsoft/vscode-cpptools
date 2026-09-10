import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';

test('shipping manifest exposes only Hornet entrypoints and settings', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    assert.equal(manifest.name, 'hornet-cpp');
    assert.equal(manifest.main, './dist/hornet.js');
    assert.equal(manifest.extensionKind[0], 'workspace');
    assert.ok(manifest.contributes.viewsContainers.panel.some((panel: { id: string; title: string }) => panel.id === 'hornet-cpp-graph' && panel.title === 'Hornet Graph'));
    assert.ok(manifest.contributes.views['hornet-cpp-graph'].some((view: { id: string; type: string }) => view.id === 'hornet-cpp.graphView' && view.type === 'webview'));
    for (const containers of Object.values(manifest.contributes.viewsContainers)) {
        for (const container of containers as { id: string }[]) { assert.match(container.id, /^[a-zA-Z0-9_-]+$/); }
    }
    const graphCommand = manifest.contributes.commands.find((command: { command: string }) => command.command === 'hornet-cpp.showCallGraph');
    assert.equal(graphCommand.title, 'Hornet Show Graph');
    assert.equal(graphCommand.shortTitle ?? graphCommand.title, 'Hornet Show Graph');
    assert.ok(!manifest.contributes.debuggers);
    assert.ok(!manifest.runtimeDependencies);
    for (const command of manifest.contributes.commands) { assert.ok(command.command.startsWith('hornet-cpp.')); }
    for (const token of manifest.contributes.semanticTokenTypes) { assert.ok(typeof token.description === 'string' && token.description.length > 0); }
    for (const setting of Object.keys(manifest.contributes.configuration.properties)) { assert.ok(setting.startsWith('hornet-cpp.')); }
    const dependencyNames = Object.keys(manifest.dependencies).join(' ');
    assert.doesNotMatch(dependencyNames, /telemetry|tas-client|cpptools|experiment/i);
});

test('every declared command is implemented and the bundle has no legacy imports', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const source = fs.readFileSync('src/hornet/extension.ts', 'utf8');
    for (const command of manifest.contributes.commands) {
        assert.ok(source.includes(`register('${command.command.replace('hornet-cpp.', '')}'`), command.command);
    }
    if (fs.existsSync('dist/hornet.meta.json')) {
        const inputs = Object.keys(JSON.parse(fs.readFileSync('dist/hornet.meta.json', 'utf8')).inputs);
        assert.ok(inputs.filter(file => file.startsWith('src/')).every(file => file.startsWith('src/hornet/')));
    }
});
