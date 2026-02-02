/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it } from 'mocha';
import { fail, ok, strictEqual } from 'node:assert';
import { accumulator } from '../../src/Utility/Async/iterators';

describe('Async Iterators', () => {
    it('Use the accumulator() for async iterators (empty, manual close)', async () => {
        const result = accumulator<string>();
        setTimeout(() => result.complete(), 5);
        for await (const _each of result) {
            fail('should not have gotten here');
        }

        ok(true, 'should have gotten here');

    });

    it('Use the accumulator() for async iterators (add some items)', async () => {
        let total = 0;
        let count = 0;

        // asyncOf takes any number of arguments, and flattens values, iterables, promises, and async iterables into a single async iterable.
        // (good for testing)

        const result = accumulator(0).autoComplete(false); // create an iterable with a single item.

        result.add(1, 2, 3); // add more items
        result.add(-10, 10); // add more items

        setTimeout(() => result.add(4, 5, 6), 5); // set a timeout to add more items again.
        setTimeout(() => result.complete(), 11); // set a timeout to tell it you won't add more iterables.

        for await (const each of result) {
            count++;
            total += each;
        }

        strictEqual(total, 21, 'The total should be 21');
        strictEqual(count, 8, 'The count should be 8');
        ok(true, 'should have gotten here');

    });
});
