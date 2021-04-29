/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as util from '../common';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

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
        return localize("refresh.process.list.tooltip", "Refresh process list");
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
        quickPick.title = localize("attach.to.process", "Attach to process");
        quickPick.canSelectMany = false;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.placeholder = localize("select.process.attach", "Select the process to attach to");
        quickPick.buttons = [new RefreshButton()];
        quickPick.items = processEntries;
        const disposables: vscode.Disposable[] = [];

        quickPick.onDidTriggerButton(async () => { quickPick.items = await getAttachItems(); }, undefined, disposables);

        quickPick.onDidAccept(() => {
            if (quickPick.selectedItems.length !== 1) {
                reject(new Error(localize("process.not.selected", "Process not selected.")));
            }

            const selectedId: string | undefined = quickPick.selectedItems[0].id;

            disposables.forEach(item => item.dispose());
            quickPick.dispose();

            resolve(selectedId);
        }, undefined, disposables);

        quickPick.onDidHide(() => {
            disposables.forEach(item => item.dispose());
            quickPick.dispose();

            reject(new Error(localize("process.not.selected", "Process not selected.")));
        }, undefined, disposables);

        quickPick.show();
    });
}
