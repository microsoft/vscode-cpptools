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

    constructor(readonly isCandidates: boolean) {
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
            return;
        }

        switch (element.node) {
            case NodeType.referenceType:
                const label: string = getReferenceTagString(element.referenceType, this.referencesModel.isCanceled, true);
                let result: vscode.TreeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
                if (this.referencesModel.isRename) {
                    result.contextValue = "candidateReferenceType";
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
                    resultFile.command = {
                        title: localize("goto.reference", "Go to reference"),
                        command: 'C_Cpp.ShowReferenceItem',
                        arguments: [element]
                    };
                    let tag: string = getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referencesModel.isCanceled);
                    resultFile.tooltip = `[${tag}]\n${element.filename}`;
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
    }

    getChildren(element?: TreeNode | undefined): TreeNode[] {
        if (!this.referencesModel) {
            return;
        }

        if (element instanceof TreeNode) {
            // Replacement for ReferenceFileItem
            if (element.node === NodeType.file) {
                let type: ReferenceType = (this.referencesModel.isRename && !this.isCandidates) ? undefined : element.referenceType;
                return this.referencesModel.getReferenceNodes(element.filename, type, this.isCandidates);
            }
            // Replacement for ReferenceTypeItem
            if (element.node === NodeType.referenceType) {
                return this.referencesModel.getFileNodes(element.referenceType, this.isCandidates);
            }
        }

        if (this.referencesModel.isRename) {
            if (this.isCandidates) {
                if (this.referencesModel.groupByFile) {
                    return this.referencesModel.getRenameCandidateFiles();
                } else {
                    return this.referencesModel.getRenameCandidateReferenceTypes();
                }
            } else {
                return this.referencesModel.getRenamePendingFiles();
            }
        } else {
            // Return root for tree view
            if (this.referencesModel.groupByFile) {
                return this.referencesModel.getFileNodes(undefined, false);
            } else {
                return this.referencesModel.getReferenceTypeNodes();
            }
        }
    }
}
