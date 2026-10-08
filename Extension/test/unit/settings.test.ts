/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { beforeEach, describe, it } from 'mocha';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Uri } from 'vscode';
import proxyquire = require('proxyquire');

const settingName = 'codeAnalysis.clangTidy.includeCleanerMappings';
const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));
let mappings: unknown;
let requestedResource: unknown;

function getSetting(key: string, value: unknown): unknown {
    const settings = { codeAnalysis: { clangTidy: { includeCleanerMappings: value } } };
    return key.split('.').reduce<unknown>((section, name) =>
        section && typeof section === 'object' ? (section as Record<string, unknown>)[name] : undefined, settings);
}

const configuration = {
    codeAnalysis: {},
    get: (key: string) => getSetting(key, mappings),
    inspect: (key: string) => ({ defaultValue: getSetting(key, {}) })
};
const vscode = {
    extensions: { getExtension: () => ({ packageJSON: packageJson }) },
    workspace: {
        getConfiguration: (_section: string, resource: unknown) => {
            requestedResource = resource;
            return configuration;
        }
    }
};
const load = proxyquire.noCallThru();
const common: typeof import('../../src/common') = load('../../src/common', {
    vscode,
    'vscode-languageclient': {},
    'vscode-tas-client': {},
    './logger': {},
    './platform': {},
    './telemetry': {}
});
const { CppSettings }: typeof import('../../src/LanguageServer/settings') = load('../../src/LanguageServer/settings', {
    vscode,
    '../common': common,
    '../telemetry': {},
    './client': {},
    './editorConfig': {},
    './extension': {},
    './persistentState': {}
});
const { SettingsTracker }: typeof import('../../src/LanguageServer/settingsTracker') = load('../../src/LanguageServer/settingsTracker', {
    vscode,
    '../common': common
});
const schema = common.getRawSetting(`C_Cpp.${settingName}`, true);

const controlCharacters = [
    ...Array.from({ length: 0x20 }, (_, code) => String.fromCharCode(code)),
    ...Array.from({ length: 0x21 }, (_, code) => String.fromCharCode(0x7f + code))
];
const validHeaders = [
    '<widget.h>',
    '"widget.h"',
    '<library/widget.hpp>',
    '"folder with spaces/widget.h"',
    '<widget>',
    '"folder\\widget.h"',
    '<${name}.h>',
    '<café/élément.h>',
    '"cafe\u0301/élément.h"'
];
const invalidHeaders = [
    '', '<>', '""', 'widget.h', '#include <widget.h>',
    '<widget.h"', '"widget.h>', '<widget.h> trailing', ' <widget.h>',
    '<widget.h>\n', '<widget.h>\r', '\n<widget.h>', '<widget\n.h>', '"widget\r.h"',
    '<widget\0.h>', '"widget\0.h"', '<widget"h>', '"widget<h"', '"widget>h"',
    '<widget<h>', '<widget>h>', '"widget"h"', '<widget.h>\n#include "other.h"',
    '"<widget.h>"', '<"widget.h">',
    ...controlCharacters.flatMap(control => [
        `<widget${control}.h>`, `"widget${control}.h"`,
        `${control}<widget.h>`, `${control}"widget.h"`,
        `<widget.h>${control}`, `"widget.h"${control}`
    ])
];

