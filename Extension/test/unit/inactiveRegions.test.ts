/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import { suite, test } from 'mocha';
import { getInactiveRegionStartLines, InactiveRegion, InactiveRegionStore } from '../../src/LanguageServer/inactiveRegions';

suite("InactiveRegionStore", () => {
    const uri: string = "file:///source.cpp";
    const firstRegion: InactiveRegion = {
        startLine: 2,
        startColumn: 0,
        endLine: 4,
        endColumn: 0
    };
    const secondRegion: InactiveRegion = {
        startLine: 8,
        startColumn: 0,
        endLine: 10,
        endColumn: 0
    };

    test("returns regions only after a complete pass", () => {
        const store: InactiveRegionStore = new InactiveRegionStore();

        store.update(uri, [firstRegion], true, false);
        assert.strictEqual(store.getComplete(uri), undefined);

        store.update(uri, [secondRegion], false, true);
        assert.deepStrictEqual(store.getComplete(uri), [firstRegion, secondRegion]);
    });

    test("replaces regions when a new pass starts", () => {
        const store: InactiveRegionStore = new InactiveRegionStore();
        store.update(uri, [firstRegion], true, true);

        store.update(uri, [secondRegion], true, true);

        assert.deepStrictEqual(store.getComplete(uri), [secondRegion]);
    });

    test("deletes cached regions", () => {
        const store: InactiveRegionStore = new InactiveRegionStore();
        store.update(uri, [firstRegion], true, true);

        store.delete(uri);

        assert.strictEqual(store.getComplete(uri), undefined);
    });

    test("returns sorted unique start lines", () => {
        assert.deepStrictEqual(getInactiveRegionStartLines([secondRegion, firstRegion, secondRegion]), [2, 8]);
    });
});
