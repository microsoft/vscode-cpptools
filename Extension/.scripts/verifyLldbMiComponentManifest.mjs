import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const componentParameters = [
    { repository: 'llvm_repo', commit: 'llvm_commit' },
    { repository: 'lldb_mi_repo', commit: 'lldb_mi_commit' }
];

function parseScalarParameter(template, parameterName) {
    const matches = [...template.matchAll(new RegExp(`^  ${parameterName}:\\s*(.*?)\\s*$`, 'gm'))];
    if (matches.length !== 1) {
        throw new Error(`Expected ${parameterName} to appear exactly once in the LLDB-MI template.`);
    }

    const serializedValue = matches[0][1];
    if (serializedValue.startsWith('"')) {
        const value = JSON.parse(serializedValue);
        if (typeof value !== 'string') {
            throw new Error(`Expected ${parameterName} to be a string.`);
        }
        return value;
    }
    if (serializedValue.startsWith("'")) {
        if (!serializedValue.endsWith("'")) {
            throw new Error(`Expected ${parameterName} to be a valid scalar value.`);
        }
        return serializedValue.slice(1, -1).replaceAll("''", "'");
    }
    if (!serializedValue || /\s/.test(serializedValue)) {
        throw new Error(`Expected ${parameterName} to be a non-empty scalar value.`);
    }
    return serializedValue;
}

function normalizeRepositoryUrl(repositoryUrl) {
    const normalizedUrl = new URL(repositoryUrl);
    normalizedUrl.hash = '';
    normalizedUrl.search = '';
    normalizedUrl.pathname = normalizedUrl.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
    return normalizedUrl.href.replace(/\/$/, '');
}

function getGitRegistrations(manifest) {
    if (!Array.isArray(manifest.registrations)) {
        throw new Error('Component manifest does not contain a registrations array.');
    }

    const registrations = new Map();
    for (const registration of manifest.registrations) {
        const component = registration?.component;
        if (component?.type !== 'git') {
            continue;
        }

        const repositoryUrl = component.git?.repositoryUrl;
        const commitHash = component.git?.commitHash;
        if (typeof repositoryUrl !== 'string' || typeof commitHash !== 'string') {
            throw new Error('Git component registrations require repositoryUrl and commitHash strings.');
        }

        const normalizedRepositoryUrl = normalizeRepositoryUrl(repositoryUrl);
        if (registrations.has(normalizedRepositoryUrl)) {
            throw new Error(`Component manifest contains duplicate registrations for ${repositoryUrl}.`);
        }
        registrations.set(normalizedRepositoryUrl, { repositoryUrl, commitHash });
    }
    return registrations;
}

function validateLldbMiComponentManifest(template, manifest) {
    const registrations = getGitRegistrations(manifest);
    const errors = [];

    for (const parameters of componentParameters) {
        const repositoryUrl = parseScalarParameter(template, parameters.repository);
        const commitHash = parseScalarParameter(template, parameters.commit);
        if (!/^[0-9a-f]{40}$/.test(commitHash)) {
            errors.push(`${parameters.commit} must be a 40-character lowercase Git commit hash.`);
            continue;
        }

        const registration = registrations.get(normalizeRepositoryUrl(repositoryUrl));
        if (!registration) {
            errors.push(`${parameters.repository} references ${repositoryUrl}, which is missing from the component manifest.`);
        } else if (registration.commitHash !== commitHash) {
            errors.push(`${parameters.commit} is ${commitHash}, but the component manifest registers ${registration.commitHash} for ${registration.repositoryUrl}.`);
        }
    }

    if (errors.length > 0) {
        throw new Error(`LLDB-MI component manifest validation failed:\n${errors.map(error => `  ${error}`).join('\n')}`);
    }
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedUrl === import.meta.url) {
    const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const manifestPath = process.argv[2] ?? path.join(extensionRoot, 'cgmanifest.json');
    const templatePath = process.argv[3] ?? path.join(extensionRoot, '..', 'Build', 'lldb-mi', 'lldb-mi.template.yml');

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const template = fs.readFileSync(templatePath, 'utf8');
        validateLldbMiComponentManifest(template, manifest);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}

export { normalizeRepositoryUrl, parseScalarParameter, validateLldbMiComponentManifest };