/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { ok, strictEqual } from 'assert';
import { describe } from 'mocha';
import { is } from '../../src/Utility/System/guards';
import { readKey } from '../../src/Utility/System/registry';
import { isWindows } from '../../src/constants';
import { when } from '../common/internal';

describe('Verify that registry access works', () => {
    when(isWindows).it('can read from the registry', async () => {
        const currentVersion = await readKey("HKLM", "SOFTWARE/Microsoft/Windows NT/CurrentVersion");
        ok(currentVersion, "Should return an object!");
        ok(is.string(currentVersion.properties.SystemRoot), "Should return a string for SystemRoot");
        strictEqual(currentVersion.properties.SystemRoot.toUpperCase(), "C:\\WINDOWS", "Should return the correct value for SystemRoot");
    });
});
