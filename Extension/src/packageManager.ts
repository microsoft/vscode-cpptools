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
import * as nls from 'vscode-nls';
import { Readable } from 'stream';
import * as crypto from 'crypto';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export function isValidPackage(buffer: Buffer, integrity: string): boolean {
    if (integrity && integrity.length > 0) {
        const hash: crypto.Hash = crypto.createHash('sha256');
        hash.update(buffer);
        const value: string = hash.digest('hex').toUpperCase();
        return (value === integrity.toUpperCase());
    }
    // No integrity has been specified
    return false;
}

export interface IPackage {
    // Description of the package
    description: string;

    // URL of the package
    url: string;

    // Platforms for which the package should be downloaded
    platforms: string[];

    // Architectures for which the package is applicable
    architectures: string[];

    // OS Version regex to check if package is applicable
    versionRegex: string;

    // A flag to indicate if 'versionRegex' should match or not match.
    // Required if versionRegex is used. Default is false.
    matchVersion: boolean;

    // Binaries in the package that should be executable when deployed
    binaries: string[];

    // Internal location to which the package was downloaded
    tmpFile: tmp.FileResult;

    // sha256 hash of the package
    integrity: string;
}

export class PackageManagerError extends Error {
    public localizedMessageText: string;

    constructor(
        public message: string,
        public localizedMessage: string,
        public methodName: string,
        public pkg: IPackage | null = null,
        public innerError: any = null,
        public errorCode: string = '') {
        super(message);
        this.localizedMessageText = localizedMessage;
    }
}

export class PackageManagerWebResponseError extends PackageManagerError {
    constructor(
        public socket: net.Socket,
        public message: string,
        public localizedMessage: string,
        public methodName: string,
        public pkg: IPackage | null = null,
        public innerError: any = null,
        public errorCode: string = '') {
        super(message, localizedMessage, methodName, pkg, innerError, errorCode);
    }
}

export class PackageManager {
    private allPackages?: IPackage[];

    public constructor(
        private platformInfo: PlatformInformation,
        private outputChannel?: Logger) {
        // Ensure our temp files get cleaned up in case of error
        tmp.setGracefulCleanup();
    }

    public DownloadPackages(progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void | null> {
        return this.GetPackages()
            .then((packages) => {
                let count: number = 1;
                return this.BuildPromiseChain(packages, (pkg): Promise<void> => {
                    const p: Promise<void> = this.DownloadPackage(pkg);
                    progress.report({ message: localize("downloading.progress.description", "Downloading {0}", pkg.description), increment: this.GetIncrement(count, packages.length) });
                    count += 1;
                    return p;
                });
            });
    }

    public InstallPackages(progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void | null> {
        return this.GetPackages()
            .then((packages) => {
                let count: number = 1;
                return this.BuildPromiseChain(packages, (pkg): Promise<void> => {
                    const p: Promise<void> = this.InstallPackage(pkg);
                    progress.report({ message: localize("installing.progress.description", "Installing {0}", pkg.description), increment: this.GetIncrement(count, packages.length) });
                    count += 1;
                    return p;
                });
            });
    }

    private GetIncrement(curStep: number, totalSteps: number): number {
        // The first half of the progress bar is assigned to download progress,
        // and the second half of the progress bar is assigned to install progress.
        const maxIncrement: number = 100 / 2;
        const increment: number = Math.floor(maxIncrement / totalSteps);
        return (curStep !== totalSteps) ? increment : maxIncrement - (totalSteps - 1) * increment;
    }

    public GetPackages(): Promise<IPackage[]> {
        return this.GetPackageList()
            .then((list) =>
                list.filter((value, index, array) =>
                    ArchitecturesMatch(value, this.platformInfo) &&
                        PlatformsMatch(value, this.platformInfo) &&
                        VersionsMatch(value, this.platformInfo)
                )
            );
    }

    /** Builds a chain of promises by calling the promiseBuilder function once per item in the list.
     *  Like Promise.all, but runs the promises in sequence rather than simultaneously.
     */
    private BuildPromiseChain<TItem, TPromise>(items: TItem[], promiseBuilder: (item: TItem) => Promise<TPromise>): Promise<TPromise | null> {
        let promiseChain: Promise<TPromise | null> = Promise.resolve<TPromise | null>(null);

        for (const item of items) {
            promiseChain = promiseChain.then(() => promiseBuilder(item));
        }

        return promiseChain;
    }

    private GetPackageList(): Promise<IPackage[]> {
        return new Promise<IPackage[]>((resolve, reject) => {
            if (!this.allPackages) {
                if (util.packageJson.runtimeDependencies) {
                    this.allPackages = <IPackage[]>util.packageJson.runtimeDependencies;

                    // Convert relative binary paths to absolute
                    for (const pkg of this.allPackages) {
                        if (pkg.binaries) {
                            pkg.binaries = pkg.binaries.map((value) => util.getExtensionFilePath(value));
                        }
                    }

                    resolve(this.allPackages);
                } else {
                    reject(new PackageManagerError("Package manifest does not exist", localize("package.manager.missing", 'Package manifest does not exist'), 'GetPackageList'));
                }
            } else {
                resolve(this.allPackages);
            }
        });
    }

    private async DownloadPackage(pkg: IPackage): Promise<void> {
        this.AppendChannel(localize("downloading.package", "Downloading package '{0}' ", pkg.description));

        const tmpResult: tmp.FileResult = await this.CreateTempFile(pkg);
        await this.DownloadPackageWithRetries(pkg, tmpResult);
    }

    private async CreateTempFile(pkg: IPackage): Promise<tmp.FileResult> {
        return new Promise<tmp.FileResult>((resolve, reject) => {
            tmp.file({ prefix: "package-" }, (err, path, fd, cleanupCallback) => {
                if (err) {
                    return reject(new PackageManagerError("Error from temp.file", localize("error.from", 'Error from {0}', "temp.file"), 'DownloadPackage', pkg, err));
                }

                return resolve(<tmp.FileResult>{ name: path, fd: fd, removeCallback: cleanupCallback });
            });
        });
    }

    private async DownloadPackageWithRetries(pkg: IPackage, tmpResult: tmp.FileResult): Promise<void> {
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
                    this.AppendChannel(" " + localize("failed.download.url", "Failed to download {0}", pkg.url));
                    throw error;
                } else {
                    this.AppendChannel(" " + localize("failed.retrying", "Failed. Retrying..."));
                    continue;
                }
            }
        } while (!success && retryCount < MAX_RETRIES);

