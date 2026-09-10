import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProcessManager } from '../../src/hornet/core/processManager';
import { CallGraphModel } from '../../src/hornet/views/callGraphModel';
import type { CompilerEngine as CompilerEngineType } from '../../src/hornet/engines/compilerEngine';
import type * as lsp from 'vscode-languageserver-protocol';

// Only VS Code host objects are substituted. Transport, process management and clangd are real.
test('real clangd: handshake, UTF-16 positions, completion, navigation, rename, hierarchies and diagnostics', {
    skip: !process.env.HORNET_TEST_CLANGD && !process.env.HORNET_TEST_AUTO_CLANGD, timeout: 45000
}, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hornet-clangd-'));
    const manager = new ProcessManager();
    let engine: CompilerEngineType | undefined;
    const moduleLoader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown };
    const originalLoad = moduleLoader._load;
    const settings: Record<string, unknown> = { 'clangd.path': process.env.HORNET_TEST_CLANGD || 'clangd', cpuUsage: 'Low' };
    const mock = new Proxy({
        workspace: { isTrusted: true, getConfiguration: () => ({ get: (key: string, fallback: unknown) => settings[key] ?? fallback }) },
        window: { showErrorMessage: () => {} }
    } as Record<string, unknown>, { get: (target, key: string) => target[key] ?? class {} });
    moduleLoader._load = (id, ...args) => id === 'vscode' ? mock : originalLoad(id, ...args);
    try {
        const { CompilerEngine } = require('../../src/hornet/engines/compilerEngine') as { CompilerEngine: typeof CompilerEngineType };
        const file = path.join(directory, 'sample.cpp');
        const text = 'int add(int a, int b) { return a + b; }\nstruct Base { virtual ~Base() = default; };\nstruct Derived : Base {};\nint main() { /* 中文 😀 */ return add(1, 2); }\n';
        fs.writeFileSync(file, text);
        fs.writeFileSync(path.join(directory, 'compile_commands.json'), JSON.stringify([{ directory, file, arguments: ['clang++', '-std=c++17', '-c', file] }]));
        const uri = pathToFileURL(file).toString();
        const logs: string[] = [];
        let receiveDiagnostics!: (params: lsp.PublishDiagnosticsParams) => void;
        const diagnostics = new Promise<lsp.PublishDiagnosticsParams>(resolve => { receiveDiagnostics = resolve; });
        engine = new CompilerEngine(manager, {
            root: { name: 'integration', index: 0, uri: { fsPath: directory, toString: () => pathToFileURL(directory).toString() } as never },
            databaseDirectory: directory, log: line => logs.push(line), diagnostics: params => receiveDiagnostics(params),
            changed: () => {}, refresh: () => {}, canApplyEdit: () => false
        });
        await engine.initialize();
        assert.ok(engine.getCapabilities().completionProvider, logs.join('\n'));
        await engine.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cpp', version: 1, text } });
        const initial = await diagnostics;
        assert.equal(initial.diagnostics.filter(diagnostic => diagnostic.severity === 1).length, 0, JSON.stringify(initial));
        const params = { textDocument: { uri }, position: { line: 3, character: text.split('\n')[3].indexOf('add') + 1 } };
        const definition = await engine.request<lsp.Location[]>('textDocument/definition', params);
        assert.ok(definition?.length);
        assert.equal(definition![0].range.start.line, 0);
        const references = await engine.request<lsp.Location[]>('textDocument/references', { ...params, context: { includeDeclaration: true } });
        assert.ok(references && references.length >= 2);
        const rename = await engine.request<lsp.WorkspaceEdit>('textDocument/rename', { ...params, newName: 'sum' });
        assert.ok(rename && (rename.changes || rename.documentChanges));
        const completion = await engine.request<lsp.CompletionList>('textDocument/completion', { ...params, position: { ...params.position, character: params.position.character + 1 }, context: { triggerKind: 1 } });
        assert.ok(completion?.items.some(item => item.label.includes('add')));
        const calls = await engine.request<lsp.CallHierarchyItem[]>('textDocument/prepareCallHierarchy', { textDocument: { uri }, position: { line: 0, character: 5 } });
        assert.ok(calls?.length);
        const incoming = await engine.request<lsp.CallHierarchyIncomingCall[]>('callHierarchy/incomingCalls', { item: calls![0] });
        assert.ok(incoming?.some(call => call.from.name.includes('main')));
        const main = await engine.request<lsp.CallHierarchyItem[]>('textDocument/prepareCallHierarchy', { textDocument: { uri }, position: { line: 3, character: 5 } });
        const outgoing = await engine.request<lsp.CallHierarchyOutgoingCall[]>('callHierarchy/outgoingCalls', { item: main![0] });
        assert.ok(outgoing?.some(call => call.to.name.includes('add')));
        const graph = new CallGraphModel((method, input) => engine!.request(method, input), () => {});
        graph.reset(calls![0]);
        await graph.expand(graph.snapshot().root!);
        const mainNode = graph.snapshot().nodes.find(node => node.name.includes('main'));
        assert.ok(mainNode);
        await graph.expand(mainNode.id, 'outgoing');
        assert.equal(graph.snapshot().nodes.length, 2);
        assert.deepEqual(graph.snapshot().edges, [{ from: mainNode.id, to: graph.snapshot().root }]);
        graph.collapse(graph.snapshot().root!, 'incoming');
        assert.equal(graph.snapshot().nodes.length, 1);
        if (engine.getCapabilities().typeHierarchyProvider) {
            const types = await engine.request<lsp.TypeHierarchyItem[]>('textDocument/prepareTypeHierarchy', { textDocument: { uri }, position: { line: 2, character: 9 } });
            assert.ok(types?.length);
            const bases = await engine.request<lsp.TypeHierarchyItem[]>('typeHierarchy/supertypes', { item: types![0] });
            assert.ok(bases?.some(type => type.name === 'Base'));
        }
        await engine.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: text.replace('return add(1, 2)', 'return 42') }] });
        assert.deepEqual(await engine.request('callHierarchy/outgoingCalls', { item: main![0] }), [], 'graph queries preserve unsaved editor content, including canonical URI aliases');
        const invalid = new Promise<lsp.PublishDiagnosticsParams>(resolve => { receiveDiagnostics = params => { if (params.version === 3) resolve(params); }; });
        await engine.notify('textDocument/didChange', { textDocument: { uri, version: 3 }, contentChanges: [{ text: text + 'int broken = ;\n' }] });
        assert.ok((await invalid).diagnostics.some(diagnostic => diagnostic.severity === 1));
        // Real semantic regression for the selected D chain, with deliberately unrelated
        // ancestor callees and an unrelated caller of F in the same translation unit.
        const chainFile = file, chainUri = uri;
        const chainText = ['int G() { return 1; }', 'int J() { return 2; }', 'int H() { return 3; }',
            'int unusedA() { return 4; }', 'int unusedB() { return 5; }', 'int unusedC() { return 6; }',
            'int F() { return G(); }', 'int E() { return F(); }', 'int I() { return J(); }',
            'int D() { return E() + I(); }', 'int C() { return D() + unusedC(); }',
            'int B() { return C() + unusedB(); }', 'int A() { return B() + unusedA(); }',
            'int main() { return A() + H(); }', 'int unrelatedCaller() { return F(); }'].join('\n');
        fs.writeFileSync(chainFile, chainText);
        const chainDiagnostics = new Promise<lsp.PublishDiagnosticsParams>(resolve => {
            receiveDiagnostics = params => { if (params.version === 4) resolve(params); };
        });
        await engine.notify('textDocument/didChange', { textDocument: { uri: chainUri, version: 4 }, contentChanges: [{ text: chainText }] });
        assert.equal((await chainDiagnostics).diagnostics.filter(diagnostic => diagnostic.severity === 1).length, 0);
        const center = await engine.request<lsp.CallHierarchyItem[]>('textDocument/prepareCallHierarchy', { textDocument: { uri: chainUri }, position: { line: 9, character: 5 } });
        assert.ok(center?.length);
        graph.reset(center[0]);
        await graph.expandChains();
        const shortName = (id: string) => graph.item(id)!.name.replace(/\(.*$/, '');
        const expected = ['main->A', 'A->B', 'B->C', 'C->D', 'D->E', 'E->F', 'F->G', 'D->I', 'I->J'].sort();
        const drawn = () => graph.snapshot().edges.map(edge => `${shortName(edge.from)}->${shortName(edge.to)}`).sort();
        assert.deepEqual(drawn(), expected);
        for (const node of graph.snapshot().nodes.filter(node => ['main', 'A', 'B', 'C'].includes(shortName(node.id)))) {
            await graph.expandChain(node.id, 'outgoing');
        }
        assert.deepEqual(drawn(), expected, 'manual expansion cannot add H or any ancestor side branch');
        await engine.shutdown();
        assert.deepEqual(engine.getCapabilities(), {});
    } finally {
        await engine?.shutdown();
        await manager.dispose();
        moduleLoader._load = originalLoad;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
