import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import type { GraphSnapshot } from '../../src/hornet/views/callGraphModel';

type Point = [number, number];
type Geometry = { positions: Map<string, { x: number; y: number; rank: number }>; routes: Map<string, { points: Point[]; recursive: boolean }>; roles: Map<string, string> };
const { layoutGraph, edgeKey, W, H } = require(path.resolve('assets/callGraph/layout.js')) as {
    layoutGraph: (graph: GraphSnapshot) => Geometry; edgeKey: (edge: { from: string; to: string }) => string; W: number; H: number;
};
function graph(pairs: string[][], root = pairs[0][0]): GraphSnapshot {
    const side = { loaded: true, open: true, loading: false, count: 1, action: 'collapse' as const };
    return { root, generation: 1, nodes: [...new Set(pairs.flat())].map(id => ({ id, name: id, uri: 'file:///test.cpp', line: 1, detail: '', layer: 0, incoming: side, outgoing: side })),
        edges: pairs.map(([from, to]) => ({ from, to })) };
}
function assertGeometry(snapshot: GraphSnapshot, result: Geometry) {
    for (const [id, a] of result.positions) for (const [other, b] of result.positions) {
        if (id !== other) assert.ok(a.x + W <= b.x || b.x + W <= a.x || a.y + H <= b.y || b.y + H <= a.y, `${id} overlaps ${other}`);
    }
    for (const edge of snapshot.edges) {
        const route = result.routes.get(edgeKey(edge))!, a = result.positions.get(edge.from)!, b = result.positions.get(edge.to)!;
        if (!route.recursive) assert.ok(a.x < b.x, `${edge.from} must be left of ${edge.to}`);
        assert.ok(route.points[0][0] >= a.x + W, 'calls always leave the right side');
        assert.ok(route.points.at(-1)![0] <= b.x, 'calls always enter the left side');
        assert.equal(route.points[0][1], a.y + H / 2, 'source port stays at the vertical center');
        assert.equal(route.points.at(-1)![1], b.y + H / 2, 'arrow tip stays at the vertical center');
        for (let i = 1; i < route.points.length; i++) {
            const [x, y] = route.points[i - 1], [xx, yy] = route.points[i];
            assert.ok(x === xx || y === yy, 'routes are orthogonal');
            for (const [id, p] of result.positions) {
                const crosses = x === xx
                    ? x > p.x && x < p.x + W && Math.max(y, yy) > p.y && Math.min(y, yy) < p.y + H
                    : y > p.y && y < p.y + H && Math.max(x, xx) > p.x && Math.min(x, xx) < p.x + W;
                assert.equal(crosses, false, `${edge.from} -> ${edge.to} crosses ${id}`);
            }
        }
    }
}
test('expanded shared callers are ranked by direction, not stale discovery layers', () => {
    const snapshot = graph([['TEST_F', 'Execute'], ['main', 'Execute'], ['Execute', 'ExecuteOne'], ['ExecuteOne', 'Move'],
        ['ExecuteOne', 'TurnLeft'], ['ExecuteOne', 'TurnRight'], ['Move', 'IsInsideArea'], ['main', 'Init'], ['TEST', 'Init'],
        ['Init', 'IsInsideArea'], ['Init', 'IsDirectionValid'], ['Init', 'IsBoundaryModeValid']], 'IsInsideArea');
    const result = layoutGraph(snapshot);
    assertGeometry(snapshot, result);
    assert.equal(result.positions.get('IsInsideArea')!.rank, 0);
    assert.equal(result.roles.get('main'), 'caller');
    assert.equal(result.roles.get('TurnLeft'), 'related');
});
test('shortcut calls reserve lanes through intermediate columns without crossing nodes', () => {
    const snapshot = graph([['A', 'B'], ['B', 'C'], ['C', 'D'], ['A', 'D'], ['A', 'C'], ['B', 'D'], ['E', 'C']]);
    assertGeometry(snapshot, layoutGraph(snapshot));
});
test('recursive groups and self calls route outside boxes with left-side arrowheads', () => {
    const snapshot = graph([['caller', 'A'], ['A', 'B'], ['B', 'C'], ['C', 'A'], ['B', 'B'], ['C', 'leaf']]);
    const result = layoutGraph(snapshot);
    assertGeometry(snapshot, result);
    assert.equal([...result.routes.values()].filter(route => route.recursive).length, 4);
});
test('layout preserves every edge and remains bounded for branching call chains', () => {
    const pairs = Array.from({ length: 100 }, (_, index) => [`f${Math.floor(index / 3)}`, `f${index + 1}`]);
    pairs.push(['f0', 'f99'], ['f2', 'f88']);
    const snapshot = graph(pairs), result = layoutGraph(snapshot);
    assertGeometry(snapshot, result);
    assert.equal(result.routes.size, pairs.length);
});
test('dense graphs bound intermediate slots and route overflow outside the nodes', () => {
    const pairs = Array.from({ length: 45 }, (_, from) => Array.from({ length: 44 - from }, (_, offset) => [`f${from}`, `f${from + offset + 1}`])).flat();
    const snapshot = graph(pairs), result = layoutGraph(snapshot);
    assertGeometry(snapshot, result);
    assert.equal(result.routes.size, pairs.length);
    assert.ok([...result.routes.values()].reduce((sum, route) => sum + route.points.length, 0) < 15000);
});