        this.AppendLineChannel(" " + localize("done", "Done!"));
        if (retryCount !== 0) {
            // Log telemetry to see if retrying helps.
            const telemetryProperties: { [key: string]: string } = {};
            telemetryProperties["success"] = success ? `OnRetry${retryCount}` : 'false';
            if (lastError instanceof PackageManagerError) {
                const packageError: PackageManagerError = lastError;
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
        const parsedUrl: url.Url = url.parse(urlString);
        const proxyStrictSSL: any = vscode.workspace.getConfiguration().get("http.proxyStrictSSL", true);

        const options: https.RequestOptions = {
            host: parsedUrl.host,
            path: parsedUrl.path,
            agent: util.getHttpsProxyAgent(),
            rejectUnauthorized: proxyStrictSSL
        };

        const buffers: Buffer[] = [];
        return new Promise<void>((resolve, reject) => {
            let secondsDelay: number = Math.pow(2, delay);
            if (secondsDelay === 1) {
                secondsDelay = 0;
            }
            if (secondsDelay > 4) {
                this.AppendChannel(localize("waiting.seconds", "Waiting {0} seconds...", secondsDelay));
            }
            setTimeout(() => {
                if (!pkg.tmpFile || pkg.tmpFile.fd === 0) {
                    return reject(new PackageManagerError('Temporary Package file unavailable', localize("temp.package.unavailable", 'Temporary Package file unavailable'), 'DownloadFile', pkg));
                }

                const handleHttpResponse: (response: IncomingMessage) => void = (response: IncomingMessage) => {
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        // Redirect - download from new location
                        let redirectUrl: string | string[];
                        if (typeof response.headers.location === "string") {
                            redirectUrl = response.headers.location;
                        } else {
                            if (!response.headers.location) {
                                return reject(new PackageManagerError('Invalid download location received', localize("invalid.download.location.received", 'Invalid download location received'), 'DownloadFile', pkg));
                            }
                            redirectUrl = response.headers.location[0];
                        }
                        return resolve(this.DownloadFile(redirectUrl, pkg, 0));
                    } else if (response.statusCode !== 200) {
                        if (response.statusCode === undefined || response.statusCode === null) {
                            return reject(new PackageManagerError('Invalid response code received', localize("invalid.response.code.received", 'Invalid response code received'), 'DownloadFile', pkg));
                        }
                        // Download failed - print error message
                        const errorMessage: string = localize("failed.web.error", "failed (error code '{0}')", response.statusCode);
                        return reject(new PackageManagerWebResponseError(response.socket, 'HTTP/HTTPS Response Error', localize("web.response.error", 'HTTP/HTTPS Response Error'), 'DownloadFile', pkg, errorMessage, response.statusCode.toString()));
                    } else {
                        // Downloading - hook up events
                        let contentLength: any = response.headers['content-length'];
                        if (typeof response.headers['content-length'] === "string") {
                            contentLength = response.headers['content-length'];
                        } else {
                            if (response.headers['content-length'] === undefined || response.headers['content-length'] === null) {
                                return reject(new PackageManagerError('Invalid content length location received', localize("invalid.content.length.received", 'Invalid content length location received'), 'DownloadFile', pkg));
                            }
                            contentLength = response.headers['content-length'][0];
                        }
                        const packageSize: number = parseInt(contentLength, 10);
                        const downloadPercentage: number = 0;
                        let dots: number = 0;
                        const tmpFile: fs.WriteStream = fs.createWriteStream("", { fd: pkg.tmpFile.fd });

                        this.AppendChannel(`(${Math.ceil(packageSize / 1024)} KB) `);

                        response.on('data', (data) => {
                            buffers.push(data);
                            // Update dots after package name in output console
                            const newDots: number = Math.ceil(downloadPercentage / 5);
                            if (newDots > dots) {
                                this.AppendChannel(".".repeat(newDots - dots));
                                dots = newDots;
                            }
                        });

                        response.on('end', () => {
                            const packageBuffer: Buffer = Buffer.concat(buffers);
                            if (isValidPackage(packageBuffer, pkg.integrity)) {
                                resolve();
                            } else {
                                reject(new PackageManagerError('Invalid content received. Hash is incorrect.', localize("invalid.content.received", 'Invalid content received. Hash is incorrect.'), 'DownloadFile', pkg));
                            }
                        });

                        response.on('error', (error) =>
                            reject(new PackageManagerWebResponseError(response.socket, 'HTTP/HTTPS Response Error', localize("web.response.error", 'HTTP/HTTPS Response Error'), 'DownloadFile', pkg, error.stack, error.name)));

                        // Begin piping data from the response to the package file
                        response.pipe(tmpFile, { end: false });
                    }
                };

                const request: ClientRequest = https.request(options, handleHttpResponse);

                request.on('error', (error) =>
                    reject(new PackageManagerError(
                        'HTTP/HTTPS Request error' + (urlString.includes("fwlink") ? ": fwlink" : ""),
                        localize("web.request.error", 'HTTP/HTTPS Request error') + (urlString.includes("fwlink") ? ": fwlink" : ""),
                        'DownloadFile', pkg, error.stack, error.message)));

                // Execute the request
                request.end();
            }, secondsDelay * 1000);
        });
    }

