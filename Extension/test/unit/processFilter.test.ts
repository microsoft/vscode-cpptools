/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { deepStrictEqual, strictEqual, throws } from 'assert';
import { describe, it } from 'mocha';
import { filterProcessItems } from '../../src/Debugger/processFilter';

interface TestProcessItem {
    label?: string;
    description?: string;
    detail?: string;
    id: string;
}

describe('Remote attach process filter', () => {
    const processes: TestProcessItem[] = [
        { id: '101', label: 'root /usr/bin/my-daemon --serve', description: '101' },
        { id: '102', label: 'root /usr/bin/other-service', description: '102', detail: 'worker' },
        { id: '103', label: 'app /usr/bin/my-daemon --once', description: '103' }
    ];

    it('returns undefined when filter is empty', () => {
        strictEqual(filterProcessItems(processes, ''), undefined);
        strictEqual(filterProcessItems(processes, '   '), undefined);
        strictEqual(filterProcessItems(processes, undefined), undefined);
    });

    it('returns undefined when filter is not a string', () => {
        strictEqual(filterProcessItems(processes, 1234), undefined);
        strictEqual(filterProcessItems(processes, true), undefined);
        strictEqual(filterProcessItems(processes, {}), undefined);
    });

    it('matches by label and description and detail', () => {
        deepStrictEqual(filterProcessItems(processes, 'other-service')?.map(p => p.id), ['102']);
        deepStrictEqual(filterProcessItems(processes, '^101$')?.map(p => p.id), ['101']);
        deepStrictEqual(filterProcessItems(processes, 'worker')?.map(p => p.id), ['102']);
    });

    it('returns multiple matches when regex matches more than one process', () => {
        deepStrictEqual(filterProcessItems(processes, 'my-daemon')?.map(p => p.id), ['101', '103']);
    });

    it('throws for invalid regular expression', () => {
        throws(() => filterProcessItems(processes, '['), /Invalid processFilter regular expression/);
    });
});
