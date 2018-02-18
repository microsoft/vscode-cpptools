/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CommentPattern } from './languageConfig';

function getTarget(): vscode.ConfigurationTarget {
    return (vscode.workspace.workspaceFolders) ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global;
}

class Settings {
    private readonly settings: vscode.WorkspaceConfiguration;

    /**
     * create the Settings object.
     * @param resource The path to a resource to which the settings should apply, or undefined if global settings are desired
     */
    constructor(section: string, resource?: vscode.Uri) {
        this.settings = vscode.workspace.getConfiguration(section, resource ? resource : null);
    }

    protected get Section(): vscode.WorkspaceConfiguration { return this.settings; }
}

export class CppSettings extends Settings {
    constructor(resource?: vscode.Uri) {
        super("C_Cpp", resource);
    }
  
    public get clangFormatPath(): string { return super.Section.get<string>("clang_format_path"); }
    public get clangFormatStyle(): string { return super.Section.get<string>("clang_format_style"); }
    public get clangFormatFallbackStyle(): string { return super.Section.get<string>("clang_format_fallbackStyle"); }
    public get clangFormatSortIncludes(): string { return super.Section.get<string>("clang_format_sortIncludes"); }
    public get clangFormatOnSave(): string { return super.Section.get<string>("clang_format_formatOnSave"); }
    public get formatting(): string { return super.Section.get<string>("formatting"); }
    public get intelliSenseEngine(): string { return super.Section.get<string>("intelliSenseEngine"); }
    public get intelliSenseEngineFallback(): string { return super.Section.get<string>("intelliSenseEngineFallback"); }
    public get errorSquiggles(): string { return super.Section.get<string>("errorSquiggles"); }
    public get autoComplete(): string { return super.Section.get<string>("autocomplete"); }
    public get loggingLevel(): string { return super.Section.get<string>("loggingLevel"); }
    public get navigationLength(): number { return super.Section.get<number>("navigation.length", 60); }
    public get autoAddFileAssociations(): boolean { return super.Section.get<boolean>("autoAddFileAssociations"); }
    public get workspaceParsingPriority(): boolean { return super.Section.get<boolean>("workspaceParsingPriority"); }
    public get exclusionPolicy(): boolean { return super.Section.get<boolean>("exclusionPolicy"); }
    public get multilineCommentPatterns(): (string | CommentPattern)[] { return super.Section.get<(string | CommentPattern)[]>("multilineCommentPatterns"); }

    public toggleSetting(name: string, value1: string, value2: string): void {
        let value: string = super.Section.get<string>(name);
        super.Section.update(name, value === value1 ? value2 : value1, getTarget());
    }
}

export class OtherSettings {
    private resource: vscode.Uri;

    constructor(resource?: vscode.Uri) {
        if (!resource) {
            resource = null;
        }
        this.resource = resource;
    }

    public get editorTabSize(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration("editor", this.resource).get("tabSize"); }
    public get filesAssociations(): any { return vscode.workspace.getConfiguration("files", null).get("associations"); }
    public get filesExclude(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration("files", this.resource).get("exclude"); }
    public get searchExclude(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration("search", this.resource).get("exclude"); }

    public set filesAssociations(value: any) {
         vscode.workspace.getConfiguration("files", null).update("associations", value, vscode.ConfigurationTarget.Workspace);
    }
}