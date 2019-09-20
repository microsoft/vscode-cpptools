/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceType, ReferenceInfo } from './references';

export class Model {
    readonly FileItems: FileItem[] = [];
    readonly ReferenceItems: ReferenceItem[] = [];
    readonly ReferenceTypeItems: ReferenceTypeItem[] = [];

    constructor(resultsInput: ReferenceInfo[]) {
        let results: ReferenceInfo[] = resultsInput.filter(r => r.type !== ReferenceType.Confirmed);
        for (let r of results) {
            // Add file if it doesn't exist
            let fileItem: FileItem;
            let index: number = this.FileItems.findIndex(function(item): boolean {
                return item.name === r.file;
             });
            if (index < 0) {
                const uri: vscode.Uri = vscode.Uri.file(r.file);
                fileItem = new FileItem(uri, r.file);
                this.FileItems.push(fileItem);
            } else {
                fileItem = this.FileItems[index];
            }

            // Add reference type if it doesn't exist
            let refTypeItem: ReferenceTypeItem;
            let indexRef: number = this.ReferenceTypeItems.findIndex(function(i): boolean {
                return i.type === r.type;
            });
            if (indexRef < 0) {
                refTypeItem = new ReferenceTypeItem(r.type);
                this.ReferenceTypeItems.push(refTypeItem);
            } else {
                refTypeItem = this.ReferenceTypeItems[indexRef];
            }
            // Get file under reference type
            let fileItemByRef: FileItem = refTypeItem.getOrAddFile(r.file);

            // Add reference to file
            let noReferenceLocation: boolean = (r.position.line === 0 && r.position.character === 0);
            fileItem.ReferenceItemsPending = noReferenceLocation;
            fileItemByRef.ReferenceItemsPending = noReferenceLocation;
            if (!noReferenceLocation) {
                const range: vscode.Range = new vscode.Range(r.position.line, r.position.character, r.position.line, r.position.character + 1);
                const location: vscode.Location = new vscode.Location(fileItem.uri, range);
                const reference: ReferenceItem = new ReferenceItem(r.position, location, r.text, fileItem, r.type);

                fileItem.addReference(reference);
                fileItemByRef.addReference(reference);
                this.ReferenceItems.push(reference);
            }
        }
    }

    getReferenceCanceledGroup(): ReferenceTypeItem[] {
        let group: ReferenceTypeItem[] = [];
        let refType: ReferenceTypeItem = new ReferenceTypeItem(ReferenceType.ConfirmationInProgress);
        refType.addFiles(this.FileItems);
        group.push(refType);
        return group;
    }
}

export class ReferenceTypeItem {
    private files: FileItem[] = [];

    constructor(readonly type: ReferenceType) {
    }

    addFiles(files: FileItem[]): void {
        this.files = files;
    }

    getFiles(): FileItem[] {
        return this.files;
    }

    getOrAddFile(fileName: string): FileItem | undefined {
        let file: FileItem;
        const uri: vscode.Uri = vscode.Uri.file(fileName);
        let index: number = this.indexOfFile(fileName);
        if (index > -1) {
            file = this.files[index];
        } else {
            file = new FileItem(uri, fileName);
            this.files.push(file);
        }
        return file;
    }

    private indexOfFile(fileName: string): number {
        return this.files.findIndex(function(item): boolean {
            return item.name === fileName;
        });
    }
}

export class FileItem {
    private references: ReferenceItem[] = [];
    public ReferenceItemsPending: boolean = false;

    constructor(
        readonly uri: vscode.Uri,
        readonly name: string
    ) { }

    getReferences(): ReferenceItem[] {
        return this.references;
    }

    addReference(reference: ReferenceItem): void {
        this.references.push(reference);
    }
}

export class ReferenceItem {
    constructor(
        readonly position: vscode.Position,
        readonly location: vscode.Location,
        readonly text: string,
        readonly parent: FileItem | undefined,
        readonly type: ReferenceType
    ) { }
}