describe('Include Cleaner mapping settings', () => {
    beforeEach(() => {
        mappings = undefined;
        requestedResource = undefined;
    });

    it('declares a localized resource-scoped object with an empty default', () => {
        strictEqual(schema.type, 'object');
        strictEqual(schema.scope, 'resource');
        deepStrictEqual(schema.default, {});
        strictEqual(schema.propertyNames.minLength, 1);
        strictEqual(schema.additionalProperties.type, 'string');
        const messages = JSON.parse(readFileSync(resolve(__dirname, '../../../package.nls.json'), 'utf8'));
        strictEqual(typeof messages[schema.markdownDescription.slice(1, -1)].message, 'string');
        deepStrictEqual(new CppSettings().clangTidyIncludeCleanerMappings, {});
    });

    it('preserves exact symbol names and literal include spellings for the resource', () => {
        const resource = { scheme: 'file', fsPath: '/workspace' } as Uri;
        const expected = Object.freeze(Object.fromEntries([
            ['example::widget', '<widget.h>'],
            ['example::Widget', '"widget.h"'],
            ['example::operator*', '<operators.h>'],
            ['example::operator<', '<operators.h>'],
            ['example::operator>', '"operators.h"'],
            ['example::operator""_tag', '<operators.h>'],
            ['example::.*', '<literal.h>'],
            ['café::élément', '<café/élément.h>'],
            ['cafe\u0301::élément', '"cafe\u0301/élément.h"'],
            ['__proto__', '<prototype.h>']
        ]));
        mappings = expected;
        const actual = new CppSettings(resource).clangTidyIncludeCleanerMappings;
        deepStrictEqual(actual, expected);
        strictEqual(Object.getPrototypeOf(actual), Object.prototype);
        strictEqual(Object.getOwnPropertyDescriptor(actual, '__proto__')?.value, '<prototype.h>');
        strictEqual(requestedResource, resource);
        const pattern = new RegExp(schema.propertyNames.pattern);
        for (const symbol of Object.keys(expected)) {
            strictEqual(pattern.test(symbol), true, JSON.stringify(symbol));
        }
    });

    it('drops empty or control-containing symbol names without dropping valid entries', () => {
        const invalidSymbols = ['', ...controlCharacters.flatMap(control => [
            control, `${control}example::widget`, `example::${control}widget`, `example::widget${control}`
        ])];
        for (const symbol of invalidSymbols) {
            mappings = Object.freeze({ [symbol]: '<widget.h>', 'example::other': '<other.h>' });
            deepStrictEqual(new CppSettings().clangTidyIncludeCleanerMappings, { 'example::other': '<other.h>' }, JSON.stringify(symbol));
            strictEqual(new RegExp(schema.propertyNames.pattern).test(symbol), false, JSON.stringify(symbol));
        }
    });

    it('agrees with the schema on valid literal headers', () => {
        const pattern = new RegExp(schema.additionalProperties.pattern);
        for (const header of validHeaders) {
            mappings = { 'example::widget': header };
            deepStrictEqual(new CppSettings().clangTidyIncludeCleanerMappings, mappings, JSON.stringify(header));
            strictEqual(pattern.test(header), true, JSON.stringify(header));
        }
    });

    it('drops malformed headers without dropping valid string entries', () => {
        const pattern = new RegExp(schema.additionalProperties.pattern);
        for (const header of invalidHeaders) {
            mappings = Object.freeze({ 'example::widget': header, 'example::other': '<other.h>' });
            deepStrictEqual(new CppSettings().clangTidyIncludeCleanerMappings, { 'example::other': '<other.h>' }, JSON.stringify(header));
            strictEqual(pattern.test(header), false, JSON.stringify(header));
        }
    });

    it('uses the empty default for values that are not string-to-string objects', () => {
        for (const value of [null, false, 42, '<widget.h>', [], ['<widget.h>'], { 'example::widget': null },
            { 'example::widget': ['<widget.h>'] }, { 'example::widget': 42, 'example::other': '<other.h>' }]) {
            mappings = value;
            deepStrictEqual(new CppSettings().clangTidyIncludeCleanerMappings, {}, JSON.stringify(value));
        }
    });

    it('redacts mapping keys and values from initial and changed-settings telemetry', () => {
        mappings = { 'private::widget': '<private-widget.h>', toString: '"private-string.h"' };
        const tracker = new SettingsTracker(undefined);
        deepStrictEqual(tracker.getUserModifiedSettings(), { [settingName]: '...' });
        deepStrictEqual(tracker.getChangedSettings(), {});
        mappings = { 'private::other': '"private-other.h"' };
        deepStrictEqual(tracker.getChangedSettings(), { [settingName]: '...' });
        mappings = {};
        deepStrictEqual(tracker.getChangedSettings(), { [settingName]: '<default>' });
    });

    it('redacts malformed mapping entries without recursing into their keys', () => {
        for (const value of [{ 'private::widget': { 'private-key': 'private-value' } }, ['private-value']]) {
            mappings = value;
            const tracker = new SettingsTracker(undefined);
            deepStrictEqual(tracker.getUserModifiedSettings(), { [settingName]: '...' });
        }
    });
});
