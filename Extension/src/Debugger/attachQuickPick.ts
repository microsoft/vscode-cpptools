/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as util from '../common';
import * as vscode from 'vscode';

class RefreshButton implements vscode.QuickInputButton {
    get iconPath(): vscode.Uri {
        const refreshImagePath: string = util.getExtensionFilePath("assets/Refresh_inverse.svg");
        return vscode.Uri.file(refreshImagePath);
    }

    get tooltip(): string {
        return "Refresh process list";
    }
}

export interface AttachItem extends vscode.QuickPickItem {
    id: string;
}

export function showQuickPick(getAttachItems: () => Promise<AttachItem[]>): Promise<string> {
    return getAttachItems().then(processEntries => {
        return new Promise<string>((resolve, reject) => {
            let quickPick: vscode.QuickPick<AttachItem> = vscode.window.createQuickPick<AttachItem>();
            quickPick.canSelectMany = false;
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;
            quickPick.placeholder = "Select the process to attach to";
            quickPick.items = processEntries;
            quickPick.buttons = [new RefreshButton()];

            quickPick.onDidTriggerButton(button => {
                getAttachItems().then(processEntries => quickPick.items = processEntries);
            });

            quickPick.onDidAccept(() => {
                if (quickPick.selectedItems.length !== 1) {
                    reject(new Error("Process not selected"));
                }

                resolve(quickPick.selectedItems[0].id);
            });

            quickPick.onDidHide(() => reject(new Error("Process not selected.")));

            quickPick.show();
        });
    });
}