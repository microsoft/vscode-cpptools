/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { deepStrictEqual, equal } from 'node:assert';
import { afterEach, describe, it } from 'mocha';
import {
    classifyFilePath,
    hasNativeFileTypeMappings,
    isTagParsableFile,
    resetFileTypeMappings,
    updateFileTypeMappings
} from '../../src/fileType';

describe('file type mappings', () => {
    afterEach(() => resetFileTypeMappings());

    it('uses legacy classifications before native initialization', () => {
        equal(hasNativeFileTypeMappings(), false);
        deepStrictEqual(classifyFilePath('file.hpp'), { name: '.hpp', kind: 'header', language: 'cpp' });
        deepStrictEqual(classifyFilePath('file.C'), { name: '.C', kind: 'source', language: 'cpp' });
        deepStrictEqual(classifyFilePath('Makefile'), { name: '', kind: 'header' });
    });

    it('atomically replaces bootstrap mappings with native mappings', () => {
        updateFileTypeMappings({
            extensions: [
                { name: '.c', kind: 'source', language: 'c' },
                { name: '.cppm', kind: 'source', language: 'cpp' },
                { name: '.h', kind: 'header', language: 'cpp' },
                { name: '.idl', kind: 'idl' }
            ],
            filenames: [
                { name: 'foo.h', kind: 'source', language: 'c' },
                { name: 'vector', kind: 'header' },
                { name: 'kernel.custom', kind: 'source', language: 'cuda' }
            ]
        });

        equal(hasNativeFileTypeMappings(), true);
        deepStrictEqual(classifyFilePath('module.CPPM'), { name: '.cppm', kind: 'source', language: 'cpp' });
        deepStrictEqual(classifyFilePath('file.C'), { name: '.C', kind: 'source', language: 'cpp' });
        deepStrictEqual(classifyFilePath('foo.h'), { name: 'foo.h', kind: 'source', language: 'c' });
        deepStrictEqual(classifyFilePath('VECTOR'), { name: 'vector', kind: 'header' });
        deepStrictEqual(classifyFilePath('kernel.custom'), { name: 'kernel.custom', kind: 'source', language: 'cuda' });
        equal(classifyFilePath('Makefile'), undefined);
        equal(isTagParsableFile('schema.idl'), true);
        equal(isTagParsableFile('kernel.custom'), true);
        equal(isTagParsableFile('vector'), true);
        equal(isTagParsableFile('unknown.txt'), false);
    });

    it('uses the editor language only for unregistered paths', () => {
        updateFileTypeMappings({
            extensions: [{ name: '.h', kind: 'header', language: 'cpp' }],
            filenames: []
        });

        deepStrictEqual(classifyFilePath('file.h', 'c'), { name: '.h', kind: 'header', language: 'cpp' });
        deepStrictEqual(classifyFilePath('file.special', 'c'), { name: '', kind: 'source', language: 'c' });
        deepStrictEqual(classifyFilePath('file.special', 'cuda-cpp'), { name: '', kind: 'source', language: 'cuda' });
    });
});
