/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as util from '../common';
import { CppSettings, OtherSettings, TextMateRule, TextMateRuleSettings } from './settings';
import * as jsonc from 'jsonc-parser';
import * as plist from 'plist';

export enum TokenKind {
    // These need to match the token_kind enum in the server

    // Semantic tokens
    Macro,
    Enumerator,
    GlobalVariable,
    LocalVariable,
    Parameter,
    Type,
    RefType,
    ValueType,
    Function,
    MemberFunction,
    MemberField,
    StaticMemberFunction,
    StaticMemberField,
    Property,
    Event,
    ClassTemplate,
    GenericType,
    FunctionTemplate,
    Namespace,
    Label,
    UdlRaw,
    UdlNumber,
    UdlString,
    OperatorFunction,
    MemberOperator,
    NewDelete,

    Count
}

interface VersionedEdits {
    editVersion: number;
    changes: readonly vscode.TextDocumentContentChangeEvent[];
}

class ThemeStyle {
    foreground?: string;
    background?: string;
    fontStyle?: string;
}

export class ColorizationSettings {
    private uri: vscode.Uri | undefined;
    private pendingTask?: util.BlockingTask<any>;
    private editorBackground?: string;

    public themeStyleCMap: ThemeStyle[] = [];
    public themeStyleCppMap: ThemeStyle[] = [];

    private static readonly scopeToTokenColorNameMap = new Map<string, string>([
        ["comment", "comments"],
        ["string", "strings"],
        ["keyword.operator", "keywords"],
        ["keyword.control", "keywords"],
        ["constant.numeric", "numbers"],
        ["entity.name.type", "types"],
        ["entity.name.class", "types"],
        ["entity.name.function", "functions"],
        ["variable", "variables"]
    ]);

    constructor(uri: vscode.Uri | undefined) {
        this.uri = uri;
    }

    // Given a TextMate rule 'settings' node, update a ThemeStyle to include any color or style information
    private updateStyleFromTextMateRuleSettings(baseStyle: ThemeStyle, textMateRuleSettings: TextMateRuleSettings): void {
        if (textMateRuleSettings.foreground) {
            baseStyle.foreground = textMateRuleSettings.foreground;
        }
        if (!this.editorBackground || textMateRuleSettings.background && textMateRuleSettings.background.toUpperCase() !== this.editorBackground.toUpperCase()) {
            baseStyle.background = textMateRuleSettings.background;
        }
        // Any (even empty) string for fontStyle removes inherited value
        if (textMateRuleSettings.fontStyle) {
            baseStyle.fontStyle = textMateRuleSettings.fontStyle;
        } else if (textMateRuleSettings.fontStyle === "") {
            baseStyle.fontStyle = undefined;
        }
    }

    // If the scope can be found in a set of TextMate rules, apply it to both C and Cpp ThemeStyle's
    private findThemeStyleForScope(baseCStyle: ThemeStyle | undefined, baseCppStyle: ThemeStyle | undefined, scope: string, textMateRules: TextMateRule[] | undefined): void {
        if (textMateRules) {
            let match: TextMateRule | undefined = textMateRules.find(e => e.settings && (e.scope === scope || ((e.scope instanceof Array) && e.scope.indexOf(scope) > -1)));
            if (match) {
                if (baseCStyle) {
                    this.updateStyleFromTextMateRuleSettings(baseCStyle, match.settings);
                }
                if (baseCppStyle) {
                    this.updateStyleFromTextMateRuleSettings(baseCppStyle, match.settings);
                }
            }

            match = textMateRules.find(e => e.settings && (e.scope === "source " + scope || ((e.scope instanceof Array) && e.scope.indexOf("source " + scope) > -1)));
            if (match) {
                if (baseCStyle) {
                    this.updateStyleFromTextMateRuleSettings(baseCStyle, match.settings);
                }
                if (baseCppStyle) {
                    this.updateStyleFromTextMateRuleSettings(baseCppStyle, match.settings);
                }
            }

            if (baseCStyle) {
                match = textMateRules.find(e => e.settings && (e.scope === "source.c " + scope || ((e.scope instanceof Array) && e.scope.indexOf("source.c " + scope) > -1)));
                if (match) {
                    this.updateStyleFromTextMateRuleSettings(baseCStyle, match.settings);
                }
            }

            if (baseCppStyle) {
                match = textMateRules.find(e => e.settings && (e.scope === "source.cpp " + scope || ((e.scope instanceof Array) && e.scope.indexOf("source.cpp " + scope) > -1)));
                if (match) {
                    this.updateStyleFromTextMateRuleSettings(baseCppStyle, match.settings);
                }
            }
        }
    }

