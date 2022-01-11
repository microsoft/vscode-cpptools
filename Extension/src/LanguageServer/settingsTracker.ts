/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as util from '../common';

/**
 * track settings changes for telemetry
 */
type FilterFunction = (key: string, val: string, settings: vscode.WorkspaceConfiguration) => boolean;
type KeyValuePair = { key: string; value: string };

const maxSettingLengthForTelemetry: number = 50;
let cache: SettingsTracker;

export class SettingsTracker {
    private previousCppSettings: { [key: string]: any } = {};
    private resource: vscode.Uri | undefined;

    constructor(resource: vscode.Uri | undefined) {
        this.resource = resource;
        this.collectSettings(() => true);
    }

    public getUserModifiedSettings(): { [key: string]: string } {
        const filter: FilterFunction = (key: string, val: string, settings: vscode.WorkspaceConfiguration) => !this.areEqual(val, settings.inspect(key)?.defaultValue);
        return this.collectSettings(filter);
    }

    public getChangedSettings(): { [key: string]: string } {
        const filter: FilterFunction = (key: string, val: string) => !(key in this.previousCppSettings) || !this.areEqual(val, this.previousCppSettings[key]);
        return this.collectSettings(filter);
    }

    private collectSettings(filter: FilterFunction): { [key: string]: string } {
        const settingsResourceScope: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", this.resource);
        const settingsNonScoped: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp");
        const selectCorrectlyScopedSettings = (rawSetting: any): vscode.WorkspaceConfiguration =>
            (!rawSetting || rawSetting.scope === "resource" || rawSetting.scope === "machine-overridable") ? settingsResourceScope : settingsNonScoped;
        const result: { [key: string]: string } = {};
        for (const key in settingsResourceScope) {
            const rawSetting: any = util.packageJson.contributes.configuration.properties["C_Cpp." + key];
            const correctlyScopedSettings: vscode.WorkspaceConfiguration = selectCorrectlyScopedSettings(rawSetting);
            const val: any = this.getSetting(correctlyScopedSettings, key);
            if (val === undefined) {
                continue;
            }

            // Iterate through dotted "sub" settings.
            const collectSettingsRecursive = (key: string, val: Object, depth: number) => {
                if (depth > 4) {
                    // Limit settings recursion to 4 dots (not counting the first one in: `C_Cpp.`)
                    return;
                }
                for (const subKey in val) {
                    const newKey: string = key + "." + subKey;
                    const newRawSetting: any = util.packageJson.contributes.configuration.properties["C_Cpp." + newKey];
                    const correctlyScopedSubSettings: vscode.WorkspaceConfiguration = selectCorrectlyScopedSettings(newRawSetting);
                    const subVal: any = this.getSetting(correctlyScopedSubSettings, newKey);
                    if (subVal === undefined) {
                        continue;
                    }
                    if (subVal instanceof Object && !(subVal instanceof Array)) {
                        collectSettingsRecursive(newKey, subVal, depth + 1);
                    } else {
                        const entry: KeyValuePair | undefined = this.filterAndSanitize(newKey, subVal, correctlyScopedSubSettings, filter);
                        if (entry && entry.key && entry.value) {
                            result[entry.key] = entry.value;
                        }
                    }
                }
            };
            if (val instanceof Object && !(val instanceof Array)) {
                collectSettingsRecursive(key, val, 1);
                continue;
            }

            const entry: KeyValuePair | undefined = this.filterAndSanitize(key, val, correctlyScopedSettings, filter);
            if (entry && entry.key && entry.value) {
                result[entry.key] = entry.value;
            }
        }

        return result;
    }

    private getSetting(settings: vscode.WorkspaceConfiguration, key: string): any {
        // Ignore methods and settings that don't exist
        if (settings.inspect(key)?.defaultValue !== undefined) {
            const val: any = settings.get(key);
            if (val instanceof Object) {
                return val; // It's a sub-section.
            }

            // Only return values that match the setting's type and enum (if applicable).
            const curSetting: any = util.packageJson.contributes.configuration.properties["C_Cpp." + key];
            if (curSetting) {
                const type: string | undefined = this.typeMatch(val, curSetting["type"]);
                if (type) {
                    if (type !== "string") {
                        return val;
                    }
                    const curEnum: any[] = curSetting["enum"];
                    if (curEnum && curEnum.indexOf(val) === -1) {
                        return "<invalid>";
                    }
                    return val;
                }
            }
        }
        return undefined;
    }

    private typeMatch(value: any, type?: string | string[]): string | undefined {
        if (type) {
            if (type instanceof Array) {
                for (let i: number = 0; i < type.length; i++) {
                    const t: string = type[i];
                    if (t) {
                        if (typeof value === t) {
                            return t;
                        }
                        if (t === "array" && value instanceof Array) {
                            return t;
                        }
                        if (t === "null" && value === null) {
                            return t;
                        }
                    }
                }
            } else if (typeof type === "string" && typeof value === type) {
                return type;
            }
        }
        return undefined;
    }

    private filterAndSanitize(key: string, val: any, settings: vscode.WorkspaceConfiguration, filter: FilterFunction): KeyValuePair | undefined {
        if (filter(key, val, settings)) {
            let value: string;
            this.previousCppSettings[key] = val;
            switch (key) {
                case "clang_format_style":
                case "clang_format_fallbackStyle": {
                    const newKey: string = key + "2";
                    if (val) {
                        switch (String(val).toLowerCase()) {
                            case "emulated visual studio":
                            case "visual studio":
                            case "llvm":
                            case "google":
                            case "chromium":
                            case "mozilla":
                            case "webkit":
                            case "file":
                            case "none": {
                                value = String(this.previousCppSettings[key]);
                                break;
                            }
                            default: {
                                value = "...";
                                break;
                            }
                        }
                    } else {
                        value = "null";
                    }
                    key = newKey;
                    break;
                }
                case "commentContinuationPatterns": {
                    key = "commentContinuationPatterns2";
                    value = this.areEqual(val, settings.inspect(key)?.defaultValue) ? "<default>" : "..."; // Track whether it's being used, but nothing specific about it.
                    break;
                }
                default: {
                    if (key === "clang_format_path" || key === "intelliSenseCachePath" || key.startsWith("default.")
                        || key === "codeAnalysis.clangTidy.path"
                        || key === "codeAnalysis.clangTidy.headerFilter" || key === "codeAnalysis.clangTidy.args"
                        || key === "codeAnalysis.clangTidy.config" || key === "codeAnalysis.clangTidy.fallbackConfig"

                        // Note: An existing bug prevents these settings of type "object" from getting processed here,
                        // so these checks are here just in case that bug gets fixed later on.
                        || key === "files.exclude" || key === "codeAnalysis.exclude"
                    ) {
                        value = this.areEqual(val, settings.inspect(key)?.defaultValue) ? "<default>" : "..."; // Track whether it's being used, but nothing specific about it.
                    } else {
                        value = String(this.previousCppSettings[key]);
                    }
                }
            }
            if (value && value.length > maxSettingLengthForTelemetry) {
                value = value.substr(0, maxSettingLengthForTelemetry) + "...";
            }
            return {key: key, value: value};
        }
        return undefined;
    }

    private areEqual(value1: any, value2: any): boolean {
        if (value1 instanceof Object && value2 instanceof Object) {
            return JSON.stringify(value1) === JSON.stringify(value2);
        }
        return value1 === value2;
    }
}

export function getTracker(resource: vscode.Uri | undefined): SettingsTracker {
    if (!cache) {
        cache = new SettingsTracker(resource);
    }
    return cache;
}
