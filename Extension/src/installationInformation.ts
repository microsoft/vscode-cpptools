/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export enum InstallationType {
    Online,
    Offline
}

export class InstallationInformation {
    stage?: string;
    type?: InstallationType;
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

export function setInstallationType(type: InstallationType): void {
    getInstallationInformation().type = type;
}
