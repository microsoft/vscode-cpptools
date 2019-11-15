/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { ReferenceType, ReferenceInfo, ReferencesResult } from './references';

export type RenameResultCallback = (result: ReferencesResult) => void;

let currentRenameModel: ReferencesModel;

export class ReferencesModel {
    readonly nodes: TreeNode[] = []; // Raw flat list of references
    private renameResultsCallback: RenameResultCallback;
    private originalSymbol: string = "";
    public groupByFile: boolean;

    constructor(resultsInput: ReferencesResult, readonly isRename: boolean, readonly isCanceled: boolean, groupByFile: boolean, resultsCallback: RenameResultCallback, readonly refreshCallback: () => void) {
        this.originalSymbol = resultsInput.text;
        this.renameResultsCallback = resultsCallback;
        if (isRename) {
            currentRenameModel = this;
        }
        this.groupByFile = groupByFile;

        let results: ReferenceInfo[];
        if (this.isRename) {
            results = resultsInput.referenceInfos;
        } else {
            results = resultsInput.referenceInfos.filter(r => r.type !== ReferenceType.Confirmed);
        }

        // Build a single flat list of all leaf nodes
        // Currently, the hierachy is build each time referencesTreeDataProvider requests nodes.
        // When moving between pending and candidate views in rename, the hierachy gets rebuilt.
        // TODO: If that is a performance issue, we could change this to always build the tree up front.
        for (let r of results) {
            // Add reference to file
            let noReferenceLocation: boolean = (r.position.line === 0 && r.position.character === 0);
            if (noReferenceLocation) {
                let node: TreeNode = new TreeNode(this, NodeType.fileWithPendingRef);
                node.fileUri = vscode.Uri.file(r.file);
                node.filename = r.file;
                node.referenceType = r.type;
                this.nodes.push(node);
            } else {
                const range: vscode.Range = new vscode.Range(r.position.line, r.position.character, r.position.line, r.position.character + this.originalSymbol.length);
                const uri: vscode.Uri = vscode.Uri.file(r.file);
                const location: vscode.Location = new vscode.Location(uri, range);
                let node: TreeNode = new TreeNode(this, NodeType.reference);
                node.fileUri = uri;
                node.filename = r.file;
                node.referencePosition = r.position;
                node.referenceLocation = location;
                node.referenceText = r.text;
                node.referenceType = r.type;
                node.isRenameCandidate = r.type !== ReferenceType.Confirmed;
                this.nodes.push(node);
            }
        }
    }

