/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

export class PackageVersion {
    major: number;
    minor: number;
    patch: number;
    suffix?: string;
    suffixVersion: number;

    constructor(version: string) {
        const tokens: string[] = version.split(new RegExp('[-\\.]', 'g')); // Match against dots and dashes
        if (tokens.length < 3) {
            throw new Error('Failed to parse version string: ' + version);
        }

        this.major = parseInt(tokens[0]);
        this.minor = parseInt(tokens[1]);
        this.patch = parseInt(tokens[2]);

        if (tokens.length > 3) {
            const firstDigitOffset: number = tokens[3].search(new RegExp(/(\d)/)); // Find first occurrence of 0-9
            if (firstDigitOffset !== -1) {
                this.suffix = tokens[3].substring(0, firstDigitOffset);
                this.suffixVersion = parseInt(tokens[3].substring(firstDigitOffset));
            } else {
                this.suffix = tokens[3];
                this.suffixVersion = 1;
            }
        } else {
            this.suffix = undefined;
            this.suffixVersion = 0;
        }

        if (this.major === undefined || this.minor === undefined || this.patch === undefined) {
            throw new Error('Failed to parse version string: ' + version);
        }
    }

    public isGreaterThan(other: PackageVersion): boolean {
        // PackageVersions cannot be compared if either have a suffix that is not 'insiders'
        if ((this.suffix && !this.suffix.startsWith('insiders')) || (other.suffix && !other.suffix.startsWith('insiders'))) {
            return false;
        }

        let diff: number = this.major - other.major;
        if (diff) {
            return diff > 0;
        } else if (diff = this.minor - other.minor) {
            return diff > 0;
        } else if (diff = this.patch - other.patch) {
            return diff > 0;
        } else if (this.suffix) {
            return (other.suffix && this.suffixVersion > other.suffixVersion);
        } else {
            return other.suffix ? true : false;
        }
    }
}
