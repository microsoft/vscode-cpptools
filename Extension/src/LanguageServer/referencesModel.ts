/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceType, ReferenceInfo } from './references';

export class Model {
    readonly items: FileItem[] = [];

    constructor(resultsInput: ReferenceInfo[]) {
        let results: ReferenceInfo[] = resultsInput.filter(r => r.type !== ReferenceType.Confirmed);
        for (let r of results) {
            // Add file if it doesn't exist
            let fileItem: FileItem;
            let index: number = this.items.findIndex(function(item): boolean {
                return item.name === r.file;
             });
            if (index < 0) {
                const uri: vscode.Uri = vscode.Uri.file(r.file);
                fileItem = new FileItem(uri, r.file);
                this.items.push(fileItem);
            } else {
                fileItem = this.items[index];
            }

            // Add reference to file
            let isFileReference: boolean = (r.position.line === 0 && r.position.character === 0);
            if (!isFileReference) {
                const range: vscode.Range = new vscode.Range(r.position.line, r.position.character, r.position.line, r.position.character + 1);
                const location: vscode.Location = new vscode.Location(fileItem.uri, range);
                const reference: ReferenceItem = new ReferenceItem(location, r.text, fileItem, r.type);
                fileItem.addReference(reference);
            }
        }
    }
}

export class ReferenceTypeItem {
    private files: FileItem[] = [];

    constructor(readonly type: ReferenceType) {
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
        readonly location: vscode.Location,
        readonly text: string,
        readonly parent: FileItem | undefined,
        readonly type: ReferenceType
    ) { }
}
