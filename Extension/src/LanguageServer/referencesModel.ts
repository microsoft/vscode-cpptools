/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceType, ReferenceInfo, ReferencesResult } from './references';

export type RenameResultCallback = (result: ReferencesResult) => void;

let currentReferencesModel: ReferencesModel;

export class ReferencesModel {
    readonly nodes: TreeNode[] = []; // Raw flat list of references
    readonly fileItems: ReferenceFileItem[] = [];
    readonly referenceItems: ReferenceItem[] = [];
    readonly referenceTypeItems: ReferenceTypeItem[] = [];

    private renameResultsCallback: RenameResultCallback;
    private originalSymbol: string = "";
    public groupByFile: boolean;

    constructor(resultsInput: ReferencesResult, readonly isRename: boolean, readonly isCanceled: boolean, groupByFile: boolean, resultsCallback: RenameResultCallback, readonly refreshCallback: () => void) {
        this.originalSymbol = resultsInput.text;
        this.renameResultsCallback = resultsCallback;
        currentReferencesModel = this;
        this.groupByFile = groupByFile;

        let results: ReferenceInfo[];
        if (this.isRename) {
            results = resultsInput.referenceInfos;
        } else {
            results = resultsInput.referenceInfos.filter(r => r.type !== ReferenceType.Confirmed);
        }
        for (let r of results) {
            // Add reference type if it doesn't exist
            let refTypeItem: ReferenceTypeItem;
            let indexRef: number = this.referenceTypeItems.findIndex(i => i.type === r.type);
            if (indexRef < 0) {
                refTypeItem = new ReferenceTypeItem(r.type);
                this.referenceTypeItems.push(refTypeItem);
            } else {
                refTypeItem = this.referenceTypeItems[indexRef];
            }
            // Get file under reference type
            let fileItemByRef: ReferenceFileItem = refTypeItem.getOrAddFile(r.file);

            // Add file if it doesn't exist
            let fileItem: ReferenceFileItem;
            let index: number = this.fileItems.findIndex(item => item.name === r.file);
            if (index < 0) {
                const uri: vscode.Uri = vscode.Uri.file(r.file);
                fileItem = new ReferenceFileItem(uri, r.file, refTypeItem);
                this.fileItems.push(fileItem);
            } else {
                fileItem = this.fileItems[index];
            }

            // Add reference to file
            let noReferenceLocation: boolean = (r.position.line === 0 && r.position.character === 0);
            fileItem.referenceItemsPending = noReferenceLocation;
            fileItemByRef.referenceItemsPending = noReferenceLocation;

            if (noReferenceLocation) {
                let node: TreeNode = new TreeNode(this, NodeType.fileWithPendingRef);
                node.fileUri = vscode.Uri.file(r.file);
                node.filename = r.file;
                node.referenceType = r.type;
                this.nodes.push(node);
            } else {
                const range: vscode.Range = new vscode.Range(r.position.line, r.position.character, r.position.line, r.position.character + this.originalSymbol.length);
                const location: vscode.Location = new vscode.Location(fileItem.uri, range);
                const reference: ReferenceItem = new ReferenceItem(r.position, location, r.text, fileItem, r.type);

                fileItem.addReference(reference);
                fileItemByRef.addReference(reference);
                this.referenceItems.push(reference);

                let node: TreeNode = new TreeNode(this, NodeType.reference);
                node.fileUri = fileItem.uri;
                node.filename = r.file;
                node.referencePosition = r.position;
                node.referenceLocation = location;
                node.referenceText = r.text;
                node.referenceType = r.type;
                node.referenceItem = reference;
                this.nodes.push(node);
            }
        }
    }

    hasResults(): boolean {
        return this.referenceItems.length > 0 || this.fileItems.length > 0;
    }

    getReferenceTypeNodes(): TreeNode[] {
        let result: TreeNode[] = [];
        for (let n of this.nodes) {
            let i: number = result.findIndex(e => e.referenceType === n.referenceType);
            if (i < 0) {
                let node: TreeNode = new TreeNode(this, NodeType.referenceType);
                node.referenceType = n.referenceType;
                result.push(node);
            }
        }
        return result;
    }

