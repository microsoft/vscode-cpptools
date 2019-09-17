/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceType, ReferenceInfo } from './references';
import { RenameDataProvider } from './renameDataProvider';

export class RenameGroupItem {
    private files: RenameFileItem[] = [];
    private otherGroup: RenameGroupItem;

    constructor(readonly pending: boolean, readonly model: RenameModel) {
    }

    getFiles(): RenameFileItem[] {
        return this.files;
    }

    getOtherGroup(): RenameGroupItem {
        return this.otherGroup;
    }

    setOtherGroup(group: RenameGroupItem): void {
        this.otherGroup = group;
    }

    addFile(file: RenameFileItem): void {
        this.files.push(file);
    }

    removeFile(file: RenameFileItem): void {
        this.files = this.files.filter(e => e !== file);
    }

    getIsEmpty(): boolean {
        return this.files.length === 0;
    }

    getOrAddFile(fileName: string): RenameFileItem {
        let file: RenameFileItem;
        const uri: vscode.Uri = vscode.Uri.file(fileName);
        let index: number = this.indexOfFile(fileName);
        if (index > -1) {
            file = this.files[index];
        } else {
            file = new RenameFileItem(uri, fileName, this.pending, this);
            this.files.push(file);
        }
        return file;
    }

    private indexOfFile(fileName: string): number {
        return this.files.findIndex(function(item): boolean {
            return item.name === fileName;
        });
    }

    changeGroup(): void {
        while (this.files.length > 0) {
            this.files[0].changeGroup();
        }
    }
}

// Only 1 rename operation can be in progress at a time.
let currentRename: RenameModel;

export class RenameModel {
    private groups: RenameGroupItem[] = [];   // index 0 is pending items, index 1 is candidate items

    constructor(resultsInput: ReferenceInfo[], readonly pendingProvider: RenameDataProvider, readonly candidateProvider: RenameDataProvider) {
        currentRename = this;
        let pendingItems: RenameGroupItem = new RenameGroupItem(true, this);
        let candidateItems: RenameGroupItem = new RenameGroupItem(false, this);
        pendingItems.setOtherGroup(candidateItems);
        candidateItems.setOtherGroup(pendingItems);
        this.groups.push(pendingItems, candidateItems);
        for (let r of resultsInput) {
            // Add file if it doesn't exist
            let fileItem: RenameFileItem;
            let isPending: boolean = r.type === ReferenceType.Confirmed;
            let group: RenameGroupItem = candidateItems;
            if (isPending) {
                group = pendingItems;
            }
            let index: number = group.getFiles().findIndex(function(item): boolean {
                return item.name === r.file;
             });
            if (index < 0) {
                const uri: vscode.Uri = vscode.Uri.file(r.file);
                fileItem = new RenameFileItem(uri, r.file, isPending, group);
                group.getFiles().push(fileItem);
            } else {
                fileItem = group.getFiles()[index];
            }
            // Add reference to file
            let isFileReference: boolean = (r.position.line === 0 && r.position.character === 0);
            if (!isFileReference) {
                const range: vscode.Range = new vscode.Range(r.position.line, r.position.character, r.position.line, r.position.character + 1);
                const location: vscode.Location = new vscode.Location(fileItem.uri, range);
                const reference: RenameItem = new RenameItem(location, r.text, fileItem, r.type, isPending);
                fileItem.addReference(reference);
            }
        }
    }

    getGroups(): RenameGroupItem[] {
        return this.groups;
    }

    getGroup(pending: boolean): RenameGroupItem {
        return this.groups[pending ? 0 : 1];
    }

    updateProviders(): void {
        this.pendingProvider.update();
        this.candidateProvider.update();
    }
}

export class RenameFileItem {
    private references: RenameItem[] = [];
    private parentGroup: RenameGroupItem;

    constructor(readonly uri: vscode.Uri, readonly name: string, readonly pending: boolean, readonly group: RenameGroupItem) {
        this.parentGroup = group;
    }

    getReferences(): RenameItem[] {
        return this.references;
    }

    getParentGroup(): RenameGroupItem {
        return this.parentGroup;
    }

    setParentGroup(group: RenameGroupItem): void {
        this.parentGroup = group;
    }

    addReference(reference: RenameItem): void {
        this.references.push(reference);
    }

    removeReference(reference: RenameItem): void {
        this.references = this.references.filter(e => e !== reference);
    }

    getIsEmpty(): boolean {
        return this.references.length === 0;
    }

    changeGroup(): void {
        while (this.references.length > 0) {
            this.references[0].changeGroup();
        }
    }

    getModel(): RenameModel {
        return this.parentGroup.model;
    }
}

export class RenameItem {
    private parentFile: RenameFileItem;
    private isPending: boolean;

    constructor(readonly location: vscode.Location, readonly text: string, parent: RenameFileItem, readonly type: ReferenceType, pending: boolean) {
        this.isPending = pending;
        this.parentFile = parent;
    }

    getIsPending(): boolean {
        return this.isPending;
    }

    getParentFile(): RenameFileItem {
        return this.parentFile;
    }

    changeGroup(): void {
        let parentGroup: RenameGroupItem = this.parentFile.getParentGroup();
        let otherGroup: RenameGroupItem = parentGroup.getOtherGroup();
        this.parentFile.removeReference(this);
        if (this.parentFile.getIsEmpty()) {
            parentGroup.removeFile(this.parentFile);
        }
        let newParentFile: RenameFileItem = otherGroup.getOrAddFile(this.parentFile.name);
        this.isPending = !this.isPending;
        this.parentFile = newParentFile;
        newParentFile.addReference(this);
    }

    getModel(): RenameModel {
        return this.parentFile.getModel();
    }
}

export function getCurrentRenameModel(): RenameModel {
    return currentRename;
}

export class RenameReferenceTypeItem {
    constructor(readonly type: ReferenceType, readonly text: string, readonly parent: RenameGroupItem) {
    }
}

