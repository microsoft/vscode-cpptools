/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as telemetry from '../telemetry';

export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    suffix?: string;
}

export function getParsedVersion(versionStr: string): ParsedVersion {
    let tokens: string[] = versionStr.split(new RegExp('[-\\.]', 'g')); // Match against dots and dashes
    if (tokens.length < 3) {
        telemetry.logLanguageServerEvent('versionParsingFailure', { 'versionString': versionStr });
        return;
    }

    const parsedVersion: ParsedVersion = function(tokens): ParsedVersion {
        let parsedVersion: ParsedVersion;
        parsedVersion.major = parseInt(tokens[0]);
        parsedVersion.minor = parseInt(tokens[1]);
        parsedVersion.patch = parseInt(tokens[2]);
        parsedVersion.suffix = tokens[3];
        return parsedVersion;
    }(tokens);

    if (!parsedVersion.major || !parsedVersion.minor || !parsedVersion.patch) {
        telemetry.logLanguageServerEvent('versionParsingFailure', { 'versionString': versionStr });
    }

    return parsedVersion;
}

export function parsedVersionGreater(v1: ParsedVersion, v2: ParsedVersion): boolean {
    // ParsedVersions cannot be compared if either have a suffix that is not 'insiders'
    if ((v1.suffix && v1.suffix !== 'insiders') || (v2.suffix && v2.suffix !== 'insiders')) {
        return false;
    }

    let diff: number = v2.major - v1.major;
    if (diff) {
        return diff > 0;
    } else if (diff = v2.minor - v1.minor) {
        return diff > 0;
    } else if (diff = v2.patch - v1.patch) {
        return diff > 0;
    } else if (!v2.suffix && v1.suffix === 'insiders') {
        return true;
    }
    return false;
}