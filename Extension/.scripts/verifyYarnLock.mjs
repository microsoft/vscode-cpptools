import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies'];

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

function validateYarnLock(packageJsonPath, yarnLockPath) {
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const lockfile = fs.readFileSync(yarnLockPath, 'utf8');
    const missingSelectors = findMissingSelectors(manifest, lockfile);
    if (missingSelectors.length > 0) {
        throw new Error(`yarn.lock is missing selectors required by package.json:\n${missingSelectors.map(selector => `  ${selector}`).join('\n')}\nRun yarn install to update yarn.lock.`);
    }
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedUrl === import.meta.url) {
    const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const packageJsonPath = process.argv[2] ?? path.join(extensionRoot, 'package.json');
    const yarnLockPath = process.argv[3] ?? path.join(extensionRoot, 'yarn.lock');

    try {
        validateYarnLock(packageJsonPath, yarnLockPath);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}

export { findMissingSelectors, getExpectedSelectors, parseLockfileSelectors, validateYarnLock };
