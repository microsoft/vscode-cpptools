import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { CallHierarchyItem } from 'vscode-languageserver-protocol';
import { CallGraphModel } from '../../src/hornet/views/callGraphModel';

const symbol = (name: string): CallHierarchyItem => ({ name, kind: 12, uri: `file:///project/${name}.cpp`,
    range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
    selectionRange: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } } });
function fixture(edges: [string, string][]) {
    const requests: string[] = [];
    const model = new CallGraphModel(async <T>(method: string, params: unknown) => {
        const name = (params as { item: CallHierarchyItem }).item.name;
        const incoming = method.endsWith('incomingCalls');
        requests.push(`${name}:${incoming ? 'incoming' : 'outgoing'}`);
        return edges.filter(edge => edge[incoming ? 1 : 0] === name).map(edge =>
            incoming ? { from: symbol(edge[0]), fromRanges: [] } : { to: symbol(edge[1]), fromRanges: [] }) as T;
    }, () => {});
    model.reset(symbol('root'));
    return { model, requests, id: (name: string) => model.snapshot().nodes.find(node => node.name === name)!.id };
}

test('call graph expands both root directions without following unrelated callers of a child', async () => {
    const { model, requests, id } = fixture([['caller', 'root'], ['root', 'callee'], ['other', 'callee'], ['callee', 'leaf']]);
    await model.expand(id('root'));
    assert.deepEqual(requests.sort(), ['root:incoming', 'root:outgoing']);
    assert.deepEqual(model.snapshot().edges, [{ from: id('caller'), to: id('root') }, { from: id('root'), to: id('callee') }]);
    await model.expand(id('callee'), 'outgoing');
    assert.ok(model.snapshot().nodes.some(node => node.name === 'leaf'));
    assert.ok(!model.snapshot().nodes.some(node => node.name === 'other'));
    await model.expand(id('callee'), 'incoming');
    assert.ok(!model.snapshot().nodes.some(node => node.name === 'other'));
    const count = requests.length;
    model.collapse(id('callee'), 'outgoing');
    assert.ok(!model.snapshot().nodes.some(node => node.name === 'leaf'));
    assert.ok(!model.snapshot().nodes.some(node => node.name === 'other'));
    await model.expand(id('callee'), 'outgoing');
    assert.equal(requests.length, count, 'reopening uses cached relationships');
});

test('collapse removes descendants but preserves shared functions through other visible branches', async () => {
    const { model, id } = fixture([['root', 'left'], ['root', 'right'], ['left', 'shared'], ['right', 'shared'], ['shared', 'leaf']]);
    await model.expand(id('root'));
    await model.expand(id('left'), 'outgoing');
    await model.expand(id('right'), 'outgoing');
    await model.expand(id('shared'), 'outgoing');
    model.collapse(id('left'), 'outgoing');
    assert.equal(model.snapshot().nodes.filter(node => node.name === 'shared').length, 1);
    assert.ok(model.snapshot().nodes.some(node => node.name === 'leaf'));
    model.collapse(id('right'), 'outgoing');
    assert.deepEqual(model.snapshot().nodes.map(node => node.name).sort(), ['left', 'right', 'root']);
    model.collapse(id('root'), 'outgoing');
    assert.equal(model.snapshot().nodes.length, 1);
});

test('recursive calls and duplicate edges terminate and keep arrow direction', async () => {
    const { model, id } = fixture([['root', 'root'], ['root', 'callee'], ['root', 'callee'], ['callee', 'root']]);
    await model.expand(id('root'));
    await model.expand(id('callee'));
    assert.equal(model.snapshot().nodes.length, 2);
    assert.equal(model.snapshot().edges.length, 3);
    assert.ok(model.snapshot().edges.some(edge => edge.from === id('root') && edge.to === id('root')));
    model.collapse(id('root'), 'incoming');
    model.collapse(id('root'), 'outgoing');
    assert.equal(model.snapshot().nodes.length, 1);
    assert.equal(model.snapshot().edges.length, 0);
});

test('concurrent clicks deduplicate queries; stale results cannot repopulate a new graph', async () => {
    let finish!: (value: unknown) => void;
    let requests = 0;
    const model = new CallGraphModel(<T>() => { requests++; return new Promise<unknown>(resolve => { finish = resolve; }) as Promise<T>; }, () => {});
    model.reset(symbol('root'));
    const root = model.snapshot().root!;
    const first = model.expand(root, 'incoming');
    const second = model.expand(root, 'incoming');
    assert.equal(requests, 1);
    model.reset(symbol('new'));
    finish([{ from: symbol('stale'), fromRanges: [] }]);
    await Promise.all([first, second]);
    assert.deepEqual(model.snapshot().nodes.map(node => node.name), ['new']);
});

