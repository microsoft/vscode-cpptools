/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { extensionContext, ISshConfigHostInfo, pathAccessible } from "../../common";
import { TreeItem } from "vscode";
import { LabelLeafNode } from "./common";
import { constants } from 'fs';

export const workspaceState_activeSshTarget: string = 'workspaceState_activeSshTarget';

// File path => writable
// Cleared in SSH targets provider during refresh
export const filesWritable: Map<string, boolean> = new Map<string, boolean>();
async function isWritable(file: string): Promise<boolean> {
    let cachedWritable: boolean | undefined = filesWritable.get(file);
    if (cachedWritable === undefined) {
        const writable: boolean = await pathAccessible(file, constants.W_OK);
        filesWritable.set(file, writable);
        cachedWritable = writable;
    }
    return cachedWritable;
}

export class TargetLeafNode extends LabelLeafNode {
    constructor(readonly name: string, readonly sshConfigHostInfo: ISshConfigHostInfo) {
        super(name);
    }

    async getTreeItem(): Promise<TreeItem> {
        const item: TreeItem = await super.getTreeItem();
        const removable: boolean = await isWritable(this.sshConfigHostInfo.file);
        if (_activeTarget === this.name) {
            item.label = `* ${item.label}`;
            if (removable) {
                item.contextValue = 'CppSshTargetsView.targetLeafRemovable';
            }
        } else if (removable) {
            item.contextValue = 'CppSshTargetsView.targetLeafRemovableCanSetActive';
        } else {
            item.contextValue = 'CppSshTargetsView.targetLeafCanSetActive';
        }
        return item;
    }
}

/**
 * Should only be used in targetNodes.ts and sshTargetsProvider.ts
 */
export let _activeTarget: string | undefined;
export async function setActiveSshTarget(name: string | undefined): Promise<void> {
    _activeTarget = name;
    await extensionContext?.workspaceState.update(workspaceState_activeSshTarget, name);
}
