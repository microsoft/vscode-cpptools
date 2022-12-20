/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Client } from './client';
import * as nls from 'vscode-nls';
import { NewUI } from './ui_new';
import { OldUI } from './ui_old';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();

let ui: UI;

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
        ui = true ? new NewUI() : new OldUI();
    }
    return ui;
}
