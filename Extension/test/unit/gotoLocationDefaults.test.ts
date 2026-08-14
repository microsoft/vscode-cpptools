/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { deepStrictEqual } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'mocha';

type PackageJson = {
    contributes?: {
        configurationDefaults?: Record<string, Record<string, unknown>>;
    };
};

function getLanguageDefaults(packageJson: PackageJson, languageKey: string): Record<string, unknown> {
    const defaults = packageJson.contributes?.configurationDefaults?.[languageKey];
    if (!defaults) {
        throw new Error(`Missing configuration defaults for ${languageKey}`);
    }
    return defaults;
}

describe('Go to Location defaults', () => {
    it('sets C/C++ fallback commands between declaration and definition', () => {
        const packageJsonPath = join(__dirname, '../../../package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;

        const languages = ['[c]', '[cpp]', '[cuda-cpp]'];
        for (const language of languages) {
            const defaults = getLanguageDefaults(packageJson, language);
            deepStrictEqual(defaults['editor.gotoLocation.alternativeDefinitionCommand'], 'editor.action.revealDeclaration');
            deepStrictEqual(defaults['editor.gotoLocation.alternativeDeclarationCommand'], 'editor.action.revealDefinition');
        }
    });
});