    getFileNodes(refType: ReferenceType | undefined, isCandidate: boolean): TreeNode[] {
        let result: TreeNode[] = [];
        let filteredFiles: TreeNode[] = [];

        // Get files by reference type if refType is specified.
        if (refType !== undefined) {
            filteredFiles = this.nodes.filter(i => i.referenceType === refType && (!this.isRename || (isCandidate === i.referenceItem.isCandidate)));
        } else if (this.isRename) {
            filteredFiles = this.nodes.filter(i => isCandidate === i.referenceItem.isCandidate);
        } else {
            filteredFiles = this.nodes;
        }

        // Create new nodes per unique file
        for (let n of filteredFiles) {
            let i: number = result.findIndex(item => item.filename === n.filename);
            if (i < 0) {
                let nodeType: NodeType = (n.node === NodeType.fileWithPendingRef ? NodeType.fileWithPendingRef : NodeType.file);
                let node: TreeNode = new TreeNode(this, nodeType);
                node.filename = n.filename;
                node.fileUri = n.fileUri;
                node.referenceType = refType;
                result.push(node);
            }
        }

        return result;
    }

    getReferenceNodes(filename: string | undefined, refType: ReferenceType | undefined, isCandidate: boolean): TreeNode[] {
        //let result: TreeNode[] = [];
        let filteredReferences: TreeNode[] = [];

        // Filter out which references to get
        if (refType === undefined && filename) {
            // Get all references in filename
            filteredReferences = this.nodes.filter(i => i.filename === filename && (!this.isRename || (isCandidate === i.referenceItem.isCandidate)));
        } else if (refType !== undefined && filename) {
            // Get specific reference types in filename
            filteredReferences = this.nodes.filter(i => i.filename === filename && i.referenceType === refType && (!this.isRename || (isCandidate === i.referenceItem.isCandidate)));
        } else if (this.isRename) {
            filteredReferences = this.nodes.filter(i => isCandidate === i.referenceItem.isCandidate);
        } else {
            filteredReferences = this.nodes;
        }

        return filteredReferences;
    }

    // For rename, this.nodes will contain only ReferenceItems's
    getRenameCandidateReferenceTypes(): TreeNode[] {
        let result: TreeNode[] = [];
        this.nodes.forEach(n => {
            if (n.referenceItem.isCandidate) {
                let i: number = result.findIndex(e => e.referenceType === n.referenceType);
                if (i < 0) {
                    let node: TreeNode = new TreeNode(this, NodeType.referenceType);
                    node.referenceType = n.referenceType;
                    result.push(node);
                }
            }
        });
        result.sort((a, b) => (a.referenceType < b.referenceType) ? -1 : ((a.referenceType > b.referenceType) ? 1 : 0));
        return result;
    }

    // For rename, this.nodes will contain only ReferenceItems's
    getRenameCandidateFiles(): TreeNode[] {
        let result: TreeNode[] = [];
        this.nodes.forEach(n => {
            if (n.referenceItem.isCandidate) {
                let i: number = result.findIndex(e => e.fileUri === n.fileUri);
                if (i < 0) {
                    let node: TreeNode = new TreeNode(this, NodeType.file);
                    node.fileUri = n.fileUri;
                    node.filename = n.filename;
                    node.referenceType = n.referenceType;
                    result.push(node);
                }
            }
        });
        return result;
    }

    // For rename, this.nodes will contain only ReferenceItems's
    getRenamePendingFiles(): TreeNode[] {
        let result: TreeNode[] = [];
        this.nodes.forEach(n => {
            if (!n.referenceItem.isCandidate) {
                let i: number = result.findIndex(e => e.fileUri === n.fileUri);
                if (i < 0) {
                    let node: TreeNode = new TreeNode(this, NodeType.file);
                    node.fileUri = n.fileUri;
                    node.filename = n.filename;
                    node.referenceType = n.referenceType;
                    result.push(node);
                }
            }
        });
        return result;
    }

    cancelRename(): void {
        if (this.renameResultsCallback) {
            let callback: RenameResultCallback = this.renameResultsCallback;
            this.renameResultsCallback = null;
            callback(null);
        }
    }

