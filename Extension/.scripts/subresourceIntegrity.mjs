import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const digestLengths = new Map([
    ['sha1', 20],
    ['sha256', 32],
    ['sha384', 48],
    ['sha512', 64]
]);
const supportedAlgorithms = new Set(['sha256', 'sha384', 'sha512']);

function calculateIntegrity(algorithm, content) {
    return `${algorithm}-${createHash(algorithm).update(content).digest('base64')}`;
}

function getValidDigestAlgorithm(digest) {
    const metadataSeparator = digest.indexOf('?');
    const digestWithoutMetadata = metadataSeparator === -1 ? digest : digest.slice(0, metadataSeparator);
    const match = /^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(digestWithoutMetadata);
    if (!match) {
        return undefined;
    }

    const [, algorithm, serializedDigest] = match;
    const decodedDigest = Buffer.from(serializedDigest, 'base64');
    return decodedDigest.length === digestLengths.get(algorithm)
        && decodedDigest.toString('base64').replace(/=+$/, '') === serializedDigest.replace(/=+$/, '')
        ? algorithm
        : undefined;
}

function hasLockedIntegrity(integrity) {
    return typeof integrity === 'string' && integrity.split(/\s+/).some(digest => getValidDigestAlgorithm(digest) !== undefined);
}

function hasSupportedIntegrityAlgorithm(integrity) {
    return typeof integrity === 'string' && integrity.split(/\s+/).some(digest => supportedAlgorithms.has(getValidDigestAlgorithm(digest)));
}

export { calculateIntegrity, hasLockedIntegrity, hasSupportedIntegrityAlgorithm };