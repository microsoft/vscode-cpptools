/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { PackageVersion } from './packageVersion';
import * as util from './common';
import * as tmp from 'tmp';
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
    const ok: boolean = input && input.name && typeof(input.name) === "string" &&
        input.browser_download_url && typeof(input.browser_download_url) === "string";
    return ok;
}

// Note that earlier Builds do not have 4 or greater assets (Mac, Win, Linux 32/64). Only call this on more recent Builds
function isBuild(input: any): input is Build {
    const ok: boolean = input && input.name && typeof(input.name) === "string" &&
        isArrayOfAssets(input.assets) && input.assets.length >= 4;
    return ok;
}

function isArrayOfAssets(input: any): input is Asset[] {
    const ok: boolean = input instanceof Array && input.every(item => isAsset(item));
    return ok;
}

function isArrayOfBuilds(input: any): input is Build[] {
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
    const info: PlatformInformation = await PlatformInformation.GetPlatformInformation();
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
    }(info);
    if (!vsixName) {
        const distro: string = info.distribution ? ':' + info.distribution.name + '-' + info.distribution.version : '';
        return Promise.reject(new Error('Failed to match VSIX name for: ' +
            info.platform + distro + ':' + info.architecture));
    }

    // Get the URL to download the VSIX, using vsixName as a key
    const downloadUrl: string = build.assets.find((asset) => {
        return asset.name === vsixName;
    }).browser_download_url;

    if (!downloadUrl) {
        return Promise.reject(new Error('Failed to find VSIX: ' + vsixName + ' in build: ' + build.name));
    }
    return downloadUrl;
}

export async function getTargetBuildURL(updateChannel: string): Promise<string> {
    return getReleaseJson()
        .then(builds => getTargetBuild(builds, updateChannel))
        .then(build => { return build ? downloadUrlForPlatform(build) : Promise.resolve(undefined); } );
}

// Determines whether there exists a build that should be installed; returns the build if there is
function getTargetBuild(builds: Build[], updateChannel: string): Build | undefined {
    // Get predicates to determine the build to install, if any
    let needsUpdate: (v1: PackageVersion, v2: PackageVersion) => boolean;
    let useBuild: (build: Build) => boolean;
    if (updateChannel === 'Insiders') {
        needsUpdate = function(v1: PackageVersion, v2: PackageVersion): boolean { return v2.isGreaterThan(v1); };
        useBuild = function(build: Build): boolean { return true; };
    } else if (updateChannel === 'Default') {
        needsUpdate = function(v1: PackageVersion, v2: PackageVersion): boolean { return v1.isGreaterThan(v2); };
        useBuild = function(build: Build): boolean { return build.name.indexOf('-') === -1; };
    } else {
        throw new Error('Incorrect updateChannel setting provided');
    }

    // Get the build to install
    const targetBuild: Build = builds.find((build) => useBuild(build));
    if (!targetBuild) {
        throw new Error('Failed to determine installation candidate');
    }

    // Check current version against target's version to determine if the installation should happen
    const userVersion: PackageVersion = new PackageVersion(util.packageJson.version);
    const targetVersion: PackageVersion = new PackageVersion(targetBuild.name);
    if (!needsUpdate(userVersion, targetVersion)) {
        return undefined;
    }

    return targetBuild;
}

async function getReleaseJson(): Promise<Build[]> {
    return new Promise<Build[]>((resolve, reject) => {
        // Create temp file to hold json
        tmp.file(async (err, releaseJsonPath, fd, cleanupCallback) => {
            if (err) {
                return reject(new Error('Failed to create release json file'));
            }

            // Download json from GitHub
            const releaseUrl: string = 'https://api.github.com/repos/Microsoft/vscode-cpptools/releases';
            await util.downloadFileToDestination(releaseUrl, releaseJsonPath, { 'User-Agent': 'vscode-cpptools' }).catch(() => {
                return reject(new Error('Failed to download release json'));
            });

            // Read + parse json from downloaded file
            let parsedJson: any = await parseJsonAtPath(releaseJsonPath);
            cleanupCallback();
            if (!isArrayOfBuilds(parsedJson)) {
                return reject(new Error('Failed to parse release json'));
            }

            return resolve(parsedJson);
        });
    });
}