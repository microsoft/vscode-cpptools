/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const defaultTimeout: number = 100000;

export async function activateCppExtension(): Promise<void> {
    let extension: vscode.Extension<any> = vscode.extensions.getExtension("ms-vscode.cpptools");
    if (!extension.isActive) {
        await extension.activate();
    }
}
