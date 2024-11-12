/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as fs from 'fs';
import * as path from 'path';

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

let isValid: boolean = true;
let relativeToCurrentDir: boolean = false;

// Helper function to find matching '}' for a given '{' position
function findMatchingBrace(pattern: string, start: number): number {
    let braceLevel = 0;
    let i = start;
    while (i < pattern.length) {
        const c = pattern[i];
        switch (c) {
            case "\\":
                if (i === pattern.length - 1) {
                    return -1;
                }
                i += 2;
                break;
            case "{":
                braceLevel++;
                i++;
                break;
            case "}":
                braceLevel--;
                if (braceLevel === 0) {
                    return i;
                }
                i++;
                break;
            default:
                i++;
                break;
        }
    }
    return -1;
}

// Function to handle brace expansion for ranges and lists
function handleBraceExpansion(pattern: string): string {
    const rangeMatch = pattern.match(/^\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*$/);
    if (rangeMatch) {
        const [, start, end] = rangeMatch.map(Number);
        return buildRangeRegex(start, end);
    }

    const options = [];
    let braceLevel = 0;
    let currentOption = '';
    let i = 0;
    while (i < pattern.length) {
        const c = pattern[i];
        switch (c) {
            case "\\":
                if (i === pattern.length - 1) {
                    isValid = false;
                    return "";
                }
                currentOption += escapeRegex(pattern[i + 1]);
                i += 2;
                break;
            case "{":
                braceLevel++;
                i++;
                break;
            case "}":
                braceLevel--;
                if (braceLevel === 0) {
                    options.push(convertSectionToRegExp(currentOption.trim()));
                    currentOption = '';
                }
                i++;
                break;
            case ",":
                if (braceLevel === 0) {
                    options.push(convertSectionToRegExp(currentOption.trim()));
                    currentOption = '';
                } else {
                    currentOption += c;
                }
                i++;
                break;
            default:
                currentOption += c;
                i++;
                break;
        }
    }

    if (currentOption) {
        options.push(convertSectionToRegExp(currentOption.trim()));
    }

    return `(${options.join('|')})`;
}

function buildRangeRegex(start: number, end: number): string {
    if (start === end) {
        return start.toString();
    }
    if (start < 0 && end < 0) {
        return `-${buildRangeRegex(-end, -start)}`;
    }
    if (start > end) {
        isValid = false;
        return "";
    }
    if (start > 0) {
        return buildPositiveRangeRegex(start, end);
    }
    // Pattern to match one or more zeros only if not followed by a non-zero digit
    const zeroPattern = "(0+(?![1-9]))";
    if (end === 0) {
        // If end is 0, start must be negative.
        const pattern = buildZeroToNRegex(-start);
        return `(${zeroPattern}|(-${pattern}))`;
    }
    // end is >0.
    const endPattern = buildZeroToNRegex(end);
    if (start === 0) {
        return `(${zeroPattern}|${endPattern})`;
    }
    const startPattern = buildZeroToNRegex(-start);
    return `(${zeroPattern}|(-${startPattern})|${endPattern})`;
}

function buildZeroToNRegex(n: number): string {
    const nStr = n.toString();
    const length = nStr.length;
    const parts: string[] = [];

    // Pattern to remove leading zeros when followed by a non-zero digit
    const leadingZerosPattern = "(0*(?=[1-9]))";
    let prefix = "";

    if (length > 1) {
        // Handle numbers with fewer digits than `n`

        // Single-digit numbers from 0 to 9
        parts.push(`[0-9]`);
        for (let i = 2; i < length; i++) {
            // Multi-digit numbers with fewer digits than `n`
            parts.push(`([1-9]\\d{0,${i - 1}})`);
        }

        // Build the main pattern by comparing each digit position
        for (let i = 0; i < length - 1; i++) {
            const digit = parseInt(nStr[i]);
            if (digit > 1) {
                parts.push(`(${prefix}[0-${digit - 1}]${"\\d".repeat(length - i - 1)})`);
            }
            prefix += digit;
        }
    }
    const digit = parseInt(nStr[length - 1]);
    if (digit === 0) {
        parts.push(`(${prefix}0)`);
    } else {
        parts.push(`(${prefix}[0-${digit}])`);
    }

    // Combine everything without start and end anchors
    return `(${leadingZerosPattern}(${parts.join("|")}))`;
}