test('one failed direction leaves the other usable and can be retried', async () => {
    let failed = true;
    const model = new CallGraphModel(async <T>(method: string) => {
        if (method.endsWith('incomingCalls')) {
            if (failed) { throw new Error('backend failure'); }
            return [{ from: symbol('caller'), fromRanges: [] }] as T;
        }
        return [{ to: symbol('callee'), fromRanges: [] }] as T;
    }, () => {});
    model.reset(symbol('root'));
    await model.expand(model.snapshot().root!);
    assert.equal(model.snapshot().nodes[0].incoming.error, 'backend failure');
    assert.ok(model.snapshot().nodes.some(node => node.name === 'callee'));
    failed = false;
    await model.expand(model.snapshot().root!, 'incoming');
    assert.equal(model.snapshot().nodes[0].incoming.error, undefined);
    assert.equal(model.snapshot().nodes.length, 3);
});

test('collapsing a loading branch prevents late results from reopening it', async () => {
    let finish!: (value: unknown) => void;
    const model = new CallGraphModel(<T>() => new Promise<unknown>(resolve => { finish = resolve; }) as Promise<T>, () => {});
    model.reset(symbol('root'));
    const root = model.snapshot().root!;
    const loading = model.expand(root, 'outgoing');
    model.collapse(root, 'outgoing');
    finish([{ to: symbol('callee'), fromRanges: [] }]);
    await loading;
    assert.equal(model.snapshot().nodes.length, 1);
    await model.expand(root, 'outgoing');
    assert.equal(model.snapshot().nodes.length, 2);
});

test('graph size is bounded without dangling edges', async () => {
    const model = new CallGraphModel(async <T>() => ['a', 'b', 'c'].map(name => ({ to: symbol(name), fromRanges: [] })) as T, () => {}, 2);
    model.reset(symbol('root'));
    await model.expand(model.snapshot().root!, 'outgoing');
    const graph = model.snapshot();
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);
    assert.match(graph.message!, /2/);
    assert.ok(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.to)));
});

test('probing discovers empty sides without expanding and reuses results on expansion', async () => {
    const { model, requests, id } = fixture([['root', 'callee'], ['callee', 'leaf']]);
    await model.expand(id('root'));
    await model.probeVisible();
    const graph = model.snapshot();
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.nodes.find(node => node.name === 'root')!.incoming.count, 0);
    assert.deepEqual(graph.nodes.find(node => node.name === 'callee')!.outgoing,
        { open: false, loaded: true, loading: false, count: 1, action: 'expand' });
    const count = requests.length;
    await model.expand(id('callee'), 'outgoing');
    assert.equal(requests.length, count);
    assert.equal(model.snapshot().nodes.length, 3);
    await model.probeVisible();
    assert.deepEqual(model.snapshot().nodes.find(node => node.name === 'leaf')!.outgoing,
        { open: false, loaded: true, loading: false, count: 0, action: 'none' });
});

test('probes do not consume the node budget or recursively discover hidden nodes', async () => {
    const requests: string[] = [];
    const model = new CallGraphModel(async <T>(_method: string, params: unknown) => {
        requests.push((params as { item: CallHierarchyItem }).item.name);
        return ['a', 'b', 'c'].map(name => ({ from: symbol(name), to: symbol(name), fromRanges: [] })) as T;
    }, () => {}, 2);
    model.reset(symbol('root'));
    await model.probeVisible();
    assert.deepEqual(requests, ['root', 'root']);
    assert.equal(model.snapshot().nodes.length, 1);
    assert.equal(model.snapshot().message, undefined);
    await model.expand(model.snapshot().root!, 'outgoing');
    assert.equal(model.snapshot().nodes.length, 2);
    assert.equal(requests.length, 2);
    assert.match(model.snapshot().message!, /2/);
});

test('failed availability probes remain retryable', async () => {
    let failed = true;
    const model = new CallGraphModel(async <T>() => {
        if (failed) { throw new Error('probe failed'); }
        return [] as T;
    }, () => {});
    model.reset(symbol('root'));
    await model.probeVisible();
    assert.equal(model.snapshot().nodes[0].outgoing.loaded, false);
    assert.equal(model.snapshot().nodes[0].outgoing.error, 'probe failed');
    failed = false;
    await model.expand(model.snapshot().root!, 'outgoing');
    assert.equal(model.snapshot().nodes[0].outgoing.loaded, true);
    assert.equal(model.snapshot().nodes[0].outgoing.count, 0);
    assert.equal(model.snapshot().nodes[0].outgoing.error, undefined);
});

test('reset discards stale probes and their cached results', async () => {
    const finishes: ((value: unknown) => void)[] = [];
    const model = new CallGraphModel(<T>() => new Promise<unknown>(resolve => finishes.push(resolve)) as Promise<T>, () => {});
    model.reset(symbol('root'));
    const probing = model.probeVisible();
    model.reset(symbol('new'));
    for (const finish of finishes) { finish([]); }
    await probing;
    assert.equal(model.snapshot().nodes[0].incoming.loaded, false);
    const loading = model.expand(model.snapshot().root!, 'outgoing');
    assert.equal(finishes.length, 3);
    finishes[2]([{ to: symbol('fresh'), fromRanges: [] }]);
    await loading;
    assert.deepEqual(model.snapshot().nodes.map(node => node.name), ['new', 'fresh']);
});

