// SPDX-License-Identifier: MIT

import * as pathUtil from 'path';
import * as vscode from 'vscode';
import { PersistentWorkspaceState } from './persistentState';
import * as nls from 'vscode-nls';
import { isCppOrCFile, isCppToolsFile, isHeaderFile } from '../common';

/**
 * Reattaches persisted Assistant Editors to the tabs where they were loaded
 * before the window was closed.
 */
export function restoreAll() {
    try {
        for (const state of workspaceState.values()) {
            console.log("restoring assistant with state", state);
            instances.push(new AssistantEditor(state));
        }
    } catch (error) {
        console.error(error);
        console.log("clearing persistent assistant data");
        workspaceState.clear();
    }
}

/**
 * Opens or closes an Assistant Editor for the currently active tab group.
 */
export async function toggle(): Promise<void> {
    const sourceViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
    const editor = instances.find(editor => [ editor.tab?.group.viewColumn, editor.state.sourceViewColumn ].includes(sourceViewColumn));
    if (editor) {
        // This causes the instance to remove itself from the persistent state
        // list because users can close the Assistant Editor by closing its tab
        // and the editor is already listening for these tab events
        editor.dispose();
    } else {
        const state = new PersistentState();
        state.sourceViewColumn = sourceViewColumn;
        workspaceState.push(state);
        instances.push(new AssistantEditor(state));
    }
}

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

/**
 * Active Assistant Editor instances.
 */
const instances: AssistantEditor[] = [];

/**
 * The Assistant Editor manages a tab which automatically changes to display the
 * counterpart header or source of whatever file is loaded in the currently
 * active text editor.
 */
class AssistantEditor implements vscode.Disposable {
    /**
     * The persistent workspace state of the Assistant Editor.
     */
    readonly state: PersistentState;

    /**
     * The {@link vscode.Uri} of the counterpart to the file displayed in the
     * Assistant Editor.
     */
    counterpart?: vscode.Uri;

    /**
     * If true, the Assistant Editor found a valid counterpart file.
     */
    hasCounterpart: boolean = false;

    /**
     * If true, the Assistant Editor is waiting for a
     * {@link vscode.TabChangeEvent} containing the new tab that it created for
     * itself.
     *
     * This approach is used instead of searching the tab groups for the new tab
     * because it is impossible to differentiate between two editors sharing a
     * document with the same URI, so if an editor was already open for a
     * counterpart file, it would be incorrectly adopted as the Assistant Editor
     * tab.
     *
     * It would be better if VSCode would allow extensions to replace the
     * content of a tab but this does not appear to be possible as of 1.75.
     */
    inViewSwitch: boolean = false;

    /**
     * Registered global event listeners.
     */
    listeners: vscode.Disposable[] = [];

    /**
     * The tab of the Assistant Editor.
     */
    tab?: vscode.Tab;

    /**
     * The index of the Assistant Editor tab group. This is required because Tab
     * objects are invalidated and need to be re-fetched when tab groups change.
     */
    tabGroupIndex: number = -1;

    /**
     * The index of the Assistant Editor tab in its tab group. This is required
     * because Tab objects are invalidated and need to be re-fetched when tab
     * groups change.
     */
    tabIndex: number = -1;

    /**
     * The index of the source tab group. This is required because view columns
     * are not stable for tab groups, but their indexes are.
     */
    sourceGroupIndex: number = -1;

    constructor(state: PersistentState) {
        this.state = state;

        const tabGroups = vscode.window.tabGroups;
        tabGroups.onDidChangeTabGroups(this.updateTabGroups, this, this.listeners);
        tabGroups.onDidChangeTabs(this.updateTabs, this, this.listeners);

        const sourcePredicate = (group: vscode.TabGroup) => group.viewColumn === state.sourceViewColumn;
        const sourceTabGroup = tabGroups.all.find(sourcePredicate) || vscode.window.tabGroups.activeTabGroup;
        this.sourceGroupIndex = tabGroups.all.indexOf(sourceTabGroup);

        const input = sourceTabGroup.activeTab?.input;
        let uri: vscode.Uri;
        if (input instanceof vscode.TabInputText) {
            uri = input.uri;
        } else {
            uri = vscode.Uri.from({ scheme: "untitled" });
        }

        // If a restored Assistant Editor was attached to a text editor, VSCode
        // itself will have serialised and restored the underlying text editor,
        // and that needs to be adopted instead of replaced because it may have
        // contained unsaved changes.
        // Otherwise, this is either a brand new Assistant Editor, or the
        // restored Assistant Editor was showing a “No counterpart” message that
        // must be recreated because VSCode does not retain webview state
        if (state.tabIndex !== PersistentState.NoTextEditor) {
            const tabPredicate = (group: vscode.TabGroup) => group.viewColumn === state.viewColumn;
            const tabGroupIndex = vscode.window.tabGroups.all.findIndex(tabPredicate);
            const tab = vscode.window.tabGroups.all[tabGroupIndex]?.tabs[state.tabIndex];
            if (tab) {
                this.tab = tab;
                this.tabGroupIndex = tabGroupIndex;
                this.tabIndex = state.tabIndex;
                this.counterpart = uri;
            }
        }

        this.update(uri);
    }

