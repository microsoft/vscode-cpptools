/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as fs from 'fs';
import { Minimatch } from 'minimatch';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from '../common';
import { isWindows } from '../constants';

type EditorConfigSettings = Record<string, string | number | boolean>;

interface EditorConfigSection {
    pattern: string;
    settings: EditorConfigSettings;
}

interface ParsedEditorConfig {
    global: EditorConfigSettings;
    sections: EditorConfigSection[];
}

export const cachedEditorConfigSettings: Map<string, EditorConfigSettings> = new Map<string, EditorConfigSettings>();

export function mapIndentationReferenceToEditorConfig(value: string | undefined): string {
    if (value !== undefined) {
        // Will never actually be undefined, as these settings have default values.
        if (value === "statementBegin") {
            return "statement_begin";
        }
        if (value === "outermostParenthesis") {
            return "outermost_parenthesis";
        }
    }
    return "innermost_parenthesis";
}

export function mapIndentToEditorConfig(value: string | undefined): string {
    if (value !== undefined) {
        // Will never actually be undefined, as these settings have default values.
        if (value === "leftmostColumn") {
            return "leftmost_column";
        }
        if (value === "oneLeft") {
            return "one_left";
        }
    }
    return "none";
}

export function mapNewOrSameLineToEditorConfig(value: string | undefined): string {
    if (value !== undefined) {
        // Will never actually be undefined, as these settings have default values.
        if (value === "newLine") {
            return "new_line";
        }
        if (value === "sameLine") {
            return "same_line";
        }
    }
    return "ignore";
}

export function mapWrapToEditorConfig(value: string | undefined): string {
    if (value !== undefined) {
        // Will never actually be undefined, as these settings have default values.
        if (value === "allOneLineScopes") {
            return "all_one_line_scopes";
        }
        if (value === "oneLiners") {
            return "one_liners";
        }
    }
    return "never";
}

export function matchesSection(pathPrefix: string, filePath: string, section: string): boolean {
    // The following code is copied from: https://github.com/editorconfig/editorconfig-core-js
    const matchOptions = { matchBase: true, dot: true };
    pathPrefix = pathPrefix.replace(/[?*+@!()|[\]{}]/g, '\\$&');
    pathPrefix = pathPrefix.replace(/^#/, '\\#');
    switch (section.indexOf('/')) {
        case -1:
            section = `**/${section}`;
            break;
        case 0:
            section = section.substring(1);
            break;
        default:
            break;
    }
    section = section.replace(/\\\\/g, '\\\\\\\\');
    section = section.replace(/\*\*/g, '{*,**/**/**}');
    const matcher = new Minimatch(`${pathPrefix}/${section}`, matchOptions);
    return matcher.match(filePath);
}

function parseEditorConfigContent(content: string): ParsedEditorConfig {
    const lines = content.split(/\r?\n/);
    const config: ParsedEditorConfig = { global: {}, sections: [] };
    let currentSettings: EditorConfigSettings = config.global;

    lines.forEach(line => {
        line = line.trim();

        if (!line || line.startsWith('#') || line.startsWith(';')) {
            // Skip empty lines and comments.
            return;
        }

        if (line.startsWith('[') && line.endsWith(']')) {
            currentSettings = {};
            config.sections.push({ pattern: line.slice(1, -1).trim(), settings: currentSettings });
        } else {
            // Key-value pair (e.g., indent_style = space).
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                const trimmedKey = key.trim().toLowerCase();
                let value: string | number | boolean = values.join('=').trim();

                // Convert boolean-like and numeric values.
                if (value.toLowerCase() === 'true') {
                    value = true;
                } else if (value.toLowerCase() === 'false') {
                    value = false;
                } else if (!isNaN(Number(value))) {
                    value = Number(value);
                }

                currentSettings[trimmedKey] = value;
            }
        }
    });

    return config;
}

function getEditorConfig(filePath: string): EditorConfigSettings {
    let combinedConfig: EditorConfigSettings = {};
    let currentDir: string = path.dirname(filePath);
    const rootDir: string = path.parse(currentDir).root;

    if (isWindows) {
        filePath = filePath.replace(/\\/g, '/');
    }

    // Traverse from the file's directory to the root directory.
    for (; ;) {
        const editorConfigPath: string = path.join(currentDir, '.editorconfig');
        if (util.checkFileExistsSync(editorConfigPath)) {
            const configFileContent: string = fs.readFileSync(editorConfigPath, 'utf-8');
            const configData: ParsedEditorConfig = parseEditorConfigContent(configFileContent);
            const currentConfig: EditorConfigSettings = { ...configData.global };

            let currentDirForwardSlashes: string = currentDir;
            if (isWindows) {
                currentDirForwardSlashes = currentDir.replace(/\\/g, '/');
            }

            for (const section of configData.sections) {
                if (matchesSection(currentDirForwardSlashes, filePath, section.pattern)) {
                    Object.assign(currentConfig, section.settings);
                }
            }
            combinedConfig = { ...currentConfig, ...combinedConfig };

            // Check if the current .editorconfig is the root.
            if (configData.global.root === true) {
                combinedConfig.root = true;
                break; // Stop searching after processing the root = true file.
            }
        }
        if (currentDir === rootDir) {
            break; // Stop the loop after checking the root directory.
        }
        currentDir = path.dirname(currentDir);
    }

    return combinedConfig;
}

// Look up the appropriate .editorconfig settings for the specified file.
// This is intentionally not async to avoid races due to multiple entrancy.
export function getEditorConfigSettings(fsPath: string): EditorConfigSettings {
    let editorConfigSettings: EditorConfigSettings | undefined = cachedEditorConfigSettings.get(fsPath);
    if (!editorConfigSettings) {
        editorConfigSettings = getEditorConfig(fsPath);
        cachedEditorConfigSettings.set(fsPath, editorConfigSettings);
    }
    return editorConfigSettings;
}

export class EditorConfigWatcher implements vscode.Disposable {
    private readonly watchers: Map<string, vscode.FileSystemWatcher> = new Map<string, vscode.FileSystemWatcher>();

    constructor(private readonly onChanged: () => void) { }

    public update(filePaths: readonly string[]): boolean {
        const directories: Set<string> = new Set<string>();
        for (const filePath of filePaths) {
            let directory: string = path.dirname(filePath);
            for (;;) {
                if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(directory))) {
                    directories.add(directory);
                }
                const parent: string = path.dirname(directory);
                if (parent === directory) {
                    break;
                }
                directory = parent;
            }
        }

        for (const [directory, watcher] of this.watchers) {
            if (!directories.has(directory)) {
                watcher.dispose();
                this.watchers.delete(directory);
            }
        }

        let addedWatchers: boolean = false;
        for (const directory of directories) {
            if (this.watchers.has(directory)) {
                continue;
            }
            const watcher: vscode.FileSystemWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(directory), '.editorconfig'));
            const onChanged = () => {
                cachedEditorConfigSettings.clear();
                this.onChanged();
            };
            watcher.onDidCreate(onChanged);
            watcher.onDidChange(onChanged);
            watcher.onDidDelete(onChanged);
            this.watchers.set(directory, watcher);
            addedWatchers = true;
        }
        if (addedWatchers) {
            cachedEditorConfigSettings.clear();
        }
        return addedWatchers;
    }

    public dispose(): void {
        this.watchers.forEach(watcher => watcher.dispose());
        this.watchers.clear();
    }
}
