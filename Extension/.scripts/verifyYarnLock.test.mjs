import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import test from 'node:test';
import { findMissingSelectors, findUnsupportedIntegrityEntries, findUnsupportedPackageLockIntegrityEntries } from './verifyYarnLock.mjs';

const sha256Integrity = `sha256-${Buffer.alloc(32).toString('base64')}`;
const sha384Integrity = `sha384-${Buffer.alloc(48).toString('base64')}`;
const sha512Integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;

test('reports a stale resolution selector', () => {
    const manifest = { resolutions: { 'fast-uri': '^3.1.5' } };
    const lockfile = `fast-uri@^3.0.1, fast-uri@^3.1.4:
  version "3.1.5"
`;

    assert.deepEqual(findMissingSelectors(manifest, lockfile), ['fast-uri@^3.1.5']);
});

test('accepts direct, scoped, and nested resolution selectors', () => {
    const manifest = {
        dependencies: { '@scope/direct': '^1.0.0' },
        devDependencies: { 'gulp-typescript': '^5.0.1' },
        resolutions: {
            '@scope/resolved': '^2.0.0',
            'gulp-typescript/**/glob-parent': '^5.1.2',
            'parent/**/@nested/package': '~3.0.0'
        }
    };
    const lockfile = `"@nested/package@~3.0.0":
  version "3.0.1"

"@scope/direct@^1.0.0":
  version "1.0.0"

"@scope/resolved@^2.0.0":
  version "2.0.0"

glob-parent@^3.1.0, glob-parent@^5.1.2:
  version "5.1.2"

gulp-typescript@^5.0.1:
  version "5.0.1"
`;

    assert.deepEqual(findMissingSelectors(manifest, lockfile), []);
});

test('reports integrity values without a SHA-2 digest', () => {
    const lockfile = `legacy@1.0.0:
  version "1.0.0"
  integrity sha1-legacy

unsupported@1.0.0:
  version "1.0.0"
  integrity md5-unsupported

quoted@1.0.0:
  version "1.0.0"
  integrity "sha1-quoted"

invalid-sha2@1.0.0:
  version "1.0.0"
  integrity sha512-invalid

missing@1.0.0:
  version "1.0.0"
  resolved "HTTPS://registry.example/missing-1.0.0.tgz"

missing-resolution@1.0.0:
  version "1.0.0"

"remote-marker@https://example.test/@file:/package.tgz":
  version "1.0.0"

local@1.0.0:
  version "1.0.0"
  resolved "file:../local"

"local-selector@file:../local":
  version "1.0.0"
`;

    assert.deepEqual(findUnsupportedIntegrityEntries(lockfile), [
        { selector: 'legacy@1.0.0', line: 3, integrity: 'sha1-legacy' },
        { selector: 'unsupported@1.0.0', line: 7, integrity: 'md5-unsupported' },
        { selector: 'quoted@1.0.0', line: 11, integrity: 'sha1-quoted' },
        { selector: 'invalid-sha2@1.0.0', line: 15, integrity: 'sha512-invalid' },
        { selector: 'missing@1.0.0', line: 17, integrity: '<missing>' },
        { selector: 'missing-resolution@1.0.0', line: 21, integrity: '<missing>' },
        { selector: '"remote-marker@https://example.test/@file:/package.tgz"', line: 24, integrity: '<missing>' }
    ]);
});

test('accepts integrity values with a SHA-2 digest', () => {
    const lockfile = `sha256@1.0.0:
  integrity ${sha256Integrity}

sha384@1.0.0:
  integrity ${sha384Integrity}

sha512@1.0.0:
  integrity ${sha512Integrity}

multiple@1.0.0:
  integrity "sha1-legacy ${sha512Integrity}"

quoted@1.0.0:
  integrity "${sha512Integrity}"
`;

    assert.deepEqual(findUnsupportedIntegrityEntries(lockfile), []);
});

test('reports npm package entries without a SHA-2 digest', () => {
  const packageLock = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture' },
      'node_modules/legacy': { integrity: 'sha1-legacy' },
      'node_modules/unsupported': { integrity: 'md5-unsupported' },
      'node_modules/invalid-sha2': { integrity: 'sha512-invalid' },
      'node_modules/missing': { resolved: 'HTTPS://registry.example/missing-1.0.0.tgz' },
      'node_modules/missing-resolution': { version: '1.0.0' },
      'node_modules/local': { resolved: 'file:../local' },
      'node_modules/link': { link: true, resolved: 'packages/local' },
      'packages/local': { name: 'local', version: '1.0.0' },
      'node_modules/remote-link': { link: true, resolved: 'node_modules/remote-target' },
      'node_modules/remote-target': { version: '1.0.0', resolved: 'https://registry.example/remote-1.0.0.tgz' },
      'node_modules/malformed-link': { link: true },
      'node_modules/fake-bundled': { version: '1.0.0', inBundle: true },
      'node_modules/bundler': { integrity: sha512Integrity, bundleDependencies: ['bundled'] },
      'node_modules/bundler/node_modules/bundled': { version: '1.0.0', inBundle: true }
    }
  };

  assert.deepEqual(findUnsupportedPackageLockIntegrityEntries(packageLock), [
    { packagePath: 'node_modules/legacy', integrity: 'sha1-legacy' },
    { packagePath: 'node_modules/unsupported', integrity: 'md5-unsupported' },
    { packagePath: 'node_modules/invalid-sha2', integrity: 'sha512-invalid' },
    { packagePath: 'node_modules/missing', integrity: '<missing>' },
    { packagePath: 'node_modules/missing-resolution', integrity: '<missing>' },
    { packagePath: 'node_modules/remote-target', integrity: '<missing>' },
    { packagePath: 'node_modules/malformed-link', integrity: '<missing>' },
    { packagePath: 'node_modules/fake-bundled', integrity: '<missing>' }
  ]);
});

test('accepts npm package entries with a SHA-2 digest', () => {
  const packageLock = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture' },
      'node_modules/sha256': { integrity: sha256Integrity },
      'node_modules/sha384': { integrity: sha384Integrity },
      'node_modules/sha512': { integrity: sha512Integrity },
      'node_modules/multiple': { integrity: `sha1-legacy ${sha512Integrity}` }
    }
  };

  assert.deepEqual(findUnsupportedPackageLockIntegrityEntries(packageLock), []);
});
