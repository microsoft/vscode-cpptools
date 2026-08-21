import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { findPackageLockPaths } from './packageLockFiles.mjs';
import { calculateIntegrity, hasSupportedIntegrityAlgorithm } from './subresourceIntegrity.mjs';

const approvedRegistryPrefix = 'https://pkgs.dev.azure.com/azure-public/VisualCpp/_packaging/cpp_PublicPackages/npm/registry/';
const approvedRegistryUrl = new URL(approvedRegistryPrefix);
const batchSize = 32;

function getPackageNameFromResolvedUrl(resolved, requireApprovedRegistry = true) {
    const parsedUrl = new URL(resolved);
    const usesApprovedRegistry = parsedUrl.protocol.toLowerCase() === approvedRegistryUrl.protocol
        && parsedUrl.host.toLowerCase() === approvedRegistryUrl.host
        && parsedUrl.pathname.startsWith(approvedRegistryUrl.pathname);
    if (requireApprovedRegistry && !usesApprovedRegistry) {
        throw new Error(`Package tarball is not hosted by the approved registry: ${resolved}`);
    }

    const relativeUrl = decodeURIComponent(requireApprovedRegistry ? parsedUrl.pathname.slice(approvedRegistryUrl.pathname.length) : parsedUrl.pathname.slice(1));
    const tarballSeparator = relativeUrl.indexOf('/-/');
    if (tarballSeparator <= 0) {
        throw new Error(`Package tarball URL has an unexpected format: ${resolved}`);
    }
    const packagePathSegments = relativeUrl.slice(0, tarballSeparator).split('/');
    const packageName = packagePathSegments.at(-1);
    const scope = packagePathSegments.at(-2);
    return scope?.startsWith('@') ? `${scope}/${packageName}` : packageName;
}

function updatePackageIntegrity(packageEntry, tarball) {
    const sha1Integrity = calculateIntegrity('sha1', tarball);
    if (!packageEntry.integrity.split(/\s+/).includes(sha1Integrity)) {
        throw new Error(`Downloaded tarball does not match the locked integrity for ${packageEntry.resolved}.`);
    }

    packageEntry.integrity = calculateIntegrity('sha512', tarball);
    return packageEntry.integrity;
}

function loadPackageLocks(packageLockPaths) {
    const packageLocks = [];
    const tarballsByUrl = new Map();
    const urlsByPackageId = new Map();
    const packageIdsByUrl = new Map();

    for (const packageLockPath of packageLockPaths) {
        const text = fs.readFileSync(packageLockPath, 'utf8');
        const packageLock = JSON.parse(text);
        if (!packageLock.packages || typeof packageLock.packages !== 'object') {
            throw new Error(`${packageLockPath} does not contain a packages object.`);
        }

        const indentation = /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';
        const newline = text.includes('\r\n') ? '\r\n' : '\n';
        packageLocks.push({ packageLockPath, packageLock, indentation, newline, originalText: text });

        for (const [packagePath, packageEntry] of Object.entries(packageLock.packages)) {
            const hasSupportedIntegrity = hasSupportedIntegrityAlgorithm(packageEntry.integrity);
            if (typeof packageEntry.integrity !== 'string') {
                if (typeof packageEntry.resolved === 'string' && /^https?:\/\//i.test(packageEntry.resolved)) {
                    throw new Error(`${packageLockPath}: ${packagePath || '<root>'} has a network resolution without locked integrity.`);
                }
                continue;
            }
            if (typeof packageEntry.resolved !== 'string' || typeof packageEntry.version !== 'string') {
                throw new Error(`${packageLockPath}: ${packagePath || '<root>'} has integrity without a resolved URL and version.`);
            }

            const packageName = getPackageNameFromResolvedUrl(packageEntry.resolved, !hasSupportedIntegrity);
            const packageId = `${packageName}@${packageEntry.version}`;
            const existingUrl = urlsByPackageId.get(packageId);
            if (existingUrl && existingUrl !== packageEntry.resolved) {
                throw new Error(`${packageId} resolves to more than one tarball URL.`);
            }
            urlsByPackageId.set(packageId, packageEntry.resolved);
            const existingPackageId = packageIdsByUrl.get(packageEntry.resolved);
            if (existingPackageId && existingPackageId !== packageId) {
                throw new Error(`${packageEntry.resolved} maps to both ${existingPackageId} and ${packageId}.`);
            }
            packageIdsByUrl.set(packageEntry.resolved, packageId);

            if (hasSupportedIntegrity) {
                continue;
            }

            let tarball = tarballsByUrl.get(packageEntry.resolved);
            if (!tarball) {
                tarball = { packageId, resolved: packageEntry.resolved, packageEntries: [] };
                tarballsByUrl.set(packageEntry.resolved, tarball);
            }
            tarball.packageEntries.push(packageEntry);
        }
    }

    return { packageLocks, tarballs: [...tarballsByUrl.values()] };
}

