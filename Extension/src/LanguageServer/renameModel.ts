/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceType, ReferencesResult, ReferenceInfo } from './references';
import { RenameDataProvider } from './renameDataProvider';

export class RenamePendingItem {
    constructor(readonly model: RenameModel, readonly location: vscode.Location, readonly text: string, readonly parent: RenamePendingFileItem, readonly type: ReferenceType) {
    }

    changeGroup(): void {
        this.parent.removeReference(this);
        if (this.parent.getIsEmpty()) {
            this.parent.parent.removeFile(this.parent);
        }
        const referenceTypeItem: RenameCandidateReferenceTypeItem = this.model.getCandidatesGroup().getOrAddReferenceType(this.type);
        const fileItem: RenameCandidateFileItem = referenceTypeItem.getOrAddFile(this.parent.name);
        const reference: RenameCandidateItem = new RenameCandidateItem(this.model, this.location, this.text, fileItem, this.type);
        fileItem.addReference(reference);
    }
}

export class RenameCandidateItem {
    constructor(readonly model: RenameModel, readonly location: vscode.Location, readonly text: string, readonly parent: RenameCandidateFileItem, readonly type: ReferenceType) {
    }

    changeGroup(): void {
        this.parent.removeReference(this);
        if (this.parent.getIsEmpty()) {
            this.parent.parent.removeFile(this.parent);
            if (this.parent.parent.getIsEmpty()) {
                this.parent.parent.parent.removeReferenceType(this.parent.parent);
            }
        }
        const fileItem: RenamePendingFileItem = this.model.getPendingGroup().getOrAddFile(this.parent.name);
        const reference: RenamePendingItem = new RenamePendingItem(this.model, this.location, this.text, fileItem, this.type);
        fileItem.addReference(reference);
    }
}

export class RenamePendingFileItem {
    private references: RenamePendingItem[] = [];

    constructor(readonly model: RenameModel, readonly uri: vscode.Uri, readonly name: string, readonly parent: RenamePendingFilesGroupItem) {
    }

    getReferences(): RenamePendingItem[] {
        return this.references;
    }

    addReference(reference: RenamePendingItem): void {
        this.references.push(reference);
    }

    removeReference(reference: RenamePendingItem): void {
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
}

export class RenameCandidateFileItem {
    private references: RenameCandidateItem[] = [];

    constructor(readonly model: RenameModel, readonly uri: vscode.Uri, readonly name: string, readonly parent: RenameCandidateReferenceTypeItem) {
    }

    getReferences(): RenameCandidateItem[] {
        return this.references;
    }

    addReference(reference: RenameCandidateItem): void {
        this.references.push(reference);
    }

    removeReference(reference: RenameCandidateItem): void {
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
}

export class RenamePendingFilesGroupItem {
    private files: RenamePendingFileItem[] = [];

    constructor(readonly model: RenameModel) {
    }

    getFiles(): RenamePendingFileItem[] {
        return this.files;
    }

    removeFile(file: RenamePendingFileItem): void {
        this.files = this.files.filter(e => e !== file);
    }

    getIsEmpty(): boolean {
        return this.files.length === 0;
    }