    // For a specific scope cascase all potential sources of style information to create a final ThemeStyle
    private calculateThemeStyleForScope(baseCStyle: ThemeStyle | undefined, baseCppStyle: ThemeStyle | undefined, scope: string, themeName: string, themeTextMateRules: TextMateRule[][]): void {
        // Search for settings with this scope in current theme
        themeTextMateRules.forEach((rules) => {
            this.findThemeStyleForScope(baseCStyle, baseCppStyle, scope, rules);
        });

        const otherSettings: OtherSettings = new OtherSettings(this.uri);

        // Next in priority would be a global user override of token color of the equivilent scope
        const colorTokenName: string | undefined = ColorizationSettings.scopeToTokenColorNameMap.get(scope);
        if (colorTokenName) {
            const settingValue: string | undefined = otherSettings.getCustomColorToken(colorTokenName);
            if (settingValue) {
                if (baseCStyle) {
                    baseCStyle.foreground = settingValue;
                }
                if (baseCppStyle) {
                    baseCppStyle.foreground = settingValue;
                }
            }
        }

        // Next in priority would be a global user override of this scope in textMateRules
        this.findThemeStyleForScope(baseCStyle, baseCppStyle, scope, otherSettings.customTextMateRules);

        // Next in priority would be a theme-specific user override of token color of the equivilent scope
        if (colorTokenName) {
            const settingValue: string | undefined = otherSettings.getCustomThemeSpecificColorToken(colorTokenName, themeName);
            if (settingValue) {
                if (baseCStyle) {
                    baseCStyle.foreground = settingValue;
                }
                if (baseCppStyle) {
                    baseCppStyle.foreground = settingValue;
                }
            }
        }

        // Next in priority would be a theme-specific user override of this scope in textMateRules
        const textMateRules: TextMateRule[] | undefined = otherSettings.getCustomThemeSpecificTextMateRules(themeName);
        this.findThemeStyleForScope(baseCStyle, baseCppStyle, scope, textMateRules);
    }

    // For each level of the scope, look of style information
    private calculateStyleForToken(tokenKind: TokenKind, scope: string, themeName: string, themeTextMateRules: TextMateRule[][]): void {
        // Try scopes, from most general to most specific, apply style in cascading manner
        const parts: string[] = scope.split(".");
        let accumulatedScope: string = "";
        for (let i: number = 0; i < parts.length; i++) {
            accumulatedScope += parts[i];
            this.calculateThemeStyleForScope(this.themeStyleCMap[tokenKind], this.themeStyleCppMap[tokenKind], accumulatedScope, themeName, themeTextMateRules);
            this.calculateThemeStyleForScope(this.themeStyleCMap[tokenKind], undefined, accumulatedScope + ".c", themeName, themeTextMateRules);
            this.calculateThemeStyleForScope(undefined, this.themeStyleCppMap[tokenKind], accumulatedScope + ".cpp", themeName, themeTextMateRules);
            accumulatedScope += ".";
        }
    }

    public syncWithLoadingSettings(f: () => any): void {
        this.pendingTask = new util.BlockingTask<void>(f, this.pendingTask);
    }

