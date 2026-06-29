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

const wordChar: RegExp = /[\p{L}\p{N}_]/u;

function isWord(ch: string | undefined): boolean {
    return ch !== undefined && wordChar.test(ch);
}

// Index just past the `]` that closes the `[` at `open`, or -1 if it is unbalanced.
function matchingClose(line: string, open: number): number {
    let depth: number = 0;
    for (let j: number = open; j < line.length; j++) {
        if (line[j] === '[') {
            depth++;
        } else if (line[j] === ']') {
            depth--;
            if (depth === 0) {
                return j + 1;
            }
        }
    }
    return -1;
}

// Index of the `[` that opens the `]` at `close`, or -1 if it is unbalanced.
function matchingOpen(line: string, close: number): number {
    let depth: number = 0;
    for (let j: number = close; j >= 0; j--) {
        if (line[j] === ']') {
            depth++;
        } else if (line[j] === '[') {
            depth--;
            if (depth === 0) {
                return j;
            }
        }
    }
    return -1;
}

// Start of the access chain that the subscript opening at `open` applies to, without crossing
// `exprStart` or an enclosing (still-open) `[`.
function primaryStart(line: string, open: number, exprStart: number): number {
    let s: number = open;
    while (s > exprStart) {
        const prev: string = line[s - 1];
        if (isWord(prev)) {
            while (s > exprStart && isWord(line[s - 1])) {
                s--;
            }
        } else if (prev === '.') {
            s--;
        } else if (prev === '>' && line[s - 2] === '-') {
            s -= 2;
        } else if (prev === ':' && line[s - 2] === ':') {
            s -= 2;
        } else if (prev === ']') {
            const open2: number = matchingOpen(line, s - 1);
            if (open2 < exprStart) {
                break;
            }
            s = open2;
        } else {
            break;
        }
    }
    return s;
}

