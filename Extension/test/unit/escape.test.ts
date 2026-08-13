/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { doesNotMatch, match, strictEqual } from 'node:assert';
import { escapePathForSquiggles } from '../../src/Utility/Text/escape';

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
});
