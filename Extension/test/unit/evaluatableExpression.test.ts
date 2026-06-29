/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { strictEqual } from 'node:assert';
import { computeEvaluatableExpression } from '../../src/Debugger/evaluatableExpression';

// In each input the `|` marks the cursor; it is removed (at that single index) before evaluating.
function evaluate(marked: string): string | undefined {
    const character: number = marked.indexOf('|');
    const line: string = marked.slice(0, character) + marked.slice(character + 1);
    return computeEvaluatableExpression(line, character)?.expression;
}

describe('computeEvaluatableExpression', () => {
    it('returns undefined when the cursor is not on a token', () => {
        strictEqual(evaluate('a + | b'), undefined);
    });

    it('evaluates a plain identifier', () => {
        strictEqual(evaluate('|x'), 'x');
    });

    it('drops a leading * for an interior member of a dot chain', () => {
        strictEqual(evaluate('*|a.b.c'), 'a');
        strictEqual(evaluate('*a.|b.c'), 'a.b');
    });

    it('keeps a leading * on the final member', () => {
        strictEqual(evaluate('*a.b.|c'), '*a.b.c');
    });

    it('drops a leading * on an interior member before -> and keeps it on the final member', () => {
        strictEqual(evaluate('*|ptr->member'), 'ptr');
        strictEqual(evaluate('*ptr->|member'), '*ptr->member');
    });

    it('drops a leading * before a subscript (the array base is not the dereferenced value)', () => {
        strictEqual(evaluate('*a.|b[i]'), 'a.b');
        strictEqual(evaluate('*dbbolz.|nullzwang_ok[DBBOLZ_A_AUS]'), 'dbbolz.nullzwang_ok');
    });

    it('drops a leading & so the variable shows its value, not its address', () => {
        strictEqual(evaluate('&|nullzwang_ok'), 'nullzwang_ok');
        strictEqual(evaluate('&a.b.|c'), 'a.b.c');
    });

    it('leaves -> chains without a leading operator unchanged', () => {
        strictEqual(evaluate('p->|q->r'), 'p->q');
        strictEqual(evaluate('p->q->|r'), 'p->q->r');
    });

    it('keeps array subscripts in the chain', () => {
        strictEqual(evaluate('a.|b[i].c'), 'a.b');
        strictEqual(evaluate('a.b[i].|c'), 'a.b[i].c');
        strictEqual(evaluate('dbbolz.dbbolz_anst[out_idx].|anw_dig'), 'dbbolz.dbbolz_anst[out_idx].anw_dig');
        strictEqual(evaluate('dbbolz.dbbolz_anst[out_idx].anw_dig.|stsdig'), 'dbbolz.dbbolz_anst[out_idx].anw_dig.stsdig');
    });

    it('evaluates the element when on a subscript bracket, without the leading operator', () => {
        strictEqual(evaluate('a.b|[i].c'), 'a.b[i]');
        strictEqual(evaluate('a.b[i|].c'), 'a.b[i]');
        strictEqual(evaluate('&dbbolz.dbbolz_anst[out_idx].fg|[kanal_idx]'), 'dbbolz.dbbolz_anst[out_idx].fg[kanal_idx]');
    });

    it('evaluates the index on its own when inside a subscript', () => {
        strictEqual(evaluate('a.b[|i].c'), 'i');
        strictEqual(evaluate('&dbbolz.dbbolz_anst[out_idx].fg[|kanal_idx]'), 'kanal_idx');
    });

    it('keeps :: scoped names together', () => {
        strictEqual(evaluate('ns::|var'), 'ns::var');
        strictEqual(evaluate('ns::var::|z'), 'ns::var::z');
    });

    it('returns undefined for a fragment that begins with a connector', () => {
        // The head of the expression (a call) is skipped by the tokenizer, leaving a `.`/`->` start.
        strictEqual(evaluate('foo().|bar'), undefined);
        strictEqual(evaluate('obj->fn()->|field'), undefined);
        strictEqual(evaluate('(*this).|member'), undefined);
    });

    it('returns undefined when the cursor is on an operator or space inside a subscript', () => {
        strictEqual(evaluate('a[i |+ j].c'), undefined);
        strictEqual(evaluate('a[i +| j].c'), undefined);
        strictEqual(evaluate('a[i +|j].c'), 'j');
        strictEqual(evaluate('a[i|+1].c'), undefined);
    });

    it('treats nested subscripts as balanced brackets', () => {
        strictEqual(evaluate('a|[b[i]]'), 'a[b[i]]');
        strictEqual(evaluate('a[b|[i]]'), 'b[i]');
        strictEqual(evaluate('a[b[|i]]'), 'i');
        strictEqual(evaluate('a[b[i]|]'), 'a[b[i]]');
    });

    it('keeps a trailing subscript whole when hovering past the last identifier', () => {
        strictEqual(evaluate('a[i]|'), 'a[i]');
        strictEqual(evaluate('*a.b[i]|'), '*a.b[i]');
    });

    it('keeps a leading * on a final subscript element but drops it on an interior one', () => {
        strictEqual(evaluate('*a.b|[i]'), '*a.b[i]');
        strictEqual(evaluate('*a.b[i|]'), '*a.b[i]');
        strictEqual(evaluate('*a.b|[i].c'), 'a.b[i]');
        strictEqual(evaluate('&a|[i]'), 'a[i]');
    });

    it('does not grab the whole element when hovering an interior connector', () => {
        strictEqual(evaluate('*x|.y[i]'), 'x');
        strictEqual(evaluate('*dbbolz|.nullzwang_ok[DBBOLZ_A_AUS]'), 'dbbolz');
    });
});
