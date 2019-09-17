/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceInfo, ReferenceType, getReferenceTagString } from './references';
import { ReferenceDataProvider } from './referencesProvider';
import { FileItem, ReferenceItem } from './referencesModel';

export class FindAllRefsView {
    private referenceViewProvider: ReferenceDataProvider;

    constructor() {
        this.referenceViewProvider = new ReferenceDataProvider();
        vscode.window.createTreeView(
            'CppReferencesView',
            { treeDataProvider: this.referenceViewProvider, showCollapseAll: true });
    }

    show(showView: boolean): void {
        vscode.commands.executeCommand(`setContext`, 'cppReferenceTypes:hasResults', this.referenceViewProvider.hasResults());
        if (!showView) {
            this.clearData();
        }
    }

    setData(results: ReferenceInfo[], isCanceled: boolean): void {
        this.referenceViewProvider.setModel(results, isCanceled);
    }

    clearData(): void {
        this.referenceViewProvider.clear();
    }

    getResultsAsText(includeConfirmedReferences: boolean): string {
        let results: string[] = [];
        let confirmedRefs: string[] = [];
        let otherRefs: string[] = [];
        let fileRefs: string[] = [];

        let referenceItems: ReferenceItem[] = this.referenceViewProvider.getReferenceItems();
        for (let ref of referenceItems) {
            let line: string =
                ("[" + getReferenceTagString(ref.type, this.referenceViewProvider.isCanceled()) + "] "
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
        let fileReferences: FileItem[] = this.referenceViewProvider.getFilesWithPendingReferences();
        for (let fileRef of fileReferences) {
            let line: string =
                ("[" + getReferenceTagString(ReferenceType.ConfirmationInProgress, this.referenceViewProvider.isCanceled()) + "] "
                + fileRef.name);
            fileRefs.push(line);
        }

        results = results.concat(confirmedRefs, otherRefs, fileRefs);
        return results.join('\n');
    }
}
