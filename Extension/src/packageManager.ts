/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as fs from 'fs';
import * as net from 'net';
import * as https from 'https';
import * as path from 'path';
import * as vscode from 'vscode';
import * as url from 'url';
import * as tmp from 'tmp';
import * as yauzl from 'yauzl';
import * as mkdirp from 'mkdirp';

import * as util from './common';
import { PlatformInformation } from './platform';
import * as Telemetry from './telemetry';
import { IncomingMessage, ClientRequest } from 'http';
import { Logger } from './logger';

export interface IPackage {
    // Description of the package
    description: string;

    // URL of the package
    url: string;

    // Platforms for which the package should be downloaded
    platforms: string[];

    // Architectures for which the package is applicable
    architectures: string[];

    // Binaries in the package that should be executable when deployed
    binaries: string[];

    // Internal location to which the package was downloaded
    tmpFile: tmp.SyncResult;
}

export class PackageManagerError extends Error {
    constructor(
        public message: string,
        public methodName: string,
        public pkg: IPackage = null,
        public innerError: any = null,
        public errorCode: string = '') {
        super(message);
    }
}

export class PackageManagerWebResponseError extends PackageManagerError {
    constructor(
        public socket: net.Socket,
        public message: string,
        public methodName: string,
        public pkg: IPackage = null,
        public innerError: any = null,
        public errorCode: string = '') {
        super(message, methodName, pkg, innerError, errorCode);
    }
}

export class PackageManager {
    private allPackages: IPackage[];

    public constructor(
        private platformInfo: PlatformInformation,
        private outputChannel?: Logger,
        private statusItem?: vscode.StatusBarItem) {
        // Ensure our temp files get cleaned up in case of error
        tmp.setGracefulCleanup();
    }

    public DownloadPackages(): Promise<void> {
        return this.GetPackages()
            .then((packages) => {
                return this.BuildPromiseChain(packages, (pkg) => this.DownloadPackage(pkg));
            });
    }

    public InstallPackages(): Promise<void> {
        return this.GetPackages()
            .then((packages) => {
                return this.BuildPromiseChain(packages, (pkg) => this.InstallPackage(pkg));
            });
    }

    /** Builds a chain of promises by calling the promiseBuilder function once per item in the list.
     *  Like Promise.all, but runs the promises in sequence rather than simultaneously.
     */
    private BuildPromiseChain<TItem, TPromise>(items: TItem[], promiseBuilder: (TItem) => Promise<TPromise>): Promise<TPromise> {
        let promiseChain: Promise<TPromise> = Promise.resolve<TPromise>(null);

        for (let item of items) {
            promiseChain = promiseChain.then(() => {
                return promiseBuilder(item);
            });
        }

        return promiseChain;
    }

    private GetPackageList(): Promise<IPackage[]> {
        return new Promise<IPackage[]>((resolve, reject) => {
            if (!this.allPackages) {
                if (util.packageJson.runtimeDependencies) {
                    this.allPackages = <IPackage[]>util.packageJson.runtimeDependencies;

                    // Convert relative binary paths to absolute
                    for (let pkg of this.allPackages) {
                        if (pkg.binaries) {
                            pkg.binaries = pkg.binaries.map((value) => {
                                return util.getExtensionFilePath(value);
                            });
                        }
                    }

                    resolve(this.allPackages);
                } else {
                    reject(new PackageManagerError('Package manifest does not exist', 'GetPackageList'));
                }
            } else {
                resolve(this.allPackages);
            }
        });
    }

    private GetPackages(): Promise<IPackage[]> {
        return this.GetPackageList()
            .then((list) => {
                return list.filter((value, index, array) => {
                    return (!value.architectures || value.architectures.indexOf(this.platformInfo.architecture) !== -1) &&
                        (!value.platforms || value.platforms.indexOf(this.platformInfo.platform) !== -1);
                });
            });
    }