// start will be >0, end will be >start.
function buildPositiveRangeRegex(start: number, end: number): string {
    const startStr = start.toString();
    const endStr = end.toString();
    const startLength = startStr.length;
    const endLength = endStr.length;
    const parts: string[] = [];

    // Pattern to remove leading zeros when followed by a non-zero digit
    const leadingZerosPattern = "(0*(?=[1-9]))";

    if (startLength === endLength) {
        if (startLength === 1) {
            return `(${leadingZerosPattern}([${startStr}-${endStr}]))`;
        }

        // First, any identical leading digits are added to the prefix.
        let sharedPrefix = "";
        let i = 0;
        while (i < startLength && startStr[i] === endStr[i]) {
            sharedPrefix += startStr[i];
            i++;
        }
        if (i === startLength - 1) {
            // Special case for only 1 digit lefts)
            parts.push(`(${sharedPrefix}[${startStr[i]}-${endStr[i]}])`);
        } else {

            // Now we break the remaining digits into three parts:
            // Part 1. With the new start digit, check any of the remaining against ranges to 9.
            let prefix = sharedPrefix + startStr[i];
            for (let i2 = i + 1; i2 < startLength - 1; i2++) {
                const startDigit = parseInt(startStr[i2]);
                if (startDigit === 8) {
                    parts.push(`(${prefix}9${"\\d".repeat(startLength - i2 - 1)})`);
                } else if (startDigit !== 9) {
                    parts.push(`(${prefix}[${startDigit + 1}-9]${"\\d".repeat(startLength - i2 - 1)})`);
                }
                prefix += startStr[i2];
            }
            const startDigit = parseInt(startStr[startLength - 1]);
            if (startDigit === 9) {
                parts.push(`(${prefix}9)`);
            } else {
                parts.push(`(${prefix}[${startDigit}-9])`);
            }

            // Part 2. Any larger start digit less than the end digit, should match the full range for the remaining digits.
            let curDigit = parseInt(startStr[i]) + 1;
            const firstEndDigit = parseInt(endStr[i]);
            while (curDigit < firstEndDigit) {
                parts.push(`(${sharedPrefix}${curDigit}${"\\d".repeat(startLength - i - 1)})`);
                curDigit++;
            }

            // Part 3. With the new end digit, check for any the remaining against ranges from 0.
            prefix = sharedPrefix + endStr[i];
            for (let i2 = i + 1; i2 < endLength - 1; i2++) {
                const endDigit = parseInt(endStr[i2]);
                if (endDigit === 1) {
                    parts.push(`(${prefix}0${"\\d".repeat(endLength - i2 - 1)})`);
                } else if (endDigit !== 0) {
                    parts.push(`(${prefix}[0-${endDigit - 1}]${"\\d".repeat(endLength - i2 - 1)})`);
                }
                prefix += endStr[i2];
            }
            const endDigit = parseInt(endStr[endLength - 1]);
            if (endDigit === 0) {
                parts.push(`(${prefix}0)`);
            } else {
                parts.push(`(${prefix}[0-${endDigit}])`);
            }
        }
    } else {
        // endLength > startLength

        // Add patterns for numbers with the same number of digits as `start`
        let startPrefix = "";
        for (let i = 0; i < startLength - 1; i++) {
            const startDigit = parseInt(startStr[i]);
            if (startDigit === 8) {
                parts.push(`(${startPrefix}9\\d{${startLength - i - 1}})`);
            }
            else if (startDigit !== 9) {
                parts.push(`(${startPrefix}[${startDigit + 1}-9]\\d{${startLength - i - 1}})`);
            }
            // if startDigit === 9, we don't need to add a pattern for this digit
            startPrefix += startStr[i];
        }
        const startDigit = parseInt(startStr[startLength - 1]);
        if (startDigit === 9) {
            parts.push(`(${startPrefix}9)`);
        } else {
            parts.push(`(${startPrefix}[${startDigit}-9])`);
        }

        // Handle numbers with more digits than 'start' and fewer digits than 'end'
        for (let i = startLength + 1; i < endLength; i++) {
            // Multi-digit numbers with more digits than 'start' and fewer digits than 'end'
            parts.push(`([1-9]\\d{${i - 1}})`);
        }

        // Add patterns for numbers with the same number of digits as `end`
        let endPrefix = "";
        for (let i = 0; i < endLength - 1; i++) {
            const endDigit = parseInt(endStr[i]);
            if (endDigit === 1) {
                if (i !== 0) {
                    parts.push(`(${endPrefix}0\\d{${endLength - i - 1}})`);
                }
            } else if (endDigit !== 0) {
                parts.push(`(${endPrefix}[0-${endDigit - 1}]\\d{${endLength - i - 1}})`);
            }
            // endDigit === 0, we don't need to add a pattern for this digit
            endPrefix += endStr[i];
        }
        const endDigit = parseInt(endStr[endLength - 1]);
        if (endDigit === 0) {
            parts.push(`(${endPrefix}0)`);
        } else {
            parts.push(`(${endPrefix}[0-${endDigit}])`);
        }
    }

    // Combine everything without start and end anchors
    return `(${leadingZerosPattern}(${parts.join("|")}))`;
}