function applyPackedTarballs(batch, packedTarballs, packDestination) {
    const tarballsByPackageId = new Map(batch.map(tarball => [tarball.packageId, tarball]));
    const returnedPackageIds = new Set();

    for (const packedTarball of packedTarballs) {
        if (returnedPackageIds.has(packedTarball.id)) {
            throw new Error(`npm returned ${packedTarball.id} more than once.`);
        }
        returnedPackageIds.add(packedTarball.id);

        const tarball = tarballsByPackageId.get(packedTarball.id);
        if (!tarball) {
            throw new Error(`npm returned an unexpected package: ${packedTarball.id}.`);
        }
    }

    const missingPackageIds = [...tarballsByPackageId.keys()].filter(packageId => !returnedPackageIds.has(packageId));
    if (missingPackageIds.length > 0) {
        throw new Error(`npm did not return the requested packages: ${missingPackageIds.join(', ')}.`);
    }

    for (const packedTarball of packedTarballs) {
        const tarball = tarballsByPackageId.get(packedTarball.id);
        const tarballPath = path.resolve(packDestination, packedTarball.filename);
        if (path.dirname(tarballPath) !== packDestination) {
            throw new Error(`npm returned an unsafe tarball path: ${packedTarball.filename}.`);
        }
        const tarballBytes = fs.readFileSync(tarballPath);
        const sha1Hex = createHash('sha1').update(tarballBytes).digest('hex');
        const sha512Integrity = calculateIntegrity('sha512', tarballBytes);
        if (packedTarball.shasum !== sha1Hex || packedTarball.integrity !== sha512Integrity) {
            throw new Error(`npm metadata does not match the downloaded bytes for ${packedTarball.id}.`);
        }

        for (const packageEntry of tarball.packageEntries) {
            updatePackageIntegrity(packageEntry, tarballBytes);
        }
        fs.unlinkSync(tarballPath);
    }
}

