/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import * as util from '../common';
import { Model, FileItem, ReferenceItem, ReferenceTypeItem } from './referencesModel';
import { ReferenceInfo, ReferenceType, convertReferenceTypeToString } from './references';

function getReferenceTypeIconPath(referenceType: ReferenceType): vscode.ThemeIcon {
    // TODO: return icon path for light and dark themes based on reference type
    switch (referenceType) {
        case ReferenceType.Confirmed:
        case ReferenceType.Comment: return util.getExtensionFilePath("assets/comment.svg");
        case ReferenceType.String: return util.getExtensionFilePath("assets/string.svg");
        case ReferenceType.Inactive: return util.getExtensionFilePath("assets/cannotconfirm.svg");
        case ReferenceType.CannotConfirm: return util.getExtensionFilePath("assets/cannotconfirm.svg");
        case ReferenceType.NotAReference: return util.getExtensionFilePath("assets/not-a-reference.svg");
    }
    return util.getExtensionFilePath("assets/cannotconfirm.svg");
}

type TreeObject = FileItem | ReferenceItem | ReferenceTypeItem;

export class ReferenceDataProvider implements vscode.TreeDataProvider<TreeObject> {
    private references: Model;
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeObject>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor() {
    }

    setModel(results: ReferenceInfo[]): void {
        this.references = new Model(results);
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.references = undefined;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeObject): vscode.TreeItem {
        if (!this.references) {
            return;
        }

        if (element instanceof ReferenceItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.text);
            result.collapsibleState = vscode.TreeItemCollapsibleState.None;
            result.iconPath = getReferenceTypeIconPath(element.type);
            result.command = {
                title: 'Open Reference',
                command: 'C_Cpp.ShowReferencesItem',
                arguments: [element]
            };
            return result;
        }

        if (element instanceof FileItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.uri);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            result.iconPath = vscode.ThemeIcon.File;
            result.description = true;
            return result;
        }

        if (element instanceof ReferenceTypeItem) {
            const label: string = convertReferenceTypeToString(element.type, false, false);
            const result: vscode.TreeItem = new vscode.TreeItem(label);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            result.iconPath = getReferenceTypeIconPath(element.type);
            return result;
        }
    }

    getChildren(element?: TreeObject | undefined): TreeObject[] {
        if (!this.references) {
            return;
        }

        if (element instanceof FileItem) {
            return element.getReferences();
        }

        if (element instanceof ReferenceTypeItem) {
            return element.getFiles();
        }

        return this.references.items;
    }
}

// TODO: add provider for rename
// export class RenameDataProvider implements vscode.TreeDataProvider<T> {
// }
