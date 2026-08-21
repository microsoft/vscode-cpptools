import fs from 'node:fs';
import path from 'node:path';
import { hasLockedIntegrity } from './subresourceIntegrity.mjs';

const excludedDirectoryNames = new Set(['.git', 'node_modules']);

function findPackageLockPaths(repositoryRoot) {
    const packageLockPaths = [];

    function visit(directory) {
        const entries = fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory() && !excludedDirectoryNames.has(entry.name)) {
                visit(entryPath);
            } else if (entry.isFile() && entry.name === 'package-lock.json') {
                packageLockPaths.push(entryPath);
            }
        }
    }

    visit(repositoryRoot);
    return packageLockPaths;
}

function getWorkspaceTargetPath(packageEntry) {
    if (packageEntry.link !== true || typeof packageEntry.resolved !== 'string') {
        return undefined;
    }

    const workspacePath = packageEntry.resolved.replaceAll('\\', '/');
    const normalizedPath = path.posix.normalize(workspacePath);
    return workspacePath.length > 0
        && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(workspacePath)
        && !path.posix.isAbsolute(workspacePath)
        && normalizedPath === workspacePath
        && normalizedPath !== '.'
        && normalizedPath !== '..'
        && !normalizedPath.startsWith('../')
        ? normalizedPath
        : undefined;
}

function getWorkspacePaths(packages) {
    return new Set(Object.values(packages)
        .map(getWorkspaceTargetPath)
        .filter(workspacePath => workspacePath !== undefined)
        .filter(workspacePath => {
            const workspaceEntry = packages[workspacePath];
            return !workspacePath.split('/').includes('node_modules')
                && workspaceEntry !== undefined
                && workspaceEntry.resolved === undefined
                && workspaceEntry.integrity === undefined;
        }));
}

function isBundledPackageEntry(packages, packagePath, packageEntry) {
    if (packageEntry.inBundle !== true || !packagePath.includes('/node_modules/')) {
        return false;
    }

    let ancestorPath = packagePath.slice(0, packagePath.lastIndexOf('/node_modules/'));
    while (ancestorPath) {
        const ancestorEntry = packages[ancestorPath];
        if (ancestorEntry && hasLockedIntegrity(ancestorEntry.integrity)) {
            const relativePath = packagePath.slice(`${ancestorPath}/node_modules/`.length);
            const relativeSegments = relativePath.split('/');
            const packageName = relativeSegments[0].startsWith('@')
                ? relativeSegments.slice(0, 2).join('/')
                : relativeSegments[0];
            return Array.isArray(ancestorEntry.bundleDependencies) && ancestorEntry.bundleDependencies.includes(packageName);
        }

        const nextSeparator = ancestorPath.lastIndexOf('/node_modules/');
        if (nextSeparator === -1) {
            break;
        }
        ancestorPath = ancestorPath.slice(0, nextSeparator);
    }
    return false;
}

function isExplicitLocalPackageEntry(packages, workspacePaths, packagePath, packageEntry) {
    const normalizedPackagePath = packagePath.replaceAll('\\', '/');
    return workspacePaths.has(getWorkspaceTargetPath(packageEntry))
        || workspacePaths.has(normalizedPackagePath)
        || (packageEntry.link !== true && typeof packageEntry.resolved === 'string' && /^(?:file|link|workspace):/i.test(packageEntry.resolved))
        || isBundledPackageEntry(packages, normalizedPackagePath, packageEntry);
}

export { findPackageLockPaths, getWorkspacePaths, isExplicitLocalPackageEntry };