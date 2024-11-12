/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ok } from 'assert';
import { describe } from 'mocha';
import { matchesSection } from '../../src/LanguageServer/editorConfig';

describe('Test editorConfig section pattern matching', () => {
    const editorConfigPath = "/project";

    it('matchesSection test: *', () => {
        const pattern = "*";
        const filePath = "/project/subdir/file.cpp";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);
    });

    it('matchesSection test: *.cpp', () => {
        const pattern = "*.cpp";
        const filePath = "/project/subdir/file.cpp";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);
    });

    it('matchesSection test: subdir/*.c', () => {
        const pattern: string = "subdir/*.c";

        let filePath: string = "/project/subdir/file.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/file.cpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/file.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/other/subdir/file.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: ????.cpp', () => {
        const pattern = "????.cpp";

        let filePath: string = "/project/subdir/file.cpp";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/file2.cpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/x.cpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: [abc].c', () => {
        const pattern = "[abc].c";

        let filePath: string = "/project/subdir/a.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/z.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: [!abc].c', () => {
        const pattern = "[!abc].c";

        let filePath: string = "/project/subdir/a.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/z.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);
    });

    it('matchesSection test: test.{c, h, cpp}', () => {
        const pattern = "test.{c, h, cpp}";

        let filePath: string = "/project/subdir/test.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test.h";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test.cpp";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test.hpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);
    });

    it('matchesSection test: test{1..3}.c', () => {
        const pattern = "test{1..3}.c";

        let filePath: string = "/project/subdir/test1.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test2.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test3.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test4.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test0.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test01.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test00.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: test{0..100}.c', () => {
        const pattern = "test{0..100}.c";

        let filePath: string = "/project/subdir/test0.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test100.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test5.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test50.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test00.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test050.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test101.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test-1.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test1000.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test500.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: test{10..1000}.c', () => {
        const pattern = "test{10..1000}.c";

        let filePath: string = "/project/subdir/test10.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test100.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test100.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test1001.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: test{0..101}.c', () => {
        const pattern = "test{0..101}.c";

        let filePath: string = "/project/subdir/test0.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test10.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test100.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test100.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test101.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test102.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: test{0..456}.c', () => {
        const pattern = "test{0..456}.c";

        let filePath: string = "/project/subdir/test0.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test400.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test450.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test456.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test457.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test460.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test500.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: test{123..456}.c', () => {
        const pattern = "test{123..456}.c";

        let filePath: string = "/project/subdir/test123.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test299.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test456.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test12.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test122.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test457.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test-123.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: test{123..456}0.c', () => {
        const pattern = "test{123..456}0.c";

        let filePath: string = "/project/subdir/test1230.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test2990.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test4560.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test12.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test120.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test1220.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test4570.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test-1230.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test123.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: test{123..45678}.c', () => {
        const pattern = "test{123..45678}.c";

        let filePath: string = "/project/subdir/test123.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test999.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test9999.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test45678.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/test12.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test45679.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test123x.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/subdir/test-9999.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: *.{c, h, cpp}', () => {
        const pattern = "*.{c, h, cpp}";

        let filePath: string = "/project/subdir/a.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/other/subdir/b.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/c.h";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/subdir/d.cpp";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/a.c/other";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: src/{test, lib}/**', () => {
        const pattern = "src/{test, lib}/**";

        let filePath: string = "/project/src/test/subdir/test.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/src/test/test.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/src/lib/test.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/src/other/test.cpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/other/src/test/test.c";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });

    it('matchesSection test: src/{test, lib}/**/*.{c, h, cpp}', () => {
        const pattern = "src/{test, lib}/**/*.{c, h, cpp}";

        let filePath: string = "/project/src/test/subdir/test.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/src/test/test.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/src/lib/test.c";
        ok(matchesSection(editorConfigPath, filePath, pattern), `${pattern} should match: ${filePath}`);

        filePath = "/project/src/other/test.cpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/other/src/test/test.hpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/src/test/subdir/test.hpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/src/test/test.hpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);

        filePath = "/project/src/lib/test.hpp";
        ok(!matchesSection(editorConfigPath, filePath, pattern), `${pattern} should not match: ${filePath}`);
    });
});
