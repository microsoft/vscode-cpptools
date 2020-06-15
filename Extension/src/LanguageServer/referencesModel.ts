/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceType, ReferenceInfo, ReferencesResult } from './references';

export class ReferencesModel {
    readonly nodes: TreeNode[] = []; // Raw flat list of references
    private originalSymbol: string = "";
    public groupByFile: boolean;

    constructor(resultsInput: ReferencesResult, readonly isCanceled: boolean, groupByFile: boolean, readonly refreshCallback: () => void) {
        this.originalSymbol = resultsInput.text;
        this.groupByFile = groupByFile;

        const results: ReferenceInfo[] = resultsInput.referenceInfos.filter(r => r.type !== ReferenceType.Confirmed);

        // Build a single flat list of all leaf nodes
        // Currently, the hierarchy is built each time referencesTreeDataProvider requests nodes.
        for (const r of results) {
            // Add reference to file
            const noReferenceLocation: boolean = (r.position.line === 0 && r.position.character === 0);
            if (noReferenceLocation) {
                const node: TreeNode = new TreeNode(this, NodeType.fileWithPendingRef);
                node.fileUri = vscode.Uri.file(r.file);
                node.filename = r.file;
                node.referenceType = r.type;
                this.nodes.push(node);
            } else {
                const range: vscode.Range = new vscode.Range(r.position.line, r.position.character, r.position.line, r.position.character + this.originalSymbol.length);
                const uri: vscode.Uri = vscode.Uri.file(r.file);
                const location: vscode.Location = new vscode.Location(uri, range);
                const node: TreeNode = new TreeNode(this, NodeType.reference);
                node.fileUri = uri;
                node.filename = r.file;
                node.referencePosition = r.position;
                node.referenceLocation = location;
                node.referenceText = r.text;
                node.referenceType = r.type;
                this.nodes.push(node);
            }
        }
    }

    hasResults(): boolean {
        return this.nodes.length > 0;
    }

    getReferenceTypeNodes(): TreeNode[] {
        const result: TreeNode[] = [];
        for (const n of this.nodes) {
            const i: number = result.findIndex(e => e.referenceType === n.referenceType);
            if (i < 0) {
                const node: TreeNode = new TreeNode(this, NodeType.referenceType);
                node.referenceType = n.referenceType;
                result.push(node);
            }
        }
        return result;
    }

    getFileNodes(refType?: ReferenceType): TreeNode[] {
        const result: TreeNode[] = [];
        let filteredFiles: TreeNode[] = [];

        // Get files by reference type if refType is specified.
        if (refType !== undefined) {
            filteredFiles = this.nodes.filter(i => i.referenceType === refType);
        } else {
            filteredFiles = this.nodes;
        }

        // Create new nodes per unique file
        for (const n of filteredFiles) {
            const i: number = result.findIndex(item => item.filename === n.filename);
            if (i < 0) {
                const nodeType: NodeType = (n.node === NodeType.fileWithPendingRef ? NodeType.fileWithPendingRef : NodeType.file);
                const node: TreeNode = new TreeNode(this, nodeType);
                node.filename = n.filename;
                node.fileUri = n.fileUri;
                node.referenceType = refType;
                result.push(node);
            }
        }
        result.sort((a, b) => {
            if (a.filename === undefined) {
                if (b.filename === undefined) {
                    return 0;
                } else {
                    return -1;
                }
            } else if (b.filename === undefined) {
                return 1;
            } else {
                return a.filename.localeCompare(b.filename);
            }
        });
        return result;
    }

    getReferenceNodes(filename?: string, refType?: ReferenceType): TreeNode[] {
        if (refType === undefined || refType === null) {
            if (filename === undefined || filename === null) {
                return this.nodes;
            }
            return this.nodes.filter(i => i.filename === filename);
        }
        if (filename === undefined || filename === null) {
            return this.nodes.filter(i => i.referenceType === refType);
        }
        return this.nodes.filter(i => i.filename === filename && i.referenceType === refType);
    }

    getAllReferenceNodes(): TreeNode[] {
        return this.nodes.filter(i => i.node === NodeType.reference);
    }

    getAllFilesWithPendingReferenceNodes(): TreeNode[] {
        const result: TreeNode[] = this.nodes.filter(i => i.node === NodeType.fileWithPendingRef);
        result.sort((a, b) => {
            if (a.filename === undefined) {
                if (b.filename === undefined) {
                    return 0;
                } else {
                    return -1;
                }
            } else if (b.filename === undefined) {
                return 1;
            } else {
                return a.filename.localeCompare(b.filename);
            }
        });
        return result;
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
    // Optional properties for file related info
    public filename?: string;
    public fileUri?: vscode.Uri;

    // Optional properties for reference item info
    public referencePosition?: vscode.Position;
    public referenceLocation?: vscode.Location;
    public referenceText?: string;
    public referenceType?: ReferenceType;

    constructor(readonly model: ReferencesModel, readonly node: NodeType) {
    }
}
