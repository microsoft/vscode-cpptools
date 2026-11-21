/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { beforeEach, describe, it } from 'mocha';
import { strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Uri, WorkspaceFolder } from 'vscode';
import proxyquire = require('proxyquire');

// The version reported by the auto-discovered clang-tidy, as settings.ts would cache it.
let cachedVersion: string | undefined;
// codeAnalysis.clangTidy.path per folder: undefined means the folder relies on auto-discovery.
let folderPaths: Map<string, string | undefined>;
let workspaceFolders: WorkspaceFolder[] | undefined;

const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));

function folderOf(resource: unknown): string | undefined {
    const uri: any = resource;
    return uri?.fsPath;
}

const configuration = {
    get: (key: string) => {
        // Only codeAnalysis.clangTidy.path is read by the getter under test.
        if (key === 'codeAnalysis.clangTidy.path') {
            return undefined;
        }
        return undefined;
    },
    inspect: () => ({ defaultValue: undefined })
};

const vscode = {
    extensions: { getExtension: () => ({ packageJSON: packageJson }) },
    workspace: {
        getConfiguration: (_section: string, resource: unknown) => {
            const fsPath = folderOf(resource);
            return {
                get: (key: string) => {
                    if (key === 'codeAnalysis.clangTidy.path') {
                        return fsPath ? folderPaths.get(fsPath) : undefined;
                    }
                    return undefined;
                },
                inspect: () => ({ defaultValue: undefined })
            };
        },
        get workspaceFolders() {
            return workspaceFolders;
        }
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
};

const load = proxyquire.noCallThru();
const common: typeof import('../../src/common') = load('../../src/common', {
    vscode,
    'vscode-languageclient': {},
    'vscode-tas-client': {},
    './logger': {},
    './platform': {},
    './telemetry': {}
});

// getCachedClangTidyVersion is replaced after loading, so the module keeps its own state.
const { CppSettings }: typeof import('../../src/LanguageServer/settings') = load('../../src/LanguageServer/settings', {
    vscode,
    '../common': { ...common, getCachedClangTidyVersion: () => cachedVersion },
    '../telemetry': {},
    './client': {},
    './editorConfig': {},
    './extension': {},
    './persistentState': {},
    './languageConfig': {}
});

function folder(fsPath: string): WorkspaceFolder {
    return { uri: { fsPath, scheme: 'file' } as Uri, name: fsPath, index: 0 };
}

function settingsFor(fsPath: string): InstanceType<typeof CppSettings> {
    return new CppSettings({ fsPath, scheme: 'file' } as Uri);
}

describe('clang-tidy version per resource', () => {
    beforeEach(() => {
        cachedVersion = '24.0.0';
        folderPaths = new Map<string, string | undefined>();
        workspaceFolders = undefined;
        void configuration;
    });

    it('reports the auto-discovered version when no folder overrides the path', () => {
        workspaceFolders = [folder('/a')];
        folderPaths.set('/a', undefined);
        strictEqual(settingsFor('/a').clangTidyVersion, '24.0.0');
    });

    it('reports nothing for a folder that sets its own clang-tidy path', () => {
        workspaceFolders = [folder('/a')];
        folderPaths.set('/a', '/opt/llvm-19/bin/clang-tidy');
        strictEqual(settingsFor('/a').clangTidyVersion, undefined);
    });

    it('reports nothing in a multi-root workspace where another folder overrides the path', () => {
        // Folder /a runs its own clang-tidy 19, /b relies on discovery. A translation unit from
        // /a can report a header under /b, and the diagnostic only carries the header's URI, so
        // the cached auto-discovered version says nothing about which binary ran. Falling back is
        // the only safe answer.
        workspaceFolders = [folder('/a'), folder('/b')];
        folderPaths.set('/a', '/opt/llvm-19/bin/clang-tidy');
        folderPaths.set('/b', undefined);
        strictEqual(settingsFor('/b').clangTidyVersion, undefined);
    });

    it('still reports the version when every folder relies on auto-discovery', () => {
        workspaceFolders = [folder('/a'), folder('/b')];
        folderPaths.set('/a', undefined);
        folderPaths.set('/b', undefined);
        strictEqual(settingsFor('/a').clangTidyVersion, '24.0.0');
        strictEqual(settingsFor('/b').clangTidyVersion, '24.0.0');
    });
});