    hasResults(): boolean {
        return this.nodes.length > 0;
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

    getFileNodes(refType: ReferenceType | undefined, isRenameCandidate: boolean): TreeNode[] {
        let result: TreeNode[] = [];
        let filteredFiles: TreeNode[] = [];

        // Get files by reference type if refType is specified.
        if (refType !== undefined) {
            filteredFiles = this.nodes.filter(i => i.referenceType === refType && (!this.isRename || (isRenameCandidate === i.isRenameCandidate)));
        } else if (this.isRename) {
            filteredFiles = this.nodes.filter(i => isRenameCandidate === i.isRenameCandidate);
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
        result.sort((a, b) => a.filename.localeCompare(b.filename));
        return result;
    }

    getReferenceNodes(filename: string | undefined, refType: ReferenceType | undefined, isRenameCandidate?: boolean): TreeNode[] {
        if (this.isRename) {
            if (refType === undefined || refType === null) {
                if (filename === undefined || filename === null) {
                    return this.nodes.filter(i => i.isRenameCandidate === isRenameCandidate);
                }
                return this.nodes.filter(i => i.isRenameCandidate === isRenameCandidate && i.filename === filename);
            }
            if (filename === undefined || filename === null) {
                return this.nodes.filter(i => i.isRenameCandidate === isRenameCandidate && i.referenceType === refType);
            }
            return this.nodes.filter(i => i.isRenameCandidate === isRenameCandidate && i.filename === filename && i.referenceType === refType);
        }

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
        if (this.isRename) {
            return this.nodes;
        }
        return this.nodes.filter(i => i.node === NodeType.reference);
    }

    getAllFilesWithPendingReferenceNodes(): TreeNode[] {
        if (this.isRename) {
            let empty: TreeNode[] = [];
            return empty;
        }
        let result: TreeNode[] = this.nodes.filter(i => i.node === NodeType.fileWithPendingRef);
        result.sort((a, b) => a.filename.localeCompare(b.filename));
        return result;
    }

    // For rename, this.nodes will contain only ReferenceItems's
    getRenameCandidateReferenceTypes(): TreeNode[] {
        let result: TreeNode[] = [];
        this.nodes.forEach(n => {
            if (n.isRenameCandidate) {
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
            if (n.isRenameCandidate) {
                let i: number = result.findIndex(e => e.filename === n.filename);
                if (i < 0) {
                    let node: TreeNode = new TreeNode(this, NodeType.file);
                    node.fileUri = n.fileUri;
                    node.filename = n.filename;
                    node.referenceType = n.referenceType;
                    result.push(node);
                }
            }
        });
        result.sort((a, b) => a.filename.localeCompare(b.filename));
        return result;
    }

    // For rename, this.nodes will contain only ReferenceItems's
    getRenamePendingFiles(): TreeNode[] {
        let result: TreeNode[] = [];
        this.nodes.forEach(n => {
            if (!n.isRenameCandidate) {
                let i: number = result.findIndex(e => e.filename === n.filename);
                if (i < 0) {
                    let node: TreeNode = new TreeNode(this, NodeType.file);
                    node.fileUri = n.fileUri;
                    node.filename = n.filename;
                    node.referenceType = n.referenceType;
                    result.push(node);
                }
            }
        });
        result.sort((a, b) => a.filename.localeCompare(b.filename));
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
            if (!n.isRenameCandidate) {
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

    setRenameCandidate(node: TreeNode): void {
        node.isRenameCandidate = true;
        this.refreshCallback();
    }

    setRenamePending(node: TreeNode): void {
        node.isRenameCandidate = false;
        this.refreshCallback();
    }

    setAllRenamesCandidates(): void {
        this.nodes.forEach(n => n.isRenameCandidate = true);
        this.refreshCallback();
    }

    setAllRenamesPending(): void {
        this.nodes.forEach(n => n.isRenameCandidate = false);
        this.refreshCallback();
    }

    setFileRenamesCandidates(node: TreeNode): void {
        this.nodes.forEach(n => {
            if (n.filename === node.filename) {
                n.isRenameCandidate = true;
            }
        });
        this.refreshCallback();
    }

    setFileRenamesPending(node: TreeNode): void {
        this.nodes.forEach(n => {
            if (this.groupByFile) {
                if (n.filename === node.filename) {
                    n.isRenameCandidate = false;
                }
            } else {
                if (n.filename === node.filename && node.referenceType === n.referenceType) {
                    n.isRenameCandidate = false;
                }
            }
        });
        this.refreshCallback();
    }

    setAllReferenceTypeRenamesPending(type: ReferenceType): void {
        this.nodes.forEach(n => {
            if (n.referenceType === type) {
                n.isRenameCandidate = false;
            }
        });
        this.refreshCallback();
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
    public filename?: string | undefined;
    public fileUri?: vscode.Uri | undefined;

    // Optional properties for reference item info
    public referencePosition?: vscode.Position | undefined;
    public referenceLocation?: vscode.Location | undefined;
    public referenceText?: string | undefined;
    public referenceType?: ReferenceType | undefined;
    public isRenameCandidate?: boolean | undefined;

    constructor(readonly model: ReferencesModel, readonly node: NodeType) {
    }
}

export function getCurrentRenameModel(): ReferencesModel {
    return currentRenameModel;
}