    private async DownloadPackage(pkg: IPackage): Promise<void> {
        this.AppendChannel(`Downloading package '${pkg.description}' `);

        this.SetStatusText("$(cloud-download) Downloading packages...");
        this.SetStatusTooltip(`Downloading package '${pkg.description}'...`);

        const tmpResult: tmp.SyncResult = await this.CreateTempFile(pkg);
        await this.DownloadPackageWithRetries(pkg, tmpResult);
    }

    private async CreateTempFile(pkg: IPackage): Promise<tmp.SyncResult> {
        return new Promise<tmp.SyncResult>((resolve, reject) => {
            tmp.file({ prefix: "package-" }, (err, path, fd, cleanupCallback) => {
                if (err) {
                    return reject(new PackageManagerError('Error from temp.file', 'DownloadPackage', pkg, err));
                }

                return resolve(<tmp.SyncResult>{ name: path, fd: fd, removeCallback: cleanupCallback });
            });
        });
    }

    private async DownloadPackageWithRetries(pkg: IPackage, tmpResult: tmp.SyncResult): Promise<void> {
        pkg.tmpFile = tmpResult;

        let success: boolean = false;
        let lastError: any = null;
        let retryCount: number = 0;
        const MAX_RETRIES: number = 5;

        // Retry the download at most MAX_RETRIES times with 2-32 seconds delay.
        do {
            try {
                await this.DownloadFile(pkg.url, pkg, retryCount);
                success = true;
            } catch (error) {
                retryCount += 1;
                lastError = error;
                if (retryCount >= MAX_RETRIES) {
                    this.AppendChannel(` Failed to download ` + pkg.url);
                    throw error;
                } else {
                    // This will skip the success = true.
                    this.AppendChannel(` Failed. Retrying...`);
                    continue;
                }
            }
        } while (!success && retryCount < MAX_RETRIES);

        this.AppendLineChannel(" Done!");
        if (retryCount !== 0) {
            // Log telemetry to see if retrying helps.
            let telemetryProperties: { [key: string]: string } = {};
            telemetryProperties["success"] = `OnRetry${retryCount}`;
            if (lastError instanceof PackageManagerError) {
                let packageError: PackageManagerError = lastError;
                telemetryProperties['error.methodName'] = packageError.methodName;
                telemetryProperties['error.message'] = packageError.message;
                if (packageError.pkg) {
                    telemetryProperties['error.packageName'] = packageError.pkg.description;
                    telemetryProperties['error.packageUrl'] = packageError.pkg.url;
                }
                if (packageError.errorCode) {
                    telemetryProperties['error.errorCode'] = packageError.errorCode;
                }
            }
            Telemetry.logDebuggerEvent("acquisition", telemetryProperties);
        }
    }

