/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as util from './common';
import * as Telemetry from './telemetry';
import { PersistentState } from './LanguageServer/persistentState';
import * as fs from 'fs';
import { PackageVersion } from './packageVersion';

const userBucketMax: number = 100;
const userBucketString: string = "CPP.UserBucket";
const localConfigFile: string = "cpptools.json";
const minimumVSCodeVersionDefault: PackageVersion = new PackageVersion("1.43.2");

interface Settings {
    defaultIntelliSenseEngine?: number;
    recursiveIncludes?: number;
    gotoDefIntelliSense?: number;
    enhancedColorization?: number;
    // a map of <extensionVersion, vscodeVersion>
    // Note: the new dependency entries should be added in the beginning of the map.
    minimumVSCodeVersion: { [extensionVersion: string]: string };
}

export class ABTestSettings {
    private settings: Settings;
    private intelliSenseEngineDefault: PersistentState<number>;
    private recursiveIncludesDefault: PersistentState<number>;
    private gotoDefIntelliSenseDefault: PersistentState<number>;
    private enhancedColorizationDefault: PersistentState<number>;
    private minimumVSCodeVersionDefault: Map<string, string>;
    private bucket: PersistentState<number>;

    constructor() {
        this.intelliSenseEngineDefault = new PersistentState<number>("ABTest.1", 100);
        this.recursiveIncludesDefault = new PersistentState<number>("ABTest.2", 100);
        this.gotoDefIntelliSenseDefault = new PersistentState<number>("ABTest.3", 100);
        this.enhancedColorizationDefault = new PersistentState<number>("ABTest.4", 100);
        this.minimumVSCodeVersionDefault = new Map<string, string>();
        this.settings = {
            defaultIntelliSenseEngine: this.intelliSenseEngineDefault.Value,
            recursiveIncludes: this.recursiveIncludesDefault.Value,
            gotoDefIntelliSense: this.gotoDefIntelliSenseDefault.Value,
            enhancedColorization: this.enhancedColorizationDefault.Value,
            minimumVSCodeVersion: {}
        };
        this.bucket = new PersistentState<number>(userBucketString, -1);
        if (this.bucket.Value === -1) {
            this.bucket.Value = Math.floor(Math.random() * userBucketMax) + 1; // Range is [1, userBucketMax].
        }

        this.updateSettings();
        // Redownload cpptools.json after initialization so it's not blocked.
        // It'll be used the next time the extension reloads.
        this.downloadCpptoolsJsonPkgAsync();

        // Redownload occasionally to prevent an extra reload during long sessions.
        setInterval(() => { this.downloadCpptoolsJsonPkgAsync(); }, 30 * 60 * 1000); // 30 minutes.
    }

    public get UseRecursiveIncludes(): boolean {
        return util.isNumber(this.settings.recursiveIncludes) ? this.settings.recursiveIncludes >= this.bucket.Value : true;
    }

    public get UseGoToDefIntelliSense(): boolean {
        return util.isNumber(this.settings.gotoDefIntelliSense) ? this.settings.gotoDefIntelliSense >= this.bucket.Value : true;
    }

    public getMinimumVSCodeVersion(curExtension: PackageVersion): PackageVersion {
        if (this.minimumVSCodeVersionDefault.size === 0) {
            return minimumVSCodeVersionDefault;
        }
        for (const [extensionString, vscodeString] of this.minimumVSCodeVersionDefault) {
            const extensionPackage: PackageVersion = new PackageVersion(extensionString);
            const vscodePackage: PackageVersion = new PackageVersion(vscodeString);
            if (!extensionPackage.isGreaterThan(curExtension, undefined)) {
                return vscodePackage;
            }
        }
        return minimumVSCodeVersionDefault;
    }

    private updateSettings(): void {
        const cpptoolsJsonFile: string = util.getExtensionFilePath(localConfigFile);

        try {
            const exists: boolean = fs.existsSync(cpptoolsJsonFile);
            if (exists) {
                const fileContent: string = fs.readFileSync(cpptoolsJsonFile).toString();
                const newSettings: Settings = <Settings>JSON.parse(fileContent);
                this.intelliSenseEngineDefault.Value = util.isNumber(newSettings.defaultIntelliSenseEngine) ? newSettings.defaultIntelliSenseEngine : this.intelliSenseEngineDefault.DefaultValue;
                this.recursiveIncludesDefault.Value = util.isNumber(newSettings.recursiveIncludes) ? newSettings.recursiveIncludes : this.recursiveIncludesDefault.DefaultValue;
                this.gotoDefIntelliSenseDefault.Value = util.isNumber(newSettings.gotoDefIntelliSense) ? newSettings.gotoDefIntelliSense : this.gotoDefIntelliSenseDefault.DefaultValue;
                this.enhancedColorizationDefault.Value = util.isNumber(newSettings.enhancedColorization) ? newSettings.enhancedColorization : this.enhancedColorizationDefault.DefaultValue;
                const newMap: Map<string, string> = new Map<string, string>();
                if (newSettings.minimumVSCodeVersion) {
                    for (const [extensionVersion, vscodeVersion] of Object.entries(newSettings.minimumVSCodeVersion)) {
                        newMap.set(extensionVersion, <string> vscodeVersion);
                    }
                }
                this.minimumVSCodeVersionDefault = newSettings.minimumVSCodeVersion ? newMap : this.minimumVSCodeVersionDefault;
                this.settings = {
                    defaultIntelliSenseEngine: this.intelliSenseEngineDefault.Value,
                    recursiveIncludes: this.recursiveIncludesDefault.Value,
                    gotoDefIntelliSense: this.gotoDefIntelliSenseDefault.Value,
                    enhancedColorization: this.enhancedColorizationDefault.Value,
                    minimumVSCodeVersion: newSettings.minimumVSCodeVersion ? newSettings.minimumVSCodeVersion : this.settings.minimumVSCodeVersion
                };
            }
        } catch (error) {
            // Ignore any cpptoolsJsonFile errors
        }
    }

    private downloadCpptoolsJsonPkgAsync(): Promise<void> {
        let hasError: boolean = false;
        const telemetryProperties: { [key: string]: string } = {};
        const localConfigPath: string = util.getExtensionFilePath(localConfigFile);
        return util.downloadFileToDestination("https://go.microsoft.com/fwlink/?linkid=2097702", localConfigPath)
            .catch((error) => {
                // More specific error info is not likely to be helpful, and we get detailed download data from the initial install.
                hasError = true;
            })
            .then(() => {
                this.updateSettings();
                telemetryProperties['success'] = (!hasError).toString();
                Telemetry.logDebuggerEvent("cpptoolsJsonDownload", telemetryProperties);
            });
    }
}

let settings: ABTestSettings;

export function getABTestSettings(): ABTestSettings {
    if (!settings) {
        settings = new ABTestSettings();
    }
    return settings;
}
