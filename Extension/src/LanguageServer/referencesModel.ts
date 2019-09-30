/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceType, ReferenceInfo, ReferencesResult } from './references';

export class Model {
    readonly Nodes: TreeNode[] = []; // Raw flat list of references
    readonly FileItems: FileItem[] = [];
    readonly ReferenceItems: ReferenceItem[] = [];
    readonly ReferenceTypeItems: ReferenceTypeItem[] = [];
    private originalSymbol: string = "";

    constructor(resultsInput: ReferencesResult) {
        this.originalSymbol = resultsInput.text;
        this.createItems(resultsInput); // creates specific groups for FileItem, ReferenceItem, ReferenceTypeItem objects.
        this.createNodes(resultsInput); // creates TreeNode objects.
    }

    private createItems(resultsInput: ReferencesResult): void {
        let results: ReferenceInfo[] = resultsInput.referenceInfos.filter(r => r.type !== ReferenceType.Confirmed);
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
                const range: vscode.Range = new vscode.Range(r.position.line, r.position.character, r.position.line, r.position.character + this.originalSymbol.length);
                const location: vscode.Location = new vscode.Location(fileItem.uri, range);
                const reference: ReferenceItem = new ReferenceItem(r.position, location, r.text, fileItem, r.type);

                fileItem.addReference(reference);
                fileItemByRef.addReference(reference);
                this.ReferenceItems.push(reference);
            }
        }
    }

    private createNodes(resultsInput: ReferencesResult): void {
        let results: ReferenceInfo[] = resultsInput.referenceInfos.filter(r => r.type !== ReferenceType.Confirmed);
        // Create a node for each non-confirmed result.
        for (let r of results) {
            let noReferenceLocation: boolean = (r.position.line === 0 && r.position.character === 0);
            if (noReferenceLocation) {
                let node: TreeNode = new TreeNode(NodeType.fileWithPendingRef);
                node.fileUri = vscode.Uri.file(r.file);
                node.filename = r.file;
                node.referenceType = r.type;
                this.Nodes.push(node);
            } else {
                const uri: vscode.Uri = vscode.Uri.file(r.file);
                const range: vscode.Range = new vscode.Range(r.position.line, r.position.character, r.position.line, r.position.character + this.originalSymbol.length);
                const location: vscode.Location = new vscode.Location(uri, range);

                let node: TreeNode = new TreeNode(NodeType.undefined);
                node.fileUri = uri;
                node.filename = r.file;
                node.referencePosition = r.position;
                node.referenceLocation = location;
                node.referenceText = r.text;
                node.referenceType = r.type;
                this.Nodes.push(node);
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

    getReferenceCanceledGroup2(): TreeNode[] {
        let group: TreeNode[] = [];
        let node: TreeNode = new TreeNode(NodeType.referenceType);
        node.referenceType = ReferenceType.ConfirmationInProgress;
        group.push(node);
        return group;
    }

    getReferenceTypeNodes(): TreeNode[] {
        let result: TreeNode[] = [];

        // Create new nodes for each reference type
        for (let n of this.Nodes) {
            let i: number = result.findIndex(function(item): boolean {
                return item.referenceType === n.referenceType;
            });
            if (i < 0) {
                let node: TreeNode = new TreeNode(NodeType.referenceType);
                node.referenceType = n.referenceType;
                result.push(node);
            }
        }

        return result;
    }

    getFileNodes(refType: ReferenceType | undefined): TreeNode[] {
        let result: TreeNode[] = [];
        let filteredFiles: TreeNode[] = [];

        // Get files by reference type if refType is specified.
        if (refType) {
            filteredFiles = this.Nodes.filter(i => i.referenceType === refType);
        } else {
            filteredFiles = this.Nodes;
        }

        // Create new nodes per unique file
        for (let n of filteredFiles) {
            let i: number = result.findIndex(function(item): boolean {
                return item.filename === n.filename;
            });
            if (i < 0) {
                let nodeType: NodeType = (n.node === NodeType.fileWithPendingRef ? NodeType.fileWithPendingRef : NodeType.file);
                let node: TreeNode = new TreeNode(nodeType);
                node.filename = n.filename;
                node.fileUri = n.fileUri;
                node.referenceType = refType;
                result.push(node);
            }
        }

        return result;
    }

    getReferenceNodes(filename: string | undefined, refType: ReferenceType | undefined): TreeNode[] {
        let result: TreeNode[] = [];
        let filteredReferences: TreeNode[] = [];

        // Filter out which references to get
        if (refType === undefined && filename) {
            // Get all references in filename
            filteredReferences = this.Nodes.filter(i => i.filename === filename);
        } else if (refType && filename) {
            // Get specific reference types in filename
            filteredReferences = this.Nodes.filter(i => i.filename === filename);
            filteredReferences = this.Nodes.filter(i => i.referenceType === refType);
        } else {
            filteredReferences = this.Nodes;
        }

        // Create new nodes for reference objects
        for (let ref of filteredReferences) {
            let node: TreeNode = new TreeNode(NodeType.reference);
            node.filename = ref.filename;
            node.fileUri = ref.fileUri;
            node.referenceLocation = ref.referenceLocation;
            node.referencePosition = ref.referencePosition;
            node.referenceText = ref.referenceText;
            node.referenceType = ref.referenceType;
            result.push(node);
        }

        return result;
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

export  enum NodeType {
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

    // TODO: add optional properties for rename item

    constructor(readonly node: NodeType) {
    }
}
