/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { afterEach, beforeEach, describe, it } from 'mocha';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import proxyquire = require('proxyquire');
import { getIncludeCleanupPreferences } from '../../src/LanguageServer/includeCleanupEditorConfig';

type WatcherEvent = 'create' | 'change' | 'delete';

class TestWatcher {
    public disposed = false;
    private readonly listeners: Record<WatcherEvent, (() => void)[]> = { create: [], change: [], delete: [] };

    constructor(public readonly directory: string) { }

    public onDidCreate(listener: () => void): void { this.listeners.create.push(listener); }
    public onDidChange(listener: () => void): void { this.listeners.change.push(listener); }
    public onDidDelete(listener: () => void): void { this.listeners.delete.push(listener); }
    public fire(event: WatcherEvent): void { this.listeners[event].forEach(listener => listener()); }
    public dispose(): void {
        this.disposed = true;
        this.listeners.create = [];
        this.listeners.change = [];
        this.listeners.delete = [];
    }
}

let workspaceDirectory: string | undefined;
const watchers: TestWatcher[] = [];
const vscode = {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    RelativePattern: class {
        constructor(public readonly baseUri: { fsPath: string }, public readonly pattern: string) { }
    },
    workspace: {
        getWorkspaceFolder: (uri: { fsPath: string }) =>
            workspaceDirectory && (uri.fsPath === workspaceDirectory || uri.fsPath.startsWith(workspaceDirectory + sep))
                ? { uri: { fsPath: workspaceDirectory } } : undefined,
        createFileSystemWatcher: (pattern: { baseUri: { fsPath: string }; pattern: string }) => {
            strictEqual(pattern.pattern, '.editorconfig');
            const watcher = new TestWatcher(pattern.baseUri.fsPath);
            watchers.push(watcher);
            return watcher;
        }
    }
};

const editorConfig: typeof import('../../src/LanguageServer/editorConfig') = proxyquire.noCallThru()(
    '../../src/LanguageServer/editorConfig', {
        vscode,
        '../common': { checkFileExistsSync: existsSync }
    });

