/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/method-signature-style */
/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * The code here is borrowed from https://github.com/microsoft/vscode-ripgrep
 *
 * The original code is used internally and not designed to be consumed via npm.
 * Since we needed the same functionality, I've borrowed the code and typescript-ified it.
 *
 */

import { resolve } from 'path';
import { verbose } from '../Text/streams';
import { filepath, mkdir } from './filepath';

const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const util = require('util');
const url = require('url');
const child_process = require('child_process');
const proxy_from_env = require('proxy-from-env');

const fsExists = util.promisify(fs.exists);

const tmpDir = path.join(os.tmpdir(), `vscode-ripgrep-cache`);

const fsUnlink = util.promisify(fs.unlink);
const fsMkdir = util.promisify(fs.mkdir);

const isWindows = os.platform() === 'win32';

const REPO = 'microsoft/ripgrep-prebuilt';

function isGithubUrl(_url: any) {
    return url.parse(_url).hostname === 'api.github.com';
}

function downloadWin(url: any, dest: any, opts: { headers: { [x: string]: any }; proxy: string | URL }) {
    return new Promise((resolve, reject) => {
        let userAgent;
        if (opts.headers['user-agent']) {
            userAgent = opts.headers['user-agent'];
            delete opts.headers['user-agent'];
        }
        const headerValues = Object.keys(opts.headers)
            .map(key => `\\"${key}\\"=\\"${opts.headers[key]}\\"`)
            .join('; ');
        const headers = `@{${headerValues}}`;
        verbose('Downloading with Invoke-WebRequest');
        dest = sanitizePathForPowershell(dest);
        let iwrCmd = `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -URI ${url} -UseBasicParsing -OutFile ${dest} -Headers ${headers}`;
        if (userAgent) {
            iwrCmd += ' -UserAgent ' + userAgent;
        }
        if (opts.proxy) {
            iwrCmd += ' -Proxy ' + opts.proxy;

            try {
                const { username, password } = new URL(opts.proxy);
                if (username && password) {
                    const decodedPassword = decodeURIComponent(password);
                    iwrCmd += ` -ProxyCredential (New-Object PSCredential ('${username}', (ConvertTo-SecureString '${decodedPassword}' -AsPlainText -Force)))`;
                }
            } catch (err) {
                reject(err);
            }
        }

        iwrCmd = `powershell "${iwrCmd}"`;

        child_process.exec(iwrCmd, (err: any) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(undefined);
        });
    });
}

function download(_url: { version: string; token: string | undefined; target: string; destDir: any; force: boolean }, dest?: any, opts?: any) {

    const proxy = proxy_from_env.getProxyForUrl(url.parse(_url));
    if (proxy !== '') {
        const HttpsProxyAgent = require('https-proxy-agent');
        opts = {
            ...opts,
            "agent": new HttpsProxyAgent(proxy),
            proxy
        };
    }

    if (isWindows) {
        // This alternative strategy shouldn't be necessary but sometimes on Windows the file does not get closed,
        // so unzipping it fails, and I don't know why.
        return downloadWin(_url, dest, opts);
    }

    if (opts.headers && opts.headers.authorization && !isGithubUrl(_url)) {
        delete opts.headers.authorization;
    }

    return new Promise((resolve, reject) => {
        verbose(`Download options: ${JSON.stringify(opts)}`);
        const outFile = fs.createWriteStream(dest);
        const mergedOpts = {
            ...url.parse(_url),
            ...opts
        };
        https.get(mergedOpts, (response: { statusCode: string | number; headers: Record<string, any>; pipe: (arg0: any) => void }) => {
            verbose('statusCode: ' + response.statusCode);
            if (response.statusCode === 302) {
                verbose('Following redirect to: ' + response.headers.location);
                return download(response.headers.location, dest, opts)
                    .then(resolve, reject);
            } else if (response.statusCode !== 200) {
                reject(new Error('Download failed with ' + response.statusCode));
                return;
            }

            response.pipe(outFile);
            outFile.on('finish', () => {
                resolve(undefined);
            });
        }).on('error', async (err: any) => {
            await fsUnlink(dest);
            reject(err);
        });
    });
}