// Utility to escape regex special characters in a string
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function convertSectionToRegExp(pattern: string): string {
    let regExp = '';
    let i = 0;
    while (i < pattern.length) {
        const c = pattern[i];
        switch (c) {
            case '*':
                if (i < pattern.length - 1 && pattern[i + 1] === '*') {
                    if (i > 0 && pattern[i - 1] !== '/') {
                        isValid = false;
                        return "";
                    }
                    i++;
                    if (i < pattern.length - 1) {
                        if (pattern[i + 1] !== '/') {
                            isValid = false;
                            return "";
                        }
                        i++;
                        regExp += '(?:(.*\\/)?|\\/)?';
                    }
                    else {
                        regExp += '.*';
                    }
                } else {
                    regExp += '[^\\/]*';
                }
                i++;
                break;
            case '?':
                regExp += '.';
                i += 1;
                break;
            case '[':
                const endBracket = pattern.indexOf(']', i);
                if (endBracket === -1) {
                    isValid = false;
                    return "";
                }
                const charClass = pattern.slice(i + 1, endBracket);
                if (charClass.startsWith('!')) {
                    regExp += `[^${escapeRegex(charClass.slice(1))}]`;
                } else {
                    regExp += `[${escapeRegex(charClass)}]`;
                }
                i = endBracket + 1;
                break;
            case '{':
                const endBrace = findMatchingBrace(pattern, i);
                if (endBrace === -1) {
                    isValid = false;
                    return "";
                }
                const braceContent = pattern.slice(i + 1, endBrace);
                regExp += handleBraceExpansion(braceContent);
                if (!isValid) {
                    return "";
                }
                i = endBrace + 1;
                break;
            case "/":
                if (i === pattern.length - 1) {
                    isValid = false;
                    return "";
                }
                relativeToCurrentDir = true;
                regExp += '\\/';
                i++;
                break;
            case '\\':
                if (i === pattern.length - 1) {
                    isValid = false;
                    return "";
                }
                regExp += escapeRegex(pattern[i + 1]);
                i += 2;
                break;
            default:
                regExp += escapeRegex(c);
                i++;
                break;
        }
    }
    return regExp;
}

export function matchesSection(currentDir: string, filePath: string, section: string): boolean {
    isValid = true;
    relativeToCurrentDir = false;
    const regExpString: string = `^${convertSectionToRegExp(section)}$`;
    if (!isValid) {
        return false;
    }
    const regexp: RegExp = new RegExp(regExpString);
    let compareWith: string;
    if (relativeToCurrentDir) {
        if (!filePath.startsWith(currentDir)) {
            return false;
        }
        compareWith = filePath.slice(currentDir.length);
        if (compareWith.startsWith('/')) {
            compareWith = compareWith.slice(1);
        }
    } else {
        compareWith = path.basename(filePath);
    }
    return regexp.test(compareWith);
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
                if (value.toLowerCase() === 'true') {
                    value = true;
                } else if (value.toLowerCase() === 'false') {
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

            // Match sections and combine configurations.
            Object.keys(configData).forEach((section: string) => {
                if (section !== '*' && matchesSection(currentDir, filePath, section)) {
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
