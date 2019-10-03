/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferencesResult, ReferenceType, getReferenceTagString } from './references';
import { ReferenceDataProvider } from './referencesProvider';
import { ReferencesModel, NodeType, TreeNode } from './referencesModel';

export class FindAllRefsView {
    private referencesModel: ReferencesModel;
    private referenceViewProvider: ReferenceDataProvider;

    constructor() {
        this.referenceViewProvider = new ReferenceDataProvider(false);
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
        this.referencesModel = new ReferencesModel(results, false, isCanceled, groupByFile, null, () => { this.referenceViewProvider.refresh(); });
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
        let confirmedRefs: string[] = [];
        let otherRefs: string[] = [];
        let fileRefs: string[] = [];

        for (let ref of this.referencesModel.nodes) {
            if (ref.node === NodeType.reference) {
                let line: string =
                    ("[" + getReferenceTagString(ref.referenceType, this.referencesModel.isCanceled) + "] "
                    + ref.filename
                    + ":" + (ref.referencePosition.line + 1) + ":" + (ref.referencePosition.character + 1)
                    + " " + ref.referenceText);
                if (includeConfirmedReferences && ref.referenceType === ReferenceType.Confirmed) {
                    confirmedRefs.push(line);
                } else {
                    otherRefs.push(line);
                }
            }
        }

        // Get files with pending references items (location of reference is pending)
        let fileReferences: TreeNode[] = this.referencesModel.nodes.filter(i => (i.referencePosition.line === 0 && i.referencePosition.character === 0));
        for (let fileRef of fileReferences) {
            let line: string =
                ("[" + getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referencesModel.isCanceled) + "] "
                + fileRef.filename);
            fileRefs.push(line);
        }

        return results.join('\n');
    }
}
