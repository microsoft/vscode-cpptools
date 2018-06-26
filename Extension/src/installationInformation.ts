/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export class InstallationInformation {
    stage: string;
    hasError: boolean;
    telemetryProperties: { [key: string]: string };

    constructor() {
        this.hasError = false;
        this.telemetryProperties = {};
    }
}

let installBlob: InstallationInformation;

export function getInstallationInformation(): InstallationInformation {
    if (!installBlob) {
        installBlob = new InstallationInformation();
    }
    return installBlob;
}

export function setInstallationStage(stage: string): void {
    getInstallationInformation().stage = stage;
}