// Computes the expression a debug data-tip should evaluate for the token at `character` in `line`,
// or undefined when the cursor is not on an expression token.
//
// Registering an EvaluatableExpressionProvider replaces VS Code's built-in data-tip expression
// detection, so this reproduces that detection for ordinary tokens and additionally resolves access
// chains involving a leading `*`/`&` or array subscripts, which the built-in detection mishandles:
//   - A leading `*` is kept only when hovering the final segment of the chain (the value actually
//     dereferenced, e.g. `*a.b.c`); on any interior segment it is dropped, so hovering `b` in
//     `*a.b.c` gives `a.b` and hovering `b` in `*a.b[i]` gives `a.b` (not `*a.b`, the dereferenced
//     struct/array base). A leading `&` is always dropped so the hovered variable shows its value
//     rather than its address.
//   - Array subscripts are part of the chain, including nested ones like `a[b[i]]`; hovering `c` in
//     `a.b[i].c` evaluates `a.b[i].c` rather than a fragment after the `]`, hovering a subscript
//     bracket evaluates the indexed element, and hovering the index evaluates it on its own.
//
// This has no vscode dependency so it can be unit tested directly.
export function computeEvaluatableExpression(line: string, character: number): EvaluatableExpressionInfo | undefined {
    // Find the access-chain token containing the cursor: an optional leading run of `*`/`&`, then a
    // chain of identifiers, `.`, `->`, `::` and balanced `[...]` subscripts. Brackets are matched by
    // depth so nested subscripts stay in one token. The cursor is matched with an inclusive end so a
    // token is selected when the cursor is at its trailing edge (VS Code's built-in does the same).
    let tokenStart: number = -1;
    let tokenEnd: number = -1;
    const n: number = line.length;
    let i: number = 0;
    while (i < n) {
        const start: number = i;
        while (i < n && (line[i] === '*' || line[i] === '&')) {
            i++;
        }
        let chained: boolean = false;
        let advanced: boolean = true;
        while (i < n && advanced) {
            const c: string = line[i];
            if (isWord(c)) {
                while (i < n && isWord(line[i])) {
                    i++;
                }
                chained = true;
            } else if (c === '.') {
                i++;
                chained = true;
            } else if (c === '-' && line[i + 1] === '>') {
                i += 2;
                chained = true;
            } else if (c === ':' && line[i + 1] === ':') {
                i += 2;
                chained = true;
            } else if (c === '[') {
                const close: number = matchingClose(line, i);
                if (close === -1) {
                    advanced = false;
                } else {
                    i = close;
                    chained = true;
                }
            } else {
                advanced = false;
            }
        }
        if (chained && start <= character && character <= i) {
            tokenStart = start;
            tokenEnd = i;
            break;
        }
        i = chained && i > start ? i : start + 1;
    }
    if (tokenStart === -1) {
        return undefined;
    }

    const leadingMatch: RegExpMatchArray | null = line.substring(tokenStart, tokenEnd).match(/^[*&]+/u);
    const leading: string | null = leadingMatch !== null ? leadingMatch[0] : null;
    const exprStart: number = tokenStart + (leading !== null ? leading.length : 0);

    // A chain can begin with `.` or `->` when its head was skipped (e.g. a call: `foo().bar` leaves
    // `.bar`). Such a fragment is not a valid expression, so decline it.
    if (line[exprStart] === '.' || (line[exprStart] === '-' && line[exprStart + 1] === '>')) {
        return undefined;
    }

    // On a subscript bracket, evaluate the indexed element: the subscripted primary through that
    // subscript, without the leading `*`/`&`.
    const cursorChar: string = line.charAt(character);
    if (cursorChar === '[' || cursorChar === ']') {
        const open: number = cursorChar === '[' ? character : matchingOpen(line, character);
        const close: number = cursorChar === '[' ? matchingClose(line, character) : character + 1;
        if (open !== -1 && close !== -1) {
            let startColumn: number = Math.max(primaryStart(line, open, exprStart), exprStart);
            // Keep a leading `*` when the subscript is the final segment (the dereferenced
            // element, e.g. `*a.b[i]`); a leading `&`, or an interior subscript, drops it.
            if (close === tokenEnd && startColumn === exprStart && leading !== null && /^\*+$/u.test(leading)) {
                startColumn = tokenStart;
            }
            return { startColumn, endColumn: close, expression: line.substring(startColumn, close) };
        }
    }

    // Locate the identifier under the cursor and the offset just past it.
    let clipEnd: number = tokenEnd;
    let wordStart: number = tokenStart;
    let word: string = '';
    const wordRegExp: RegExp = /[\p{L}\p{N}_]+/gu;
    const tokenText: string = line.substring(tokenStart, tokenEnd);
    for (let w: RegExpExecArray | null = wordRegExp.exec(tokenText); w !== null; w = wordRegExp.exec(tokenText)) {
        clipEnd = tokenStart + w.index + w[0].length;
        wordStart = tokenStart + w.index;
        word = w[0];
        if (clipEnd >= character) {
            break;
        }
    }

    // An identifier inside a `[...]` is the index; it is evaluated on its own. Inside `[...]` the
    // chain also spans operators and whitespace (e.g. `a[i + j]`), so only return the identifier
    // when the cursor is actually on it; other positions are not tokens.
    let depth: number = 0;
    for (let k: number = tokenStart; k < character; k++) {
        if (line[k] === '[') {
            depth++;
        } else if (line[k] === ']') {
            depth--;
        }
    }
    if (depth > 0) {
        if (character < wordStart || character >= clipEnd) {
            return undefined;
        }
        return { startColumn: wordStart, endColumn: clipEnd, expression: word };
    }

    // Past the last identifier but still on the token's trailing `]` (or its inclusive trailing
    // edge), with no identifier left between the cursor and the end: evaluate the indexed
    // element, like hovering that closing bracket, so the clip never cuts a subscript in half.
    if (line.charAt(tokenEnd - 1) === ']' && !/[\p{L}\p{N}_]/u.test(line.substring(character, tokenEnd))) {
        const open: number = matchingOpen(line, tokenEnd - 1);
        if (open !== -1) {
            let startColumn: number = Math.max(primaryStart(line, open, exprStart), exprStart);
            if (startColumn === exprStart && leading !== null && /^\*+$/u.test(leading)) {
                startColumn = tokenStart;
            }
            return { startColumn, endColumn: tokenEnd, expression: line.substring(startColumn, tokenEnd) };
        }
    }

    // The leading `*`/`&` belongs to the final segment of the chain. A `*` is kept only when the
    // cursor is on that final segment (the value actually dereferenced, e.g. `*a.b.c`). On any
    // interior segment it is dropped, since `*a.b` would dereference the struct `a.b` and `*a.b[i]`
    // the array base rather than the indexed element. A leading `&` is always dropped so hovering
    // the variable shows its value, not its address.
    const keepLeading: boolean = leading !== null && clipEnd >= tokenEnd && /^\*+$/u.test(leading);
    if (!keepLeading) {
        return { startColumn: exprStart, endColumn: clipEnd, expression: line.substring(exprStart, clipEnd) };
    }
    return { startColumn: tokenStart, endColumn: clipEnd, expression: line.substring(tokenStart, clipEnd) };
}
