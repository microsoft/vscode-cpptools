/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// The column range and text of the expression a debug data-tip should evaluate.
export interface EvaluatableExpressionInfo {
    readonly startColumn: number;
    readonly endColumn: number;
    readonly expression: string;
}

// Computes the expression a debug data-tip should evaluate for the token at `character` in `line`,
// or undefined when the cursor is not on an expression token.
//
// Registering an EvaluatableExpressionProvider replaces VS Code's built-in data-tip expression
// detection, so this reproduces that detection for ordinary tokens and additionally resolves access
// chains involving a leading `*`/`&` or array subscripts, which the built-in detection mishandles:
//   - A leading `*`/`&` applies to the whole access chain (the postfix `.`, `->`, `[]` operators
//     bind tighter). It is dropped for an interior member of a `.` chain, where e.g. `*a.b` would
//     dereference the struct `a.b`, and kept on the final segment and before `->`.
//   - Array subscripts are part of the chain, so `[...]` is kept in the token; hovering `c` in
//     `a.b[i].c` evaluates `a.b[i].c` rather than a fragment after the `]`.
//
// This has no vscode dependency so it can be unit tested directly.
export function computeEvaluatableExpression(line: string, character: number): EvaluatableExpressionInfo | undefined {
    // An optional leading run of `*`/`&`, then a chain of identifiers, `.`, `->`, `::` and non-nested
    // `[...]` subscripts.
    const tokenRegExp: RegExp = /(?:[*&]+)?(?:[\p{L}\p{N}_]|->|::|\.|\[[^\][]*\])+/gu;
    let token: RegExpExecArray | null = null;
    for (let m: RegExpExecArray | null = tokenRegExp.exec(line); m !== null; m = tokenRegExp.exec(line)) {
        // Upper bound is inclusive to match VS Code's built-in detection, which selects a token when
        // the cursor is at its trailing edge.
        if (m.index <= character && character <= m.index + m[0].length) {
            token = m;
            break;
        }
    }
    if (token === null) {
        return undefined;
    }
    const tokenStart: number = token.index;
    const tokenEnd: number = token.index + token[0].length;
    const leading: RegExpMatchArray | null = token[0].match(/^[*&]+/);
    const exprStart: number = tokenStart + (leading !== null ? leading[0].length : 0);

    // A token can begin with a `.` or `->` when the head of the expression was skipped by the
    // tokenizer (e.g. a call: `foo().bar` yields `.bar`). Such a fragment is not a valid
    // expression, so decline it rather than returning something the debugger cannot evaluate.
    if (line[exprStart] === '.' || (line[exprStart] === '-' && line[exprStart + 1] === '>')) {
        return undefined;
    }

    // On a subscript bracket, evaluate the element through that subscript without a leading `*`/`&`,
    // i.e. the indexed element itself.
    const cursorChar: string = line.charAt(character);
    if (cursorChar === '[' || cursorChar === ']') {
        let end: number = character;
        if (cursorChar === '[') {
            while (end < tokenEnd && line.charAt(end) !== ']') {
                end++;
            }
        }
        const subEnd: number = Math.min(end + 1, tokenEnd);
        return { startColumn: exprStart, endColumn: subEnd, expression: line.substring(exprStart, subEnd) };
    }

    // Locate the identifier under the cursor and the offset just past it.
    let clipEnd: number = tokenEnd;
    let wordStart: number = tokenStart;
    let word: string = '';
    const wordRegExp: RegExp = /[\p{L}\p{N}_]+/gu;
    for (let w: RegExpExecArray | null = wordRegExp.exec(token[0]); w !== null; w = wordRegExp.exec(token[0])) {
        clipEnd = tokenStart + w.index + w[0].length;
        wordStart = tokenStart + w.index;
        word = w[0];
        if (clipEnd >= character) {
            break;
        }
    }

    // An identifier inside a `[...]` is the index; it is evaluated on its own, not as part of the
    // surrounding access chain.
    const beforeCursor: string = line.substring(tokenStart, character);
    const openCount: number = (beforeCursor.match(/\[/g) || []).length;
    const closeCount: number = (beforeCursor.match(/\]/g) || []).length;
    if (openCount > closeCount) {
        // Inside `[...]` the token also spans whitespace and operators (e.g. `a[i + j]`), so the
        // nearest identifier is only the index when the cursor is actually on it; otherwise the
        // cursor is not on a token.
        if (character < wordStart || character > clipEnd) {
            return undefined;
        }
        return { startColumn: wordStart, endColumn: clipEnd, expression: word };
    }

    // The leading `*`/`&` is dropped only for an interior member directly followed by `.`, because
    // `.` is the only connector whose left operand is not provably a pointer/array, so keeping it
    // (`*a.b`) would dereference a struct and error. Before `->` or `[]`, or at the end of the
    // chain, the left operand is a pointer/array, so the leading operator stays valid and is kept
    // to match the built-in keep-leading-and-clip-right behavior. This is deliberate for `*ptr->m`
    // and likewise for `*a.b[i]` and `&a[i]`, which evaluate without error (the array decays)
    // though they show the element/address rather than the hovered operand.
    if (leading === null || clipEnd >= tokenEnd || clipEnd <= exprStart || line.charAt(clipEnd) !== '.') {
        return { startColumn: tokenStart, endColumn: clipEnd, expression: line.substring(tokenStart, clipEnd) };
    }
    return { startColumn: exprStart, endColumn: clipEnd, expression: line.substring(exprStart, clipEnd) };
}
