/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { getDebugAdapterEnvironment, isFileSizeLimitBelowDotnetMemfd } from '../../src/Debugger/debugAdapterEnvironment';

const limits = (maxFileSize: string): string =>
    'Limit                     Soft Limit           Hard Limit           Units     \n' +
    'Max cpu time              unlimited            unlimited            seconds   \n' +
    `Max file size             ${maxFileSize}             ${maxFileSize}             bytes     \n` +
    'Max data size             unlimited            unlimited            bytes     \n';

describe('Debug adapter environment', () => {
    it('detects a file size limit below 2 TiB', () => {
        strictEqual(isFileSizeLimitBelowDotnetMemfd(limits('25769803776')), true); // ulimit -f 25165824 (KiB)
        strictEqual(isFileSizeLimitBelowDotnetMemfd(limits('2199023255551')), true);
    });

    it('does not trigger for unlimited, 2 TiB or more, or unparsable input', () => {
        strictEqual(isFileSizeLimitBelowDotnetMemfd(limits('unlimited')), false);
        strictEqual(isFileSizeLimitBelowDotnetMemfd(limits('2199023255552')), false);
        strictEqual(isFileSizeLimitBelowDotnetMemfd(''), false);
        strictEqual(isFileSizeLimitBelowDotnetMemfd('Max cpu time unlimited unlimited seconds'), false);
    });

    it('disables the .NET W^X double mapping only on Linux with a low limit', () => {
        deepStrictEqual(getDebugAdapterEnvironment('linux', {}, limits('25769803776')), { DOTNET_EnableWriteXorExecute: '0' });
        strictEqual(getDebugAdapterEnvironment('linux', {}, limits('unlimited')), undefined);
        strictEqual(getDebugAdapterEnvironment('linux', {}, undefined), undefined);
        strictEqual(getDebugAdapterEnvironment('darwin', {}, limits('25769803776')), undefined);
        strictEqual(getDebugAdapterEnvironment('win32', {}, limits('25769803776')), undefined);
    });

    it('keeps a value the user already set', () => {
        strictEqual(getDebugAdapterEnvironment('linux', { DOTNET_EnableWriteXorExecute: '1' }, limits('25769803776')), undefined);
    });
});
