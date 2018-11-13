/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { PackageVersion } from './packageVersion';
import * as util from './common';
import { PlatformInformation } from './platform';
import { OutgoingHttpHeaders } from 'http';

/**
 * The object representation of a Build Asset. Each Asset corresponds to information about a release file on GitHub.
 */
interface Asset {
    name: string;
    browser_download_url: string;
}

/**
 * The object representation of a release in the GitHub API's release JSON.
 * Named Build so as to reduce confusion between a "Release" release and "Insiders" release.
 */
interface Build {
    name: string;
    assets: Asset[];
}

/**
* Search each Asset by name to retrieve the download URL for a VSIX package
* @param vsixName The name of the VSIX to search for
* @return The download URL of the VSIX
*/
function getVsixDownloadUrl(build: Build, vsixName: string): string {
    const downloadUrl: string = build.assets.find(asset => {
        return asset.name === vsixName;
    }).browser_download_url;
    if (!downloadUrl) {
        throw new Error('Failed to find VSIX: ' + vsixName + ' in build: ' + build.name);
    }
    return downloadUrl;
}

/**
 * Determine whether an object is of type Asset.
 * @param input Incoming object.
 * @return Whether input is of type Asset.
 */
function isAsset(input: any): input is Asset {
    return input && input.name && typeof(input.name) === "string" &&
        input.browser_download_url && typeof(input.browser_download_url) === "string";
}

/**
 * Determine whether an object is of type Build. Note that earlier releases of the extension
 * do not have 4 or greater Assets (Mac, Win, Linux 32/64). Only call this on more recent Builds.
 * @param input Incoming object.
 * @return Whether input is of type Build.
 */
function isBuild(input: any): input is Build {
    return input && input.name && typeof(input.name) === "string" && isArrayOfAssets(input.assets) && input.assets.length >= 4;
}

/**
 * Determine whether an object is of type Asset[].
 * @param input Incoming object.
 * @return Whether input is of type Asset[].
 */
function isArrayOfAssets(input: any): input is Asset[] {
    return input instanceof Array && input.every(item => isAsset(item));
}

/**
 * Determine whether an object is of type Build[].
 * @param input Incoming object.
 * @return Whether input is of type Build[].
 */
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

/**
 * Match the user's platform information to the VSIX name relevant to them.
 * @param info Information about the user's operating system.
 * @return VSIX filename for the extension's releases matched to the user's platform.
 */
function vsixNameForPlatform(info: PlatformInformation): string {
    const vsixName: string = function(platformInfo): string {
        switch (platformInfo.platform) {
            case 'win32': return 'cpptools-win32.vsix';
            case 'darwin': return 'cpptools-osx.vsix';
            default: {
                switch (platformInfo.architecture) {
                    case 'x86_64': return 'cpptools-linux.vsix';
                    case 'x86':
                    case 'i386':
                    case 'i686': return 'cpptools-linux32.vsix';
                }
            }
        }
    }(info);
    if (!vsixName) {
        throw new Error('Failed to match VSIX name for: ' + info.platform + ':' + info.architecture);
    }
    return vsixName;
}

/**
 * Interface for return value of getTargetBuildInfo containing the download URL and version of a Build.
 */
export interface BuildInfo {
    downloadUrl: string;
    name: string;
}

/**
 * Use the GitHub API to retrieve the download URL of the extension version the user should update to, if any.
 * @param updateChannel The user's updateChannel setting.
 * @return Download URL for the extension VSIX package that the user should install. If the user
 * does not need to update, resolves to undefined.
 */
export async function getTargetBuildInfo(updateChannel: string): Promise<BuildInfo> {
    return getReleaseJson()
        .then(builds => {
            if (!builds || builds.length === 0) {
                return undefined;
            }

            // If the user version is greater than or incomparable to the latest available verion then there is no need to update
            // Allows testing pre-releases without accidentally downgrading to the latest version
            const userVersion: PackageVersion = new PackageVersion(util.packageJson.version);
            const latestVersion: PackageVersion = new PackageVersion(builds[0].name);
            if (userVersion.isGreaterThan(latestVersion) || (userVersion.suffix && userVersion.suffix !== 'insiders')) {
                return undefined;
            }

            return getTargetBuild(builds, userVersion, updateChannel);
        })
        .then(async build => {
            if (!build) {
                return Promise.resolve(undefined);
            }
            try {
                const platformInfo: PlatformInformation = await PlatformInformation.GetPlatformInformation();
                const vsixName: string = vsixNameForPlatform(platformInfo);
                const downloadUrl: string = getVsixDownloadUrl(build, vsixName);
                return { downloadUrl: downloadUrl, name: build.name };
            } catch (error) {
                return Promise.reject(error);
            }
        });
}