    public updateStyles(themeName: string, defaultStyle: ThemeStyle, textMateRules: TextMateRule[][]): void {
        this.themeStyleCMap = new Array<ThemeStyle>(TokenKind.Count);
        this.themeStyleCppMap = new Array<ThemeStyle>(TokenKind.Count);

        // Populate with unique objects, as they will be individual modified in place
        for (let i: number = 0; i < TokenKind.Count; i++) {
            this.themeStyleCMap[i] = {...defaultStyle};
            this.themeStyleCppMap[i] = {...defaultStyle};
        }

        this.calculateStyleForToken(TokenKind.Macro, "entity.name.function.preprocessor", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.Enumerator, "variable.other.enummember", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.GlobalVariable, "variable.other.global", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.LocalVariable, "variable.other.local", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.Parameter, "variable.parameter", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.Type, "entity.name.type.class", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.RefType, "entity.name.type.class.reference", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.ValueType, "entity.name.type.class.value", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.Function, "entity.name.function", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.MemberFunction, "entity.name.function.member", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.MemberField, "variable.other.property", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.StaticMemberFunction, "entity.name.function.member.static", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.StaticMemberField, "variable.other.property.static", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.Property, "variable.other.property.cli", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.Event, "variable.other.event", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.ClassTemplate, "entity.name.type.class.templated", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.GenericType, "entity.name.type.class.generic", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.FunctionTemplate, "entity.name.function.templated", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.Namespace, "entity.name.namespace", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.Label, "entity.name.label", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.UdlRaw, "entity.name.operator.custom-literal", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.UdlNumber, "entity.name.operator.custom-literal.number", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.UdlString, "entity.name.operator.custom-literal.string", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.OperatorFunction, "entity.name.function.operator", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.MemberOperator, "entity.name.function.operator.member", themeName, textMateRules);
        this.calculateStyleForToken(TokenKind.NewDelete, "keyword.operator.new", themeName, textMateRules);
    }

    public async loadTheme(themePath: string, defaultStyle: ThemeStyle): Promise<TextMateRule[][]> {
        let rules: TextMateRule[][] = [];
        if (await util.checkFileExists(themePath)) {
            const themeContentText: string = await util.readFileText(themePath);
            let themeContent: any;
            let textMateRules: TextMateRule[] | undefined;
            if (themePath.endsWith("tmTheme")) {
                themeContent = plist.parse(themeContentText);
                if (themeContent) {
                    textMateRules = themeContent.settings;
                }
            } else {
                themeContent = jsonc.parse(themeContentText);
                if (themeContent) {
                    textMateRules = themeContent.tokenColors;
                    if (themeContent.include) {
                        // parse included theme file
                        const includedThemePath: string = path.join(path.dirname(themePath), themeContent.include);
                        rules = await this.loadTheme(includedThemePath, defaultStyle);
                    }

                    if (themeContent.colors && themeContent.colors["editor.background"]) {
                        this.editorBackground = themeContent.colors["editor.background"];
                    }
                }
            }

            if (textMateRules) {
                // Convert comma delimited scopes into an array
                textMateRules.forEach(e => {
                    if (e.scope && e.scope.includes(',')) {
                        e.scope = e.scope.split(',').map((s: string) => s.trim());
                    }
                });

                const scopelessSetting: any = textMateRules.find(e => e.settings && !e.scope);
                if (scopelessSetting) {
                    if (scopelessSetting.settings.background) {
                        this.editorBackground = scopelessSetting.settings.background;
                    }
                    this.updateStyleFromTextMateRuleSettings(defaultStyle, scopelessSetting.settings);
                }
                rules.push(textMateRules);
            }
        }

        return rules;
    }

