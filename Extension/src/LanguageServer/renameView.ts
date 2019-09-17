/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceInfo } from './references';
import { RenameDataProvider } from './renameDataProvider';
import { RenameModel } from './renameModel';

export class RenameView {
    private renamePendingDataProvider: RenameDataProvider;
    private renameCandidatesDataProvider: RenameDataProvider;

    constructor() {
        this.renamePendingDataProvider = new RenameDataProvider(true);
        this.renameCandidatesDataProvider = new RenameDataProvider(false);
        vscode.window.createTreeView(
            'CppRenamePendingView',
            { treeDataProvider: this.renamePendingDataProvider, showCollapseAll: false });
        vscode.window.createTreeView(
            'CppRenameCandidatesView',
            { treeDataProvider: this.renameCandidatesDataProvider, showCollapseAll: false });
    }

    show(showView: boolean): void {
        vscode.commands.executeCommand(`setContext`, 'cppRename:hasResults', showView);
        if (!showView) {
            this.clearData();
        }
    }

    setData(results: ReferenceInfo[]): void {
        let renameModel: RenameModel = new RenameModel(results, this.renamePendingDataProvider, this.renameCandidatesDataProvider);
        this.renamePendingDataProvider.setModel(renameModel);
        this.renameCandidatesDataProvider.setModel(renameModel);
    }

    clearData(): void {
        this.renamePendingDataProvider.clear();
        this.renameCandidatesDataProvider.clear();
    }
}
