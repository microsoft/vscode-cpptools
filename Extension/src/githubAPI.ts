/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { PackageVersion } from './packageVersion';
import * as util from './common';
import * as tmp from 'tmp';
import { PlatformInformation } from './platform';
import { OutgoingHttpHeaders } from 'http';

interface Asset {
    name: string;
    browser_download_url: string;
}

class Build {
    name: string;
    assets: Asset[];

    getVsixDownloadUrl(vsixName: string): string {
        const downloadUrl: string = this.assets.find(asset => {
            return asset.name === vsixName;
        }).browser_download_url;
        if (!downloadUrl) {
            throw new Error('Failed to find VSIX: ' + vsixName + ' in build: ' + this.name);
        }
        return downloadUrl;
    }
}

function isAsset(input: any): input is Asset {
    return input && input.name && typeof(input.name) === "string" &&
        input.browser_download_url && typeof(input.browser_download_url) === "string";
}

// Note that earlier Builds do not have 4 or greater assets (Mac, Win, Linux 32/64). Only call this on more recent Builds
function isBuild(input: any): input is Build {
    return input && input.name && typeof(input.name) === "string" && isArrayOfAssets(input.assets) && input.assets.length >= 4;
}

function isArrayOfAssets(input: any): input is Asset[] {
    return input instanceof Array && input.every(item => isAsset(item));
}

function isArrayOfBuilds(input: any): input is Build[] {
    if (!input || !(input instanceof Array) || input.length === 0) {
        return false;
    }
    // Only check the five most recent builds for validity -- no need to check all of them
    for (let i: number = 0; i < 5 && i < input.length; i++) {
        if (!isBuild(input[i])) {
            return false;
        }
    }
    return true;
}

function vsixNameForPlatform(info: PlatformInformation): string {
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
        const distro: string = info.distribution ? (':' + info.distribution.name + '-' + info.distribution.version) : '';
        throw new Error('Failed to match VSIX name for: ' + info.platform + distro + ':' + info.architecture);
    }
    return vsixName;
}

export async function getTargetBuildUrl(updateChannel: string): Promise<string> {
    const boundGetTargetBuild: (builds: Build[]) => Build = getTargetBuild.bind(undefined, updateChannel);

    return getReleaseJson()
        .then(boundGetTargetBuild)
        .then(build => {
            if (!build) {
                return Promise.resolve(undefined);
            }
            const boundGetDownloadUrl: any = Build.prototype.getVsixDownloadUrl.bind(build);
            return PlatformInformation.GetPlatformInformation()
                .then(vsixNameForPlatform)
                .then(boundGetDownloadUrl);
        });
}

// Determines whether there exists a build that should be installed; returns the build if there is
function getTargetBuild(updateChannel: string, builds: Build[]): Build {
    // Get predicates to determine the build to install, if any
    let needsUpdate: (installed: PackageVersion, other: PackageVersion) => boolean;
    let useBuild: (build: Build) => boolean;
    if (updateChannel === 'Insiders') {
        needsUpdate = (installed: PackageVersion, other: PackageVersion) => { return other.isGreaterThan(installed); };
        useBuild = function(build: Build): boolean { return true; };
    } else if (updateChannel === 'Default') {
        needsUpdate = function(installed: PackageVersion, other: PackageVersion): boolean { return installed.isGreaterThan(other); };
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
    return needsUpdate(userVersion, targetVersion) ? targetBuild : undefined;
}

async function getReleaseJson(): Promise<Build[]> {
    return new Promise<Build[]>((resolve, reject) => {
        // Create temp file to hold json
        tmp.file((err, releaseJsonPath, fd, cleanupCallback) => {
            if (err) {
                return reject(new Error('Failed to create release json file'));
            }

            const releaseUrl: string = 'https://api.github.com/repos/Microsoft/vscode-cpptools/releases';
            const header: OutgoingHttpHeaders = { 'User-Agent': 'vscode-cpptools' };
            const downloadReleaseJson: any = util.downloadFileToDestination.bind(undefined, releaseUrl, releaseJsonPath, header);
            const rejectDownload: any = () => { return reject(new Error('Failed to download release json')); };

            const readJson: any = util.readFileText.bind(undefined, releaseJsonPath);
            const rejectRead: any = () => { return reject(new Error('Failed to read release json file')); };

            const rejectParse: any = () => { return reject(new Error('Failed to parse release json')); };

            const typeCheck: any = releaseJson => {
                return isArrayOfBuilds(releaseJson) ? resolve(releaseJson) : reject('Release json is not Build[]');
            };

            return downloadReleaseJson()
                .catch(rejectDownload)
                .then(readJson, rejectRead)
                .then(JSON.parse, rejectParse)
                .then(typeCheck);
        });
    });
}