/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { lookupString } from '../nativeStrings';

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
