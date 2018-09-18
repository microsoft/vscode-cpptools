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
                    case 'x86': return 'cpptools-linux32.vsix';
                    case 'x86_64': return 'cpptools-linux.vsix';
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
 * Use the GitHub API to retrieve the download URL of the extension version the user should update to, if any.
 * @param updateChannel The user's updateChannel setting.
 * @return Download URL for the extension VSIX package that the user should install. If the user
 * does not need to update, resolves to undefined.
 */
export async function getTargetBuildUrl(updateChannel: string): Promise<string> {
    return getReleaseJson()
        .then(builds => getTargetBuild(builds, updateChannel))
        .then(build => {
            if (!build) {
                return Promise.resolve(undefined);
            }
            return PlatformInformation.GetPlatformInformation()
                .then(platformInfo => vsixNameForPlatform(platformInfo))
                .then(vsixName => getVsixDownloadUrl(build, vsixName));
        });
}

/**
 * Determines whether there exists a Build in the given Build[] that should be installed.
 * @param builds The GitHub release list parsed as an array of Builds.
 * @param updateChannel The user's updateChannel setting.
 * @return The Build if the user should update to it, otherwise undefined.
 */
function getTargetBuild(builds: Build[], updateChannel: string): Build {
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
    const userVersion: PackageVersion = new PackageVersion(util.packageJson.version);
    const targetVersion: PackageVersion = new PackageVersion(targetBuild.name);
    return needsUpdate(userVersion, targetVersion) ? targetBuild : undefined;
}

/**
 * Download and parse the release list JSON from the GitHub API into a Build[].
 * @return Information about the released builds of the C/C++ extension.
 */
async function getReleaseJson(): Promise<Build[]> {
    return new Promise<Build[]>((resolve, reject) => {
        // Create temp file to hold JSON
        tmp.file((err, releaseJsonPath, fd, cleanupCallback) => {
            if (err) {
                return reject(new Error('Failed to create release json file'));
            }

            // Helper functions to handle promise rejection
            const rejectDownload: any = () => { return reject(new Error('Failed to download release JSON')); };
            const rejectRead: any = () => { return reject(new Error('Failed to read release JSON file')); };
            const rejectParse: any = () => { return reject(new Error('Failed to parse release JSON')); };

            // Helper function to verify result of download + parse
            const typeCheck: any = releaseJson => {
                return isArrayOfBuilds(releaseJson) ? resolve(releaseJson) : reject('Release JSON is not Build[]');
            };

            const releaseUrl: string = 'https://api.github.com/repos/Microsoft/vscode-cpptools/releases';
            const header: OutgoingHttpHeaders = { 'User-Agent': 'vscode-cpptools' };
            return util.downloadFileToDestination(releaseUrl, releaseJsonPath, header)
                .then(() => util.readFileText(releaseJsonPath), () => { return rejectDownload(); })
                .then(fileContent => JSON.parse(fileContent), () => { return rejectRead(); })
                .then(releaseJson => typeCheck(releaseJson), () => { return rejectParse(); });
        });
    });
}