/**
 * Determines whether there exists a Build in the given Build[] that should be installed.
 * @param builds The GitHub release list parsed as an array of Builds.
 * @param userVersion The verion of the extension that the user is running.
 * @param updateChannel The user's updateChannel setting.
 * @return The Build if the user should update to it, otherwise undefined.
 */
function getTargetBuild(builds: Build[], userVersion: PackageVersion, updateChannel: string): Build {
    // Get predicates to determine the build to install, if any
    let needsUpdate: (installed: PackageVersion, target: PackageVersion) => boolean;
    let useBuild: (build: Build) => boolean;
    if (updateChannel === 'Insiders') {
        needsUpdate = (installed: PackageVersion, target: PackageVersion) => { return target.isGreaterThan(installed); };
        useBuild = (build: Build): boolean => { return true; };
    } else if (updateChannel === 'Default') {
        needsUpdate = function(installed: PackageVersion, target: PackageVersion): boolean { return installed.isGreaterThan(target); };
        useBuild = (build: Build): boolean => { return build.name.indexOf('-') === -1; };
    } else {
        throw new Error('Incorrect updateChannel setting provided');
    }

    // Get the build to install
    const targetBuild: Build = builds.find((build) => useBuild(build));
    if (!targetBuild) {
        throw new Error('Failed to determine installation candidate');
    }

    // Check current version against target's version to determine if the installation should happen
    const targetVersion: PackageVersion = new PackageVersion(targetBuild.name);
    return needsUpdate(userVersion, targetVersion) ? targetBuild : undefined;
}

interface Rate {
    remaining: number;
}

interface RateLimit {
    rate: Rate;
}

function isRate(input: any): input is Rate {
    return input && input.remaining && util.isNumber(input.remaining);
}

function isRateLimit(input: any): input is RateLimit {
    return input && isRate(input.rate);
}

async function getRateLimit(): Promise<RateLimit> {
    const header: OutgoingHttpHeaders = { 'User-Agent': 'vscode-cpptools' };
    const data: string = await util.downloadFileToStr('https://api.github.com/rate_limit', header)
        .catch((error) => {
            if (error.code && error.code !== "ENOENT") {
                // Only throw if the user is connected to the Internet.
                throw new Error('Failed to download rate limit JSON');
            }
        });
    if (!data) {
        return Promise.resolve(null);
    }

    let rateLimit: any;
    try {
        rateLimit = JSON.parse(data);
    } catch (error) {
        throw new Error('Failed to parse rate limit JSON');
    }

    if (isRateLimit(rateLimit)) {
        return Promise.resolve(rateLimit);
    } else {
        throw new Error('Rate limit JSON is not of type RateLimit');
    }
}

async function rateLimitExceeded(): Promise<boolean> {
    const rateLimit: RateLimit = await getRateLimit();
    return rateLimit && rateLimit.rate.remaining <= 0;
}

/**
 * Download and parse the release list JSON from the GitHub API into a Build[].
 * @return Information about the released builds of the C/C++ extension.
 */
async function getReleaseJson(): Promise<Build[]> {
    if (await rateLimitExceeded()) {
        throw new Error('Failed to stay within GitHub API rate limit');
    }

    // Download release JSON
    const releaseUrl: string = 'https://api.github.com/repos/Microsoft/vscode-cpptools/releases';
    const header: OutgoingHttpHeaders = { 'User-Agent': 'vscode-cpptools' };

    const data: string = await util.downloadFileToStr(releaseUrl, header)
        .catch((error) => {
            if (error.code && error.code !== "ENOENT") {
                // Only throw if the user is connected to the Internet.
                throw new Error('Failed to download release JSON');
            }
        });
    if (!data) {
        return Promise.resolve(null);
    }

    // Parse the file
    let releaseJson: any;
    try {
        releaseJson = JSON.parse(data);
    } catch (error) {
        throw new Error('Failed to parse release JSON');
    }

    // Type check
    if (isArrayOfBuilds(releaseJson)) {
        return releaseJson;
    } else {
        throw new Error('Release JSON is not of type Build[]');
    }
}
