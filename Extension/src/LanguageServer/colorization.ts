/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as util from '../common';
import { CppSettings, OtherSettings, TextMateRule, TextMateRuleSettings } from './settings';
import { Client } from './client';

export enum TokenKind {
    // These need to match the token_kind enum in the server
    None,
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

    // Syntactic/Lexical tokens
    Identifier,
    Comment,
    Keyword,
    PreprocessorKeyword,
    OperatorToken,
    XmlDocComment,
    XmlDocTag,

    Count
}

export class ThemeStyle {
    foreground: string;
    background: string;
    fontStyle: string;
}

export class ColorizationSettings {

    constructor(uri: vscode.Uri) {
        this.uri = uri;
        this.reload();
    }

    public themeStyleCMap: ThemeStyle[] = [];
    public themeStyleCppMap: ThemeStyle[] = [];

    private uri: vscode.Uri;

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

    public reload(): void {
        let otherSettings: OtherSettings = new OtherSettings(this.uri);
        let themeName: string = otherSettings.colorTheme;
        
        // Enumerate through all extensions, looking for this theme.  (Themes are implemented as extensions - even the default ones)
        // Crack open each package.json to check for a theme name patch
        for (let i: number = 0; i < vscode.extensions.all.length; i++) {
            let extensionPath: string = vscode.extensions.all[i].extensionPath;
            let extensionPackageJsonPath: string = path.join(extensionPath, "package.json");
            if (!fs.existsSync(extensionPackageJsonPath)) {
                continue;
            }
            let packageJson: any = JSON.parse(fs.readFileSync(extensionPackageJsonPath).toString());
            if (packageJson.contributes && packageJson.contributes.themes) {
                for (let j: number = 0; j < packageJson.contributes.themes.length; j++) {
                    let themeId: string = packageJson.contributes.themes[j].id;
                    let themeLabel: string = packageJson.contributes.themes[j].label;
                    if (themeId === themeName || themeLabel === themeName) {
                        // found currently selected theme

                        let defaultStyle: ThemeStyle = new ThemeStyle();                        
                        let themeRelativePath: string = packageJson.contributes.themes[j].path;
                        let themeFullPath: string = path.join(extensionPath, themeRelativePath);
                        if (fs.existsSync(themeFullPath)) {
                            let themeContent: any = JSON.parse(fs.readFileSync(themeFullPath).toString());
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
                            this.calculateThemeStyleForVsToken(TokenKind.UdlNumber, "constant.numeric", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.UdlString, "string.quoted", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Keyword, "keyword.control", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Function, "entity.name.function", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Type, "entity.name.type", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.OperatorFunction, "keyword.operator", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.PreprocessorKeyword, "keyword.control.directive", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.RefType, "entity.name.type.class.reference", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.ValueType, "entity.name.type.class.value", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.MemberFunction, "entity.name.function.member", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.StaticMemberFunction, "entity.name.function.member.static", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.ClassTemplate, "entity.name.type.class.template", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.FunctionTemplate, "entity.name.function.template", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.XmlDocComment, "comment.xml.doc", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.XmlDocTag, "comment.xml.doc.tag", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Macro, "entity.name.function.preprocessor", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.OperatorToken, "entity.name.operator", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.GlobalVariable, "variable.other.global", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.LocalVariable, "variable.other.local", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Parameter, "variable.parameter", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.MemberField, "variable.other.member", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.StaticMemberField, "variable.other.member.static", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Namespace, "entity.name.namespace", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Label, "entity.name.label", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.MemberOperator, "keyword.operator.member", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.NewDelete, "keyword.operator.new", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Enumerator, "entity.name.enum", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Property, "variable.other.property", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.Event, "variable.other.event", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.UdlRaw, "constant.other.user-defined-literal", themeName, textMateRules);
                            this.calculateThemeStyleForVsToken(TokenKind.GenericType, "entity.name.type.class.generic", themeName, textMateRules);
                            return;
                        }
                    }
                }
            }
        }
    }