    /**
     * Destroys the Assistant Editor.
     */
    dispose() {
        console.log("destroying assistant");
        workspaceState.remove(this.state);
        instances.splice(instances.indexOf(this), 1);
        this.listeners.forEach(d => d.dispose());
        if (this.tab) {
            vscode.window.tabGroups.close(this.tab, !this.tab.isActive);
        }
    }

    /**
     * Updates the Assistant Editor with a new counterpart file.
     *
     * @param uri The URI of the counterpart file.
     * @returns A promise that resolves once the Assistant Editor is finished
     * updating.
     */
    async update(uri: vscode.Uri) {
        if (this.counterpart?.toString() === uri.toString()) {
            return;
        }

        this.counterpart = uri;

        const options: vscode.TextDocumentShowOptions & VsCodeCreateWebviewPanelOptions = {
            viewColumn: this.state.viewColumn,
            preserveFocus: true
        };
        const document = await loadDocument(uri);
        this.inViewSwitch = true;
        this.hasCounterpart = Boolean(document);
        if (document) {
            // The editor must never be a preview or else if a user focuses the
            // Assistant Editor without making changes and tries to load a new
            // document it would replace its content with the wrong content.
            // Also, without extra work to check the preview flag, it would
            // cause the old tab to be double-closed.
            // Unfortunately, this will always push the Assistant Editor to the
            // end of the tab group, because VSCode has no API for tab placement
            // within a group, and the only API for moving is running a command
            // that can only move the *active* editor.
            options.preview = false;
            await vscode.window.showTextDocument(document, options);
        } else {
            this.state.tabIndex = PersistentState.NoTextEditor;
            workspaceState.commit();
            emptyEditor(options);
        }
    }

    /**
     * Updates the Assistant Editor after any change to the tab layout.
     */
    updateFromActiveTab() {
        // *Any* change to other tabs (add, remove, or update) within the
        // tab group where the Assistant Editor lives may cause the position
        // of its tab to change, and any changes to the layout of the tabs may
        // cause groups/view columns to change, and any changes to tab groups
        // cause Tab instances to invalidate, so it is necessary to do this
        // recovery garbage basically all the time
        this.state.sourceViewColumn = vscode.window.tabGroups.all[this.sourceGroupIndex].viewColumn;
        if (this.tab) {
            this.state.viewColumn = this.tab.group.viewColumn;
            this.tabGroupIndex = vscode.window.tabGroups.all.indexOf(this.tab.group);
            this.tabIndex = this.tab.group.tabs.indexOf(this.tab);
            if (this.hasCounterpart) {
                this.state.tabIndex = this.tabIndex;
            }
        }
        workspaceState.commit();

        const activeTabGroup = vscode.window.tabGroups.activeTabGroup;
        if (activeTabGroup.viewColumn === this.state.sourceViewColumn) {
            const input = activeTabGroup.activeTab?.input;
            if (input instanceof vscode.TabInputText) {
                this.update(input.uri);
            }
        }
    }

    /**
     * Updates the Assistant Editor in response to relevant tab group changes.
     */
    async updateTabGroups(event: vscode.TabGroupChangeEvent) {
        if (event.closed.some(group => group.viewColumn === this.state.viewColumn)) {
            this.tab = undefined;
            this.dispose();
        } else if (event.closed.some(group => group.viewColumn === this.state.sourceViewColumn)) {
            this.dispose();
        } else {
            // VSCode invalidates Tab objects when a new group is opened
            // (multiple times; a second event that says that all of the groups
            // “changed” also invalidates everything again), so it is necessary
            // to recover it by index every time there is a tab group event 😩
            if (this.tab) {
                const group = vscode.window.tabGroups.all[this.tabGroupIndex];
                this.tab = group.tabs[this.tabIndex];

                if (!this.tab) {
                    console.error("invalidated tab lost forever");
                    this.dispose();
                    return;
                }
            }

            // This has to be done in both tab group and tab update events
            // because if a tab is made active by clicking on it, the tab active
            // state is updated first and then the tab group active state is
            // updated second, so the tab group being activated will not be seen
            // as active at the time the tab change event occurs and the
            // Assistant Editor will not update itself
            this.updateFromActiveTab();
        }
    }

