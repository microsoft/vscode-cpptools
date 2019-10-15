/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferencesResult } from './references';
import { ReferencesModel, RenameResultCallback } from './referencesModel';
import { ReferencesTreeDataProvider } from './referencesTreeDataProvider';

export class RenameView {
    private referencesModel: ReferencesModel;
    private renamePendingTreeDataProvider: ReferencesTreeDataProvider;
    private renameCandidatesTreeDataProvider: ReferencesTreeDataProvider;
    private visible: boolean = false;

    constructor() {
        this.renamePendingTreeDataProvider = new ReferencesTreeDataProvider(false);
        this.renameCandidatesTreeDataProvider = new ReferencesTreeDataProvider(true);
        vscode.window.createTreeView(
            'CppRenamePendingView',
            { treeDataProvider: this.renamePendingTreeDataProvider, showCollapseAll: false });
        vscode.window.createTreeView(
            'CppRenameCandidatesView',
            { treeDataProvider: this.renameCandidatesTreeDataProvider, showCollapseAll: false });
    }

    show(showView: boolean): void {
        vscode.commands.executeCommand(`setContext`, 'cppRename:hasResults', showView);
        if (showView) {
            this.visible = true;
            vscode.commands.executeCommand(`CppRenamePendingView.focus`);
        } else if (this.visible) {
            this.visible = false;
            this.referencesModel.cancelRename();
            this.referencesModel = null;
            this.clearData();
        }
    }

    setGroupBy(groupByFile: boolean): void {
        if (this.referencesModel) {
            this.referencesModel.groupByFile = groupByFile;
            this.renameCandidatesTreeDataProvider.refresh();
        }
    }

    setData(results: ReferencesResult, groupByFile: boolean, resultsCallback: RenameResultCallback): void {
        this.referencesModel = new ReferencesModel(results, true, false, groupByFile, resultsCallback, () => {
            this.renamePendingTreeDataProvider.refresh();
            this.renameCandidatesTreeDataProvider.refresh();
        });
        this.renamePendingTreeDataProvider.setModel(this.referencesModel);
        this.renameCandidatesTreeDataProvider.setModel(this.referencesModel);
    }

    clearData(): void {
        this.renamePendingTreeDataProvider.clear();
        this.renameCandidatesTreeDataProvider.clear();
    }
}
