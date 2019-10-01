/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import * as util from '../common';
import { ReferencesModel, TreeNode, NodeType } from './referencesModel';
import { ReferenceType, getReferenceTagString } from './references';
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
    return (isCanceled && type === ReferenceType.ConfirmationInProgress) ? getReferenceCanceledIconPath() : getReferenceTypeIconPath(type);
}

export class ReferenceDataProvider implements vscode.TreeDataProvider<TreeNode> {
    private referencesModel: ReferencesModel;
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private groupByFile: boolean = true;

    constructor(readonly isCandidates: boolean) {
        vscode.commands.executeCommand('setContext', 'refView.isGroupedByFile', true);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    toggleGroupView(): void {
        this.groupByFile = !this.groupByFile;
        vscode.commands.executeCommand('setContext', 'refView.isGroupedByFile', this.groupByFile);
        this._onDidChangeTreeData.fire();
    }

    setModel(model: ReferencesModel): void {
        this.referencesModel = model;
        this._onDidChangeTreeData.fire();
    }

    // isCanceled(): boolean {
    //     return this.referencesCanceled;
    // }

    clear(): void {
        this.referencesModel = undefined;
        this._onDidChangeTreeData.fire();
    }

    // hasResults(): boolean {
    //     return this.referencesModel &&
    //         (this.referencesModel.ReferenceItems.length > 0 || this.referencesModel.FileItems.length > 0);
    // }

    // getReferenceItems(): ReferenceItem[] {
    //     return this.referencesModel.ReferenceItems as ReferenceItem[];
    // }

    // getFilesWithPendingReferences(): ReferenceFileItem[] {
    //     return this.referencesModel.FileItems.filter(i => i.ReferenceItemsPending) as ReferenceFileItem[];
    // }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        if (!this.referencesModel) {
            return;
        }

        // if (element instanceof ReferenceItem) {
        //     const result: vscode.TreeItem = new vscode.TreeItem(element.text);
        //     result.collapsibleState = vscode.TreeItemCollapsibleState.None;
        //     result.iconPath = getReferenceItemIconPath(element.type, this.referencesModel.isCanceled);
        //     let tag: string = getReferenceTagString(element.type, this.referencesModel.isCanceled);
        //     result.tooltip = `[${tag}]\n${element.text}`;

        //     result.command = {
        //         title: localize("goto.reference", "Go to reference"),
        //         command: 'C_Cpp.ShowReferenceItem',
        //         arguments: [element]
        //     };

        //     return result;
        // }

        // if (element instanceof ReferenceFileItem) {
        //     const result: vscode.TreeItem = new vscode.TreeItem(element.uri);
        //     result.collapsibleState = element.ReferenceItemsPending ?
        //         vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded;
        //     result.iconPath = vscode.ThemeIcon.File;
        //     result.description = true;

        //     if (element.ReferenceItemsPending) {
        //         result.command = {
        //             title: localize("goto.reference", "Go to reference"),
        //             command: 'C_Cpp.ShowReferenceItem',
        //             arguments: [element]
        //         };
        //         let tag: string = getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referencesModel.isCanceled);
        //         result.tooltip = `[${tag}]\n${element.name}`;
        //     }

        //     return result;
        // }

        // if (element instanceof ReferenceTypeItem) {
        //     const label: string = getReferenceTagString(element.type, this.referencesModel.isCanceled, true);
        //     const result: vscode.TreeItem = new vscode.TreeItem(label);
        //     result.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        //     return result;
        // }

        //if (element instanceof TreeNode) {
            switch (element.node) {
                case NodeType.referenceType:
                    const label: string = getReferenceTagString(element.referenceType, this.referencesModel.isCanceled, true);
                    let result: vscode.TreeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
                    if (this.referencesModel.isRename) {
                        result.contextValue = this.isCandidates ? "candidateGroup" : "pendingGroup";
                    }
                    return result;

                case NodeType.file:
                case NodeType.fileWithPendingRef:
                    let resultFile: vscode.TreeItem = new vscode.TreeItem(element.fileUri, vscode.TreeItemCollapsibleState.Expanded);
                    resultFile.iconPath = vscode.ThemeIcon.File;
                    resultFile.description = true;
                    if (this.referencesModel.isRename) {
                        resultFile.contextValue = this.isCandidates ? "candidateFile" : "pendingFile";
                    }

                    if (element.node === NodeType.fileWithPendingRef) {
                        result.command = {
                            title: localize("goto.reference", "Go to reference"),
                            command: 'C_Cpp.ShowReferenceItem',
                            arguments: [element]
                        };
                        let tag: string = getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referencesModel.isCanceled);
                        result.tooltip = `[${tag}]\n${element.filename}`;
                    }

                    return resultFile;

                case NodeType.reference:
                    let resultRef: vscode.TreeItem = new vscode.TreeItem(element.referenceText, vscode.TreeItemCollapsibleState.None);
                    resultRef.iconPath = getReferenceItemIconPath(element.referenceType, this.referencesModel.isCanceled);
                    let tag: string = getReferenceTagString(element.referenceType, this.referencesModel.isCanceled);
                    resultRef.tooltip = `[${tag}]\n${element.referenceText}`;
                    if (this.referencesModel.isRename) {
                        resultRef.contextValue = this.isCandidates ? "candidateItem" : "pendingItem";
                    }

                    resultRef.command = {
                        title: localize("goto.reference", "Go to reference"),
                        command: 'C_Cpp.ShowReferenceItem',
                        arguments: [element]
                    };

                    return resultRef;
            }
        //}
    }

    getChildren(element?: TreeNode | undefined): TreeNode[] {
        if (!this.referencesModel) {
            return;
        }

        // if (element instanceof ReferenceFileItem) {
        //     return element.getReferences();
        // }

        // if (element instanceof ReferenceTypeItem) {
        //     return element.getFiles();
        // }

        //if (element instanceof TreeNode) {
        if (element instanceof TreeNode) {
            // Replacement for ReferenceFileItem
            if (element.node === NodeType.file) {
                return this.referencesModel.getReferenceNodes(element.filename, element.referenceType, this.isCandidates);
            }
            // Replacement for ReferenceTypeItem
            if (element.node === NodeType.referenceType) {
                return this.referencesModel.getFileNodes(element.referenceType, this.isCandidates);
            }

            // Should not get here
        }

        // element should be null

        if (this.referencesModel.isRename) {
            if (this.isCandidates) {
                if (this.groupByFile) {
                    this.referencesModel.getRenameCandidateReferenceTypes();
                } else {
                    this.referencesModel.getRenameCandidateFiles();
                }
            } else {
                this.referencesModel.getRenamePendingFiles();
            }
        } else {
            // Return root for tree view
            if (this.groupByFile) {
                return this.referencesModel.getFileNodes(undefined, false);
                // return this.referencesModel.FileItems;
            } else {
                return this.referencesModel.getReferenceTypeNodes();
                // TODO: handle references are canceled.
                // TODO: handle preview references.
                // return this.referencesCanceled ? this.referencesModel.getReferenceCanceledGroup2() : this.referencesModel.getReferenceTypeNodes();
                // return this.referencesCanceled ? this.referencesModel.getReferenceCanceledGroup() : this.referencesModel.ReferenceTypeItems;
            }
        }
    }
}