    public reload(): void {
        const f: () => void = async () => {
            const otherSettings: OtherSettings = new OtherSettings(this.uri);
            const themeName: string | undefined = otherSettings.colorTheme;
            if (themeName) {
                // Enumerate through all extensions, looking for this theme.  (Themes are implemented as extensions - even the default ones)
                // Open each package.json to check for a theme path
                for (let i: number = 0; i < vscode.extensions.all.length; i++) {
                    const extensionPath: string = vscode.extensions.all[i].extensionPath;
                    const extensionPackageJsonPath: string = path.join(extensionPath, "package.json");
                    if (!await util.checkFileExists(extensionPackageJsonPath)) {
                        continue;
                    }
                    const packageJsonText: string = await util.readFileText(extensionPackageJsonPath);
                    const packageJson: any = jsonc.parse(packageJsonText);
                    if (packageJson.contributes && packageJson.contributes.themes) {
                        const foundTheme: any = packageJson.contributes.themes.find((e: any) => e.id === themeName || e.label === themeName);
                        if (foundTheme) {
                            const themeRelativePath: string = foundTheme.path;
                            const themeFullPath: string = path.join(extensionPath, themeRelativePath);
                            const defaultStyle: ThemeStyle = new ThemeStyle();
                            const rulesSet: TextMateRule[][] = await this.loadTheme(themeFullPath, defaultStyle);
                            this.updateStyles(themeName, defaultStyle, rulesSet);
                            return;
                        }
                    }
                }
            }
        };
        this.syncWithLoadingSettings(f);
    }

    public static createDecorationFromThemeStyle(themeStyle: ThemeStyle): vscode.TextEditorDecorationType | undefined {
        if (themeStyle && (themeStyle.foreground || themeStyle.background || themeStyle.fontStyle)) {
            const options: vscode.DecorationRenderOptions = {};
            options.rangeBehavior = vscode.DecorationRangeBehavior.OpenOpen;
            if (themeStyle.foreground) {
                options.color = themeStyle.foreground;
            }
            if (themeStyle.background) {
                options.backgroundColor = themeStyle.background;
            }
            if (themeStyle.fontStyle) {
                const parts: string[] = themeStyle.fontStyle.split(" ");
                parts.forEach((part) => {
                    switch (part) {
                        case "italic":
                            options.fontStyle = "italic";
                            break;
                        case "bold":
                            options.fontWeight = "bold";
                            break;
                        case "underline":
                            options.textDecoration = "underline";
                            break;
                        default:
                            break;
                    }
                });
            }
            return vscode.window.createTextEditorDecorationType(options);
        }

        return undefined;
    }
}

export class ColorizationState {
    private uri: vscode.Uri;
    private colorizationSettings: ColorizationSettings;
    private decorations: (vscode.TextEditorDecorationType | undefined)[] = new Array<vscode.TextEditorDecorationType | undefined>(TokenKind.Count);
    private semanticRanges: vscode.Range[][] = new Array<vscode.Range[]>(TokenKind.Count);
    private inactiveDecoration: vscode.TextEditorDecorationType | undefined;
    private inactiveRanges: vscode.Range[] = [];
    private versionedEdits: VersionedEdits[] = [];
    private currentSemanticVersion: number = 0;
    private lastReceivedSemanticVersion: number = 0;

    public constructor(uri: vscode.Uri, colorizationSettings: ColorizationSettings) {
        this.uri = uri;
        this.colorizationSettings = colorizationSettings;
    }

    private createColorizationDecorations(isCpp: boolean): void {
        const settings: CppSettings = new CppSettings(this.uri);
        if (settings.enhancedColorization) {
            // Create new decorators
            // The first decorator created takes precedence, so these need to be created in reverse order
            for (let i: number = TokenKind.Count; i > 0;) {
                i--;
                let themeStyleMap: any;
                if (isCpp) {
                    themeStyleMap = this.colorizationSettings.themeStyleCppMap;
                } else {
                    themeStyleMap = this.colorizationSettings.themeStyleCMap;
                }
                this.decorations[i] = ColorizationSettings.createDecorationFromThemeStyle(themeStyleMap[i]);
            }
        }
        if (settings.dimInactiveRegions) {
            const opacity: number | undefined = settings.inactiveRegionOpacity;
            if (opacity !== null && opacity !== undefined) {
                let backgroundColor: string | undefined = settings.inactiveRegionBackgroundColor;
                if (backgroundColor === "") {
                    backgroundColor = undefined;
                }
                let color: string | undefined = settings.inactiveRegionForegroundColor;
                if (color === "") {
                    color = undefined;
                }
                this.inactiveDecoration = vscode.window.createTextEditorDecorationType({
                    opacity: opacity.toString(),
                    backgroundColor: backgroundColor,
                    color: color,
                    rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
                });
            }
        }
    }

