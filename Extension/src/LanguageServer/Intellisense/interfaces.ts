/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { CancellationToken } from 'vscode';
import { Configuration } from '../configurations';
import { CustomConfigurationProvider7 } from '../customProviders';

export interface ExtendedBrowseInformation {
    browsePath: string[];
    systemPath: string[];
    userFrameworks: string[];
    systemFrameworks: string[];
}

export interface IntellisenseConfigurationProvider extends CustomConfigurationProvider7 {
    getExtendedBrowseInformation(token: CancellationToken): Promise<ExtendedBrowseInformation>;
    getBaseConfiguration(token: CancellationToken): Promise<Configuration>;
}

