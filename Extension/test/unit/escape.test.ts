/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { deepStrictEqual, doesNotMatch, match, ok, strictEqual } from 'node:assert';
import { escapePathForSquiggles, getTextMatchOffsets } from '../../src/Utility/Text/escape';

describe('Text escaping', () => {
    it('escapes paths for matching their JSON spelling', () => {
        strictEqual(escapePathForSquiggles('"'), '\\\\"');
        strictEqual(escapePathForSquiggles('\\'), '\\\\');
        strictEqual(escapePathForSquiggles('.*'), '\\.\\*');

        const parsedPath: string = String.raw`C:\src"quoted"`;
        const sourcePath: string = String.raw`C:\src\"quoted\"`;
        const pattern: RegExp = new RegExp(`^${escapePathForSquiggles(parsedPath)}$`);
        match(sourcePath, pattern);
        doesNotMatch(parsedPath, pattern);
    });

    it('handles repeated backslashes and regex metacharacters', () => {
        const parsedPath: string = String.raw`C:\\sdk\\[headers]+(x)?.h\\say"hello"and"goodbye`;
        const sourcePath: string = String.raw`C:\\sdk\\[headers]+(x)?.h\\say\"hello\"and\"goodbye`;
        const pattern: RegExp = new RegExp(`^${escapePathForSquiggles(parsedPath)}$`);

        match(sourcePath, pattern);
        doesNotMatch(String.raw`C:\sdk\[headers]+(x)?.h\say\"hello\"and\"goodbye`, pattern);
        doesNotMatch(String.raw`C:\\sdk\\headers+(x)?.h\\say\"hello\"and\"goodbye`, pattern);
    });

    it('uses the full source match for a non-first semicolon-delimited path', () => {
        const parsedPath: string = 'second';
        const sourceMatch: string = '"first;second;third"';
        const text: string = `"includePath": [${sourceMatch}]`;
        const pattern: RegExp = new RegExp(`"[^"]*?(?<="|;)${escapePathForSquiggles(parsedPath)}(?="|;).*?"`, 'g');
        const matches: string[] | null = text.match(pattern);

        ok(matches);
        strictEqual(matches?.[0], sourceMatch);
        const startOffset: number = text.indexOf(sourceMatch);
        deepStrictEqual(getTextMatchOffsets(text, matches[0]), [startOffset, startOffset + sourceMatch.length]);
    });

    it('uses the JSON source length when it differs from the parsed path', () => {
        const parsedPath: string = 'folder"quoted"';
        const sourceMatch: string = String.raw`"folder\"quoted\""`;
        const text: string = `"includePath": [${sourceMatch}]`;
        const pattern: RegExp = new RegExp(`"[^"]*?(?<="|;)${escapePathForSquiggles(parsedPath)}(?="|;).*?"`, 'g');
        const matches: string[] | null = text.match(pattern);

        ok(matches);
        strictEqual(matches?.[0], sourceMatch);
        const startOffset: number = text.indexOf(sourceMatch);
        deepStrictEqual(getTextMatchOffsets(text, matches[0]), [startOffset, startOffset + sourceMatch.length]);
    });
});
