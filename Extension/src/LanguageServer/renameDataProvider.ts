/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import * as util from '../common';
import { RenameModel, RenameFileItem, RenameItem, RenameGroupItem } from './renameModel';
import { ReferenceType } from './references';

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

type TreeObject = RenameFileItem | RenameItem | RenameGroupItem;

export class RenameDataProvider implements vscode.TreeDataProvider<TreeObject> {
    private references: RenameModel;
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeObject>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(readonly pending: boolean) {
    }

    setModel(renameModel: RenameModel): void {
        this.references = renameModel;
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.references = undefined;
        this._onDidChangeTreeData.fire();
    }

    update(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeObject): vscode.TreeItem {
        if (!this.references) {
            return;
        }

        if (element instanceof RenameItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.text);
            result.collapsibleState = vscode.TreeItemCollapsibleState.None;
            result.iconPath = getReferenceTypeIconPath(element.type);
            result.command = {
                title: 'Open Reference',
                command: 'C_Cpp.ShowRenameItem',
                arguments: [element]
            };
            if (element.getIsPending()) {
                result.contextValue = "pendingItem";
            } else {
                result.contextValue = "candidateItem";
            }
            return result;
        }

        if (element instanceof RenameFileItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.uri);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            result.iconPath = vscode.ThemeIcon.File;
            result.description = true;
            if (element.pending) {
                result.contextValue = "pendingFile";
            } else {
                result.contextValue = "candidateFile";
            }
            return result;
        }

        if (element instanceof RenameGroupItem) {
            let label: string;
            if (element.pending) {
                label = "Pending Rename";
            } else {
                label = "Candidates for Rename";
            }
            const result: vscode.TreeItem = new vscode.TreeItem(label);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            result.iconPath = null; // TBD
            if (element.pending) {
                result.contextValue = "pendingGroup";
            } else {
                result.contextValue = "candidateGroup";
            }
            return result;
        }
    }

    getChildren(element?: TreeObject | undefined): TreeObject[] {
        if (!this.references) {
            return;
        }

        if (element instanceof RenameFileItem) {
            return element.getReferences();
        }

        if (element instanceof RenameGroupItem) {
            return element.getFiles();
        }

        return this.references.getGroup(this.pending).getFiles();
    }
}
