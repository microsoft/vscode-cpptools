/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferencesResult, ReferenceType, getReferenceTagString } from './references';
import { ReferencesTreeDataProvider } from './referencesTreeDataProvider';
import { ReferencesModel, TreeNode } from './referencesModel';

export class FindAllRefsView {
    private referencesModel?: ReferencesModel;
    private referenceViewProvider: ReferencesTreeDataProvider;

    constructor() {
        this.referenceViewProvider = new ReferencesTreeDataProvider();
        vscode.window.createTreeView(
            'CppReferencesView',
            { treeDataProvider: this.referenceViewProvider, showCollapseAll: true });
    }

    show(showView: boolean): void {
        if (!showView) {
            this.clearData();
        }
        let hasResults: boolean = false;
        if (this.referencesModel) {
            hasResults = this.referencesModel.hasResults();
        }
        vscode.commands.executeCommand('setContext', 'cppReferenceTypes:hasResults', hasResults);
    }

    setData(results: ReferencesResult, isCanceled: boolean, groupByFile: boolean): void {
        this.referencesModel = new ReferencesModel(results, isCanceled, groupByFile, () => { this.referenceViewProvider.refresh(); });
        this.referenceViewProvider.setModel(this.referencesModel);
    }

    clearData(): void {
        this.referenceViewProvider.clear();
    }

    setGroupBy(groupByFile: boolean): void {
        if (this.referencesModel) {
            this.referencesModel.groupByFile = groupByFile;
            this.referenceViewProvider.refresh();
        }
    }

    getResultsAsText(includeConfirmedReferences: boolean): string {
        let results: string[] = [];
        const confirmedRefs: string[] = [];
        const otherRefs: string[] = [];
        const fileRefs: string[] = [];

        if (!this.referencesModel) {
            throw new Error("Missiung ReferencesModel in getResultsAsText()");
        }
        for (const ref of this.referencesModel.getAllReferenceNodes()) {
            let line: string = "";
            if (ref.referenceType !== null && ref.referenceType !== undefined) {
                line = "[" + getReferenceTagString(ref.referenceType, this.referencesModel.isCanceled) + "] ";
            }
            line += ref.filename;
            if (ref.referencePosition !== null && ref.referencePosition !== undefined) {
                line += ":" + (ref.referencePosition.line + 1) + ":" + (ref.referencePosition.character + 1)
                + " " + ref.referenceText;
            }
            if (includeConfirmedReferences && ref.referenceType === ReferenceType.Confirmed) {
                confirmedRefs.push(line);
            } else {
                otherRefs.push(line);
            }
        }

        // Get files with pending references items (location of reference is pending)
        const fileReferences: TreeNode[] = this.referencesModel.getAllFilesWithPendingReferenceNodes();
        for (const fileRef of fileReferences) {
            const line: string =
                ("[" + getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referencesModel.isCanceled) + "] "
                + fileRef.filename);
            fileRefs.push(line);
        }

        results = results.concat(confirmedRefs, otherRefs, fileRefs);
        return results.join('\n');
    }
}
