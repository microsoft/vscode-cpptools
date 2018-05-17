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

const userBucketMax: number = 100;
const userBucketString: string = "CPP.UserBucket";

export function activate(context: vscode.ExtensionContext): void {
    if (context.globalState.get<number>(userBucketString, -1) === -1) {
        let bucket: number = Math.floor(Math.random() * userBucketMax) + 1; // Range is [1, userBucketMax].
        context.globalState.update(userBucketString, bucket);
    }

    setInterval(() => {
        // Redownload occasionally to prevent an extra reload during long sessions.
        downloadCpptoolsJsonPkg();
    }, 30 * 60 * 1000); // 30 minutes.
}

// NOTE: Code is copied from DownloadPackage in packageManager.ts, but with ~75% fewer lines.
function downloadCpptoolsJson(urlString): Promise<void> {
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
                return resolve(downloadCpptoolsJson(redirectUrl)); // Redirect - download from new location
            }
            if (response.statusCode !== 200) {
                return reject();
            }
            let downloadedBytes = 0; // tslint:disable-line
            let cppToolsJsonFile: fs.WriteStream = fs.createWriteStream(util.getExtensionFilePath("cpptools.json"));
            response.on('data', (data) => { downloadedBytes += data.length; });
            response.on('end', () => { cppToolsJsonFile.close(); });
            cppToolsJsonFile.on('close', () => { resolve(); });
            response.on('error', (error) => { reject(); });
            response.pipe(cppToolsJsonFile, { end: false });
        });
        request.on('error', (error) => { reject(); });
        request.end();
    });
}

export function downloadCpptoolsJsonPkg(): Promise<void> {
    let hasError: boolean = false;
    let telemetryProperties: { [key: string]: string } = {};
    return downloadCpptoolsJson("https://go.microsoft.com/fwlink/?linkid=852750")
        .catch((error) => {
            // More specific error info is not likely to be helpful, and we get detailed download data from the initial install.
            hasError = true;
        })
        .then(() => {
            telemetryProperties['success'] = (!hasError).toString();
            Telemetry.logDebuggerEvent("cpptoolsJsonDownload", telemetryProperties);
        });
}

export function processCpptoolsJson(cpptoolsString: string): Promise<void> {
    let cpptoolsObject: any = JSON.parse(cpptoolsString);
    let intelliSenseEnginePercentage: number = cpptoolsObject.intelliSenseEngine_default_percentage;
    let packageJson: any = util.getRawPackageJson();

    if (!packageJson.extensionFolderPath.includes(".vscode-insiders")) {
        let prevIntelliSenseEngineDefault: any = packageJson.contributes.configuration.properties["C_Cpp.intelliSenseEngine"].default;
        if (util.extensionContext.globalState.get<number>(userBucketString, userBucketMax + 1) <= intelliSenseEnginePercentage) {
            packageJson.contributes.configuration.properties["C_Cpp.intelliSenseEngine"].default = "Default";
        } else {
            packageJson.contributes.configuration.properties["C_Cpp.intelliSenseEngine"].default = "Tag Parser";
        }
        if (prevIntelliSenseEngineDefault !== packageJson.contributes.configuration.properties["C_Cpp.intelliSenseEngine"].default) {
            return util.writeFileText(util.getPackageJsonPath(), util.stringifyPackageJson(packageJson));
        }
    }
}