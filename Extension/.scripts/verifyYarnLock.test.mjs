import assert from 'node:assert/strict';
import test from 'node:test';
import { findMissingSelectors } from './verifyYarnLock.mjs';

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
