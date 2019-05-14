/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { OtherSettings, TextMateRule, TextMateRuleSettings } from './settings';
import * as fs from 'fs';
import { loadavg } from 'os';

export enum TokenKind {
    // These need to match sematic_token_kind in edge_hlapi.h
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

    Last
}

export class ThemeStyle {
    foreground: string;
    background: string;
    fontStyle: string;
}

export class ColorizationSettings {

    constructor(uri: vscode.Uri)
    {
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
                        let themeContent: any = JSON.parse(fs.readFileSync(themeFullPath).toString());
                        let textMateRules: TextMateRule[];
                        if (themeContent) {
                            textMateRules = themeContent.tokenColors;
                        }

                        // override default if there are setting for an undefined scope in the current theme.
                        this.findThemeStyleForScope(defaultStyle, null, undefined, textMateRules);

                        this.themeStyleCMap = new Array<ThemeStyle>(TokenKind.Last);
                        this.themeStyleCppMap = new Array<ThemeStyle>(TokenKind.Last);
                        
                        // Populate with unique objects, as they will be individual modified in place
                        for (let i: number = 0; i < TokenKind.Last; i++) {
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
                        this.calculateThemeStyleForVsToken(TokenKind.OperatorToken, "entity.name.operator", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.RefType, "entity.name.type.class.reference", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.ValueType, "entity.name.type.class.value", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.MemberFunction, "entity.name.function.member", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.StaticMemberFunction, "entity.name.function.member.static", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.ClassTemplate, "entity.name.type.class.template", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.FunctionTemplate, "entity.name.function.template", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.XmlDocComment, "comment.xml.doc", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.XmlDocTag, "comment.xml.doc.tag", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.PreprocessorKeyword, "keyword.control.directive", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.Macro, "entity.name.function.preprocessor", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.GlobalVariable, "variable.other.global", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.LocalVariable, "variable.other.local", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.Parameter, "variable.parameter", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.MemberField, "variable.other.member", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.StaticMemberField, "variable.other.member.static", themeName, textMateRules);
                        this.calculateThemeStyleForVsToken(TokenKind.Namespace, "entity.name.type.namespace", themeName, textMateRules);
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
                    options.fontStyle = themeStyle.fontStyle;
                }
                return vscode.window.createTextEditorDecorationType(options);
            }
        }

        return null;
    }
}