    // reloadCpptoolsJson in main.ts uses ~25% of this function.
    private DownloadFile(urlString: any, pkg: IPackage, delay: number): Promise<void> {
        let parsedUrl: url.Url = url.parse(urlString);
        let proxyStrictSSL: any = vscode.workspace.getConfiguration().get("http.proxyStrictSSL", true);

        let options: https.RequestOptions = {
            host: parsedUrl.host,
            path: parsedUrl.path,
            agent: util.GetHttpsProxyAgent(),
            rejectUnauthorized: proxyStrictSSL
        };

        return new Promise<void>((resolve, reject) => {
            let secondsDelay: number = Math.pow(2, delay);
            if (secondsDelay === 1) {
                secondsDelay = 0;
            }
            if (secondsDelay > 4) {
                this.AppendChannel(`Waiting ${secondsDelay} seconds...`);
            }
            setTimeout(() => {
                if (!pkg.tmpFile || pkg.tmpFile.fd === 0) {
                    return reject(new PackageManagerError('Temporary Package file unavailable', 'DownloadFile', pkg));
                }

                let handleHttpResponse: (response: IncomingMessage) => void = (response: IncomingMessage) => {
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        // Redirect - download from new location
                        let redirectUrl: string | string[];
                        if (typeof response.headers.location === "string") {
                            redirectUrl = response.headers.location;
                        } else {
                            redirectUrl = response.headers.location[0];
                        }
                        return resolve(this.DownloadFile(redirectUrl, pkg, 0));
                    } else if (response.statusCode !== 200) {
                        // Download failed - print error message
                        let errorMessage: string = `failed (error code '${response.statusCode}')`;
                        return reject(new PackageManagerWebResponseError(response.socket, 'HTTP/HTTPS Response Error', 'DownloadFile', pkg, errorMessage, response.statusCode.toString()));
                    } else {
                        // Downloading - hook up events
                        let contentLength: any = response.headers['content-length'];
                        if (typeof response.headers['content-length'] === "string") {
                            contentLength = response.headers['content-length'];
                        } else {
                            contentLength = response.headers['content-length'][0];
                        }
                        let packageSize: number = parseInt(contentLength, 10);
                        let downloadedBytes: number = 0;
                        let downloadPercentage: number = 0;
                        let dots: number = 0;
                        let tmpFile: fs.WriteStream = fs.createWriteStream(null, { fd: pkg.tmpFile.fd });

                        this.AppendChannel(`(${Math.ceil(packageSize / 1024)} KB) `);

                        response.on('data', (data) => {
                            downloadedBytes += data.length;

                            // Update status bar item with percentage
                            let newPercentage: number = Math.ceil(100 * (downloadedBytes / packageSize));
                            if (newPercentage !== downloadPercentage) {
                                this.SetStatusTooltip(`Downloading package '${pkg.description}'... ${downloadPercentage}%`);
                                downloadPercentage = newPercentage;
                            }

                            // Update dots after package name in output console
                            let newDots: number = Math.ceil(downloadPercentage / 5);
                            if (newDots > dots) {
                                this.AppendChannel(".".repeat(newDots - dots));
                                dots = newDots;
                            }
                        });

                        response.on('end', () => {
                            return resolve();
                        });

                        response.on('error', (error) => {
                            return reject(new PackageManagerWebResponseError(response.socket, 'HTTP/HTTPS Response error', 'DownloadFile', pkg, error.stack, error.name));
                        });

                        // Begin piping data from the response to the package file
                        response.pipe(tmpFile, { end: false });
                    }
                };

                let request: ClientRequest = https.request(options, handleHttpResponse);

                request.on('error', (error) => {
                    return reject(new PackageManagerError('HTTP/HTTPS Request error' + (urlString.includes("fwlink") ? ": fwlink" : ""), 'DownloadFile', pkg, error.stack, error.message));
                });

                // Execute the request
                request.end();
            }, secondsDelay * 1000);
        });
    }

    private InstallPackage(pkg: IPackage): Promise<void> {
        this.AppendLineChannel(`Installing package '${pkg.description}'`);

        this.SetStatusText("$(desktop-download) Installing packages...");
        this.SetStatusTooltip(`Installing package '${pkg.description}'`);

        return new Promise<void>((resolve, reject) => {
            if (!pkg.tmpFile || pkg.tmpFile.fd === 0) {
                return reject(new PackageManagerError('Downloaded file unavailable', 'InstallPackage', pkg));
            }

            yauzl.fromFd(pkg.tmpFile.fd, { lazyEntries: true }, (err, zipfile) => {
                if (err) {
                    return reject(new PackageManagerError('Zip file error', 'InstallPackage', pkg, err));
                }

                // setup zip file events
                zipfile.on('end', () => {
                    return resolve();
                });

                zipfile.on('error', err => {
                    return reject(new PackageManagerError('Zip File Error', 'InstallPackage', pkg, err, err.code));
                });

                zipfile.readEntry();

                zipfile.on('entry', (entry: yauzl.Entry) => {
                    let absoluteEntryPath: string = util.getExtensionFilePath(entry.fileName);

                    if (entry.fileName.endsWith("/")) {
                        // Directory - create it
                        mkdirp.mkdirp(absoluteEntryPath, { mode: 0o775 }, (err) => {
                            if (err) {
                                return reject(new PackageManagerError('Error creating directory', 'InstallPackage', pkg, err, err.code));
                            }

                            zipfile.readEntry();
                        });
                    } else {
                        util.checkFileExists(absoluteEntryPath).then((exists: boolean) => {
                            if (!exists) {
                                // File - extract it
                                zipfile.openReadStream(entry, (err, readStream: fs.ReadStream) => {
                                    if (err) {
                                        return reject(new PackageManagerError('Error reading zip stream', 'InstallPackage', pkg, err));
                                    }

                                    readStream.on('error', (err) => {
                                        return reject(new PackageManagerError('Error in readStream', 'InstallPackage', pkg, err));
                                    });

                                    mkdirp.mkdirp(path.dirname(absoluteEntryPath), { mode: 0o775 }, async (err) => {
                                        if (err) {
                                            return reject(new PackageManagerError('Error creating directory', 'InstallPackage', pkg, err, err.code));
                                        }

                                        // Create as a .tmp file to avoid partially unzipped files 
                                        // counting as completed files.
                                        let absoluteEntryTempFile: string = absoluteEntryPath + ".tmp";
                                        if (fs.existsSync(absoluteEntryTempFile)) {
                                            try {
                                                await util.unlinkPromise(absoluteEntryTempFile);
                                            } catch (err) {
                                                return reject(new PackageManagerError(`Error unlinking file ${absoluteEntryTempFile}`, 'InstallPackage', pkg, err));
                                            }
                                        }

                                        // Make sure executable files have correct permissions when extracted
                                        let fileMode: number = (pkg.binaries && pkg.binaries.indexOf(absoluteEntryPath) !== -1) ? 0o755 : 0o664;
                                        let writeStream: fs.WriteStream = fs.createWriteStream(absoluteEntryTempFile, { mode: fileMode });

                                        writeStream.on('close', async () => {
                                            try {
                                                // Remove .tmp extension from the file.
                                                await util.renamePromise(absoluteEntryTempFile, absoluteEntryPath);
                                            } catch (err) {
                                                return reject(new PackageManagerError(`Error renaming file ${absoluteEntryTempFile}`, 'InstallPackage', pkg, err));
                                            }
                                            // Wait till output is done writing before reading the next zip entry.
                                            // Otherwise, it's possible to try to launch the .exe before it is done being created.
                                            zipfile.readEntry();
                                        });

                                        writeStream.on('error', (err) => {
                                            return reject(new PackageManagerError('Error in writeStream', 'InstallPackage', pkg, err));
                                        });

                                        readStream.pipe(writeStream);
                                    });
                                });
                            } else {
                                // Skip the message for text files, because there is a duplicate text file unzipped.
                                if (path.extname(absoluteEntryPath) !== ".txt") {
                                    this.AppendLineChannel(`Warning: File '${absoluteEntryPath}' already exists and was not updated.`);
                                }
                                zipfile.readEntry();
                            }
                        });
                    }
                });
            });
        }).then(() => {
            // Clean up temp file
            pkg.tmpFile.removeCallback();
        });
    }

    private AppendChannel(text: string): void {
        if (this.outputChannel) {
            this.outputChannel.append(text);
        }
    }

    private AppendLineChannel(text: string): void {
        if (this.outputChannel) {
            this.outputChannel.appendLine(text);
        }
    }

    private SetStatusText(text: string): void {
        if (this.statusItem) {
            this.statusItem.text = text;
            this.statusItem.show();
        }
    }

    private SetStatusTooltip(text: string): void {
        if (this.statusItem) {
            this.statusItem.tooltip = text;
            this.statusItem.show();
        }
    }
}