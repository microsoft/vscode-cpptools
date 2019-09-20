/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { RenameModel, RenamePendingFileItem, RenamePendingFilesGroupItem, RenamePendingItem,
    RenameCandidateFileItem, RenameCandidateReferenceTypeGroupItem, RenameCandidateReferenceTypeItem,
    RenameCandidateItem } from './renameModel';
import { getReferenceTypeIconPath } from './referencesProvider';
import { convertReferenceTypeToString } from './references';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

type TreeObject = RenamePendingFileItem | RenamePendingItem | RenameCandidateFileItem | RenameCandidateItem | RenameCandidateReferenceTypeGroupItem | RenameCandidateReferenceTypeItem;

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

        if (element instanceof RenamePendingItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.text);
            result.collapsibleState = vscode.TreeItemCollapsibleState.None;
            result.iconPath = getReferenceTypeIconPath(element.type);
            let tag: string = convertReferenceTypeToString(element.type);
            result.tooltip = `[${tag}]\n${element.text}`;
            result.command = {
                title: localize("goto.reference", "Go to reference"),
                command: 'C_Cpp.ShowReferenceItem',
                arguments: [element]
            };
            result.contextValue = "pendingItem";
            return result;
        }

        if (element instanceof RenamePendingFileItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.uri);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            result.iconPath = vscode.ThemeIcon.File;
            result.description = true;
            result.contextValue = "pendingFile";
            return result;
        }

        if (element instanceof RenamePendingFilesGroupItem) {
            let label: string = localize("pending.rename", "Pending Rename");
            const result: vscode.TreeItem = new vscode.TreeItem(label);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            result.contextValue = "pendingGroup";
            return result;
        }

        if (element instanceof RenameCandidateItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.text);
            result.collapsibleState = vscode.TreeItemCollapsibleState.None;
            result.iconPath = getReferenceTypeIconPath(element.type);
            let tag: string = convertReferenceTypeToString(element.type);
            result.tooltip = `[${tag}]\n${element.text}`;
            result.command = {
                title: localize("goto.reference", "Go to reference"),
                command: 'C_Cpp.ShowReferenceItem',
                arguments: [element]
            };
            result.contextValue = "candidateItem";
            return result;
        }

        if (element instanceof RenameCandidateFileItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.uri);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            result.iconPath = vscode.ThemeIcon.File;
            result.description = true;
            result.contextValue = "candidateFile";
            return result;
        }

        if (element instanceof RenameCandidateReferenceTypeGroupItem) {
            let label: string = localize("candidates.for.rename", "Candidates for Rename");
            const result: vscode.TreeItem = new vscode.TreeItem(label);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            result.contextValue = "candidateGroup";
            return result;
        }

        if (element instanceof RenameCandidateReferenceTypeItem) {
            let label: string = convertReferenceTypeToString(element.type, true);
            const result: vscode.TreeItem = new vscode.TreeItem(label);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            result.contextValue = "candidateReferenceType";
            return result;
        }
    }

    getChildren(element?: TreeObject | undefined): TreeObject[] {
        if (!this.references) {
            return;
        }
        if (element instanceof RenamePendingFileItem) {
            return element.getReferences();
        }

        if (element instanceof RenamePendingFilesGroupItem) {
            return element.getFiles();
        }

        if (element instanceof RenameCandidateFileItem) {
            return element.getReferences();
        }

        if (element instanceof RenameCandidateReferenceTypeGroupItem) {
            return element.getReferenceTypes();
        }

        if (element instanceof RenameCandidateReferenceTypeItem) {
            return element.getFiles();
        }

        if (this.pending) {
            return this.references.getPendingGroup().getFiles();
        }

        return this.references.getCandidatesGroup().getReferenceTypes();
    }
}
