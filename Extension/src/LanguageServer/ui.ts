/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { Client } from './client';
import * as nls from 'vscode-nls';
import { NewUI } from './ui_new';
import { OldUI } from './ui_old';
import * as telemetry from '../telemetry';
import { IExperimentationService } from 'tas-client';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();

let ui: UI;

export interface UI {
    whichUI: boolean;
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

export async function getUI(): Promise<UI> {
    if (!ui) {
        const experimentationService: IExperimentationService | undefined = await telemetry.getExperimentationService();
        if (experimentationService !== undefined) {
            const useNewUI: boolean | undefined = true; // experimentationService.getTreatmentVariable<boolean>("vscode", "splitUIUsers");
            ui = useNewUI ? new NewUI() : new OldUI();
        }
    }
    return ui;
}
