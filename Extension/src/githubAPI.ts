/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { PackageVersion } from './packageVersion';
import * as util from './common';
import { PlatformInformation } from './platform';
import { OutgoingHttpHeaders } from 'http';
import * as vscode from 'vscode';
import * as telemetry from './telemetry';

const testingInsidersVsixInstall: boolean = false; // Change this to true to enable testing of the Insiders vsix installation.
export const releaseDownloadUrl: string = "https://github.com/microsoft/vscode-cpptools/releases";
/**
 * The object representation of a Build Asset. Each Asset corresponds to information about a release file on GitHub.
 */
export interface Asset {
    name: string;
    browser_download_url: string;
}

/**
 * The object representation of a release in the GitHub API's release JSON.
 * Named Build so as to reduce confusion between a "Release" release and "Insiders" release.
 */
export interface Build {
    name: string;
    assets: Asset[];
}

/**
* Search each Asset by name to retrieve the download URL for a VSIX package
* @param vsixName The name of the VSIX to search for
* @return The download URL of the VSIX
*/
function getVsixDownloadUrl(build: Build, vsixName: string): string {
    const asset: Asset | undefined = build.assets.find(asset => asset.name === vsixName);
    const downloadUrl: string | null = (asset) ? asset.browser_download_url : null;
    if (!downloadUrl) {
        throw new Error(`Failed to find VSIX: ${vsixName} in build: ${build.name}`);
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
 * Determine whether an object is of type Build.
 * @param input Incoming object.
 * @return Whether input is of type Build.
 */
function isBuild(input: any): input is Build {
    return input && input.name && typeof (input.name) === "string" && isArrayOfAssets(input.assets);
}

/**
 * Determine whether an object is of type Build, and it has 3 or more assets (i.e valid build).
 * Note that earlier releases of the extension do not have 3 or greater Assets
 * (Mac, Win, Linux). Only call this on more recent Builds.
 * @param input Incoming object.
 * @return Whether input is a valid build.
 */
function isValidBuild(input: any): input is Build {
    return isBuild(input) && input.assets.length >= 3;
}

/**
 * Determine whether an object is of type Asset[].
 * @param input Incoming object.
 * @return Whether input is of type Asset[].
 */
function isArrayOfAssets(input: any): input is Asset[] {
    return input instanceof Array && input.every(isAsset);
}

/**
 * Return the most recent released builds.
 * @param input Incoming object.
 * @return An array of type Build[].
 */
function getArrayOfBuilds(input: any): Build[] {
    const builds: Build[] = [];
    if (!input || !(input instanceof Array) || input.length === 0) {
        return builds;
    }
    // Only return the the most recent release and insider builds.
    for (let i: number = 0; i < input.length; i++) {
        if (isBuild(input[i])) {
            builds.push(input[i]);
            // the latest "valid" released build
            if (input[i].name.indexOf('-') === -1 && isValidBuild(input[i])) {
                break;
            }
        }
    }
    return builds;
}

/**
 * Match the user's platform information to the VSIX name relevant to them.
 * @param info Information about the user's operating system.
 * @return VSIX filename for the extension's releases matched to the user's platform.
 */
export function vsixNameForPlatform(info: PlatformInformation): string {
    const vsixName: string | undefined = function(platformInfo): string | undefined {
        switch (platformInfo.platform) {
            case 'win32':
                switch (platformInfo.architecture) {
                    case 'x64': return 'cpptools-win32.vsix'; // TODO: Change to cpptools-win64?
                    case 'x86': return 'cpptools-win32.vsix';
                    case 'arm64': return 'cpptools-win-arm64.vsix';
                    default: throw new Error(`Unexpected Windows architecture: ${platformInfo.architecture}`);
                }
            case 'darwin':
                switch (platformInfo.architecture) {
                    case 'x64': return 'cpptools-osx.vsix';
                    case 'arm64': return 'cpptools-osx-arm64.vsix';
                    default: throw new Error(`Unexpected macOS architecture: ${platformInfo.architecture}`);
                }
            default: {
                switch (platformInfo.architecture) {
                    case 'x64': return 'cpptools-linux.vsix';
                    case 'arm': return 'cpptools-linux-armhf.vsix';
                    case 'arm64': return 'cpptools-linux-aarch64.vsix';
                    default: throw new Error(`Unexpected Linux architecture: ${platformInfo.architecture}`);
                }
            }
        }
    }(info);
    if (!vsixName) {
        throw new Error(`Failed to match VSIX name for: ${info.platform}: ${info.architecture}`);
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
 * @param isFromSettingsChange True if the invocation is the result of a settings change.
 * @return Download URL for the extension VSIX package that the user should install. If the user
 * does not need to update, resolves to undefined.
 */
export async function getTargetBuildInfo(updateChannel: string, isFromSettingsChange: boolean): Promise<BuildInfo | undefined> {
    const builds: Build[] | undefined = await getReleaseJson();
    if (!builds || builds.length === 0) {
        return undefined;
    }

    const userVersion: PackageVersion = new PackageVersion(util.packageJson.version);
    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, isFromSettingsChange);
    if (targetBuild === undefined) {
        // no action
        telemetry.logLanguageServerEvent("UpgradeCheck", { "action": "none" });
    } else if (userVersion.isExtensionVersionGreaterThan(new PackageVersion(targetBuild.name))) {
        // downgrade
        telemetry.logLanguageServerEvent("UpgradeCheck", { "action": "downgrade", "newVersion": targetBuild.name });
    } else {
        // upgrade
        telemetry.logLanguageServerEvent("UpgradeCheck", { "action": "upgrade", "newVersion": targetBuild.name });
    }

    if (!targetBuild) {
        return undefined;
    }
    const platformInfo: PlatformInformation = await PlatformInformation.GetPlatformInformation();
    const vsixName: string = vsixNameForPlatform(platformInfo);
    const downloadUrl: string = getVsixDownloadUrl(targetBuild, vsixName);
    if (!downloadUrl) {
        return undefined;
    }
    return { downloadUrl: downloadUrl, name: targetBuild.name };

}

/**
 * Determines whether there exists a Build in the given Build[] that should be installed.
 * @param builds The GitHub release list parsed as an array of Builds.
 * @param userVersion The verion of the extension that the user is running.
 * @param updateChannel The user's updateChannel setting.
 * @param isFromSettingsChange True if the invocation is the result of a settings change.
 * @return The Build if the user should update to it, otherwise undefined.
 */
export function getTargetBuild(builds: Build[], userVersion: PackageVersion, updateChannel: string, isFromSettingsChange: boolean): Build | undefined {
    if (!isFromSettingsChange && !vscode.workspace.getConfiguration("extensions", null).get<boolean>("autoUpdate")) {
        return undefined;
    }
    const latestVersionOnline: PackageVersion = new PackageVersion(builds[0].name);
    // Allows testing pre-releases without accidentally downgrading to the latest version
    if ((!testingInsidersVsixInstall && userVersion.suffix && userVersion.suffix !== 'insiders') ||
        userVersion.isExtensionVersionGreaterThan(latestVersionOnline)) {
        return undefined;
    }

    // Get predicates to determine the build to install, if any
    let needsUpdate: (installed: PackageVersion, target: PackageVersion) => boolean;
    let useBuild: (build: Build) => boolean;
    if (updateChannel === 'Insiders') {
        needsUpdate = (installed: PackageVersion, target: PackageVersion) => testingInsidersVsixInstall || (!target.isEqual(installed));
        // Check if the assets are available
        useBuild = isValidBuild;
    } else if (updateChannel === 'Default') {
        // If the updateChannel switches from 'Insiders' to 'Default', a downgrade to the latest non-insiders release is needed.
        needsUpdate = function(installed: PackageVersion, target: PackageVersion): boolean {
            return installed.isExtensionVersionGreaterThan(target); };
        // Look for the latest non-insiders released build
        useBuild = (build: Build): boolean => build.name.indexOf('-') === -1 && isValidBuild(build);
    } else {
        throw new Error('Incorrect updateChannel setting provided');
    }

    // Get the build to install
    const targetBuild: Build | undefined = builds.find(useBuild);
    if (!targetBuild) {
        throw new Error('Failed to determine installation candidate');
    }

    // Check current version against target's version to determine if the installation should happen
    const targetVersion: PackageVersion = new PackageVersion(targetBuild.name);
    if (needsUpdate(userVersion, targetVersion)) {
        return targetBuild;
    } else {
        return undefined;
    }
}

interface Rate {
    remaining: number;
}

interface RateLimit {
    rate: Rate;
}

function isRate(input: any): input is Rate {
    return input && util.isNumber(input.remaining);
}

function isRateLimit(input: any): input is RateLimit {
    return input && isRate(input.rate);
}

async function getRateLimit(): Promise<RateLimit | undefined> {
    const header: OutgoingHttpHeaders = { 'User-Agent': 'vscode-cpptools' };
    try {
        const data: string = await util.downloadFileToStr('https://api.github.com/rate_limit', header);
        if (!data) {
            return undefined;
        }
        let rateLimit: any;
        try {
            rateLimit = JSON.parse(data);
        } catch (error) {
            throw new Error('Failed to parse rate limit JSON');
        }

        if (isRateLimit(rateLimit)) {
            return rateLimit;
        } else {
            throw new Error('Rate limit JSON is not of type RateLimit');
        }

    } catch (errJS) {
        const err: NodeJS.ErrnoException = errJS as NodeJS.ErrnoException;
        if (err && err.code && err.code !== "ENOENT") {
            // Only throw if the user is connected to the Internet.
            throw new Error('Failed to download rate limit JSON');
        }
    }
}

async function rateLimitExceeded(): Promise<boolean> {
    const rateLimit: RateLimit | undefined = await getRateLimit();
    return rateLimit !== undefined && rateLimit.rate.remaining <= 0;
}

/**
 * Download and parse the release list JSON from the GitHub API into a Build[].
 * @return Information about the released builds of the C/C++ extension.
 */
async function getReleaseJson(): Promise<Build[] | undefined> {
    if (await rateLimitExceeded()) {
        throw new Error('Failed to stay within GitHub API rate limit');
    }

    // Download release JSON
    const releaseUrl: string = 'https://api.github.com/repos/Microsoft/vscode-cpptools/releases';
    const header: OutgoingHttpHeaders = { 'User-Agent': 'vscode-cpptools' };

    try {
        const data: string = await util.downloadFileToStr(releaseUrl, header);
        if (!data) {
            return undefined;
        }

        // Parse the file
        let releaseJson: any;
        try {
            releaseJson = JSON.parse(data);
        } catch (error) {
            throw new Error('Failed to parse release JSON');
        }

        // Find the latest released builds.
        const builds: Build[] = getArrayOfBuilds(releaseJson);
        if (!builds || builds.length === 0) {
            throw new Error('Release JSON is not of type Build[]');
        } else {
            return builds;
        }
    } catch (errJS) {
        const err: NodeJS.ErrnoException = errJS as NodeJS.ErrnoException;
        if (err && err.code && err.code !== "ENOENT") {
            // Only throw if the user is connected to the Internet.
            throw new Error('Failed to download release JSON');
        }
    }
}
