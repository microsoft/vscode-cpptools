/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceInfo } from './references';
import { ReferenceDataProvider } from './referencesProvider';

export class FindAllRefsView {
    private referenceViewProvider: ReferenceDataProvider;

    constructor() {
        this.referenceViewProvider = new ReferenceDataProvider();
        vscode.window.createTreeView(
            'CppReferencesView',
            { treeDataProvider: this.referenceViewProvider, showCollapseAll: true });
    }

    show(showView: boolean): void {
        vscode.commands.executeCommand(`setContext`, 'cppReferenceTypes:hasResults', showView);
        if (!showView) {
            this.clearData();
        }
    }

    setData(results: ReferenceInfo[]): void {
        this.referenceViewProvider.setModel(results);
    }

    clearData(): void {
        this.referenceViewProvider.clear();
    }
}

// TODO: create class to manage displaying data to rename view
// export class RenameView {
// }
