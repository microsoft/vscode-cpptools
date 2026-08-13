/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * -------------------------------------------------------------------------------------------- */

import { deepStrictEqual } from 'assert';
import { describe, it } from 'mocha';
import { collectAccessSpecifierFoldingRanges } from '../../src/LanguageServer/Providers/foldingRangeUtils';

function toRangeTuples(text: string): [number, number][] {
    return collectAccessSpecifierFoldingRanges(text).map(range => [range.start, range.end]);
}

describe('Access specifier folding', () => {
    it('creates fold ranges for public/protected/private sections', () => {
        const source = [
            'class A',
            '{',
            'public:',
            '    void foo();',
            'private:',
            '    int value;',
            'protected:',
            '    void bar();',
            '};'
        ].join('\n');

        deepStrictEqual(toRangeTuples(source), [
            [2, 3],
            [4, 5],
            [6, 7]
        ]);
    });
});
