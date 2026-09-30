import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScalarParameter, validateLldbMiComponentManifest } from './verifyLldbMiComponentManifest.mjs';

const template = `parameters:
  llvm_repo: https://github.com/llvm/llvm-project.git
  llvm_commit: 0d44201451f03ba907cdb268ddddfc3fa38a0ebd
  lldb_mi_repo: https://github.com/lldb-tools/lldb-mi.git
  lldb_mi_commit: 2388bd74133bc21eac59b2e2bf97f2a30770a315

jobs:
`;

function createManifest(llvmCommit = '0d44201451f03ba907cdb268ddddfc3fa38a0ebd') {
    return {
        registrations: [
            {
                component: {
                    type: 'git',
                    git: {
                        repositoryUrl: 'https://github.com/lldb-tools/lldb-mi',
                        commitHash: '2388bd74133bc21eac59b2e2bf97f2a30770a315'
                    }
                }
            },
            {
                component: {
                    type: 'git',
                    git: {
                        repositoryUrl: 'https://github.com/llvm/llvm-project',
                        commitHash: llvmCommit
                    }
                }
            }
        ]
    };
}

test('accepts matching build and component manifest pins', () => {
    assert.doesNotThrow(() => validateLldbMiComponentManifest(template, createManifest()));
});

test('reports a missing repository registration', () => {
    const manifest = createManifest();
    manifest.registrations.pop();

    assert.throws(
        () => validateLldbMiComponentManifest(template, manifest),
        /llvm_repo references https:\/\/github\.com\/llvm\/llvm-project\.git, which is missing/
    );
});

test('reports a stale registered commit', () => {
    assert.throws(
        () => validateLldbMiComponentManifest(template, createManifest('1111111111111111111111111111111111111111')),
        /llvm_commit is 0d44201451f03ba907cdb268ddddfc3fa38a0ebd, but the component manifest registers 1111111111111111111111111111111111111111/
    );
});

test('requires each build parameter exactly once', () => {
    assert.throws(
        () => parseScalarParameter(`${template}  llvm_repo: https://example.com/duplicate.git\n`, 'llvm_repo'),
        /Expected llvm_repo to appear exactly once/
    );
});