function downloadAndUpdateTarballs(tarballs, temporaryRoot) {
    const packDestination = path.join(temporaryRoot, 'tarballs');
    const cache = path.join(temporaryRoot, 'cache');
    fs.mkdirSync(packDestination, { recursive: true });

    for (let batchStart = 0; batchStart < tarballs.length; batchStart += batchSize) {
        const batch = tarballs.slice(batchStart, batchStart + batchSize);
        const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const result = spawnSync(npmCommand, [
            'pack',
            ...batch.map(tarball => tarball.resolved),
            '--ignore-scripts',
            '--json',
            '--pack-destination', packDestination,
            '--cache', cache,
            '--audit=false',
            '--fund=false'
        ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

        if (result.status !== 0) {
            throw new Error(`npm pack failed:\n${result.stderr || result.stdout}`);
        }

        const packedTarballs = JSON.parse(result.stdout);
        applyPackedTarballs(batch, packedTarballs, packDestination);

        process.stdout.write(`Verified ${Math.min(batchStart + batch.length, tarballs.length)} of ${tarballs.length} package tarballs.\n`);
    }
}

function writePackageLocks(packageLocks, fileSystem = fs) {
    const pendingWrites = packageLocks
        .map(({ packageLockPath, packageLock, indentation, newline, originalText }) => ({
            packageLockPath,
            originalText,
            serialized: `${JSON.stringify(packageLock, null, indentation)}\n`.replaceAll('\n', newline),
            temporaryPath: `${packageLockPath}.${randomUUID()}.tmp`,
            probePath: `${packageLockPath}.${randomUUID()}.probe`,
            claimPath: `${packageLockPath}.${randomUUID()}.claim`,
            claimed: false,
            installed: false
        }))
        .filter(pendingWrite => pendingWrite.serialized !== pendingWrite.originalText);
    const operationErrors = [];

    try {
        for (const pendingWrite of pendingWrites) {
            fileSystem.writeFileSync(pendingWrite.temporaryPath, pendingWrite.serialized, { encoding: 'utf8', flag: 'wx' });
        }
        for (const pendingWrite of pendingWrites) {
            fileSystem.linkSync(pendingWrite.temporaryPath, pendingWrite.probePath);
            fileSystem.unlinkSync(pendingWrite.probePath);
        }
        for (const pendingWrite of pendingWrites) {
            fileSystem.renameSync(pendingWrite.packageLockPath, pendingWrite.claimPath);
            pendingWrite.claimed = true;
            if (fileSystem.readFileSync(pendingWrite.claimPath, 'utf8') !== pendingWrite.originalText) {
                throw new Error(`${pendingWrite.packageLockPath} changed while package tarballs were being verified.`);
            }
            fileSystem.linkSync(pendingWrite.temporaryPath, pendingWrite.packageLockPath);
            pendingWrite.installed = true;
        }

        for (const pendingWrite of pendingWrites) {
            if (fileSystem.readFileSync(pendingWrite.packageLockPath, 'utf8') !== pendingWrite.serialized
                || fileSystem.readFileSync(pendingWrite.claimPath, 'utf8') !== pendingWrite.originalText) {
                throw new Error(`${pendingWrite.packageLockPath} changed while package lockfiles were being replaced.`);
            }
        }
    } catch (error) {
        operationErrors.push(error);
        for (const pendingWrite of [...pendingWrites].reverse()) {
            if (!pendingWrite.claimed) {
                continue;
            }

            let currentPath;
            if (pendingWrite.installed) {
                currentPath = `${pendingWrite.packageLockPath}.${randomUUID()}.current`;
                try {
                    fileSystem.renameSync(pendingWrite.packageLockPath, currentPath);
                } catch (rollbackError) {
                    if (rollbackError.code !== 'ENOENT') {
                        operationErrors.push(rollbackError);
                        continue;
                    }
                    currentPath = undefined;
                }
            }

            let restorePath = pendingWrite.claimPath;
            if (currentPath) {
                try {
                    if (fileSystem.readFileSync(currentPath, 'utf8') !== pendingWrite.serialized) {
                        restorePath = currentPath;
                        operationErrors.push(new Error(`${pendingWrite.packageLockPath} changed while package lockfiles were being replaced; the concurrent content was preserved.`));
                    }
                } catch (rollbackError) {
                    operationErrors.push(rollbackError);
                    restorePath = currentPath;
                }
            }

            try {
                fileSystem.copyFileSync(restorePath, pendingWrite.packageLockPath, fs.constants.COPYFILE_EXCL);
            } catch (rollbackError) {
                if (rollbackError.code !== 'EEXIST') {
                    operationErrors.push(rollbackError);
                    continue;
                }
            }

            for (const cleanupPath of [pendingWrite.claimPath, currentPath]) {
                if (!cleanupPath) {
                    continue;
                }
                try {
                    fileSystem.unlinkSync(cleanupPath);
                } catch (cleanupError) {
                    if (cleanupError.code !== 'ENOENT') {
                        operationErrors.push(cleanupError);
                    }
                }
            }
        }
    }

    const replacementFailed = operationErrors.length > 0;
    for (const pendingWrite of pendingWrites) {
        for (const cleanupPath of replacementFailed
            ? [pendingWrite.temporaryPath, pendingWrite.probePath]
            : [pendingWrite.temporaryPath, pendingWrite.probePath, pendingWrite.claimPath]) {
            try {
                fileSystem.unlinkSync(cleanupPath);
            } catch (cleanupError) {
                if (cleanupError.code !== 'ENOENT') {
                    operationErrors.push(cleanupError);
                }
            }
        }
    }

    if (operationErrors.length > 0) {
        throw new AggregateError(operationErrors, 'Unable to update package-lock.json files atomically.');
    }
}

function formatError(error, indentation = '') {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof AggregateError)) {
        return `${indentation}${message}`;
    }

    const nestedErrors = error.errors.map(nestedError => formatError(nestedError, `${indentation}  `));
    return [
        `${indentation}${message}`,
        ...nestedErrors,
        `${indentation}Original or concurrent content may remain in adjacent .claim or .current files if rollback could not complete.`
    ].join('\n');
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedUrl === import.meta.url) {
    const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const repositoryRoot = path.resolve(extensionRoot, '..');
    const packageLockPaths = findPackageLockPaths(repositoryRoot);
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cpptools-package-integrity-'));

    try {
        const { packageLocks, tarballs } = loadPackageLocks(packageLockPaths);
        downloadAndUpdateTarballs(tarballs, temporaryRoot);
        writePackageLocks(packageLocks);
        process.stdout.write(`Updated ${tarballs.length} unique package tarballs in ${packageLocks.length} lockfiles.\n`);
    } catch (error) {
        process.stderr.write(`${formatError(error)}\n`);
        process.exitCode = 1;
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
}

export { applyPackedTarballs, formatError, getPackageNameFromResolvedUrl, loadPackageLocks, updatePackageIntegrity, writePackageLocks };