    private disposeColorizationDecorations(): void {
        // Dispose of all old decorations
        if (this.inactiveDecoration) {
            this.inactiveDecoration.dispose();
            this.inactiveDecoration = undefined;
        }
        for (let i: number = 0; i < TokenKind.Count; i++) {
            const decoration: vscode.TextEditorDecorationType | undefined = this.decorations[i];
            if (decoration) {
                decoration.dispose();
                this.decorations[i] = undefined;
            }
        }
    }

    public dispose(): void {
        this.disposeColorizationDecorations();
    }

    private refreshInner(e: vscode.TextEditor): void {
        const settings: CppSettings = new CppSettings(this.uri);
        if (settings.enhancedColorization) {
            for (let i: number = 0; i < TokenKind.Count; i++) {
                const decoration: vscode.TextEditorDecorationType | undefined = this.decorations[i];
                if (decoration) {
                    const ranges: vscode.Range[] = this.semanticRanges[i];
                    if (ranges && ranges.length > 0) {
                        e.setDecorations(decoration, ranges);
                    }
                }
            }
        }

        // Normally, decorators are honored in the order in which they were created, not the
        // order in which they were applied.  Decorators with opacity appear to be handled
        // differently, in that the opacity is applied to overlapping decorators even if
        // created afterwards.
        if (settings.dimInactiveRegions && this.inactiveDecoration && this.inactiveRanges) {
            e.setDecorations(this.inactiveDecoration, this.inactiveRanges);
        }
    }

    public refresh(e: vscode.TextEditor): void {
        this.applyEdits();
        const f: () => void = async () => {
            this.refreshInner(e);
        };
        this.colorizationSettings.syncWithLoadingSettings(f);
    }

