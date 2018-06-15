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
const intelliSenseEngineDefault: PersistentState<number> = new PersistentState<number>("ABTest.1", 100);
const recursiveIncludesDefault: PersistentState<number> = new PersistentState<number>("ABTest.2", 100);
const localConfigFile: string = "cpptools.json";

interface Settings {
    defaultIntelliSenseEngine?: number;
    recursiveIncludes?: number;
}

export class ABTestSettings {
    private bucket: PersistentState<number>;
    private settings: Settings = {
        defaultIntelliSenseEngine: intelliSenseEngineDefault.Value,
        recursiveIncludes: recursiveIncludesDefault.Value
    };

    constructor() {
        let bucketAssignment: number = Math.floor(Math.random() * userBucketMax) + 1; // Range is [1, userBucketMax].
        this.bucket = new PersistentState<number>(userBucketString, bucketAssignment);
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
                    intelliSenseEngineDefault.Value = newSettings.defaultIntelliSenseEngine;
                }
                if (newSettings.recursiveIncludes) {
                    recursiveIncludesDefault.Value = newSettings.recursiveIncludes;
                }
                this.settings = newSettings;
            }
        } catch (error) {
            // Ignore any cpptoolsJsonFile errors
        }
    }

    // NOTE: Code is copied from DownloadPackage in packageManager.ts, but with ~75% fewer lines.
    private downloadCpptoolsJsonAsync(urlString): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let parsedUrl: url.Url = url.parse(urlString);
            let request: ClientRequest = https.request({
                host: parsedUrl.host,
                path: parsedUrl.path,
                agent: util.getHttpsProxyAgent(),
                rejectUnauthorized: vscode.workspace.getConfiguration().get("http.proxyStrictSSL", true)
            }, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    let redirectUrl: string | string[];
                    if (typeof response.headers.location === "string") {
                        redirectUrl = response.headers.location;
                    } else {
                        redirectUrl = response.headers.location[0];
                    }
                    return resolve(this.downloadCpptoolsJsonAsync(redirectUrl)); // Redirect - download from new location
                }
                if (response.statusCode !== 200) {
                    return reject();
                }
                let downloadedBytes = 0; // tslint:disable-line
                let cppToolsJsonFile: fs.WriteStream = fs.createWriteStream(util.getExtensionFilePath(localConfigFile));
                response.on('data', (data) => { downloadedBytes += data.length; });
                response.on('end', () => { cppToolsJsonFile.close(); });
                cppToolsJsonFile.on('close', () => { resolve(); this.updateSettingsAsync(); });
                response.on('error', (error) => { reject(); });
                response.pipe(cppToolsJsonFile, { end: false });
            });
            request.on('error', (error) => { reject(); });
            request.end();
        });
    }

    private downloadCpptoolsJsonPkgAsync(): Promise<void> {
        let hasError: boolean = false;
        let telemetryProperties: { [key: string]: string } = {};
        return this.downloadCpptoolsJsonAsync("https://go.microsoft.com/fwlink/?linkid=852750")
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
