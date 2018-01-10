/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export class InstallBlob {
    stage: string;
    hasError: boolean;
    telemetryProperties: { [key: string]: string };

    constructor() {
        this.hasError = false;
        this.telemetryProperties = {};
    }
}

let installBlob: InstallBlob;

export function initializeInstallBlob(): void {
    installBlob = new InstallBlob();
}

export function getInstallBlob(): InstallBlob {
    return installBlob;
}

export function setInstallationStage(stage: string): void {
    if (!installBlob) {
        initializeInstallBlob();
    }
    installBlob.stage = stage;
}