/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as util from '../common';
import { CppSettings, OtherSettings, TextMateRule, TextMateRuleSettings, TextMateContributesGrammar } from './settings';

export enum TokenKind {
    // These need to match the token_kind enum in the server

    // Syntactic/Lexical tokens
    Identifier,
    Comment,
    Keyword,
    PreprocessorKeyword,
    OperatorToken,
    XmlDocComment,
    XmlDocTag,

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
    changes: vscode.TextDocumentContentChangeEvent[];
}

class ThemeStyle {
    foreground: string;
    background: string;
    fontStyle: string;
}

export class ColorizationSettings {
    private uri: vscode.Uri;
    private pendingTask: util.BlockingTask<void>;

    public themeStyleCMap: ThemeStyle[] = [];
    public themeStyleCppMap: ThemeStyle[] = [];

    constructor(uri: vscode.Uri) {
        this.uri = uri;
        this.updateGrammars();
        this.reload();
    }

    private cloneThemeStyle(styleToCopy: ThemeStyle): ThemeStyle {
        let newStyle: ThemeStyle = new ThemeStyle();
        newStyle.foreground = styleToCopy.foreground;
        newStyle.background = styleToCopy.background;
        newStyle.fontStyle = styleToCopy.fontStyle;
        return newStyle;
    }

    private getThemeStyleFromTextMateRuleSettings(baseStyle: ThemeStyle, textMateRuleSettings: TextMateRuleSettings): void {
        if (textMateRuleSettings.foreground) {
            baseStyle.foreground = textMateRuleSettings.foreground;
        }
        if (textMateRuleSettings.background) {
            baseStyle.background = textMateRuleSettings.background;
        }
        // Any (even empty) string for fontStyle removes inherited value
        if (textMateRuleSettings.fontStyle) {
            baseStyle.fontStyle = textMateRuleSettings.fontStyle;
        } else if (textMateRuleSettings.fontStyle === "") {
            baseStyle.fontStyle = undefined;
        }
    }

    private findThemeStyleForScope(baseCStyle: ThemeStyle, baseCppStyle: ThemeStyle, scope: string, textMateRules: TextMateRule[]): void {
        if (textMateRules) {
            // Search for settings with this scope
            for (let i: number = 0; i < textMateRules.length; i++) {
                let ruleScope: any = textMateRules[i].scope;
                if ((ruleScope === scope) || ((ruleScope instanceof Array) && ruleScope.indexOf(scope) > -1) && textMateRules[i].settings) {
                    if (baseCStyle) {
                        this.getThemeStyleFromTextMateRuleSettings(baseCStyle, textMateRules[i].settings);
                    }
                    if (baseCppStyle) {
                        this.getThemeStyleFromTextMateRuleSettings(baseCppStyle, textMateRules[i].settings);
                    }
                    break;
                }
            }
        }
    }

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

