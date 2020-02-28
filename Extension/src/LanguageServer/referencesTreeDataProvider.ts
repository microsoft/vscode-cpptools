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

export class ReferencesTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
    private referencesModel: ReferencesModel | undefined;
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode>();
    readonly onDidChangeTreeData;

    constructor(readonly isRenameCandidates: boolean) {
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh(): void {
        if (this.referencesModel) {
            vscode.commands.executeCommand('setContext', 'refView.isGroupedByFile', this.referencesModel.groupByFile);
            this._onDidChangeTreeData.fire();
        }
    }

    setModel(model: ReferencesModel): void {
        this.referencesModel = model;
        vscode.commands.executeCommand('setContext', 'refView.isGroupedByFile', this.referencesModel.groupByFile);
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.referencesModel = undefined;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        if (!this.referencesModel) {
            throw new Error("Null or undefined RefrencesModel in getTreeItem()");
        }

        switch (element.node) {
            case NodeType.referenceType:
                if (!element.referenceType) {
                    throw new Error("Null or undefined referenceType in getTreeItem()");
                }
                const label: string = getReferenceTagString(element.referenceType, this.referencesModel.isCanceled, true);
                let resultRefType: vscode.TreeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
                if (this.referencesModel.isRename) {
                    resultRefType.contextValue = "candidateReferenceType";
                }
                return resultRefType;

            case NodeType.file:
            case NodeType.fileWithPendingRef:
                if (!element.fileUri) {
                    throw new Error("Null or undefined fileUri in getTreeItem()");
                }
                let resultFile: vscode.TreeItem = new vscode.TreeItem(element.fileUri);
                resultFile.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                resultFile.iconPath = vscode.ThemeIcon.File;
                resultFile.description = true;
                if (this.referencesModel.isRename) {
                    resultFile.contextValue = this.isRenameCandidates ? "candidateFile" : "pendingFile";
                }

                if (element.node === NodeType.fileWithPendingRef) {
                    resultFile.command = {
                        title: localize("goto.reference", "Go to reference"),
                        command: 'C_Cpp.ShowReferenceItem',
                        arguments: [element]
                    };
                    let tag: string = getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referencesModel.isCanceled);
                    resultFile.tooltip = `[${tag}]\n${element.filename}`;
                    resultFile.collapsibleState = vscode.TreeItemCollapsibleState.None;
                }

                return resultFile;

            case NodeType.reference:
                if (!element.referenceText) {
                    throw new Error("Null or undefined referenceText in getTreeItem()");
                }
                if (!element.referenceType) {
                    throw new Error("Null or undefined referenceType in getTreeItem()");
                }
                let resultRef: vscode.TreeItem = new vscode.TreeItem(element.referenceText, vscode.TreeItemCollapsibleState.None);
                resultRef.iconPath = getReferenceItemIconPath(element.referenceType, this.referencesModel.isCanceled);
                let tag: string = getReferenceTagString(element.referenceType, this.referencesModel.isCanceled);
                resultRef.tooltip = `[${tag}]\n${element.referenceText}`;
                if (this.referencesModel.isRename) {
                    resultRef.contextValue = this.isRenameCandidates ? "candidateItem" : "pendingItem";
                }

                resultRef.command = {
                    title: localize("goto.reference", "Go to reference"),
                    command: 'C_Cpp.ShowReferenceItem',
                    arguments: [element]
                };

                return resultRef;
        }
        throw new Error("Invalid NoteType in getTreeItem()");
    }

    getChildren(element?: TreeNode | undefined): TreeNode[] | undefined {
        if (!this.referencesModel) {
            return undefined;
        }

        if (element instanceof TreeNode) {
            if (element.node === NodeType.file) {
                let type: ReferenceType | undefined;

                // If this.referencesModel.groupByFile is false, or if not a rename pending view, group by reference
                if (!this.referencesModel.groupByFile && (!this.referencesModel.isRename || this.isRenameCandidates)) {
                    type = element.referenceType;
                }

                return this.referencesModel.getReferenceNodes(element.filename, type, this.isRenameCandidates);
            }
            if (element.node === NodeType.referenceType) {
                return this.referencesModel.getFileNodes(element.referenceType, this.isRenameCandidates);
            }
        }

        if (this.referencesModel.isRename) {
            if (this.isRenameCandidates) {
                if (this.referencesModel.groupByFile) {
                    return this.referencesModel.getRenameCandidateFiles();
                } else {
                    return this.referencesModel.getRenameCandidateReferenceTypes();
                }
            } else {
                return this.referencesModel.getRenamePendingFiles();
            }
        } else {
            if (this.referencesModel.groupByFile) {
                return this.referencesModel.getFileNodes(undefined, false);
            } else {
                return this.referencesModel.getReferenceTypeNodes();
            }
        }
    }
}