test('D stays between its caller chain and two aligned callee chains', () => {
    const snapshot = graph([['main', 'A'], ['A', 'B'], ['B', 'C'], ['C', 'D'],
        ['D', 'E'], ['E', 'F'], ['F', 'G'], ['D', 'I'], ['I', 'J']], 'D');
    const result = layoutGraph(snapshot), p = (id: string) => result.positions.get(id)!;
    assertGeometry(snapshot, result);
    assert.deepEqual(['main', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => p(id).rank), [-4, -3, -2, -1, 0, 1, 2, 3]);
    assert.equal(p('I').rank, 1);
    assert.equal(p('J').rank, 2);
    assert.ok(Math.abs(p('E').y - p('F').y) < 1 && Math.abs(p('F').y - p('G').y) < 1, 'E/F/G align across columns');
    assert.ok(Math.abs(p('I').y - p('J').y) < 1, 'I/J align across columns');
    assert.ok(Math.abs(p('E').y - p('I').y) >= H + 40, 'separate branches have clear space');
});

test('adding a deep branch moves existing boxes to make room and reroutes every edge', () => {
    const pairs = [['D', 'E'], ['E', 'F'], ['D', 'I'], ['I', 'J']];
    const before = layoutGraph(graph(pairs, 'D'));
    const expanded = graph([...pairs, ['E', 'K'], ['E', 'L'], ['K', 'M'], ['L', 'N']], 'D');
    const after = layoutGraph(expanded);
    assertGeometry(expanded, after);
    assert.ok(['E', 'F', 'I', 'J'].some(id => Math.abs(before.positions.get(id)!.y - after.positions.get(id)!.y) > 10),
        'existing boxes must reflow when a branch grows');
});

test('whole descendant subtrees occupy separate vertical bands after expansion', () => {
    const pairs = [['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'G'], ['D', 'I'], ['I', 'J'],
        ['E', 'K'], ['K', 'L'], ['K', 'M'], ['M', 'N']];
    const snapshot = graph(pairs, 'D'), result = layoutGraph(snapshot);
    assertGeometry(snapshot, result);
    const upper = ['E', 'F', 'G', 'K', 'L', 'M', 'N'].map(id => result.positions.get(id)!);
    const lower = ['I', 'J'].map(id => result.positions.get(id)!);
    assert.ok(Math.max(...upper.map(p => p.y + H)) + 40 <= Math.min(...lower.map(p => p.y)),
        'space is reserved for all descendants of E before placing the I/J branch');
});

test('fan-out and fan-in use aligned shared spines and uninterrupted chains stay horizontal', () => {
    const snapshot = graph([['caller', 'root'], ['root', 'A'], ['root', 'B'], ['root', 'C']], 'root');
    const result = layoutGraph(snapshot);
    const spines = snapshot.edges.filter(edge => edge.from === 'root').map(edge => result.routes.get(edgeKey(edge))!.points[1][0]);
    assert.equal(new Set(spines).size, 1);
    const incoming = graph([['A', 'root'], ['B', 'root'], ['C', 'root']], 'root');
    const left = layoutGraph(incoming);
    assert.equal(new Set(incoming.edges.map(edge => left.routes.get(edgeKey(edge))!.points[1][0])).size, 1);
    const shared = graph([['TEST_F', 'Execute'], ['main', 'Execute'], ['Execute', 'ExecuteOne'], ['ExecuteOne', 'Move'],
        ['Move', 'Inside'], ['main', 'Init'], ['TEST', 'Init'], ['Init', 'Inside']], 'Inside');
    const aligned = layoutGraph(shared);
    assertGeometry(shared, aligned);
    assert.equal(aligned.positions.get('Execute')!.y, aligned.positions.get('ExecuteOne')!.y);
    assert.equal(aligned.positions.get('ExecuteOne')!.y, aligned.positions.get('Move')!.y);
});