    private calculateThemeStyleForScope(baseCStyle: ThemeStyle, baseCppStyle: ThemeStyle, scope: string, themeName: string, themeTextMateRules: TextMateRule[]): void {
        // Search for settings with this scope in current theme
        this.findThemeStyleForScope(baseCStyle, baseCppStyle, scope, themeTextMateRules);
        let otherSettings: OtherSettings = new OtherSettings(this.uri);

        // Next in priority would be a global user override of token color of the equivilent scope
        let colorTokenName: string | undefined = ColorizationSettings.scopeToTokenColorNameMap.get(scope);
        if (colorTokenName) {
            let settingValue: string = otherSettings.getCustomColorToken(colorTokenName);
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
            let settingValue: string = otherSettings.getCustomThemeSpecificColorToken(colorTokenName, themeName);
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
        let textMateRules: TextMateRule[] = otherSettings.getCustomThemeSpecificTextMateRules(themeName);
        this.findThemeStyleForScope(baseCStyle, baseCppStyle, scope, textMateRules);
    }

    private calculateThemeStyleForVsToken(tokenKind: TokenKind, scope: string, themeName: string, themeTextMateRules: TextMateRule[]): void {
        let parts: string[] = scope.split(".");
        let accumulatedScope: string = "";
        for (let i: number = 0; i < parts.length; i++) {
            accumulatedScope += parts[i];
            this.calculateThemeStyleForScope(this.themeStyleCMap[tokenKind], this.themeStyleCppMap[tokenKind], accumulatedScope, themeName, themeTextMateRules);
            this.calculateThemeStyleForScope(this.themeStyleCMap[tokenKind], null, accumulatedScope + ".c", themeName, themeTextMateRules);
            this.calculateThemeStyleForScope(null, this.themeStyleCppMap[tokenKind], accumulatedScope + ".cpp", themeName, themeTextMateRules);
            accumulatedScope += ".";
        }
    }

    public syncWithLoadingSettings(f: () => any): void {
        this.pendingTask = new util.BlockingTask<void>(f, this.pendingTask);
    };

    public reload(): void {
        let f: () => void = async () => {
            let otherSettings: OtherSettings = new OtherSettings(this.uri);
            let themeName: string = otherSettings.colorTheme;

            // Enumerate through all extensions, looking for this theme.  (Themes are implemented as extensions - even the default ones)
            // Open each package.json to check for a theme path
            for (let i: number = 0; i < vscode.extensions.all.length; i++) {
                let extensionPath: string = vscode.extensions.all[i].extensionPath;
                let extensionPackageJsonPath: string = path.join(extensionPath, "package.json");
                if (!await util.checkFileExists(extensionPackageJsonPath)) {
                    continue;
                }
                let packageJsonText: string = await util.readFileText(extensionPackageJsonPath);
                let packageJson: any = JSON.parse(packageJsonText);
                if (packageJson.contributes && packageJson.contributes.themes) {
                    let foundTheme: any = packageJson.contributes.themes.find(e => e.id === themeName || e.label === themeName);
                    if (foundTheme) {
                        let defaultStyle: ThemeStyle = new ThemeStyle();                        
                        let themeRelativePath: string = foundTheme.path;
                        let themeFullPath: string = path.join(extensionPath, themeRelativePath);
                        if (await util.checkFileExists(themeFullPath)) {
                            let themeContentText: string = await util.readFileText(themeFullPath);
                            let themeContent: any = JSON.parse(themeContentText);
                            let textMateRules: TextMateRule[];
                            if (themeContent) {
                                textMateRules = themeContent.tokenColors;
                            }

                            // override default if there are setting for an undefined scope in the current theme.
                            this.findThemeStyleForScope(defaultStyle, null, undefined, textMateRules);
                            this.themeStyleCMap = new Array<ThemeStyle>(TokenKind.Count);
                            this.themeStyleCppMap = new Array<ThemeStyle>(TokenKind.Count);
                            
                            // Populate with unique objects, as they will be individual modified in place
                            for (let i: number = 0; i < TokenKind.Count; i++) {
                                this.themeStyleCMap[i] = this.cloneThemeStyle(defaultStyle);
                                this.themeStyleCppMap[i] = this.cloneThemeStyle(defaultStyle);
                            }
                            this.calculateThemeStyleForVsToken(TokenKind.Identifier, "entity.name", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Comment, "comment", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Keyword, "keyword.control", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.PreprocessorKeyword, "keyword.control.directive", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.OperatorToken, "entity.name.operator", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.XmlDocComment, "comment.xml.doc", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.XmlDocTag, "comment.xml.doc.tag", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Macro, "entity.name.function.preprocessor", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Enumerator, "entity.name.enum", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.GlobalVariable, "variable.other.global", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.LocalVariable, "variable.other.local", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Parameter, "variable.parameter", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Type, "entity.name.type", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.RefType, "entity.name.type.class.reference", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.ValueType, "entity.name.type.class.value", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Function, "entity.name.function", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.MemberFunction, "entity.name.function.member", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.MemberField, "variable.other.member", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.StaticMemberFunction, "entity.name.function.member.static", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.StaticMemberField, "variable.other.member.static", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Property, "variable.other.property", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Event, "variable.other.event", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.ClassTemplate, "entity.name.type.class.template", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.GenericType, "entity.name.type.class.generic", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.FunctionTemplate, "entity.name.function.template", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Namespace, "entity.name.namespace", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Label, "entity.name.label", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.UdlRaw, "constant.other.user-defined-literal", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.UdlNumber, "constant.numeric", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.UdlString, "string.quoted", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.OperatorFunction, "keyword.operator", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.MemberOperator, "keyword.operator.member", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.NewDelete, "keyword.operator.new", themeName, textMateRules);
                            return;
                        }
                    }
                }
            }
        };
        this.syncWithLoadingSettings(f);
    }

    public static createDecorationFromThemeStyle(themeStyle: ThemeStyle): vscode.TextEditorDecorationType {
        if (themeStyle && (themeStyle.foreground || themeStyle.background || themeStyle.fontStyle)) {
            let options: vscode.DecorationRenderOptions = {};
            options.rangeBehavior = vscode.DecorationRangeBehavior.OpenOpen;
            if (themeStyle.foreground) {
                options.color = themeStyle.foreground;
            }
            if (themeStyle.background) {
                options.backgroundColor = themeStyle.background;
            }
            if (themeStyle.fontStyle) {
                let parts: string[] = themeStyle.fontStyle.split(" ");
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

        return null;
    }

    public useEmptyGrammars(): void {
        let packageJson: any = util.getRawPackageJson();
        if (!packageJson.contributes.grammars || !packageJson.contributes.grammars.length) {
            let cppGrammarContributesNode: TextMateContributesGrammar = {
                language: "cpp",
                scopeName: "source.cpp",
                path: "./nogrammar.cpp.json"
            };
            let cGrammarContributesNode: TextMateContributesGrammar = {
                language: "c",
                scopeName: "source.c",
                path: "./nogrammar.c.json"
            };
            packageJson.contributes.grammars = [];
            packageJson.contributes.grammars.push(cppGrammarContributesNode);
            packageJson.contributes.grammars.push(cGrammarContributesNode);
            util.writeFileText(util.getPackageJsonPath(), util.stringifyPackageJson(packageJson));
            util.promptForReloadWindowDueToSettingsChange();
        }
    }

    public useStandardGrammars(): void {
        let packageJson: any = util.getRawPackageJson();
        if (packageJson.contributes.grammars && packageJson.contributes.grammars.length > 0) {
            packageJson.contributes.grammars = [];
            util.writeFileText(util.getPackageJsonPath(), util.stringifyPackageJson(packageJson));
            util.promptForReloadWindowDueToSettingsChange();
        }
    }

    public updateGrammars(): void {
        let settings: CppSettings = new CppSettings(this.uri);
        if (settings.textMateColorization === "Enabled") {
            this.useStandardGrammars();
        } else {
            this.useEmptyGrammars();
        }
    }
}

export class ColorizationState {
    private uri: vscode.Uri;
    private colorizationSettings: ColorizationSettings;
    private decorations: vscode.TextEditorDecorationType[] = new Array<vscode.TextEditorDecorationType>(TokenKind.Count);
    private syntacticRanges: vscode.Range[][] = new Array<vscode.Range[]>(TokenKind.Count);
    private semanticRanges: vscode.Range[][] = new Array<vscode.Range[]>(TokenKind.Count);
    private inactiveDecoration: vscode.TextEditorDecorationType = null;
    private inactiveRanges: vscode.Range[] = [];
    private versionedEdits: VersionedEdits[] = [];
    private lastSyntacticVersion: number = 0;
    private lastSemanticVersion: number = 0;

    public constructor(uri: vscode.Uri, colorizationSettings: ColorizationSettings) {
        this.uri = uri;
        this.colorizationSettings = colorizationSettings;
    }

    private createColorizationDecorations(isCpp: boolean): void {
        let settings: CppSettings = new CppSettings(this.uri);
        if (settings.enhancedColorization === "Enabled") {
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
            this.inactiveDecoration = vscode.window.createTextEditorDecorationType({
                opacity: settings.inactiveRegionOpacity.toString(),
                backgroundColor: settings.inactiveRegionBackgroundColor,
                color: settings.inactiveRegionForegroundColor,
                rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen
            });
        }
    }

    private disposeColorizationDecorations(): void {
        // Dispose of all old decorations
        if (this.inactiveDecoration) {
            this.inactiveDecoration.dispose();
            this.inactiveDecoration = null;
        }
        for (let i: number = 0; i < TokenKind.Count; i++) {
            if (this.decorations[i]) {
                this.decorations[i].dispose();
                this.decorations[i] = null;
            }
        }
    }

    public dispose(): void {
        this.disposeColorizationDecorations();
    }

    public refreshColorizationRanges(e: vscode.TextEditor): void {
        // Clear inactive regions
        if (this.inactiveDecoration) {
            e.setDecorations(this.inactiveDecoration, []);
        }
        let settings: CppSettings = new CppSettings(this.uri);
        if (settings.enhancedColorization === "Enabled") {
            for (let i: number = 0; i < TokenKind.Count; i++) {
                if (this.decorations[i]) {
                    let ranges: vscode.Range[] = this.syntacticRanges[i];
                    if (this.semanticRanges[i]) {
                        if (!ranges || !ranges.length) {
                            ranges = this.semanticRanges[i];
                        } else {
                            ranges = ranges.concat(this.semanticRanges[i]);
                        }
                    }
                    if (ranges && ranges.length > 0) {
                        e.setDecorations(this.decorations[i], ranges);
                    }
                }
            }
        }
        // Apply dimming last
        if (settings.dimInactiveRegions && this.inactiveRanges) {
            e.setDecorations(this.inactiveDecoration, this.inactiveRanges);
        }
    }

    public onSettingsChanged(uri: vscode.Uri): void {
        let f: () => void = async () => {
            this.disposeColorizationDecorations();
            let isCpp: boolean = util.isEditorFileCpp(uri.toString());
            this.createColorizationDecorations(isCpp);
            let editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri === uri);
            for (let e of editors) {
                this.refreshColorizationRanges(e);
            }
        }
        this.colorizationSettings.syncWithLoadingSettings(f);
    }

    // Utility function to convert a string and a start Position into a Range
    private textToRange(text: string, startPosition: vscode.Position): vscode.Range {
        let parts: string[] = text.split("\n");
        let addedLines: number = parts.length - 1;
        let newStartLine: number = startPosition.line;
        let newStartCharacter: number = startPosition.character;
        let newEndLine: number = newStartLine + addedLines;
        let newEndCharacter: number = parts[parts.length - 1].length;
        if (newStartLine === newEndLine) {
            newEndCharacter += newStartCharacter;
        }
        return new vscode.Range(newStartLine, newStartCharacter, newEndLine, newEndCharacter);
    }

    private shiftRangeAfterRemove(range: vscode.Range, removeStartPosition: vscode.Position, removeEndPosition: vscode.Position): vscode.Range {
        let lineDelta: number = removeStartPosition.line - removeEndPosition.line;
        let startCharacterDelta: number = 0;
        let endCharacterDelta: number = 0;
        if (range.start.line === removeEndPosition.line) {
            startCharacterDelta = removeStartPosition.character - removeEndPosition.character;
            if (range.end.line === removeEndPosition.line) {
                endCharacterDelta = startCharacterDelta;
            }
        }
        let newStart: vscode.Position = range.start.translate(lineDelta, startCharacterDelta);
        let newEnd: vscode.Position = range.end.translate(lineDelta, endCharacterDelta);
        return new vscode.Range(newStart, newEnd);
    }

    private shiftRangeAfterInsert(range: vscode.Range, insertStartPosition: vscode.Position, insertEndPosition: vscode.Position): vscode.Range {
        let addedLines: number = insertEndPosition.line - insertStartPosition.line;
        let newStartLine: number = range.start.line + addedLines;
        let newEndLine: number = range.end.line + addedLines;
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

    private fixRange(range: vscode.Range, removeInsertStartPosition: vscode.Position, removeEndPosition: vscode.Position, insertEndPosition: vscode.Position): vscode.Range {
        // If the replace/insert starts after this range ends, no adjustment is needed.
        if (removeInsertStartPosition.isAfterOrEqual(range.end)) {
            return range;
        }
        // Else, replace/insert range starts before this range ends.

        // If replace/insert starts before/where this range starts, we don't need to extend the existing range, but need to shift it
        if (removeInsertStartPosition.isBeforeOrEqual(range.start)) {

            // If replace consumes the entire range, remove it
            if (removeEndPosition.isAfterOrEqual(range.end)) {
                return null;
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
        let removedLines: number = removeEndPosition.line - removeInsertStartPosition.line;
        let addedLines: number = insertEndPosition.line - removeInsertStartPosition.line;
        let deltaLines: number = addedLines - removedLines;
        return new vscode.Range(range.start.line, range.start.character, range.end.line + deltaLines,  range.end.character);
    }

    private fixRanges(originalRanges: vscode.Range[], changes: vscode.TextDocumentContentChangeEvent[]): vscode.Range[] {
        // outer loop needs to be the versioned edits, then changes within that edit, then ranges
        let ranges: vscode.Range[] = originalRanges;
        if (ranges && ranges.length > 0) {
            changes.forEach((change) => {
                let newRanges: vscode.Range[] = [];
                let insertRange: vscode.Range = this.textToRange(change.text, change.range.start);
                for (let i: number = 0; i < ranges.length; i++) {
                    let newRange: vscode.Range = this.fixRange(ranges[i], change.range.start, change.range.end, insertRange.end);
                    if (newRange !== null) {
                        newRanges.push(newRange);
                    }
                }
                ranges = newRanges;
            });
        }
        return ranges;
    }

    public updateAfterEdits(changes: vscode.TextDocumentContentChangeEvent[], editVersion: number): void {
        for (let i: number = 0; i < this.syntacticRanges.length; i++) {
            this.syntacticRanges[i] = this.fixRanges(this.syntacticRanges[i], changes);
        }
        for (let i: number = 0; i < this.semanticRanges.length; i++) {
            this.semanticRanges[i] = this.fixRanges(this.semanticRanges[i], changes);
        }
        this.inactiveRanges = this.fixRanges(this.inactiveRanges, changes);
        let edits: VersionedEdits = {
            editVersion: editVersion,
            changes: changes
        };
        this.versionedEdits.push(edits);
    }

    private purgeOldVersionedEdits(): void {
        let minVersion: number = Math.min(this.lastSemanticVersion, this.lastSyntacticVersion);
        let index: number = this.versionedEdits.findIndex((edit) => edit.editVersion > minVersion);
        if (index === -1) {
            this.versionedEdits = [];
        } else if (index > 0) {
            this.versionedEdits = this.versionedEdits.slice(index);
        }
    }
    
    private updateColorizationRanges(uri: string, syntacticRanges: vscode.Range[][], semanticRanges: vscode.Range[][], inactiveRanges: vscode.Range[]): void {
        // Dispose of original decorators.
        // Disposing and recreating is simpler than setting decorators to empty ranges in each editor showing this file
        this.disposeColorizationDecorations();
        if (inactiveRanges) {
            this.inactiveRanges = inactiveRanges;
        }
        for (let i: number = 0; i < TokenKind.Count; i++) {
            if (syntacticRanges) {
                this.syntacticRanges[i] = syntacticRanges[i];
            }
            if (semanticRanges) {
                this.semanticRanges[i] = semanticRanges[i];
            }
        }
        let isCpp: boolean = util.isEditorFileCpp(uri);
        this.createColorizationDecorations(isCpp);

        // Apply the decorations to all *visible* text editors
        let editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === uri);
        for (let e of editors) {
            this.refreshColorizationRanges(e);
        }
    }

    public updateSyntactic(uri: string, syntacticRanges: vscode.Range[][], editVersion: number): void {
        this.versionedEdits.forEach((edit) => {
            if (edit.editVersion > editVersion) {
                for (let i: number = 0; i < TokenKind.Count; i++) {
                    this.fixRanges(syntacticRanges[i], edit.changes);
                }
            }
        });
        this.updateColorizationRanges(uri, syntacticRanges, null, null);
        this.lastSyntacticVersion = editVersion;
        this.purgeOldVersionedEdits();
    }

    public updateSemantic(uri: string, semanticRanges: vscode.Range[][], inactiveRanges: vscode.Range[], editVersion: number): void {
        this.versionedEdits.forEach((edit) => {
            if (edit.editVersion > editVersion) {
                for (let i: number = 0; i < TokenKind.Count; i++) {
                    this.fixRanges(semanticRanges[i], edit.changes);
                }
                this.fixRanges(inactiveRanges, edit.changes);
            }
        });
        this.updateColorizationRanges(uri, null, semanticRanges, inactiveRanges);
        this.lastSemanticVersion = editVersion;
        this.purgeOldVersionedEdits();
    }
}
