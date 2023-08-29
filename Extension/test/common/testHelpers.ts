/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../vscode.d.ts" />
import * as vscode from 'vscode';

export const defaultTimeout: number = 100000;

export async function activateCppExtension(): Promise<void> {
    const extension = vscode.extensions.getExtension("ms-vscode.cpptools");
    if (extension && !extension.isActive) {
        await extension.activate();
    }
}

export function delay(ms: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}
