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

    it('uses case-sensitive legacy classifications when configured', () => {
        resetFileTypeMappings(true);

        equal(hasNativeFileTypeMappings(), false);
        deepStrictEqual(classifyFilePath('file.hpp'), { name: '.hpp', kind: 'header', language: 'cpp' });
        deepStrictEqual(classifyFilePath('file.C'), { name: '.C', kind: 'source', language: 'cpp' });
        deepStrictEqual(classifyFilePath('file.c'), { name: '.c', kind: 'source', language: 'c' });
        for (const extension of ['ccm', 'cppm', 'hip', 'ixx', 'sycl']) {
            deepStrictEqual(classifyFilePath(`file.${extension}`), { name: `.${extension}`, kind: 'source', language: 'cpp' });
            equal(isTagParsableFile(`file.${extension}`), true);
        }
        equal(classifyFilePath('file.CPPM'), undefined);
        equal(isTagParsableFile('file.CPPM'), false);
        deepStrictEqual(classifyFilePath('Makefile'), { name: '', kind: 'header' });
    });

    it('uses case-insensitive legacy classifications when configured', () => {
        resetFileTypeMappings(false);

        for (const extension of ['HPP', 'CCM', 'CPPM', 'HIP', 'IXX', 'SYCL']) {
            equal(isTagParsableFile(`file.${extension}`), true);
        }
        deepStrictEqual(classifyFilePath('file.C'), { name: '.C', kind: 'source', language: 'cpp' });
        deepStrictEqual(classifyFilePath('file.c'), { name: '.c', kind: 'source', language: 'c' });
    });

    it('atomically replaces bootstrap mappings with native mappings', () => {
        resetFileTypeMappings(false);
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

    it('preserves exact mapping case when configured', () => {
        resetFileTypeMappings(true);
        updateFileTypeMappings({
            extensions: [
                { name: '.c', kind: 'source', language: 'c' },
                { name: '.cppm', kind: 'source', language: 'cpp' }
            ],
            filenames: [{ name: 'vector', kind: 'header' }]
        });

        deepStrictEqual(classifyFilePath('file.C'), { name: '.C', kind: 'source', language: 'cpp' });
        deepStrictEqual(classifyFilePath('file.c'), { name: '.c', kind: 'source', language: 'c' });
        equal(classifyFilePath('file.CPPM'), undefined);
        equal(classifyFilePath('VECTOR'), undefined);
    });

    it('uses the editor language only for unregistered paths', () => {
        updateFileTypeMappings({
            extensions: [{ name: '.h', kind: 'header', language: 'cpp' }],
            filenames: []
        }, true);

        deepStrictEqual(classifyFilePath('file.h', 'c'), { name: '.h', kind: 'header', language: 'cpp' });
        deepStrictEqual(classifyFilePath('file.special', 'c'), { name: '', kind: 'source', language: 'c' });
        deepStrictEqual(classifyFilePath('file.special', 'cuda-cpp'), { name: '', kind: 'source', language: 'cuda' });
    });
});