    public static createDecorationFromThemeStyle(themeStyle: ThemeStyle): vscode.TextEditorDecorationType {
        if (themeStyle) {
            if (themeStyle.foreground || themeStyle.background || themeStyle.fontStyle) {
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
        }

        return null;
    }
}

interface VersionedEdits {
    editVersion: number;
    changes: vscode.TextDocumentContentChangeEvent[];
}

export class ColorizationState {
    private client: Client;
    private colorizationSettings: ColorizationSettings;

    private decorations: vscode.TextEditorDecorationType[] = new Array<vscode.TextEditorDecorationType>(TokenKind.Count);
    private syntacticRanges: vscode.Range[][] = new Array<vscode.Range[]>(TokenKind.Count);
    private semanticRanges: vscode.Range[][] = new Array<vscode.Range[]>(TokenKind.Count);

    private inactiveDecoration: vscode.TextEditorDecorationType = null;
    private inactiveRanges: vscode.Range[] = [];

    private versionedEdits: VersionedEdits[] = [];
    private lastSyntacticVersion: number = 0;
    private lastSemanticVersion: number = 0;

    public constructor(client: Client, colorizationSettings: ColorizationSettings) {
        this.client = client;
        this.colorizationSettings = colorizationSettings;
    }

    private createColorizationDecorations(isCpp: boolean): void {
        let settings: CppSettings = new CppSettings(this.client.RootUri);
        if (settings.enhancedColorization) {
            //  Create new decorators
            for (let i: number = 0; i < TokenKind.Count; i++) {
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
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
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
        let settings: CppSettings = new CppSettings(this.client.RootUri);
        if (settings.enhancedColorization) {
            for (let i: number = 0; i < TokenKind.Count; i++) {
                if (this.decorations[i]) {

                    let range: vscode.Range[] = this.syntacticRanges[i];
                    if (this.semanticRanges[i]) {
                        if (!range || !range.length) {
                            range = this.semanticRanges[i];
                        } else {
                            range = range.concat(this.semanticRanges[i]);
                        }
                    }
                    if (range && range.length > 0) {
                        e.setDecorations(this.decorations[i], range);
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
        this.disposeColorizationDecorations();
        let isCpp: boolean = util.isEditorFileCpp(uri.toString());
        this.createColorizationDecorations(isCpp);
        let editors: vscode.TextEditor[] = vscode.window.visibleTextEditors.filter(e => e.document.uri === uri);
        for (let e of editors) {
            this.refreshColorizationRanges(e);
        }
    }

    private shiftRangeRemoved(originalRange: vscode.Range, removedRange: vscode.Range): vscode.Range {
        if (removedRange.start.isBeforeOrEqual(originalRange.start)) {
            let lineDelta: number = removedRange.start.line - removedRange.end.line;
            let startCharacterDelta: number = 0;
            let endCharacterDelta: number = 0;
            if (originalRange.start.line === removedRange.end.line) {
                startCharacterDelta = removedRange.start.character - removedRange.end.character;
                if (originalRange.end.line === removedRange.end.line) {
                    endCharacterDelta = startCharacterDelta;
                }
            }

            let newStart: vscode.Position = originalRange.start.translate(lineDelta, startCharacterDelta);
            let newEnd: vscode.Position = originalRange.end.translate(lineDelta, endCharacterDelta);
            return new vscode.Range(newStart, newEnd);
        }
        return originalRange;
    }

    private shiftRangeAdded(originalRange: vscode.Range, insertRange: vscode.Range): vscode.Range {
        if (insertRange.start.isBeforeOrEqual(originalRange.start)) {
            let addedLines: number = insertRange.end.line - insertRange.start.line;
            let newStartLine: number = originalRange.start.line + addedLines;
            let newEndLine: number = originalRange.end.line + addedLines;
            let newStartCharacter: number = originalRange.start.character;
            let newEndCharacter: number = originalRange.end.character;
            if (insertRange.end.line === newStartLine) {
                // If starts on the same line as replacement ended
                newStartCharacter += insertRange.end.character;
                if (insertRange.end.line === newEndLine) {
                    newEndCharacter += insertRange.end.character;
                }
            }
            return new vscode.Range(newStartLine, newStartCharacter, newEndLine, newEndCharacter);
        }
        return originalRange;
    }

    private textToRange(text: string, startPosition: vscode.Position): vscode.Range {
        // Need to parse text into a range.  (TODO: Test if tab is a single character, etc.)
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

    private fixRange(originalRange: vscode.Range, removeRange: vscode.Range, insertRange: vscode.Range): vscode.Range[] {
        let ranges: vscode.Range[] = [];
        let newRange: vscode.Range;
        if (removeRange.start.isEqual(removeRange.end)) {
            // Not replacing anything, but we still split originalRange, to handle something inserted in the middle of it
            if (removeRange.start.isAfter(originalRange.start) && removeRange.start.isBefore(originalRange.end)) {
                newRange = new vscode.Range(originalRange.start, removeRange.start);
                ranges.push(newRange);
                newRange = new vscode.Range(removeRange.start, originalRange.end);
                ranges.push(newRange);
            } else {
                ranges.push(originalRange);
            }
        } else {
            let intersect: vscode.Range = originalRange.intersection(removeRange);
            if (intersect && intersect.isEmpty === false) {
                // TODO: instead of not coloring new text, add to existing range if no spaces/delimiters, etc.
                if (!originalRange.start.isEqual(intersect.start)) {
                    // Replacement starts within the existing range.  No need to adjust the first part.
                    newRange = new vscode.Range(originalRange.start, intersect.start);
                    ranges.push(newRange);
                }
                if (!originalRange.end.isEqual(intersect.end)) {
                    newRange = new vscode.Range(intersect.end, originalRange.end);
                    newRange = this.shiftRangeRemoved(originalRange, removeRange);
                    ranges.push(newRange);
                }
            } else {
                // No intersection
                // If replaced range was before this one, we need to shift this one
                newRange = this.shiftRangeRemoved(originalRange, removeRange);
                ranges.push(newRange);
            }
        }

        if (!insertRange.isEmpty) {
            for (let i: number = 0; i < ranges.length; i++) {
                ranges[i] = this.shiftRangeAdded(ranges[i], insertRange);
            }
        }

        return ranges;
    }

    private fixRanges1(originalRanges: vscode.Range[], changes: vscode.TextDocumentContentChangeEvent[]): vscode.Range[] {
        // outer loop needs to be the versioned edits, then changes within that edit, then ranges
        let ranges: vscode.Range[] = originalRanges;
        if (ranges && ranges.length > 0) {
            changes.forEach((change) => {
                let newRanges: vscode.Range[] = [];
                let insertRange: vscode.Range = this.textToRange(change.text, change.range.start);
                for (let i: number = 0; i < ranges.length; i++) {
                    newRanges.push(...this.fixRange(ranges[i], change.range, insertRange));
                }
                ranges = newRanges;
                newRanges = [];
            });
        }

        return ranges;
    }

    public fixColorizationState(changes: vscode.TextDocumentContentChangeEvent[], editVersion: number): void {
        for (let i: number = 0; i < this.syntacticRanges.length; i++) {
            this.syntacticRanges[i] = this.fixRanges1(this.syntacticRanges[i], changes);
        }
        for (let i: number = 0; i < this.semanticRanges.length; i++) {
            this.semanticRanges[i] = this.fixRanges1(this.semanticRanges[i], changes);
        }
        this.inactiveRanges = this.fixRanges1(this.inactiveRanges, changes);
        let edits: VersionedEdits = {
            editVersion: editVersion,
            changes: changes
        };
        this.versionedEdits.push(edits);
    }

    private purgeOldVersionedEdits(): void {
        let lowerVersion: number = this.lastSemanticVersion;
        if (lowerVersion > this.lastSyntacticVersion) {
            lowerVersion = this.lastSyntacticVersion;
        }
        let index: number = this.versionedEdits.findIndex((edit) => edit.editVersion > lowerVersion);
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

        // Create decorations
        let inactiveRegionDecoration: vscode.TextEditorDecorationType;

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
                    syntacticRanges[i] = this.fixRanges1(syntacticRanges[i], edit.changes);
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
                    semanticRanges[i] = this.fixRanges1(semanticRanges[i], edit.changes);
                }
                inactiveRanges = this.fixRanges1(inactiveRanges, edit.changes);
            }
        });

        this.updateColorizationRanges(uri, null, semanticRanges, inactiveRanges);
        this.lastSemanticVersion = editVersion;
        this.purgeOldVersionedEdits();
    }
}
