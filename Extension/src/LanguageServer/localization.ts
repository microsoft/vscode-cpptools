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
import * as vscode from 'vscode';

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

export function getLocaleId(): string {

    let locale: string = vscode.env.language;

    // Restrict to locale identifiers we support.
    if (locale.startsWith("cs")) {
        locale = "cs";
    } else if (locale.startsWith("de")) {
        locale = "de";
    } else if (locale.startsWith("es")) {
        locale = "es";
    } else if (locale.startsWith("fr")) {
        locale = "fr";
    } else if (locale.startsWith("it")) {
        locale = "it";
    } else if (locale.startsWith("ja")) {
        locale = "ja";
    } else if (locale.startsWith("ko")) {
        locale = "ko";
    } else if (locale.startsWith("pl")) {
        locale = "pl";
    } else if (locale.startsWith("pt")) {
        locale = "pt-br";
    } else if (locale.startsWith("ru")) {
        locale = "ru";
    } else if (locale.startsWith("zh")) {
        if (!locale.startsWith("zh-tw")) {
            locale = "zh-cn";
        }
    } else {
        locale = "en";
    }
    return locale;
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
