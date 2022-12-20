/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { Client } from './client';
import { ReferencesCommandMode, referencesCommandModeToString } from './references';
import { getCustomConfigProviders, CustomConfigurationProviderCollection, isSameProviderExtensionId } from './customProviders';
import * as nls from 'vscode-nls';
import { setTimeout } from 'timers';
import { CppSettings } from './settings';
import { NewUI } from './ui_new';
import { OldUI } from './ui_old';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

let ui: UI;

interface IndexableQuickPickItem extends vscode.QuickPickItem {
    index: number;
}
interface KeyedQuickPickItem extends vscode.QuickPickItem {
    key: string;
}

// Higher numbers mean greater priority.
enum ConfigurationPriority {
    IncludePath = 1,
    CompileCommands = 2,
    CustomProvider = 3,
}

interface ConfigurationStatus {
    configured: boolean;
    priority: ConfigurationPriority;
}

export interface UI {
    activeDocumentChanged(): void;
    bind(client: Client): void;
    showConfigurations(configurationNames: string[]): Promise<number>;
    showConfigurationProviders(currentProvider?: string): Promise<string | undefined>;
    showCompileCommands(paths: string[]): Promise<number>;
    showWorkspaces(workspaceNames: { name: string; key: string }[]): Promise<string>;
    showParsingCommands(): Promise<number>;
    showActiveCodeAnalysisCommands(): Promise<number>;
    showIdleCodeAnalysisCommands(): Promise<number>;
    showConfigureIncludePathMessage(prompt: () => Promise<boolean>, onSkip: () => void): void;
    showConfigureCompileCommandsMessage(prompt: () => Promise<boolean>, onSkip: () => void): void;
    showConfigureCustomProviderMessage(prompt: () => Promise<boolean>, onSkip: () => void): void;
    dispose(): void;
}

export function getUI(): UI {
    if (!ui) {
        ui = false ? new NewUI() : new OldUI();
    }
    return ui;
}
