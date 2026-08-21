import fs from 'node:fs';
import path from 'node:path';

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

export { findPackageLockPaths };