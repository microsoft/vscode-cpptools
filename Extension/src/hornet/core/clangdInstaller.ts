import * as fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as yauzl from 'yauzl';

// Official stable archives and SHA-256 digests from clangd/clangd release 22.1.6.
const version = '22.1.6';
const archives = {
    win32: { name: 'windows', sha256: 'ce54f16e0b4fd76d450eeda9664420b195360b73febcfe40e661108fa57f2ce1' },
    linux: { name: 'linux', sha256: 'a9c77443af2e447ed467e84771848d3a6ac1c56f84bcfcde717e66318de77cfa' },
    darwin: { name: 'mac', sha256: '631aef462556cbd74e0ebaae1778a38d1997d0ba3371652ca54f82652a179e7d' }
};
export function clangdDownload(platform: NodeJS.Platform, arch: string, musl = false) {
    if ((platform !== 'darwin' && arch !== 'x64') || (platform === 'darwin' && !['x64', 'arm64'].includes(arch))
        || !(platform in archives) || musl) {
        throw new Error(`Automatic clangd download is unavailable for ${platform}/${arch}${musl ? ' (musl)' : ''}. Install clangd with the host package manager; Hornet will discover it on retry.`);
    }
    const archive = archives[platform as keyof typeof archives];
    return { url: `https://github.com/clangd/clangd/releases/download/${version}/clangd-${archive.name}-${version}.zip`, sha256: archive.sha256 };
}

export async function downloadClangdArchive(url: string, file: string, report: (message: string) => void, proxy?: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
    const response = (address: string, redirects = 0): Promise<import('node:http').IncomingMessage> => new Promise((resolve, reject) => {
        const target = new URL(address);
        if (target.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname) || redirects > 5) {
            reject(new Error('Unexpected clangd download redirect.')); return;
        }
        const request = https.get(target, { agent, signal: controller.signal, headers: { 'User-Agent': 'Hornet-Cpp' } }, result => {
            if ([301, 302, 303, 307, 308].includes(result.statusCode ?? 0) && result.headers.location) {
                result.resume(); resolve(response(new URL(result.headers.location, target).href, redirects + 1)); return;
            }
            if (result.statusCode !== 200) { result.resume(); reject(new Error(`clangd download failed: HTTP ${result.statusCode}`)); return; }
            resolve(result);
        });
        request.on('error', reject);
    });
    try {
        const source = await response(url);
        let received = 0, lastReport = 0;
        const progress = new Transform({ transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (received > 256 * 1024 * 1024) { callback(new Error('clangd archive exceeds download limit.')); return; }
            if (Date.now() - lastReport > 1000) {
                report(`Downloading clangd: ${(received / 1024 / 1024).toFixed(1)} MB`); lastReport = Date.now();
            }
            callback(null, chunk);
        } });
        await pipeline(source, progress, createWriteStream(file, { flags: 'wx' }), { signal: controller.signal });
    } finally { clearTimeout(timeout); agent?.destroy(); }
}

export async function verifyClangdArchive(file: string, expected: string): Promise<void> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) { hash.update(chunk); }
    if (hash.digest('hex') !== expected) { throw new Error('clangd archive checksum mismatch. Please retry the download.'); }
}

export function extractClangdArchive(file: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
            if (error) { reject(error); return; }
            const fail = (reason: unknown) => { zip.close(); reject(reason); };
            let total = 0;
            zip.on('error', fail);
            zip.on('end', resolve);
            zip.on('entry', (entry: yauzl.Entry) => {
                void (async () => {
                    const parts = entry.fileName.split('/');
                    const root = path.resolve(destination);
                    const target = path.resolve(root, ...parts);
                    const mode = entry.externalFileAttributes >>> 16;
                    total += entry.uncompressedSize;
                    if (parts.some(part => part === '..' || part.includes(':') || part.includes('\\'))
                        || !target.startsWith(root + path.sep) || (mode & 0xf000) === 0xa000 || total > 1024 * 1024 * 1024) {
                        throw new Error('Unsafe clangd archive entry.');
                    }
                    if (entry.fileName.endsWith('/')) { await fs.mkdir(target, { recursive: true }); }
                    else {
                        await fs.mkdir(path.dirname(target), { recursive: true });
                        const stream = await new Promise<import('node:stream').Readable>((accept, decline) => zip.openReadStream(entry, (err, value) => err ? decline(err) : accept(value)));
                        await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: mode & 0o111 ? 0o755 : 0o644 }));
                    }
                    zip.readEntry();
                })().catch(fail);
            });
            zip.readEntry();
        });
    });
}

export interface ClangdInstallOptions {
    storagePath: string;
    report: (message: string) => void;
    proxy?: string;
}
const installations = new Map<string, Promise<string>>();
export function installClangd(options: ClangdInstallOptions): Promise<string> {
    const root = path.resolve(options.storagePath, 'clangd');
    const current = installations.get(root);
    if (current) { return current; }
    const operation = (async () => {
        const musl = process.platform === 'linux' && !((process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime);
        const asset = clangdDownload(process.platform, process.arch, musl);
        await fs.mkdir(root, { recursive: true });
        const temporary = await fs.mkdtemp(path.join(root, '.download-'));
        try {
            const archive = path.join(temporary, 'clangd.zip');
            await downloadClangdArchive(asset.url, archive, options.report, options.proxy);
            options.report('Verifying and extracting clangd');
            await verifyClangdArchive(archive, asset.sha256);
            const extracted = path.join(temporary, 'install');
            await extractClangdArchive(archive, extracted);
            const relative = path.join(`clangd_${version}`, 'bin', process.platform === 'win32' ? 'clangd.exe' : 'clangd');
            const binary = path.join(extracted, relative);
            if (process.platform !== 'win32') { await fs.chmod(binary, 0o755); }
            const { stdout } = await promisify(execFile)(binary, ['--version'], { windowsHide: true, timeout: 15000 });
            if (!/clangd version\s+\d+/i.test(stdout)) { throw new Error('Downloaded clangd could not be validated.'); }
            const installed = path.join(root, `${version}-${process.platform}-${process.arch}-${randomUUID()}`);
            await fs.rename(extracted, installed);
            options.report(`clangd ${version} installed`);
            return path.join(installed, relative);
        } finally {
            // Only remove the temporary directory created for this download.
            const target = path.resolve(temporary);
            if (path.dirname(target) === root && path.basename(target).startsWith('.download-')) {
                await fs.rm(target, { recursive: true, force: true });
            }
        }
    })();
    installations.set(root, operation);
    void operation.finally(() => installations.delete(root)).catch(() => {});
    return operation;
}
