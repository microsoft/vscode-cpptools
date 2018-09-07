/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as telemetry from '../telemetry';

export class PackageVersion {
    major: number;
    minor: number;
    patch: number;
    suffix?: string;
    isValid: boolean;

    constructor(versionStr: string) {
        let tokens: string[] = versionStr.split(new RegExp('[-\\.]', 'g')); // Match against dots and dashes
        if (tokens.length < 3) {
            this.isValid = false;
            telemetry.logLanguageServerEvent('versionParsingFailure', { 'versionString': versionStr });
            return;
        }

        this.major = parseInt(tokens[0]);
        this.minor = parseInt(tokens[1]);
        this.patch = parseInt(tokens[2]);
        this.suffix = tokens[3];

        if (!this.major || !this.minor || !this.patch) {
            this.isValid = false;
            telemetry.logLanguageServerEvent('versionParsingFailure', { 'versionString': versionStr });
            return;
        }

        this.isValid = true;
    }

    public isGreaterThan(other: PackageVersion): boolean {
        // PackageVersions cannot be compared if either have a suffix that is not 'insiders'
        if ((this.suffix && this.suffix !== 'insiders') || (other.suffix && other.suffix !== 'insiders')) {
            return false;
        }

        let diff: number = other.major - this.major;
        if (diff) {
            return diff > 0;
        } else if (diff = other.minor - this.minor) {
            return diff > 0;
        } else if (diff = other.patch - this.patch) {
            return diff > 0;
        } else if (!other.suffix && this.suffix === 'insiders') {
            return true;
        }
        return false;
    }
}