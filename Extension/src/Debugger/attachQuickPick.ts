/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as util from '../common';

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
        return vscode.l10n.t("Refresh process list");
    }
}

export interface AttachItem extends vscode.QuickPickItem {
    id?: string;
}

// We should not await on this function.
export async function showQuickPick(getAttachItems: () => Promise<AttachItem[]>): Promise<string | undefined> {
    const processEntries: AttachItem[] = await getAttachItems();
    return new Promise<string | undefined>((resolve, reject) => {
        const quickPick: vscode.QuickPick<AttachItem> = vscode.window.createQuickPick<AttachItem>();
        quickPick.title = vscode.l10n.t("Attach to process");
        quickPick.canSelectMany = false;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.placeholder = vscode.l10n.t("Select the process to attach to");
        quickPick.buttons = [new RefreshButton()];
        quickPick.items = processEntries;
        const disposables: vscode.Disposable[] = [];

        quickPick.onDidTriggerButton(async () => { quickPick.items = await getAttachItems(); }, undefined, disposables);

        quickPick.onDidAccept(() => {
            if (quickPick.selectedItems.length !== 1) {
                reject(new Error(vscode.l10n.t("Process not selected.")));
            }

            const selectedId: string | undefined = quickPick.selectedItems[0].id;

            disposables.forEach(item => item.dispose());
            quickPick.dispose();

            resolve(selectedId);
        }, undefined, disposables);

        quickPick.onDidHide(() => {
            disposables.forEach(item => item.dispose());
            quickPick.dispose();

            reject(new Error(vscode.l10n.t("Process not selected.")));
        }, undefined, disposables);

        quickPick.show();
    });
}