    private InstallPackage(pkg: IPackage): Promise<void> {
        this.AppendLineChannel(localize("installing.package", "Installing package '{0}'", pkg.description));

        return new Promise<void>((resolve, reject) => {
            if (!pkg.tmpFile || pkg.tmpFile.fd === 0) {
                return reject(new PackageManagerError('Downloaded file unavailable', localize("downloaded.unavailable", 'Downloaded file unavailable'), 'InstallPackage', pkg));
            }

            yauzl.fromFd(pkg.tmpFile.fd, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
                if (err || !zipfile) {
                    return reject(new PackageManagerError('Zip file error', localize("zip.file.error", 'Zip file error'), 'InstallPackage', pkg, err));
                }

                // setup zip file events

                // Keep track of any error that occurs, but don't resolve or reject the promise until the file is closed.
                let pendingError: Error | undefined;
                zipfile.on('close', () => {
                    if (!pendingError) {
                        resolve();
                    } else {
                        reject(pendingError);
                    }
                });

                zipfile.on('error', err => {
                    // Don't call reject() a second time.
                    // Errors can also arise from readStream and writeStream.
                    if (!pendingError) {
                        pendingError = new PackageManagerError('Zip file error', localize("zip.file.error", 'Zip file error'), 'InstallPackage', pkg, err, err.code);
                        zipfile.close();
                    }
                });

                zipfile.on('entry', (entry: yauzl.Entry) => {
                    const absoluteEntryPath: string = util.getExtensionFilePath(entry.fileName);

                    if (entry.fileName.endsWith("/")) {
                        // Directory - create it
                        mkdirp(absoluteEntryPath, { mode: 0o775 }, (err) => {
                            if (err) {
                                pendingError = new PackageManagerError('Error creating directory', localize("create.directory.error", 'Error creating directory'), 'InstallPackage', pkg, err, err.code);
                                zipfile.close();
                                return;
                            }

                            zipfile.readEntry();
                        });
                    } else {
                        util.checkFileExists(absoluteEntryPath).then((exists: boolean) => {
                            if (!exists) {
                                // File - extract it
                                zipfile.openReadStream(entry, (err, readStream: Readable | undefined) => {
                                    if (err || !readStream) {
                                        pendingError = new PackageManagerError('Error reading zip stream', localize("zip.stream.error", 'Error reading zip stream'), 'InstallPackage', pkg, err);
                                        zipfile.close();
                                        return;
                                    }

                                    mkdirp(path.dirname(absoluteEntryPath), { mode: 0o775 }, async (err) => {
                                        if (err) {
                                            pendingError = new PackageManagerError('Error creating directory', localize("create.directory.error", 'Error creating directory'), 'InstallPackage', pkg, err, err.code);
                                            zipfile.close();
                                            return;
                                        }

                                        // Create as a .tmp file to avoid partially unzipped files
                                        // counting as completed files.
                                        const absoluteEntryTempFile: string = absoluteEntryPath + ".tmp";
                                        if (await util.checkFileExists(absoluteEntryTempFile)) {
                                            try {
                                                await util.unlinkAsync(absoluteEntryTempFile);
                                            } catch (err) {
                                                pendingError = new PackageManagerError(`Error unlinking file ${absoluteEntryTempFile}`, localize("unlink.error", "Error unlinking file {0}", absoluteEntryTempFile), 'InstallPackage', pkg, err);
                                                zipfile.close();
                                                return;
                                            }
                                        }

                                        // Make sure executable files have correct permissions when extracted
                                        const fileMode: number = (this.platformInfo.platform !== "win32" && pkg.binaries && pkg.binaries.indexOf(absoluteEntryPath) !== -1) ? 0o755 : 0o664;
                                        const writeStream: fs.WriteStream = fs.createWriteStream(absoluteEntryTempFile, { mode: fileMode });

                                        writeStream.on('close', async () => {
                                            // Remove .tmp extension from the file, if there was no error.
                                            // Otherwise, delete it.
                                            // Don't move on to the next entry, if we've already called reject(), in
                                            // which case zipfile.close() will already have been called.
                                            if (!pendingError) {
                                                try {
                                                    await util.renameAsync(absoluteEntryTempFile, absoluteEntryPath);
                                                } catch (err) {
                                                    pendingError = new PackageManagerError(`Error renaming file ${absoluteEntryTempFile}`, localize("rename.error", "Error renaming file {0}", absoluteEntryTempFile), 'InstallPackage', pkg, err);
                                                    zipfile.close();
                                                    return;
                                                }
                                                // Wait until output is done writing before reading the next zip entry.
                                                // Otherwise, it's possible to try to launch the .exe before it is done being created.
                                                zipfile.readEntry();
                                            } else {
                                                try {
                                                    await util.unlinkAsync(absoluteEntryTempFile);
                                                } catch (err) {
                                                    // Ignore failure to delete temp file.  We already have an error to return.
                                                }
                                            }
                                        });

                                        readStream.on('error', (err) => {
                                            // Don't call reject() a second time.
                                            if (!pendingError) {
                                                pendingError = new PackageManagerError('Error in readStream', localize("read.stream.error", 'Error in read stream'), 'InstallPackage', pkg, err);
                                                zipfile.close();
                                            }
                                        });

                                        writeStream.on('error', (err) => {
                                            // Don't call reject() a second time.
                                            if (!pendingError) {
                                                pendingError = new PackageManagerError('Error in writeStream', localize("write.stream.error", 'Error in write stream'), 'InstallPackage', pkg, err);
                                                zipfile.close();
                                            }
                                        });

                                        readStream.pipe(writeStream);
                                    });
                                });
                            } else {
                                // Skip the message for text files, because there is a duplicate text file unzipped.
                                if (path.extname(absoluteEntryPath) !== ".txt") {
                                    this.AppendLineChannel(localize("file.already.exists", "Warning: File '{0}' already exists and was not updated.", absoluteEntryPath));
                                }
                                zipfile.readEntry();
                            }
                        });
                    }
                });

                zipfile.readEntry();
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
}

export function VersionsMatch(pkg: IPackage, info: PlatformInformation): boolean {
    if (pkg.versionRegex) {
        // If we have a versionRegex but did not get a platformVersion
        if (!info.version) {
            // If we are expecting to match the versionRegex, return false since there was no version found.
            //
            // If we are expecting to not match the versionRegex, return true since we are expecting to
            // not match the version string, the only match would be if versionRegex was not set.
            return !pkg.matchVersion;
        }
        const regex: RegExp = new RegExp(pkg.versionRegex);

        return (pkg.matchVersion ?
            regex.test(info.version) :
            !regex.test(info.version)
        );
    }

    // No versionRegex provided.
    return true;
}

export function ArchitecturesMatch(value: IPackage, info: PlatformInformation): boolean {
    return !value.architectures || (value.architectures.indexOf(info.architecture) !== -1);
}

export function PlatformsMatch(value: IPackage, info: PlatformInformation): boolean {
    return !value.platforms || value.platforms.indexOf(info.platform) !== -1;
}
