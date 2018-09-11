/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { PackageVersion } from './packageVersion';
import * as util from './common';
import * as tmp from 'tmp';
import * as telemetry from './telemetry';
import { PlatformInformation } from './platform';

async function parseJsonAtPath(path: string): Promise<any> {
    try {
        const exists: boolean = await util.checkFileExists(path);
        if (exists) {
            const fileContent: string = await util.readFileText(path);
            return JSON.parse(fileContent);
        }
    } catch (error) {
    }
}

interface Asset {
    name: string;
    browser_download_url: string;
}

interface Build {
    name: string;
    assets: Asset[];
}

function isAsset(input: any): input is Asset {
    const ok: boolean = input && input.name && typeof(input.name) === "string" && input.browser_download_url && typeof(input.browser_download_url) === "string";
    return ok;
}

// Note that earlier Builds do not have 4 or greater assets (Mac, Win, Linux 32/64). Only call this on more recent Builds
function isBuild(input: any): input is Build {
    const ok: boolean = input && input.name && typeof(input.name) === "string" && isArrayOfAssets(input.assets) && input.assets.length >= 4;
    return ok;
}

function isArrayOfAssets(input: any): input is Asset[] {
    const ok: boolean = input instanceof Array && input.every(item => isAsset(item));
    return ok;
}

function isReleaseJson(input: any): input is Build[] {
    let ok: boolean =  input && input instanceof Array && input.length !== 0;
    // Only check the five most recent builds for validity -- no need to check all of them
    for (let i: number = 0; i < 5 && i < input.length; i++) {
        if (!ok) {
            return false;
        }
        ok = ok && isBuild(input[i]);
    }
    return ok;
}

async function downloadUrlForPlatform(build: Build): Promise<string> {
    // Get the VSIX name to search for in build
    const platformInfo: PlatformInformation = await PlatformInformation.GetPlatformInformation();
    const vsixName: string = function(platformInfo): string {
        switch (platformInfo.platform) {
            case 'win32': return 'cpptools-win32.vsix';
            case 'darwin': return 'cpptools-osx.vsix';
            default: {
                switch (platformInfo.architecture) {
                    case 'x86': return 'cpptools-linux32.vsix';
                    case 'x86_64': return 'cpptools-linux.vsix';
                }
            }
        }
    }(platformInfo);
    if (!vsixName) {
        return;
    }

    // Get the URL to download the VSIX, using vsixName as a key
    const downloadUrl: string = build.assets.find((asset) => {
        return asset.name === vsixName;
    }).browser_download_url;

    return downloadUrl;
}

export async function getTargetBuildURL(updateChannel: string): Promise<string> {
    const releaseJson: Build[] = await getReleaseJson();
    if (!releaseJson) {
        return;
    }

    const targetRelease: Build = getTargetBuild(releaseJson, updateChannel);
    if (!targetRelease) {
        return;
    }

    const downloadUrl: string = await downloadUrlForPlatform(targetRelease);
    return downloadUrl;
}

// Determines whether there exists a build that should be installed; returns the build if there is
function getTargetBuild(releaseJson: Build[], updateChannel: string): Build {
    // Get predicates to determine the build to install, if any
    let needsUpdate: (v1: PackageVersion, v2: PackageVersion) => boolean;
    let useBuild: (build: Build) => boolean;
    if (updateChannel === 'Insiders') {
        needsUpdate = function(v1: PackageVersion, v2: PackageVersion): boolean { return v1.isGreaterThan(v2); };
        useBuild = function(build: Build): boolean { return true; };
    } else if (updateChannel === 'Default') {
        needsUpdate = function(v1: PackageVersion, v2: PackageVersion): boolean { return v2.isGreaterThan(v1); };
        useBuild = function(build: Build): boolean { return build.name.indexOf('-') === -1; };
    } else {
        return;
    }

    // Get the build to install
    const targetBuild: Build = releaseJson.find((build) => useBuild(build));
    if (!targetBuild) {
        return;
    }

    // Check current version against target's version to determine if the installation should happen
    const userVersion: PackageVersion = new PackageVersion(util.packageJson.version);
    const targetVersion: PackageVersion = new PackageVersion(targetBuild.name);
    if (!userVersion.isValid || !targetVersion.isValid) {
        return;
    }
    if (!needsUpdate(userVersion, targetVersion)) {
        return;
    }

    return targetBuild;
}

async function getReleaseJson(): Promise<Build[]> {
    const releaseJsonFile: any = tmp.fileSync();

    // Download json from GitHub
    const releaseUrl: string = 'https://api.github.com/repos/Microsoft/vscode-cpptools/releases';
    await util.downloadFileToDestination(releaseUrl, releaseJsonFile.name, { 'User-Agent': 'vscode-cpptools' }).catch(() => {
            // TODO check internet connection before attempting? That way we can mitigate false positive telemetry
            telemetry.logLanguageServerEvent('releaseJsonDownloadFailure');
    });

    // Read + parse json from downloaded file
    const parsedJson: any = await parseJsonAtPath(releaseJsonFile.name);
    releaseJsonFile.removeCallback();
    if (!parsedJson) {
        telemetry.logLanguageServerEvent('releaseJsonParsingFailure');
        return;
    }

    if (!isReleaseJson(parsedJson)) {
        telemetry.logLanguageServerEvent('releaseJsonParsingFailure');
        return;
    }

    return parsedJson;
}