function get(_url: string, opts: any) {
    verbose(`GET ${_url}`);

    const proxy = proxy_from_env.getProxyForUrl(url.parse(_url));
    if (proxy !== '') {
        const HttpsProxyAgent = require('https-proxy-agent');
        opts = {
            ...opts,
            "agent": new HttpsProxyAgent(proxy)
        };
    }

    return new Promise((resolve, reject) => {
        let result = '';
        opts = {
            ...url.parse(_url),
            ...opts
        };
        https.get(opts, (response: { statusCode: string | number; on: any }) => {
            if (response.statusCode !== 200) {
                reject(new Error('Request failed: ' + response.statusCode));
            }

            response.on('data', (d: any) => {
                result += d.toString();
            });

            response.on('end', () => {
                resolve(result);
            });

            response.on('error', (e: any) => {
                reject(e);
            });
        });
    });
}

function getApiUrl(repo: string, tag: any) {
    return `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
}

/**
 * @param opts
 * @param assetName
 * @param downloadFolder
 */
async function getAssetFromGithubApi(opts: Record<string, any>, assetName: string, downloadFolder: any) {
    const assetDownloadPath = path.join(downloadFolder, assetName);

    // We can just use the cached binary
    if (!opts.force && await fsExists(assetDownloadPath)) {
        verbose('Using cached download: ' + assetDownloadPath);
        return assetDownloadPath;
    }

    const downloadOpts = {
        headers: {
            'user-agent': 'vscode-ripgrep'
        } as Record<string, any>
    }as Record<string, any>;

    if (opts.token) {
        downloadOpts.headers.authorization = `token ${opts.token}`;
    }

    verbose(`Finding release for ${opts.version}`);
    const release = await get(getApiUrl(REPO, opts.version), downloadOpts) as string;
    let jsonRelease;
    try {
        jsonRelease = JSON.parse(release);
    } catch (e) {
        throw new Error('Malformed API response: ' + (e as any)?.stack);
    }

    if (!jsonRelease.assets) {
        throw new Error('Bad API response: ' + JSON.stringify(release));
    }

    const asset = jsonRelease.assets.find((a: { name: any }) => a.name === assetName);
    if (!asset) {
        throw new Error('Asset not found with name: ' + assetName);
    }

    verbose(`Downloading from ${asset.url}`);
    verbose(`Downloading to ${assetDownloadPath}`);

    downloadOpts.headers.accept = 'application/octet-stream';
    await download(asset.url, assetDownloadPath, downloadOpts);
}

function unzipWindows(zipPath: any, destinationDir: any) {
    return new Promise((resolve, reject) => {
        zipPath = sanitizePathForPowershell(zipPath);
        destinationDir = sanitizePathForPowershell(destinationDir);
        const expandCmd = 'powershell -ExecutionPolicy Bypass -Command Expand-Archive ' + ['-Path', zipPath, '-DestinationPath', destinationDir, '-Force'].join(' ');
        child_process.exec(expandCmd, (err: any, _stdout: any, stderr: string | undefined) => {
            if (err) {
                reject(err);
                return;
            }

            if (stderr) {
                verbose(stderr);
                reject(new Error(stderr));
                return;
            }

            verbose('Expand-Archive completed');
            resolve(undefined);
        });
    });
}

// Handle whitespace in filepath as powershell split's path with whitespaces
function sanitizePathForPowershell(path: string) {
    path = path.replace(/ /g, '` '); // replace whitespace with "` " as solution provided here https://stackoverflow.com/a/18537344/7374562
    return path;
}

function untar(zipPath: any, destinationDir: any) {
    return new Promise((resolve, reject) => {
        const unzipProc = child_process.spawn('tar', ['xvf', zipPath, '-C', destinationDir], { stdio: 'inherit' });
        unzipProc.on('error', (err: any) => {
            reject(err);
        });
        unzipProc.on('close', (code: number) => {
            verbose(`tar xvf exited with ${code}`);
            if (code !== 0) {
                reject(new Error(`tar xvf exited with ${code}`));
                return;
            }

            resolve(undefined);
        });
    });
}

