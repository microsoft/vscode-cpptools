/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as fs from 'fs';
import * as os from 'os';
import * as plist from 'plist';
import * as nls from 'vscode-nls';
import { LinuxDistribution } from './linuxDistribution';
import * as logger from './logger';
import { SessionState, SupportedWindowsVersions } from './sessionState';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export function GetOSName(processPlatform: string | undefined): string | undefined {
    switch (processPlatform) {
        case "win32": return "Windows";
        case "darwin": return "macOS";
        case "linux": return "Linux";
        default: return undefined;
    }
}

export class PlatformInformation {
    constructor(public platform: string, public architecture: string, public distribution?: LinuxDistribution, public version?: string) { }

    public static async GetPlatformInformation(): Promise<PlatformInformation> {
        const platform: string = os.platform();
        const architecture: string = PlatformInformation.GetArchitecture();
        let distribution: LinuxDistribution | undefined;
        let version: string | undefined;
        switch (platform) {
            case "win32":
                version = PlatformInformation.GetWindowsVersion();
                void SessionState.windowsVersion.set(version as SupportedWindowsVersions);
                break;
            case "linux":
                distribution = await LinuxDistribution.GetDistroInformation();
                break;
            case "darwin":
                version = await PlatformInformation.GetDarwinVersion();
                break;
            default:
                throw new Error(localize("unknown.os.platform", "Unknown OS platform"));
        }

        return new PlatformInformation(platform, architecture, distribution, version);
    }

    public static GetArchitecture(): string {
        const arch: string = os.arch();
        switch (arch) {
            case "arm64":
            case "arm":
                return arch;
            case "x32":
            case "ia32":
                return "x86";
            default:
                return "x64";
        }
    }

    private static GetDarwinVersion(): Promise<string> {
        const DARWIN_SYSTEM_VERSION_PLIST: string = "/System/Library/CoreServices/SystemVersion.plist";
        let productDarwinVersion: string = "";
        let errorMessage: string = "";

        if (fs.existsSync(DARWIN_SYSTEM_VERSION_PLIST)) {
            const systemVersionPListBuffer: Buffer = fs.readFileSync(DARWIN_SYSTEM_VERSION_PLIST);
            const systemVersionData: any = plist.parse(systemVersionPListBuffer.toString());
            if (systemVersionData) {
                productDarwinVersion = systemVersionData.ProductVersion;
            } else {
                errorMessage = localize("missing.plist.productversion", "Could not get ProduceVersion from SystemVersion.plist");
            }
        } else {
            errorMessage = localize("missing.darwin.systemversion.file", "Failed to find SystemVersion.plist in {0}.", DARWIN_SYSTEM_VERSION_PLIST);
        }

        if (errorMessage) {
            logger.getOutputChannel().appendLine(errorMessage);
            logger.showOutputChannel();
        }

        return Promise.resolve(productDarwinVersion);
    }

    private static GetWindowsVersion(): SupportedWindowsVersions {
        const version = os.release().split('.');
        if (version.length > 0) {
            if (version[0] === '10') {
                if (version.length > 2 && version[2].startsWith('1')) {
                    // 10.0.10240 - 10.0.190##
                    return '10';
                }
                // 10.0.22000+
                return '11';
            }
        }
        return '';
    }
}
