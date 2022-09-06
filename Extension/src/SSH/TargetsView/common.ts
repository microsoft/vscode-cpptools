/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';

/**
 * Base class of nodes in all tree nodes
 */
export interface BaseNode {
    /**
     * Get the child nodes of this node
     */
    getChildren(): Promise<BaseNode[]>;

    /**
     * Get the vscode.TreeItem associated with this node
     */
    getTreeItem(): Promise<vscode.TreeItem>;
}

export class LabelLeafNode implements BaseNode {
    constructor(private readonly label: string) { /* blank */ }

    async getChildren(): Promise<BaseNode[]> {
        return [];
    }

    getTreeItem(): Promise<vscode.TreeItem> {
        return Promise.resolve(new vscode.TreeItem(this.getLabel(), vscode.TreeItemCollapsibleState.None));
    }

    getLabel(): string {
        return this.label;
    }
}

export const cmd_refreshCppSshTargetsView: string = 'C_Cpp.refreshCppSshTargetsView';
export const cmd_addSshTarget: string = 'C_Cpp.addSshTarget';