    /**
     * Updates the Assistant Editor in response to relevant tab changes.
     */
    async updateTabs(event: vscode.TabChangeEvent) {
        if (this.tab && event.closed.some(tab => tab === this.tab)) {
            this.tab = undefined;
            this.dispose();
            return;
        }

        // VSCode will send multiple tab change events instead of coalescing
        // them, so the one where a tab is opened is the one that should be a
        // new Assistant Editor tab
        if (this.inViewSwitch && event.opened.length === 1) {
            const oldTab = this.tab;
            this.tab = event.opened[0];
            this.inViewSwitch = false;

            // Close the tab only after the new one is shown to avoid the
            // situation where the whole view column disappears for a frame if
            // there are no other tabs in it. It sure would be better if the tab
            // content could just be replaced, but there is no API for that as
            // of 1.75.
            // If the user cancels the save confirmation then we will just let
            // the tab become a detached editor
            // TODO: Maybe add a preference to auto-save the content of the
            // Assistant Editor instead if it is dirty so this cannot happen?
            if (oldTab) {
                vscode.window.tabGroups.close(oldTab, false);
            }
        }

        this.updateFromActiveTab();
    }
}

/**
 * Anonymous options object extracted from the signature of
 * {@link vscode.createWebviewPanel}.
 */
interface VsCodeCreateWebviewPanelOptions {
    readonly viewColumn: vscode.ViewColumn;
    readonly preserveFocus?: boolean;
}

/**
 * Creates an empty webview to display in the Assistant Editor when no
 * counterpart file is found.
 */
function emptyEditor(options: VsCodeCreateWebviewPanelOptions) {
    const panel = vscode.window.createWebviewPanel(
        'C_Cpp.AssistantEditor',
        localize("assistant.editor.empty.tab.label", "Assistant"),
        options
    );
    panel.webview.html = `<!DOCTYPE html><meta charset="utf-8">
        <style>html {
            align-items: center;
            display: flex;
            justify-content: center;
            font-weight: bold;
            height: 100%;
        }</style>
        ${localize("no.counterpart.found", "No counterpart found")}`;
    return panel;
}

/**
 * Tries to find and load the counterpoint {@link vscode.TextDocument}
 * for a given URI.
 *
 * @param uri The URI for which a counterpart should be loaded.
 * @returns A promise that resolves to the counterpart document.
 */
async function loadDocument(uri: vscode.Uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    if (isCppToolsFile(document)) {
        const path = vscode.workspace.asRelativePath(uri);
        const ext = pathUtil.extname(path);

        const candidates = await vscode.workspace.findFiles(
            path.slice(0, path.length - ext.length) + '*',
            path
        );

        const isCounterpart = isHeaderFile(uri) ? isCppOrCFile : isHeaderFile;
        const targetFileName = candidates.find(isCounterpart)?.fsPath;
        if (targetFileName) {
            return vscode.workspace.openTextDocument(targetFileName);
        }
    }
}

/**
 * State information for an Assistant Editor that is persisted across reloads.
 */
class PersistentState {
    /**
     * Constant used when the Assistant Editor was not attached to any text
     * editor.
     * This should match the value returned by `Array#indexOf`.
     */
    static readonly NoTextEditor = -1;

    /**
     * The view column containing the main editors that the Assistant Editor is
     * listening for.
     */
    sourceViewColumn: vscode.ViewColumn = vscode.ViewColumn.Active;

    /**
     * The view column containing the Assistant Editor.
     */
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside;

    /**
     * The index of the Assistant Editor tab within its tab group if it is
     * attached to a text editor, or {@link PersistentState.NoTextEditor} if it
     * is not.
     */
    tabIndex: number = PersistentState.NoTextEditor;
}

/**
 * Persistent Assistant Editor data storage.
 */
const workspaceState = (function() {
    /**
     * @returns the backing store.
     */
    const storage = (function () {
        // This is lazy-loaded because the PersistentWorkspaceState must be
        // constructed only after the workspace state is initialised
        let storage: PersistentWorkspaceState<PersistentState[]> | undefined;

        return function() {
            if (!storage) {
                storage = new PersistentWorkspaceState<PersistentState[]>("CPP.assistantEditor", []);
            }
            return storage;
        };
    })();

    return {
        /**
         * Clears the backing store. This change is automatically committed.
         */
        clear() {
            storage().setDefault();
        },

        /**
         * Commits all state changes to the backing store.
         */
        commit() {
            storage().Value = storage().Value;
        },

        /**
         * Adds a persistent state to the backing store. This change is
         * automatically committed.
         * @param state a new state to add.
         */
        push(state: PersistentState) {
            storage().Value = [ ...storage().Value, state ];
        },

        /**
         * Removes a persistent state from the backing store. This change is
         * automatically committed.
         * @param state the state to remove.
         */
        remove(state: PersistentState) {
            storage().Value = storage().Value.filter(stored => stored !== state);
        },

        /**
         * Gets a list of all stored states.
         * @returns all stored states.
         */
        values() {
            return storage().Value;
        }
    };
})();