    completeRename(): void {
        let referenceInfos: ReferenceInfo[] = [];
        this.nodes.forEach(n => {
            if (!n.referenceItem.isCandidate) {
                let referenceInfo: ReferenceInfo = {
                    file: n.filename,
                    position: n.referenceLocation.range.start,
                    text: n.referenceText,
                    type: n.referenceType
                };
                referenceInfos.push(referenceInfo);
            }
        });
        let results: ReferencesResult = {
            referenceInfos: referenceInfos,
            text: this.originalSymbol,
            isFinished: true
        };
        let callback: RenameResultCallback = this.renameResultsCallback;
        this.renameResultsCallback = null;
        callback(results);
    }

    setRenameCandidate(item: ReferenceItem): void {
        item.isCandidate = true;
        this.refreshCallback();
    }

    setRenamePending(item: ReferenceItem): void {
        item.isCandidate = false;
        this.refreshCallback();
    }

    setAllRenamesCandidates(): void {
        this.nodes.forEach(n => n.referenceItem.isCandidate = true);
        this.refreshCallback();
    }

    setAllRenamesPending(): void {
        this.nodes.forEach(n => n.referenceItem.isCandidate = false);
        this.refreshCallback();
    }

    setFileRenamesCandidates(node: TreeNode): void {
        this.nodes.forEach(n => {
            if (n.filename === node.filename) {
                n.referenceItem.isCandidate = true;
            }
        });
        this.refreshCallback();
    }

    setFileRenamesPending(node: TreeNode): void {
        this.nodes.forEach(n => {
            if (n.filename === node.filename && node.referenceType === n.referenceType) {
                n.referenceItem.isCandidate = false;
            }
        });
        this.refreshCallback();
    }

    setAllReferenceTypeRenamesPending(type: ReferenceType): void {
        this.nodes.forEach(n => {
            if (n.referenceType === type) {
                n.referenceItem.isCandidate = false;
            }
        });
        this.refreshCallback();
    }

}

export class ReferenceTypeItem {
    private files: ReferenceFileItem[] = [];

    constructor(readonly type: ReferenceType) {
    }

    addFiles(files: ReferenceFileItem[]): void {
        this.files = files;
    }

    getFiles(): ReferenceFileItem[] {
        return this.files;
    }

    getOrAddFile(fileName: string): ReferenceFileItem | undefined {
        let file: ReferenceFileItem;
        const uri: vscode.Uri = vscode.Uri.file(fileName);
        let index: number = this.indexOfFile(fileName);
        if (index > -1) {
            file = this.files[index];
        } else {
            file = new ReferenceFileItem(uri, fileName, this);
            this.files.push(file);
        }
        return file;
    }

    private indexOfFile(fileName: string): number {
        return this.files.findIndex(item => item.name === fileName);
    }
}

export class ReferenceFileItem {
    private references: ReferenceItem[] = [];
    public referenceItemsPending: boolean = false;

    constructor(
        readonly uri: vscode.Uri,
        readonly name: string,
        readonly referenceTypeItem: ReferenceTypeItem
    ) { }

    getReferences(): ReferenceItem[] {
        return this.references;
    }

    addReference(reference: ReferenceItem): void {
        this.references.push(reference);
    }
}

export class ReferenceItem {
    public isCandidate: boolean;

    constructor(
        readonly position: vscode.Position,
        readonly location: vscode.Location,
        readonly text: string,
        readonly parent: ReferenceFileItem,
        readonly type: ReferenceType
    ) {
        this.isCandidate = type !== ReferenceType.Confirmed;
    }
}

export enum NodeType {
    undefined,              // Use undefined for creating a flat raw list of reference results.
    referenceType,          // A node to group reference types.
    file,                   // File node that has reference nodes.
    fileWithPendingRef,     // File node with pending references to find (e.g. it has no reference children yet).
    reference               // A reference node, which is either a string, comment, inactice reference, etc.
}

export class TreeNode {
    // Optional property to identify parent node. A TreeNode of NodeType.reference may have a parent file node.
    public parentNode?: TreeNode | undefined;

    // Optional properties for file related info
    public filename?: string | undefined;
    public fileUri?: vscode.Uri | undefined;

    // Optional properties for reference item info
    public referencePosition?: vscode.Position | undefined;
    public referenceLocation?: vscode.Location | undefined;
    public referenceText?: string | undefined;
    public referenceType?: ReferenceType | undefined;

    public referenceItem?: ReferenceItem | undefined;

    constructor(readonly model: ReferencesModel, readonly node: NodeType) {
    }
}

export function getCurrentReferencesModel(): ReferencesModel {
    return currentReferencesModel;
}