test('initial graph follows both complete chains without expanding unrelated sibling calls', async () => {
    const { model, id } = fixture([['entry', 'caller'], ['caller', 'root'], ['caller', 'unrelated'], ['root', 'callee'], ['callee', 'leaf']]);
    await model.expandChains();
    await model.probeVisible();
    assert.deepEqual(model.snapshot().nodes.map(node => node.name).sort(), ['callee', 'caller', 'entry', 'leaf', 'root']);
    const node = (name: string) => model.snapshot().nodes.find(node => node.name === name)!;
    assert.equal(node('root').incoming.action, 'collapse');
    assert.equal(node('root').outgoing.action, 'collapse');
    assert.equal(node('callee').incoming.action, 'none', 'already drawn root edge is not an expansion');
    assert.equal(node('caller').outgoing.action, 'none', 'unrelated callee branches of an ancestor cannot be expanded');
    assert.equal(node('leaf').incoming.action, 'none');
    assert.equal(node('leaf').outgoing.action, 'none');
    model.collapse(id('root'), 'outgoing');
    assert.equal(node('root').outgoing.action, 'expand');
    assert.ok(!model.snapshot().nodes.some(node => node.name === 'leaf'));
    await model.expand(id('root'), 'outgoing');
    assert.ok(model.snapshot().nodes.some(node => node.name === 'leaf'), 'reopening restores the expanded descendant chain');
});

test('shared edges and cycles do not produce no-op collapse buttons', async () => {
    const { model, id } = fixture([['root', 'callee'], ['callee', 'root']]);
    await model.expandChains();
    await model.probeVisible();
    assert.equal(model.snapshot().nodes.length, 2);
    assert.equal(model.snapshot().edges.length, 2);
    await model.expand(id('callee'), 'incoming');
    assert.equal(model.snapshot().nodes.find(node => node.name === 'callee')!.incoming.action, 'none');
});

test('D side buttons follow complete caller and callee chains independently', async () => {
    const edges: [string, string][] = [['main', 'A'], ['A', 'B'], ['B', 'C'], ['C', 'D'],
        ['D', 'E'], ['E', 'F'], ['F', 'G'], ['D', 'I'], ['I', 'J']];
    const { model, id, requests } = fixture([...edges, ['main', 'H'], ['A', 'unusedA'], ['B', 'unusedB'], ['C', 'unusedC'], ['unrelatedCaller', 'F']]);
    model.reset(symbol('D'));
    await model.expandChain(id('D'), 'incoming');
    assert.deepEqual(model.snapshot().nodes.map(node => node.name).sort(), ['A', 'B', 'C', 'D', 'main']);
    await model.expandChain(id('D'), 'outgoing');
    await model.probeVisible();
    const drawnEdges = () => model.snapshot().edges.map(edge => `${model.item(edge.from)!.name}->${model.item(edge.to)!.name}`).sort();
    assert.deepEqual(drawnEdges(), edges.map(edge => edge.join('->')).sort());
    for (const ancestor of ['main', 'A', 'B', 'C']) {
        assert.equal(model.snapshot().nodes.find(node => node.name === ancestor)!.outgoing.action, 'none');
        await model.expandChain(id(ancestor), 'outgoing');
        await model.expand(id(ancestor), 'outgoing');
        assert.deepEqual(drawnEdges(), edges.map(edge => edge.join('->')).sort(), `${ancestor}'s other callees must remain excluded`);
        assert.ok(!requests.includes(`${ancestor}:outgoing`), 'out-of-scope calls are never queried');
    }
    await model.expandChain(id('F'), 'incoming');
    assert.ok(!requests.includes('F:incoming'), 'unrelated callers of descendants are never queried');
    model.collapse(id('D'), 'incoming');
    assert.deepEqual(model.snapshot().nodes.map(node => node.name).sort(), ['D', 'E', 'F', 'G', 'I', 'J']);
    model.collapse(id('D'), 'outgoing');
    assert.deepEqual(model.snapshot().nodes.map(node => node.name), ['D']);
    const queries = requests.length;
    await model.expandChains();
    assert.deepEqual(drawnEdges(), edges.map(edge => edge.join('->')).sort());
    assert.equal(requests.length, queries, 'both chains reopen from the cache');
});

test('a newly opened side discovers deeper calls and collapse cancels pending traversal', async () => {
    const { model, id } = fixture([['root', 'new'], ['new', 'deep'], ['deep', 'leaf']]);
    await model.expand(id('root'), 'outgoing');
    assert.equal(model.snapshot().nodes.length, 2);
    await model.expandChain(id('new'), 'outgoing');
    assert.deepEqual(model.snapshot().nodes.map(node => node.name).sort(), ['deep', 'leaf', 'new', 'root']);

    let finish!: (value: unknown) => void;
    const pending = new CallGraphModel(<T>() => new Promise<unknown>(resolve => { finish = resolve; }) as Promise<T>, () => {});
    pending.reset(symbol('D'));
    const root = pending.snapshot().root!;
    const expanding = pending.expandChain(root, 'outgoing');
    pending.collapse(root, 'outgoing');
    finish([{ to: symbol('E'), fromRanges: [] }]);
    await expanding;
    assert.deepEqual(pending.snapshot().nodes.map(node => node.name), ['D']);
});
