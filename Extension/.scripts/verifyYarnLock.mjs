import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findPackageLockPaths } from './packageLockFiles.mjs';
import { hasSupportedIntegrityAlgorithm } from './subresourceIntegrity.mjs';

const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies'];

function isNetworkResolution(resolved) {
    return typeof resolved === 'string' && /^https?:\/\//i.test(resolved);
}

function parseLockfileKey(key) {
    const selectors = [];
    let selectorStart = 0;
    let quoted = false;
    let escaped = false;

    for (let index = 0; index < key.length; index++) {
        const character = key[index];
        if (escaped) {
            escaped = false;
        } else if (character === '\\' && quoted) {
            escaped = true;
        } else if (character === '"') {
            quoted = !quoted;
        } else if (character === ',' && !quoted) {
            selectors.push(key.slice(selectorStart, index));
            selectorStart = index + 1;
        }
    }
    selectors.push(key.slice(selectorStart));

    return selectors.map(selector => {
        const trimmedSelector = selector.trim();
        return trimmedSelector.startsWith('"') ? JSON.parse(trimmedSelector) : trimmedSelector;
    });
}

function parseLockfileSelectors(lockfile) {
    const selectors = new Set();
    for (const line of lockfile.split(/\r?\n/)) {
        if (/^[^\s#].*:\s*$/.test(line)) {
            for (const selector of parseLockfileKey(line.replace(/:\s*$/, ''))) {
                selectors.add(selector);
            }
        }
    }
    return selectors;
}

function getResolutionPackageName(pattern) {
    const segments = pattern.split('/');
    const packageName = segments.at(-1);
    const scope = segments.at(-2);
    return scope?.startsWith('@') ? `${scope}/${packageName}` : packageName;
}

function getExpectedSelectors(manifest) {
    const selectors = [];
    for (const section of dependencySections) {
        for (const [packageName, range] of Object.entries(manifest[section] ?? {})) {
            selectors.push(`${packageName}@${range}`);
        }
    }
    for (const [pattern, range] of Object.entries(manifest.resolutions ?? {})) {
        selectors.push(`${getResolutionPackageName(pattern)}@${range}`);
    }
    return selectors;
}

function findMissingSelectors(manifest, lockfile) {
    const lockfileSelectors = parseLockfileSelectors(lockfile);
    return getExpectedSelectors(manifest)
        .filter(selector => !lockfileSelectors.has(selector))
        .sort();
}

function findUnsupportedIntegrityEntries(lockfile) {
    const unsupportedEntries = [];
    let currentEntry;

    function finishEntry() {
        if (currentEntry && isNetworkResolution(currentEntry.resolved) && currentEntry.integrity === undefined) {
            unsupportedEntries.push({
                selector: currentEntry.selector,
                line: currentEntry.line,
                integrity: '<missing>'
            });
        }
    }

    for (const [index, line] of lockfile.split(/\r?\n/).entries()) {
        if (/^[^\s#].*:\s*$/.test(line)) {
            finishEntry();
            currentEntry = {
                selector: line.replace(/:\s*$/, ''),
                line: index + 1
            };
            continue;
        }

        if (!currentEntry) {
            continue;
        }

        const resolvedMatch = /^\s+resolved\s+(.+?)\s*$/.exec(line);
        if (resolvedMatch) {
            const serializedResolved = resolvedMatch[1];
            currentEntry.resolved = serializedResolved.startsWith('"') ? JSON.parse(serializedResolved) : serializedResolved;
            continue;
        }

        const integrityMatch = /^\s+integrity\s+(.+?)\s*$/.exec(line);
        if (!integrityMatch) {
            continue;
        }

        const serializedIntegrity = integrityMatch[1];
        const integrity = serializedIntegrity.startsWith('"') ? JSON.parse(serializedIntegrity) : serializedIntegrity;
        currentEntry.integrity = integrity;
        if (!hasSupportedIntegrityAlgorithm(integrity)) {
            unsupportedEntries.push({
                selector: currentEntry.selector,
                line: index + 1,
                integrity
            });
        }
    }
    finishEntry();

    return unsupportedEntries;
}

function findUnsupportedPackageLockIntegrityEntries(packageLock) {
    if (!packageLock.packages || typeof packageLock.packages !== 'object') {
        throw new Error('package-lock.json does not contain a packages object.');
    }

    const unsupportedEntries = [];
    for (const [packagePath, packageEntry] of Object.entries(packageLock.packages)) {
        if (packageEntry.integrity !== undefined && !hasSupportedIntegrityAlgorithm(packageEntry.integrity)) {
            unsupportedEntries.push({
                packagePath: packagePath || '<root>',
                integrity: typeof packageEntry.integrity === 'string' ? packageEntry.integrity : '<invalid>'
            });
        } else if (isNetworkResolution(packageEntry.resolved) && packageEntry.integrity === undefined) {
            unsupportedEntries.push({
                packagePath: packagePath || '<root>',
                integrity: '<missing>'
            });
        }
    }
    return unsupportedEntries;
}

function validateYarnLock(packageJsonPath, yarnLockPath) {
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const lockfile = fs.readFileSync(yarnLockPath, 'utf8');
    const missingSelectors = findMissingSelectors(manifest, lockfile);
    if (missingSelectors.length > 0) {
        throw new Error(`yarn.lock is missing selectors required by package.json:\n${missingSelectors.map(selector => `  ${selector}`).join('\n')}\nRun yarn install to update yarn.lock.`);
    }

    const unsupportedIntegrityEntries = findUnsupportedIntegrityEntries(lockfile);
    if (unsupportedIntegrityEntries.length > 0) {
        throw new Error(`yarn.lock contains packages without valid SHA-2 integrity:\n${unsupportedIntegrityEntries.map(entry => `  line ${entry.line}: ${entry.selector} (${entry.integrity})`).join('\n')}\nRun yarn install --update-checksums to update yarn.lock.`);
    }
}

function validatePackageLocks(packageLockPaths) {
    const unsupportedEntries = [];
    for (const packageLockPath of packageLockPaths) {
        const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
        for (const entry of findUnsupportedPackageLockIntegrityEntries(packageLock)) {
            unsupportedEntries.push({ packageLockPath, ...entry });
        }
    }

    if (unsupportedEntries.length > 0) {
        throw new Error(`package-lock.json files contain packages without valid SHA-2 integrity:\n${unsupportedEntries.map(entry => `  ${entry.packageLockPath}: ${entry.packagePath} (${entry.integrity})`).join('\n')}\nRun yarn update-package-lock-integrity for entries with valid SHA-1 integrity. Regenerate the affected lockfile to repair missing or malformed integrity.`);
    }
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedUrl === import.meta.url) {
    const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const repositoryRoot = path.resolve(extensionRoot, '..');
    const packageJsonPath = process.argv[2] ?? path.join(extensionRoot, 'package.json');
    const yarnLockPath = process.argv[3] ?? path.join(extensionRoot, 'yarn.lock');
    const packageLockPaths = findPackageLockPaths(repositoryRoot);

    try {
        validateYarnLock(packageJsonPath, yarnLockPath);
        validatePackageLocks(packageLockPaths);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}

export { findMissingSelectors, findUnsupportedIntegrityEntries, findUnsupportedPackageLockIntegrityEntries, getExpectedSelectors, parseLockfileSelectors, validatePackageLocks, validateYarnLock };
