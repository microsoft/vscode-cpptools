/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * -------------------------------------------------------------------------------------------- */

import { deepStrictEqual } from 'assert';
import { describe, it } from 'mocha';
import { collectAccessSpecifierFoldingRanges, mergeFoldingRangesWithLimit } from '../../src/LanguageServer/Providers/foldingRangeUtils';

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

    it('respects rangeLimit when merging ranges', () => {
        const primary = [
            { start: 0, end: 1 },
            { start: 2, end: 3 }
        ];
        const secondary = [
            { start: 4, end: 5 },
            { start: 6, end: 7 }
        ];

        deepStrictEqual(mergeFoldingRangesWithLimit(primary, secondary, 3), [
            { start: 0, end: 1 },
            { start: 2, end: 3 },
            { start: 4, end: 5 }
        ]);
    });

    it('returns all merged ranges when rangeLimit is undefined', () => {
        const primary = [{ start: 10, end: 20 }];
        const secondary = [{ start: 30, end: 40 }];

        deepStrictEqual(mergeFoldingRangesWithLimit(primary, secondary, undefined), [
            { start: 10, end: 20 },
            { start: 30, end: 40 }
        ]);
    });

    it('ignores access-specifier-like lines and braces inside multiline raw strings', () => {
        const source = [
            'class A',
            '{',
            'public:',
            '    const char* text = R"raw(',
            'private:',
            '}',
            ')raw";',
            '    void foo();',
            'private:',
            '    int value;',
            '};'
        ].join('\n');

        deepStrictEqual(toRangeTuples(source), [
            [2, 7],
            [8, 9]
        ]);
    });

    it('detects class declarations with same-line template prefix', () => {
        const source = [
            'template<typename T> class A',
            '{',
            'public:',
            '    void foo();',
            'private:',
            '    int value;',
            '};'
        ].join('\n');

        deepStrictEqual(toRangeTuples(source), [
            [2, 3],
            [4, 5]
        ]);
    });
});
