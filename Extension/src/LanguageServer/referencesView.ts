/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferencesResult, ReferenceType, getReferenceTagString } from './references';
import { ReferenceDataProvider } from './referencesProvider';
import { ReferencesModel, ReferenceFileItem } from './referencesModel';

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

        for (let ref of this.referencesModel.referenceItems) {
            let line: string =
                ("[" + getReferenceTagString(ref.type, this.referencesModel.isCanceled) + "] "
                + ref.parent.name
                + ":" + (ref.position.line + 1) + ":" + (ref.position.character + 1)
                + " " + ref.text);
            if (includeConfirmedReferences && ref.type === ReferenceType.Confirmed) {
                confirmedRefs.push(line);
            } else {
                otherRefs.push(line);
            }
        }

        // Get files with pending references items (location of reference is pending)
        let fileReferences: ReferenceFileItem[] = this.referencesModel.fileItems.filter(i => i.referenceItemsPending);
        for (let fileRef of fileReferences) {
            let line: string =
                ("[" + getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referencesModel.isCanceled) + "] "
                + fileRef.name);
            fileRefs.push(line);
        }

        return results.join('\n');
    }
}
