/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export class InstallationInformation  {
    stage: string;
    hasError: boolean;
    telemetryProperties: { [key: string]: string };

    constructor() {
        this.hasError = false;
        this.telemetryProperties = {};
    }
}

let installBlob: InstallationInformation ;

export function initializeInstallationInformation(): void {
    installBlob = new InstallationInformation ();
}

export function getInstallationInformationInstance(): InstallationInformation  {
    return installBlob;
}

export function setInstallationStage(stage: string): void {
    if (!installBlob) {
        initializeInstallationInformation();
    }
    installBlob.stage = stage;
}