    getOrAddFile(fileName: string): RenamePendingFileItem {
        let file: RenamePendingFileItem;
        const uri: vscode.Uri = vscode.Uri.file(fileName);
        let index: number = this.indexOfFile(fileName);
        if (index > -1) {
            file = this.files[index];
        } else {
            file = new RenamePendingFileItem(this.model, uri, fileName, this);
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

export class RenameCandidateReferenceTypeItem {
    private files: RenameCandidateFileItem[] = [];

    constructor(readonly type: ReferenceType, readonly model: RenameModel, readonly parent: RenameCandidateReferenceTypeGroupItem) {
    }

    getFiles(): RenameCandidateFileItem[] {
        return this.files;
    }

    removeFile(file: RenameCandidateFileItem): void {
        this.files = this.files.filter(e => e !== file);
    }

    getIsEmpty(): boolean {
        return this.files.length === 0;
    }

    getOrAddFile(fileName: string): RenameCandidateFileItem {
        let file: RenameCandidateFileItem;
        const uri: vscode.Uri = vscode.Uri.file(fileName);
        let index: number = this.indexOfFile(fileName);
        if (index > -1) {
            file = this.files[index];
        } else {
            file = new RenameCandidateFileItem(this.model, uri, fileName, this);
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

export class RenameCandidateReferenceTypeGroupItem {
    private referenceTypes: RenameCandidateReferenceTypeItem[] = [];

    constructor(readonly model: RenameModel) {
    }

    getReferenceTypes(): RenameCandidateReferenceTypeItem[] {
        return this.referenceTypes;
    }

    removeReferenceType(item: RenameCandidateReferenceTypeItem): void {
        this.referenceTypes = this.referenceTypes.filter(e => e !== item);
    }

    getIsEmpty(): boolean {
        return this.referenceTypes.length === 0;
    }

    getOrAddReferenceType(type: ReferenceType): RenameCandidateReferenceTypeItem {
        let item: RenameCandidateReferenceTypeItem;
        let index: number = this.indexOfReferenceTypeItem(type);
        if (index > -1) {
            item = this.referenceTypes[index];
        } else {
            item = new RenameCandidateReferenceTypeItem(type, this.model, this);
            this.referenceTypes.push(item);
            this.referenceTypes.sort((a, b) => (a.type < b.type) ? -1 : ((a.type > b.type) ? 1 : 0));
        }
        return item;
    }

    private indexOfReferenceTypeItem(type: ReferenceType): number {
        return this.referenceTypes.findIndex(item => {
            return item.type === type;
        });
    }

    changeGroup(): void {
        while (this.referenceTypes.length > 0) {
            this.referenceTypes[0].changeGroup();
        }
    }
}

// Only 1 rename operation can be in progress at a time.
let currentRenameModel: RenameModel;

export class RenameModel {
    private pendingGroup: RenamePendingFilesGroupItem;
    private candidatesGroup: RenameCandidateReferenceTypeGroupItem;
    private renameResultsCallback: (results: ReferencesResult) => void;
    private originalText: string;

    constructor(resultsInput: ReferencesResult, readonly pendingProvider: RenameDataProvider, readonly candidateProvider: RenameDataProvider, resultsCallback: (results: ReferencesResult) => void) {
        currentRenameModel = this;
        this.originalText = resultsInput.text;
        this.renameResultsCallback = resultsCallback;
        this.pendingGroup = new RenamePendingFilesGroupItem(this);
        this.candidatesGroup = new RenameCandidateReferenceTypeGroupItem(this);
        for (let r of resultsInput.referenceInfos) {
            const range: vscode.Range = new vscode.Range(r.position.line, r.position.character, r.position.line, r.position.character + this.originalText.length);
            if (r.type === ReferenceType.Confirmed) {
                // Add file if it doesn't exist
                let pendingFileItem: RenamePendingFileItem = this.pendingGroup.getOrAddFile(r.file);

                // Add reference
                const location: vscode.Location = new vscode.Location(pendingFileItem.uri, range);
                const reference: RenamePendingItem = new RenamePendingItem(this, location, r.text, pendingFileItem, r.type);
                pendingFileItem.addReference(reference);
            } else {
                // Add reference type node and/or file, if either do not exist
                let candidateReferenceTypeItem: RenameCandidateReferenceTypeItem = this.candidatesGroup.getOrAddReferenceType(r.type);
                let candidateFileItem: RenameCandidateFileItem = candidateReferenceTypeItem.getOrAddFile(r.file);

                // Add reference
                const location: vscode.Location = new vscode.Location(candidateFileItem.uri, range);
                const reference: RenameCandidateItem = new RenameCandidateItem(this, location, r.text, candidateFileItem, r.type);
                candidateFileItem.addReference(reference);
            }
        }
    }

    getPendingGroup(): RenamePendingFilesGroupItem {
        return this.pendingGroup;
    }

    getCandidatesGroup(): RenameCandidateReferenceTypeGroupItem {
        return this.candidatesGroup;
    }

    updateProviders(): void {
        this.pendingProvider.update();
        this.candidateProvider.update();
    }

    cancel(): void {
        this.renameResultsCallback(null);
    }

    complete(): void {
        let referenceInfos: ReferenceInfo[] = [];
        this.pendingGroup.getFiles().forEach(file => {
            file.getReferences().forEach(reference => {
                let referenceInfo: ReferenceInfo = {
                    file: file.uri.fsPath,
                    position: reference.location.range.start,
                    text: reference.text,
                    type: reference.type
                };
                referenceInfos.push(referenceInfo);
            });
        });
        let results: ReferencesResult = {
            text: this.originalText,
            referenceInfos: referenceInfos
        };
        this.renameResultsCallback(results);
    }
}

export function getCurrentRenameModel(): RenameModel {
    return currentRenameModel;
}
