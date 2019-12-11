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
    private resource: vscode.Uri;

    constructor(resource: vscode.Uri) {
        this.resource = resource;
        this.collectSettings(() => true);
    }

    public getUserModifiedSettings(): { [key: string]: string } {
        let filter: FilterFunction = (key: string, val: string, settings: vscode.WorkspaceConfiguration) => {
            return !this.areEqual(val, settings.inspect(key).defaultValue);
        };
        return this.collectSettings(filter);
    }

    public getChangedSettings(): { [key: string]: string } {
        let filter: FilterFunction = (key: string, val: string) => {
            return !(key in this.previousCppSettings) || !this.areEqual(val, this.previousCppSettings[key]);
        };
        return this.collectSettings(filter);
    }

    private collectSettings(filter: FilterFunction): { [key: string]: string } {
        let settingsResourceScope: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", this.resource);
        let settingsNonScoped: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp");
        let result: { [key: string]: string } = {};

        for (let key in settingsResourceScope) {
            let curSetting: any = util.packageJson.contributes.configuration.properties["C_Cpp." + key];
            if (curSetting === undefined) {
                continue;
            }
            let settings: vscode.WorkspaceConfiguration = (curSetting.scope === "resource" || curSetting.scope === "machine-overridable") ? settingsResourceScope : settingsNonScoped;
            let val: any = this.getSetting(settings, key);
            if (val === undefined) {
                continue;
            }
            if (val instanceof Object && !(val instanceof Array)) {
                for (let subKey in val) {
                    let newKey: string = key + "." + subKey;
                    let subVal: any = this.getSetting(settings, newKey);
                    if (subVal === undefined) {
                        continue;
                    }
                    let entry: KeyValuePair = this.filterAndSanitize(newKey, subVal, settings, filter);
                    if (entry && entry.key && entry.value) {
                        result[entry.key] = entry.value;
                    }
                }
                continue;
            }

            let entry: KeyValuePair = this.filterAndSanitize(key, val, settings, filter);
            if (entry && entry.key && entry.value) {
                result[entry.key] = entry.value;
            }
        }

        return result;
    }

    private getSetting(settings: vscode.WorkspaceConfiguration, key: string): any {
        // Ignore methods and settings that don't exist
        if (settings.inspect(key).defaultValue !== undefined) {
            let val: any = settings.get(key);
            if (val instanceof Object) {
                return val; // It's a sub-section.
            }

            // Only return values that match the setting's type and enum (if applicable).
            let curSetting: any = util.packageJson.contributes.configuration.properties["C_Cpp." + key];
            if (curSetting) {
                let type: string = this.typeMatch(val, curSetting["type"]);
                if (type) {
                    if (type !== "string") {
                        return val;
                    }
                    let curEnum: any[] = curSetting["enum"];
                    if (curEnum && curEnum.indexOf(val) === -1) {
                        return "<invalid>";
                    }
                    return val;
                }
            }
        }
        return undefined;
    }

    private typeMatch(value: any, type?: string | string[]): string {
        if (type) {
            if (type instanceof Array) {
                for (let i: number = 0; i < type.length; i++) {
                    let t: string = type[i];
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

    private filterAndSanitize(key: string, val: any, settings: vscode.WorkspaceConfiguration, filter: FilterFunction): KeyValuePair {
        if (filter(key, val, settings)) {
            let value: string;
            this.previousCppSettings[key] = val;
            switch (key) {
                case "clang_format_style":
                case "clang_format_fallbackStyle": {
                    let newKey: string = key + "2";
                    if (val) {
                        switch (String(val).toLowerCase()) {
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
                    value = this.areEqual(val, settings.inspect(key).defaultValue) ? "<default>" : "..."; // Track whether it's being used, but nothing specific about it.
                    break;
                }
                default: {
                    if (key === "clang_format_path" || key === "intelliSenseCachePath" || key.startsWith("default.")) {
                        value = this.areEqual(val, settings.inspect(key).defaultValue) ? "<default>" : "..."; // Track whether it's being used, but nothing specific about it.
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
    }

    private areEqual(value1: any, value2: any): boolean {
        if (value1 instanceof Object && value2 instanceof Object) {
            return JSON.stringify(value1) === JSON.stringify(value2);
        }
        return value1 === value2;
    }
}

export function getTracker(resource: vscode.Uri): SettingsTracker {
    if (!cache) {
        cache = new SettingsTracker(resource);
    }
    return cache;
}
