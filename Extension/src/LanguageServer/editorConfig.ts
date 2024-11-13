/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as fs from 'fs';
import { Minimatch } from 'minimatch';
import * as path from 'path';
import { isWindows } from '../constants';

export const cachedEditorConfigSettings: Map<string, any> = new Map<string, any>();

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

function parseEditorConfigContent(content: string): Record<string, any> {
    const lines = content.split(/\r?\n/);
    const config: Record<string, any> = {};
    let currentSection: string | null = '*'; // Use '*' for sectionless (global) settings.

    lines.forEach(line => {
        line = line.trim();

        if (!line || line.startsWith('#') || line.startsWith(';')) {
            // Skip empty lines and comments.
            return;
        }

        if (line.startsWith('[') && line.endsWith(']')) {
            // New section (e.g., [*.js])
            currentSection = line.slice(1, -1).trim();
            config[currentSection] = config[currentSection] || {};
        } else {
            // Key-value pair (e.g., indent_style = space).
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                const trimmedKey = key.trim();
                let value: any = values.join('=').trim();

                // Convert boolean-like and numeric values.
                if (value === 'true') {
                    value = true;
                } else if (value === 'false') {
                    value = false;
                } else if (!isNaN(Number(value))) {
                    value = Number(value);
                }

                if (currentSection) {
                    // Ensure the current section is initialized.
                    if (!config[currentSection]) {
                        config[currentSection] = {};
                    }
                    config[currentSection][trimmedKey] = value;
                }
            }
        }
    });

    return config;
}

function getEditorConfig(filePath: string): any {
    let combinedConfig: any = {};
    let globalConfig: any = {};
    let currentDir: string = path.dirname(filePath);
    const rootDir: string = path.parse(currentDir).root;

    if (isWindows) {
        filePath = filePath.replace(/\\/g, '/');
    }

    // Traverse from the file's directory to the root directory.
    for (; ;) {
        const editorConfigPath: string = path.join(currentDir, '.editorconfig');
        if (fs.existsSync(editorConfigPath)) {
            const configFileContent: string = fs.readFileSync(editorConfigPath, 'utf-8');
            const configData = parseEditorConfigContent(configFileContent);

            // Extract global (sectionless) entries.
            if (configData['*']) {
                globalConfig = {
                    ...globalConfig,
                    ...configData['*']
                };
            }

            let currentDirForwardSlashes: string = currentDir;
            if (isWindows) {
                currentDirForwardSlashes = currentDir.replace(/\\/g, '/');
            }

            // Match sections and combine configurations.
            Object.keys(configData).forEach((section: string) => {
                if (section !== '*' && matchesSection(currentDirForwardSlashes, filePath, section)) {
                    combinedConfig = {
                        ...combinedConfig,
                        ...configData[section]
                    };
                }
            });

            // Check if the current .editorconfig is the root.
            if (configData['*']?.root) {
                break; // Stop searching after processing the root = true file.
            }
        }
        if (currentDir === rootDir) {
            break; // Stop the loop after checking the root directory.
        }
        currentDir = path.dirname(currentDir);
    }

    // Merge global config with section-based config.
    return {
        ...globalConfig,
        ...combinedConfig
    };
}

// Look up the appropriate .editorconfig settings for the specified file.
// This is intentionally not async to avoid races due to multiple entrancy.
export function getEditorConfigSettings(fsPath: string): Promise<any> {
    let editorConfigSettings: any = cachedEditorConfigSettings.get(fsPath);
    if (!editorConfigSettings) {
        editorConfigSettings = getEditorConfig(fsPath);
        cachedEditorConfigSettings.set(fsPath, editorConfigSettings);
    }
    return editorConfigSettings;
}
