/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import { Range } from 'vscode-languageclient';

/** Differs from vscode.Location, which has a uri of type vscode.Uri. */
export interface Location {
    uri: string;
    range: Range;
}

export interface TextEdit {
    range: Range;
    newText: string;
}

export interface WorkspaceEdit {
    file: string;
    edits: TextEdit[];
}
