/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferencesModel, TreeNode, NodeType } from './referencesModel';
import { ReferenceType, getReferenceTagString, getReferenceItemIconPath } from './references';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class ReferencesTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
    private referencesModel: ReferencesModel | undefined;
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode>;

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
        if (this.referencesModel === undefined) {
            throw new Error("Undefined RefrencesModel in getTreeItem()");
        }

        switch (element.node) {
            case NodeType.referenceType:
                if (element.referenceType === undefined) {
                    throw new Error("Undefined referenceType in getTreeItem()");
                }
                const label: string = getReferenceTagString(element.referenceType, this.referencesModel.isCanceled, true);
                let resultRefType: vscode.TreeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
                if (this.referencesModel.isRename) {
                    resultRefType.contextValue = "candidateReferenceType";
                }
                return resultRefType;

            case NodeType.file:
            case NodeType.fileWithPendingRef:
                if (element.fileUri === undefined) {
                    throw new Error("Undefined fileUri in getTreeItem()");
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
                if (element.referenceText === undefined) {
                    throw new Error("Undefined referenceText in getTreeItem()");
                }
                if (element.referenceType === undefined) {
                    throw new Error("Undefined referenceType in getTreeItem()");
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

    getChildren(element?: TreeNode): TreeNode[] | undefined {
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
