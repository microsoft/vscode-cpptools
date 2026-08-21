import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const supportedDigestLengths = new Map([
    ['sha256', 32],
    ['sha384', 48],
    ['sha512', 64]
]);

function calculateIntegrity(algorithm, content) {
    return `${algorithm}-${createHash(algorithm).update(content).digest('base64')}`;
}

function isValidSupportedDigest(digest) {
    const metadataSeparator = digest.indexOf('?');
    const digestWithoutMetadata = metadataSeparator === -1 ? digest : digest.slice(0, metadataSeparator);
    const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(digestWithoutMetadata);
    if (!match) {
        return false;
    }

    const [, algorithm, serializedDigest] = match;
    const decodedDigest = Buffer.from(serializedDigest, 'base64');
    return decodedDigest.length === supportedDigestLengths.get(algorithm)
        && decodedDigest.toString('base64').replace(/=+$/, '') === serializedDigest.replace(/=+$/, '');
}

function hasSupportedIntegrityAlgorithm(integrity) {
    return typeof integrity === 'string' && integrity.split(/\s+/).some(isValidSupportedDigest);
}

export { calculateIntegrity, hasSupportedIntegrityAlgorithm };