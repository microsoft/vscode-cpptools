/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as util from '../common';
import * as vscode from 'vscode';

class RefreshButton implements vscode.QuickInputButton {
    get iconPath(): { dark: vscode.Uri; light: vscode.Uri } {
        const refreshImagePathDark: string = util.getExtensionFilePath("assets/Refresh_inverse.svg");
        const refreshImagePathLight: string = util.getExtensionFilePath("assets/Refresh.svg");

        return {
            dark: vscode.Uri.file(refreshImagePathDark),
            light: vscode.Uri.file(refreshImagePathLight)
        };
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
            quickPick.title = "Attach to process";
            quickPick.canSelectMany = false;
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;
            quickPick.placeholder = "Select the process to attach to";
            quickPick.items = processEntries;
            quickPick.buttons = [new RefreshButton()];

            let disposables: vscode.Disposable[] = [];

            quickPick.onDidTriggerButton(button => {
                getAttachItems().then(processEntries => quickPick.items = processEntries);
            }, undefined, disposables);

            quickPick.onDidAccept(() => {
                if (quickPick.selectedItems.length !== 1) {
                    reject(new Error("Process not selected"));
                }

                let selectedId: string = quickPick.selectedItems[0].id;

                disposables.forEach(item => item.dispose());
                quickPick.dispose();

                resolve(selectedId);
            }, undefined, disposables);

            quickPick.onDidHide(() => {
                disposables.forEach(item => item.dispose());
                quickPick.dispose();

                reject(new Error("Process not selected."));
            }, undefined, disposables);

            quickPick.show();
        });
    });
}
