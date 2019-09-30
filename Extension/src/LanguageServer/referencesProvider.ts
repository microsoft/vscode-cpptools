/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import * as util from '../common';
import { Model, FileItem, ReferenceItem, ReferenceTypeItem, TreeNode, NodeType } from './referencesModel';
import { ReferencesResult, ReferenceType, getReferenceTagString } from './references';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export function getReferenceTypeIconPath(referenceType: ReferenceType): { light: string; dark: string } {
    const assetsFolder: string = "assets/";
    const postFixLight: string = "-light.svg";
    const postFixDark: string = "-dark.svg";
    let basePath: string = "ref-cannot-confirm";

    switch (referenceType) {
        case ReferenceType.Confirmed: basePath = "ref-confirmed"; break;
        case ReferenceType.Comment: basePath = "ref-comment"; break;
        case ReferenceType.String: basePath = "ref-string"; break;
        case ReferenceType.Inactive: basePath = "ref-inactive"; break;
        case ReferenceType.CannotConfirm: basePath = "ref-cannot-confirm"; break;
        case ReferenceType.NotAReference: basePath = "ref-not-a-reference"; break;
        case ReferenceType.ConfirmationInProgress: basePath = "ref-confirmation-in-progress"; break;
    }

    let lightPath: string = util.getExtensionFilePath(assetsFolder + basePath + postFixLight);
    let darkPath: string = util.getExtensionFilePath(assetsFolder + basePath + postFixDark);
    return {
        light: lightPath,
        dark: darkPath
    };
}

function getReferenceCanceledIconPath(): { light: string; dark: string } {
    return {
        light: util.getExtensionFilePath("assets/ref-canceled-light.svg"),
        dark: util.getExtensionFilePath("assets/ref-canceled-dark.svg")
    };
}

function getReferenceItemIconPath(type: ReferenceType, isCanceled: boolean): { light: string; dark: string } {
    return isCanceled ? getReferenceCanceledIconPath() : getReferenceTypeIconPath(type);
}

type TreeObject = FileItem | ReferenceItem | ReferenceTypeItem | TreeNode;

export class ReferenceDataProvider implements vscode.TreeDataProvider<TreeObject> {
    private references: Model;
    private referencesCanceled: boolean = false;
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeObject>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private groupByFile: boolean = true;

    constructor() {
        vscode.commands.executeCommand('setContext', 'refView.isGroupedByFile', true);
    }

    toggleGroupView(): void {
        this.groupByFile = !this.groupByFile;
        vscode.commands.executeCommand('setContext', 'refView.isGroupedByFile', this.groupByFile);
        this._onDidChangeTreeData.fire();
    }

    setModel(results: ReferencesResult, isCanceled: boolean): void {
        this.referencesCanceled = isCanceled;
        this.references = new Model(results);
        this._onDidChangeTreeData.fire();
    }

    isCanceled(): boolean {
        return this.referencesCanceled;
    }

    clear(): void {
        this.references = undefined;
        this._onDidChangeTreeData.fire();
    }

    hasResults(): boolean {
        return this.references &&
            (this.references.ReferenceItems.length > 0 || this.references.FileItems.length > 0);
    }

    getReferenceItems(): ReferenceItem[] {
        return this.references.ReferenceItems as ReferenceItem[];
    }

    getFilesWithPendingReferences(): FileItem[] {
        return this.references.FileItems.filter(i => i.ReferenceItemsPending) as FileItem[];
    }

    getTreeItem(element: TreeObject): vscode.TreeItem {
        if (!this.references) {
            return;
        }

        if (element instanceof ReferenceItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.text);
            result.collapsibleState = vscode.TreeItemCollapsibleState.None;
            result.iconPath = getReferenceItemIconPath(element.type, this.referencesCanceled);
            let tag: string = getReferenceTagString(element.type, this.referencesCanceled);
            result.tooltip = `[${tag}]\n${element.text}`;

            result.command = {
                title: localize("goto.reference", "Go to reference"),
                command: 'C_Cpp.ShowReferenceItem',
                arguments: [element]
            };

            return result;
        }

        if (element instanceof FileItem) {
            const result: vscode.TreeItem = new vscode.TreeItem(element.uri);
            result.collapsibleState = element.ReferenceItemsPending ?
                vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded;
            result.iconPath = vscode.ThemeIcon.File;
            result.description = true;

            if (element.ReferenceItemsPending) {
                result.command = {
                    title: localize("goto.reference", "Go to reference"),
                    command: 'C_Cpp.ShowReferenceItem',
                    arguments: [element]
                };
                let tag: string = getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referencesCanceled);
                result.tooltip = `[${tag}]\n${element.name}`;
            }

            return result;
        }

        if (element instanceof ReferenceTypeItem) {
            const label: string = getReferenceTagString(element.type, this.referencesCanceled, true);
            const result: vscode.TreeItem = new vscode.TreeItem(label);
            result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            return result;
        }

        if (element instanceof TreeNode) {
            switch (element.node) {
                case NodeType.referenceType:
                    const label: string = getReferenceTagString(element.referenceType, this.referencesCanceled, true);
                    let result: vscode.TreeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
                    return result;

                case NodeType.file:
                case NodeType.fileWithPendingRef:
                    let resultFile: vscode.TreeItem = new vscode.TreeItem(element.fileUri, vscode.TreeItemCollapsibleState.Expanded);
                    resultFile.iconPath = vscode.ThemeIcon.File;
                    resultFile.description = true;

                    if (element.node === NodeType.fileWithPendingRef) {
                        result.command = {
                            title: localize("goto.reference", "Go to reference"),
                            command: 'C_Cpp.ShowReferenceItem',
                            arguments: [element]
                        };
                        let tag: string = getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referencesCanceled);
                        result.tooltip = `[${tag}]\n${element.filename}`;
                    }

                    return resultFile;

                case NodeType.reference:
                    let resultRef: vscode.TreeItem = new vscode.TreeItem(element.referenceText, vscode.TreeItemCollapsibleState.None);
                    resultRef.iconPath = getReferenceItemIconPath(element.referenceType, this.referencesCanceled);
                    let tag: string = getReferenceTagString(element.referenceType, this.referencesCanceled);
                    resultRef.tooltip = `[${tag}]\n${element.referenceText}`;

                    resultRef.command = {
                        title: localize("goto.reference", "Go to reference"),
                        command: 'C_Cpp.ShowReferenceItem',
                        arguments: [element]
                    };

                    return resultRef;
            }
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

        if (element instanceof TreeNode) {
            // Replacement for FileItem
            if (element.node === NodeType.file) {
                return this.references.getReferenceNodes(element.filename, element.referenceType);
            }
            // Replacement for ReferenceTypeItem
            if (element.node === NodeType.referenceType) {
                return this.references.getFileNodes(element.referenceType);
            }
        }

        // Return root for tree view
        if (this.groupByFile) {
            return this.references.getFileNodes(undefined);
            // return this.references.FileItems;
        } else {
            return this.references.getReferenceTypeNodes();
            // TODO: handle references are canceled.
            // TODO: handle preview references.
            // return this.referencesCanceled ? this.references.getReferenceCanceledGroup2() : this.references.getReferenceTypeNodes();
            // return this.referencesCanceled ? this.references.getReferenceCanceledGroup() : this.references.ReferenceTypeItems;
        }
    }
}
