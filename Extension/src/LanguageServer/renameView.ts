/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferencesResult } from './references';
import { RenameDataProvider } from './renameDataProvider';
import { RenameModel } from './renameModel';

export class RenameView {
    private renamePendingDataProvider: RenameDataProvider;
    private renameCandidatesDataProvider: RenameDataProvider;
    private model: RenameModel;
    private visible: boolean = false;

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
        if (showView) {
            this.visible = true;
            vscode.commands.executeCommand(`CppRenamePendingView.focus`);
        } else if (this.visible) {
            this.visible = false;
            this.model.cancel();
            this.model = null;
            this.clearData();
        }
    }

    setData(results: ReferencesResult, resultsCallback: (results: ReferencesResult) => void): void {
        this.model = new RenameModel(results, this.renamePendingDataProvider, this.renameCandidatesDataProvider, resultsCallback);
        this.renamePendingDataProvider.setModel(this.model);
        this.renameCandidatesDataProvider.setModel(this.model);
    }

    clearData(): void {
        this.renamePendingDataProvider.clear();
        this.renameCandidatesDataProvider.clear();
    }
}