    public onSettingsChanged(uri: vscode.Uri): void {
        const f: () => void = async () => {
            this.applyEdits();
            this.disposeColorizationDecorations();
            const isCpp: boolean = util.isEditorFileCpp(uri.toString());
            this.createColorizationDecorations(isCpp);
            const editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri === uri);
            for (const e of editors) {
                this.refreshInner(e);
            }
        };
        this.colorizationSettings.syncWithLoadingSettings(f);
    }

    // Utility function to convert a string and a start Position into a Range
    private textToRange(text: string, startPosition: vscode.Position): vscode.Range {
        const parts: string[] = text.split("\n");
        const addedLines: number = parts.length - 1;
        const newStartLine: number = startPosition.line;
        const newStartCharacter: number = startPosition.character;
        const newEndLine: number = newStartLine + addedLines;
        let newEndCharacter: number = parts[parts.length - 1].length;
        if (newStartLine === newEndLine) {
            newEndCharacter += newStartCharacter;
        }
        return new vscode.Range(newStartLine, newStartCharacter, newEndLine, newEndCharacter);
    }

    // Utility function to shift a range back after removing content before it
    private shiftRangeAfterRemove(range: vscode.Range, removeStartPosition: vscode.Position, removeEndPosition: vscode.Position): vscode.Range {
        const lineDelta: number = removeStartPosition.line - removeEndPosition.line;
        let startCharacterDelta: number = 0;
        let endCharacterDelta: number = 0;
        if (range.start.line === removeEndPosition.line) {
            startCharacterDelta = removeStartPosition.character - removeEndPosition.character;
            if (range.end.line === removeEndPosition.line) {
                endCharacterDelta = startCharacterDelta;
            }
        }
        const newStart: vscode.Position = range.start.translate(lineDelta, startCharacterDelta);
        const newEnd: vscode.Position = range.end.translate(lineDelta, endCharacterDelta);
        return new vscode.Range(newStart, newEnd);
    }

    // Utility function to shift a range forward after inserting content before it
    private shiftRangeAfterInsert(range: vscode.Range, insertStartPosition: vscode.Position, insertEndPosition: vscode.Position): vscode.Range {
        const addedLines: number = insertEndPosition.line - insertStartPosition.line;
        const newStartLine: number = range.start.line + addedLines;
        const newEndLine: number = range.end.line + addedLines;
        let newStartCharacter: number = range.start.character;
        let newEndCharacter: number = range.end.character;
        // If starts on the same line as replacement ended
        if (insertEndPosition.line === newStartLine) {
            let endOffsetLength: number = insertEndPosition.character;
            // If insertRange starts and ends on the same line, only offset by it's length
            if (insertEndPosition.line === insertStartPosition.line) {
                endOffsetLength -= insertStartPosition.character;
            }
            newStartCharacter += endOffsetLength;
            if (insertEndPosition.line === newEndLine) {
                newEndCharacter += endOffsetLength;
            }
        }
        return new vscode.Range(newStartLine, newStartCharacter, newEndLine, newEndCharacter);
    }

    // Utility function to adjust a range to account for an insert and/or replace
    private fixRange(range: vscode.Range, removeInsertStartPosition: vscode.Position, removeEndPosition: vscode.Position, insertEndPosition: vscode.Position): vscode.Range | undefined {
        // If the replace/insert starts after this range ends, no adjustment is needed.
        if (removeInsertStartPosition.isAfterOrEqual(range.end)) {
            return range;
        }
        // Else, replace/insert range starts before this range ends.

        // If replace/insert starts before/where this range starts, we don't need to extend the existing range, but need to shift it
        if (removeInsertStartPosition.isBeforeOrEqual(range.start)) {

            // If replace consumes the entire range, remove it
            if (removeEndPosition.isAfterOrEqual(range.end)) {
                return undefined;
            }

            // If replace ends within this range, we need to trim it before we shift it
            let newRange: vscode.Range;
            if (removeEndPosition.isAfterOrEqual(range.start)) {
                newRange = new vscode.Range(removeEndPosition, range.end);
            } else {
                newRange = range;
            }
            // Else, if replace ends before this range starts, we just need to shift it.

            newRange = this.shiftRangeAfterRemove(newRange, removeInsertStartPosition, removeEndPosition);
            return this.shiftRangeAfterInsert(newRange, removeInsertStartPosition, insertEndPosition);
        }
        // Else, if replace/insert starts within (not before or after) range, extend it.

        // If there replace/insert overlaps past the end of the original range, just extend existing range to the insert end position
        if (removeEndPosition.isAfterOrEqual(range.end)) {
            return new vscode.Range(range.start.line, range.start.character, insertEndPosition.line, insertEndPosition.character);
        }
        // Else, range has some left over at the end, which needs to be shifted after insertEndPosition.

        // If the trailing segment is on the last line replace, we just need to extend by the remaining number of characters
        if (removeEndPosition.line === range.end.line) {
            return new vscode.Range(range.start.line, range.start.character, insertEndPosition.line, insertEndPosition.character + (range.end.character - removeEndPosition.character));
        }
        // Else, the trailing segment ends on another line, so the character position should remain the same.  Just adjust based on added/removed lined.
        const removedLines: number = removeEndPosition.line - removeInsertStartPosition.line;
        const addedLines: number = insertEndPosition.line - removeInsertStartPosition.line;
        const deltaLines: number = addedLines - removedLines;
        return new vscode.Range(range.start.line, range.start.character, range.end.line + deltaLines,  range.end.character);
    }

    private fixRanges(originalRanges: vscode.Range[], changes: readonly vscode.TextDocumentContentChangeEvent[]): vscode.Range[] {
        // outer loop needs to be the versioned edits, then changes within that edit, then ranges
        let ranges: vscode.Range[] = originalRanges;
        if (ranges && ranges.length > 0) {
            changes.forEach((change) => {
                const newRanges: vscode.Range[] = [];
                const insertRange: vscode.Range = this.textToRange(change.text, change.range.start);
                for (let i: number = 0; i < ranges.length; i++) {
                    const newRange: vscode.Range | undefined = this.fixRange(ranges[i], change.range.start, change.range.end, insertRange.end);
                    if (newRange) {
                        newRanges.push(newRange);
                    }
                }
                ranges = newRanges;
            });
        }
        return ranges;
    }

    // Add edits to be applied when/if cached tokens need to be reapplied.
    public addEdits(changes: readonly vscode.TextDocumentContentChangeEvent[], editVersion: number): void {
        const edits: VersionedEdits = {
            editVersion: editVersion,
            changes: changes
        };
        this.versionedEdits.push(edits);
    }

    // Apply any pending edits to the currently cached tokens
    private applyEdits(): void {
        this.versionedEdits.forEach((edit) => {
            if (edit.editVersion > this.currentSemanticVersion) {
                for (let i: number = 0; i < TokenKind.Count; i++) {
                    this.semanticRanges[i] = this.fixRanges(this.semanticRanges[i], edit.changes);
                }
                this.inactiveRanges = this.fixRanges(this.inactiveRanges, edit.changes);
                this.currentSemanticVersion = edit.editVersion;
            }
        });
    }

    // Remove any edits from the list if we will never receive tokens that old.
    private purgeOldVersionedEdits(): void {
        const minVersion: number = this.lastReceivedSemanticVersion;
        const index: number = this.versionedEdits.findIndex((edit) => edit.editVersion > minVersion);
        if (index === -1) {
            this.versionedEdits = [];
        } else if (index > 0) {
            this.versionedEdits = this.versionedEdits.slice(index);
        }
    }

    private updateColorizationRanges(uri: string): void {
        const f: () => void = async () => {
            this.applyEdits();
            this.purgeOldVersionedEdits();

            // The only way to un-apply decorators is to dispose them.
            // If we dispose old decorators before applying new decorators, we see a flicker on Mac,
            // likely due to a race with UI updates.  Here we set aside the existing decorators to be
            // disposed of after the new decorators have been applied, so there is not a gap
            // in which decorators are not applied.
            const oldInactiveDecoration: vscode.TextEditorDecorationType | undefined = this.inactiveDecoration;
            const oldDecorations: (vscode.TextEditorDecorationType | undefined)[] = this.decorations;
            this.inactiveDecoration = undefined;
            this.decorations =  new Array<vscode.TextEditorDecorationType>(TokenKind.Count);

            const isCpp: boolean = util.isEditorFileCpp(uri);
            this.createColorizationDecorations(isCpp);

            // Apply the decorations to all *visible* text editors
            const editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === uri);
            for (const e of editors) {
                this.refreshInner(e);
            }

            // Dispose of the old decorators only after the new ones have been applied.
            if (oldInactiveDecoration) {
                oldInactiveDecoration.dispose();
            }
            if (oldDecorations) {
                for (let i: number = 0; i < TokenKind.Count; i++) {
                    const oldDecoration: vscode.TextEditorDecorationType | undefined = oldDecorations[i];
                    if (oldDecoration) {
                        oldDecoration.dispose();
                    }
                }
            }
        };
        this.colorizationSettings.syncWithLoadingSettings(f);
    }

    public updateSemantic(uri: string, semanticRanges: vscode.Range[][], inactiveRanges: vscode.Range[], editVersion: number): void {
        this.inactiveRanges = inactiveRanges;
        for (let i: number = 0; i < TokenKind.Count; i++) {
            this.semanticRanges[i] = semanticRanges[i];
        }
        this.currentSemanticVersion = editVersion;
        this.lastReceivedSemanticVersion = editVersion;
        this.updateColorizationRanges(uri);
    }
}
