/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { getExtensionFilePath } from '../common';
import { lookupString } from '../nativeStrings';
import * as nls from 'vscode-nls';
import path = require('path');
import * as fs from 'fs';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface LocalizeStringParams {
    text: string;
    stringId: number;
    stringArgs: string[];
    indentSpaces: number;
}

export function getLocalizedString(params: LocalizeStringParams): string {
    let indent: string = "";
    if (params.indentSpaces) {
        indent = " ".repeat(params.indentSpaces);
    }
    let text: string = params.text;
    if (params.stringId !== 0) {
        text = lookupString(params.stringId, params.stringArgs);
    }
    return indent + text;
}

interface VSCodeNlsConfig {
    locale: string;
    availableLanguages: {
        [pack: string]: string;
    };
}

export function getLocaleId(): string {
    // This replicates the language detection used by initializeSettings() in vscode-nls
    if (typeof process.env.VSCODE_NLS_CONFIG === 'string') {
        const vscodeOptions: VSCodeNlsConfig = JSON.parse(process.env.VSCODE_NLS_CONFIG) as VSCodeNlsConfig;
        let language: string | undefined;
        if (vscodeOptions.availableLanguages) {
            const value: string = vscodeOptions.availableLanguages['*'];
            if (typeof value === 'string') {
                language = value;
            }
        }
        let locale: string | undefined;
        if (typeof vscodeOptions.locale === 'string') {
            locale = vscodeOptions.locale.toLowerCase();
        }
        let result: string | undefined;
        if (language === undefined) {
            result = locale;
        } else if (language !== 'en') {
            result = language;
        }
        if (result !== undefined) {
            return result;
        }
    }
    return "en";
}

export function getLocalizedHtmlPath(originalPath: string): string {
    const locale: string = getLocaleId();
    if (!locale.startsWith("en")) {
        const localizedFilePath: string = getExtensionFilePath(path.join("dist/html/", locale, originalPath));
        if (fs.existsSync(localizedFilePath)) {
            return localizedFilePath;
        }
    }
    return getExtensionFilePath(originalPath);
}

export function getLocalizedSymbolScope(scope: string, detail: string): string {
    return localize({
        key: "c.cpp.symbolscope.separator", comment:
            ["{0} is an untranslated C++ keyword (e.g. \"private\") and {1} is either another keyword (e.g. \"typedef\") or a localized property (e.g. a localized version of \"declaration\""]
    }, "{0}, {1}", scope, detail);
}
