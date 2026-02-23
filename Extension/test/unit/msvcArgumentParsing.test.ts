/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { deepEqual } from 'assert';
import { describe, it } from 'mocha';
import { extractIncludePathsFromArgs } from '../../src/Utility/msvcFlags';


describe('MSVC Argument Parsing', () => {
    it('extracts /I paths', () => {
        const args = ['/I', 'C:\\path1', '/IC:\\path2', '-I', 'C:\\path3', '-IC:\\path4'];
        const result = extractIncludePathsFromArgs(args);
        deepEqual(result.includePaths, ['C:\\path1', 'C:\\path2', 'C:\\path3', 'C:\\path4']);
    });

    it('extracts /imsvc paths', () => {
        const args = ['/imsvc', 'C:\\sys1', '/imsvcC:\\sys2', '-imsvc', 'C:\\sys3', '-imsvcC:\\sys4'];
        const result = extractIncludePathsFromArgs(args);
        deepEqual(result.externalIncludePaths, ['C:\\sys1', 'C:\\sys2', 'C:\\sys3', 'C:\\sys4']);
    });

    it('extracts /external:I paths', () => {
        const args = ['/external:I', 'C:\\ext1', '/external:IC:\\ext2', '-external:I', 'C:\\ext3', '-external:IC:\\ext4'];
        const result = extractIncludePathsFromArgs(args);
        deepEqual(result.externalIncludePaths, ['C:\\ext1', 'C:\\ext2', 'C:\\ext3', 'C:\\ext4']);
    });

    it('extracts /external:var variables', () => {
        const args = ['/external:var:MYVAR', '-external:var:OTHERVAR'];
        const result = extractIncludePathsFromArgs(args);
        deepEqual(result.externalIncludeVars, ['MYVAR', 'OTHERVAR']);
    });

    it('handles mixed flags', () => {
        const args = ['/I', 'p1', '/external:I', 'p2', '/external:var:v1', '/imsvc', 'p3'];
        const result = extractIncludePathsFromArgs(args);
        deepEqual(result.includePaths, ['p1']);
        deepEqual(result.externalIncludePaths, ['p2', 'p3']);
        deepEqual(result.externalIncludeVars, ['v1']);
    });

    it('handles empty/incomplete flags', () => {
        const args = ['/I', '/external:I', '/external:var:'];
        const result = extractIncludePathsFromArgs(args);
        deepEqual(result.includePaths, []);
        deepEqual(result.externalIncludePaths, []);
        deepEqual(result.externalIncludeVars, []);
    });
});