describe('EditorConfig resolution and refresh', () => {
    let directory: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'cpptools-editorconfig-'));
        workspaceDirectory = undefined;
        watchers.length = 0;
        editorConfig.cachedEditorConfigSettings.clear();
        writeConfig('', 'root = true\n');
    });

    afterEach(() => {
        watchers.forEach(watcher => watcher.dispose());
        editorConfig.cachedEditorConfigSettings.clear();
        rmSync(directory, { recursive: true, force: true });
    });

    function writeConfig(relativeDirectory: string, content: string): void {
        const configDirectory = join(directory, relativeDirectory);
        mkdirSync(configDirectory, { recursive: true });
        writeFileSync(join(configDirectory, '.editorconfig'), content);
    }

    function getLevel(relativeFile = 'nested/sample.cpp'): string {
        const settings = editorConfig.getEditorConfigSettings(join(directory, relativeFile));
        return getIncludeCleanupPreferences(settings).removeUnusedErrorTagType;
    }

    function fire(directory: string, event: WatcherEvent): void {
        const watcher = watchers.find(watcher => watcher.directory === directory && !watcher.disposed);
        ok(watcher, `No active EditorConfig watcher for ${directory}`);
        watcher.fire(event);
    }

    it('lets a closer wildcard section disable an inherited warning', () => {
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = warning\n');
        writeConfig('nested', '[*]\ncpp_include_cleanup_remove_unused_error_tag_type = none\n');
        strictEqual(getLevel(), 'none');
    });

    it('uses the last matching section instead of the first', () => {
        writeConfig('', 'root = true\n[*.cpp]\ncpp_include_cleanup_remove_unused_error_tag_type = warning\n' +
            '[sample.cpp]\ncpp_include_cleanup_remove_unused_error_tag_type = error\n');
        strictEqual(getLevel(), 'error');
    });

    it('preserves the ordering of repeated wildcard sections', () => {
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = warning\n' +
            '[*.cpp]\ncpp_include_cleanup_remove_unused_error_tag_type = error\n' +
            '[*]\ncpp_include_cleanup_remove_unused_error_tag_type = none\n');
        strictEqual(getLevel(), 'none');
    });

    it('lets a later wildcard section override a specific section', () => {
        writeConfig('', 'root = true\n[*.cpp]\ncpp_include_cleanup_remove_unused_error_tag_type = error\n' +
            '[*]\ncpp_include_cleanup_remove_unused_error_tag_type = none\n');
        strictEqual(getLevel(), 'none');
    });

    it('lets a closer section unset the inherited diagnostic level', () => {
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = warning\n');
        writeConfig('nested', '[*.cpp]\ncpp_include_cleanup_remove_unused_error_tag_type = unset\n');
        strictEqual(getLevel(), 'none');
    });

    it('preserves formatting inheritance and stops at root true', () => {
        writeConfig('', 'root = true\n[*]\nindent_style = tab\nindent_size = 8\n');
        writeConfig('nested', '[*.cpp]\nindent_size = 4\n');
        const inherited = editorConfig.getEditorConfigSettings(join(directory, 'nested/sample.cpp'));
        strictEqual(inherited.indent_style, 'tab');
        strictEqual(inherited.indent_size, 4);
        writeConfig('nested', 'root = true\n[*.cpp]\nindent_size = 2\n');
        editorConfig.cachedEditorConfigSettings.clear();
        const rooted = editorConfig.getEditorConfigSettings(join(directory, 'nested/sample.cpp'));
        strictEqual(rooted.indent_style, undefined);
        strictEqual(rooted.indent_size, 2);
        strictEqual(rooted.root, true);
    });

    it('matches property names case-insensitively without changing path values', async () => {
        writeConfig('', 'ROOT = TRUE\n[*]\nCPP_INCLUDE_CLEANUP_REMOVE_UNUSED_ERROR_TAG_TYPE = warning\n' +
            'cpp_include_cleanup_excluded_files = MixedCase.h\n[*.cpp]\ncpp_include_cleanup_remove_unused_error_tag_type = none\n');
        const settings = editorConfig.getEditorConfigSettings(join(directory, 'sample.cpp'));
        strictEqual(getIncludeCleanupPreferences(settings).removeUnusedErrorTagType, 'none');
        strictEqual(getIncludeCleanupPreferences(settings).excludedFiles, 'MixedCase.h');
        strictEqual(settings.root, true);
    });

    it('refreshes cached single-file preferences when an applicable config changes', () => {
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = warning\n');
        const file = join(directory, 'sample.cpp');
        let refreshedLevel = '';
        const watcher = new editorConfig.EditorConfigWatcher(() => {
            refreshedLevel = getIncludeCleanupPreferences(editorConfig.getEditorConfigSettings(file)).removeUnusedErrorTagType;
        });
        watcher.update([file]);
        strictEqual(getIncludeCleanupPreferences(editorConfig.getEditorConfigSettings(file)).removeUnusedErrorTagType, 'warning');
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = none\n');
        fire(directory, 'change');
        strictEqual(refreshedLevel, 'none');
        watcher.dispose();
    });

    it('watches parent configs outside the workspace without duplicating workspace watches', () => {
        workspaceDirectory = join(directory, 'workspace');
        mkdirSync(workspaceDirectory);
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = warning\n');
        const file = join(workspaceDirectory, 'sample.cpp');
        let refreshed = 0;
        const watcher = new editorConfig.EditorConfigWatcher(() => { ++refreshed; });
        watcher.update([file]);
        strictEqual(getIncludeCleanupPreferences(editorConfig.getEditorConfigSettings(file)).removeUnusedErrorTagType, 'warning');
        strictEqual(watchers.some(watcher => watcher.directory === workspaceDirectory), false);
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = none\n');
        fire(directory, 'change');
        strictEqual(refreshed, 1);
        strictEqual(getIncludeCleanupPreferences(editorConfig.getEditorConfigSettings(file)).removeUnusedErrorTagType, 'none');
        watcher.dispose();
    });

    it('invalidates preferences for newly created and deleted closer configs', () => {
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = warning\n');
        mkdirSync(join(directory, 'nested'));
        const file = join(directory, 'nested/sample.cpp');
        const watcher = new editorConfig.EditorConfigWatcher(() => { });
        watcher.update([file]);
        strictEqual(getIncludeCleanupPreferences(editorConfig.getEditorConfigSettings(file)).removeUnusedErrorTagType, 'warning');
        writeConfig('nested', '[*]\ncpp_include_cleanup_remove_unused_error_tag_type = none\n');
        fire(join(directory, 'nested'), 'create');
        strictEqual(getIncludeCleanupPreferences(editorConfig.getEditorConfigSettings(file)).removeUnusedErrorTagType, 'none');
        unlinkSync(join(directory, 'nested/.editorconfig'));
        fire(join(directory, 'nested'), 'delete');
        strictEqual(getIncludeCleanupPreferences(editorConfig.getEditorConfigSettings(file)).removeUnusedErrorTagType, 'warning');
        watcher.dispose();
    });

    it('deduplicates ancestor watches and releases them when no documents are visible', () => {
        const watcher = new editorConfig.EditorConfigWatcher(() => { });
        const files = [join(directory, 'first.cpp'), join(directory, 'second.cpp')];
        strictEqual(watcher.update(files), true);
        const initialWatchers = [...watchers];
        strictEqual(watcher.update(files), false);
        deepStrictEqual(watchers, initialWatchers);
        watcher.update([]);
        strictEqual(watchers.every(watcher => watcher.disposed), true);
        watcher.dispose();
    });

    it('re-reads preferences after the file was hidden while its config changed', () => {
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = warning\n');
        const file = join(directory, 'sample.cpp');
        const watcher = new editorConfig.EditorConfigWatcher(() => { });
        watcher.update([file]);
        strictEqual(getIncludeCleanupPreferences(editorConfig.getEditorConfigSettings(file)).removeUnusedErrorTagType, 'warning');
        watcher.update([]);
        writeConfig('', 'root = true\n[*]\ncpp_include_cleanup_remove_unused_error_tag_type = none\n');
        watcher.update([file]);
        strictEqual(getIncludeCleanupPreferences(editorConfig.getEditorConfigSettings(file)).removeUnusedErrorTagType, 'none');
        watcher.dispose();
        strictEqual(watchers.every(watcher => watcher.disposed), true);
    });
});
