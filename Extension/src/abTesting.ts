/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as url from 'url';
import * as https from 'https';
import { ClientRequest } from 'http';
import * as vscode from 'vscode';
import * as fs from 'fs';

import * as util from './common';
import * as Telemetry from './telemetry';
import { PersistentState } from './LanguageServer/persistentState';

const userBucketMax: number = 100;
const userBucketString: string = "CPP.UserBucket";
const localConfigFile: string = "cpptools.json";

interface Settings {
    defaultIntelliSenseEngine?: number;
    recursiveIncludes?: number;
}

export class ABTestSettings {
    private settings: Settings;
    private intelliSenseEngineDefault: PersistentState<number>;
    private recursiveIncludesDefault: PersistentState<number>;
    private bucket: PersistentState<number>;

    constructor() {
        this.intelliSenseEngineDefault = new PersistentState<number>("ABTest.1", 100);
        this.recursiveIncludesDefault = new PersistentState<number>("ABTest.2", 100);
        this.settings = {
            defaultIntelliSenseEngine: this.intelliSenseEngineDefault.Value,
            recursiveIncludes: this.recursiveIncludesDefault.Value
        };
        this.bucket = new PersistentState<number>(userBucketString, -1);
        if (this.bucket.Value === -1) {
            this.bucket.Value = Math.floor(Math.random() * userBucketMax) + 1; // Range is [1, userBucketMax].
        }

        this.updateSettingsAsync().then(() => {
            // Redownload cpptools.json after initialization so it's not blocked.
            // It'll be used the next time the extension reloads.
            this.downloadCpptoolsJsonPkgAsync();
        });

        // Redownload occasionally to prevent an extra reload during long sessions.
        setInterval(() => { this.downloadCpptoolsJsonPkgAsync(); }, 30 * 60 * 1000); // 30 minutes.
    }

    public get UseDefaultIntelliSenseEngine(): boolean {
        return this.settings.defaultIntelliSenseEngine ? this.settings.defaultIntelliSenseEngine >= this.bucket.Value : true;
    }

    public get UseRecursiveIncludes(): boolean {
        return this.settings.recursiveIncludes ? this.settings.recursiveIncludes >= this.bucket.Value : true;
    }

    private async updateSettingsAsync(): Promise<void> {
        const cpptoolsJsonFile: string = util.getExtensionFilePath(localConfigFile);
    
        try {
            const exists: boolean = await util.checkFileExists(cpptoolsJsonFile);
            if (exists) {
                const fileContent: string = await util.readFileText(cpptoolsJsonFile);
                let newSettings: Settings = <Settings>JSON.parse(fileContent);
                if (newSettings.defaultIntelliSenseEngine) {
                    this.intelliSenseEngineDefault.Value = newSettings.defaultIntelliSenseEngine;
                }
                if (newSettings.recursiveIncludes) {
                    this.recursiveIncludesDefault.Value = newSettings.recursiveIncludes;
                }
                this.settings = {
                    defaultIntelliSenseEngine: this.intelliSenseEngineDefault.Value,
                    recursiveIncludes: this.recursiveIncludesDefault.Value
                };
            }
        } catch (error) {
            // Ignore any cpptoolsJsonFile errors
        }
    }

    private downloadCpptoolsJsonPkgAsync(): Promise<void> {
        let hasError: boolean = false;
        let telemetryProperties: { [key: string]: string } = {};
        const localConfigPath: string = util.getExtensionFilePath(localConfigFile);
        return util.downloadFileToDestination("https://go.microsoft.com/fwlink/?linkid=852750", localConfigPath)
            .catch((error) => {
                // More specific error info is not likely to be helpful, and we get detailed download data from the initial install.
                hasError = true;
            })
            .then(() => {
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
