/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export enum InstallBlobStage {
    getPlatformInfo,
    downloadPackages,
    installPackages,
    makeBinariesExecutable,
    makeOfflineBinariesExecutable,
    removeUnnecessaryFile,
    touchInstallLockFile,
    rewriteManifest,
    postInstall
}

export class InstallBlob {
    stage: InstallBlobStage;
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

export function setInstallBlobStage(stage: InstallBlobStage): void {
    if (!installBlob) {
        initializeInstallBlob();
    }
    installBlob.stage = stage;
}