async function unzipRipgrep(zipPath: any, destinationDir: any) {
    if (isWindows) {
        await unzipWindows(zipPath, destinationDir);
    } else {
        await untar(zipPath, destinationDir);
    }

    const expectedName = path.join(destinationDir, 'rg');
    if (await fsExists(expectedName)) {
        return expectedName;
    }

    if (await fsExists(expectedName + '.exe')) {
        return expectedName + '.exe';
    }

    throw new Error(`Expecting rg or rg.exe unzipped into ${destinationDir}, didn't find one.`);
}

async function dl (opts: Record<string, any>) {
    if (!opts.version) {
        return Promise.reject(new Error('Missing version'));
    }

    if (!opts.target) {
        return Promise.reject(new Error('Missing target'));
    }

    const extension = isWindows ? '.zip' : '.tar.gz';
    const assetName = ['ripgrep', opts.version, opts.target].join('-') + extension;

    if (!await fsExists(tmpDir)) {
        await fsMkdir(tmpDir);
    }

    const assetDownloadPath = path.join(tmpDir, assetName);
    try {
        await getAssetFromGithubApi(opts, assetName, tmpDir);
    } catch (e) {
        verbose('Deleting invalid download cache');
        try {
            await fsUnlink(assetDownloadPath);
        } catch (e) { /* ignore */ }

        throw e;
    }

    verbose(`Unzipping to ${opts.destDir}`);
    try {
        const destinationPath = await unzipRipgrep(assetDownloadPath, opts.destDir);
        if (!isWindows) {
            await util.promisify(fs.chmod)(destinationPath, '755');
        }
        return destinationPath;
    } catch (e) {
        verbose('Deleting invalid download');

        try {
            await fsUnlink(assetDownloadPath);
        } catch (e) { /* ignore */ }

        throw e;
    }
}

const VERSION = 'v13.0.0-10';
const ARM32_LINUX_VERSION = 'v13.0.0-4';// use this for arm-unknown-linux-gnueabihf until we can fix https://github.com/microsoft/ripgrep-prebuilt/issues/24

process.on('unhandledRejection', (reason, promise) => {
    verbose('Unhandled rejection: ', promise, 'reason:', reason);
});

async function getTarget() {
    const arch = process.env.npm_config_arch || os.arch();

    switch (os.platform()) {
        case 'darwin':
            return arch === 'arm64' ? 'aarch64-apple-darwin' :
                'x86_64-apple-darwin';
        case 'win32':
            return arch === 'x64' ? 'x86_64-pc-windows-msvc' :
                arch === 'arm' ? 'aarch64-pc-windows-msvc' :
                    'i686-pc-windows-msvc';
        case 'linux':
            return arch === 'x64' ? 'x86_64-unknown-linux-musl' :
                arch === 'arm' ? 'arm-unknown-linux-gnueabihf' :
                    arch === 'armv7l' ? 'arm-unknown-linux-gnueabihf' :
                        arch === 'arm64' ? 'aarch64-unknown-linux-musl' :
                            arch === 'ppc64' ? 'powerpc64le-unknown-linux-gnu' :
                                arch === 's390x' ? 's390x-unknown-linux-gnu' :
                                    'i686-unknown-linux-musl';
        default: throw new Error('Unknown platform: ' + os.platform());
    }
}

export async function downloadRipgrep() {

    const BIN_PATH = await mkdir(path.join(__dirname, '../../../../bin'));
    const targetPath = resolve(BIN_PATH, isWindows ? 'rg.exe' : 'rg');

    if (await filepath.isExecutable(targetPath)) {
        return targetPath;
    }

    const target = await getTarget();
    const opts = {
        version: target === "arm-unknown-linux-gnueabihf" ? ARM32_LINUX_VERSION : VERSION,
        token: process.env['GITHUB_TOKEN'],
        target,
        destDir: BIN_PATH,
        force: false
    };
    try {
        return await dl(opts);
    } catch (err) {
        if (err instanceof Error) {
            console.error(`Downloading ripgrep failed: ${err.stack}`);
        }
        throw err;
    }
    return targetPath;
}

