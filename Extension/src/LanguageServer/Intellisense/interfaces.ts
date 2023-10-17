/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { CancellationToken, Uri } from 'vscode';
import { IntelliSenseConfiguration } from '../../ToolsetDetection/interfaces';
import { Configuration } from '../configurations';
import { CustomConfigurationProvider1 } from '../customProviders';
import EventEmitter = require('events');

export interface ExtendedBrowseInformation {
    browsePath: string[];
    systemPath: string[];
    userFrameworks: string[];
    systemFrameworks: string[];
}

export interface IntellisenseConfigurationAdapter extends EventEmitter, CustomConfigurationProvider1 {
    readonly initialized: Promise<void>;

    // source files, aka 'translation units'
    getSourceFiles(): Promise<Uri[]>;

    // header files, aka 'include'd files'
    getHeaderFiles(): Promise<Uri[]>;

    getExtendedBrowseInformation(token: CancellationToken): Promise<ExtendedBrowseInformation>;
    getBaseConfiguration(token: CancellationToken): Promise<Configuration>;

    // events
    on(event: 'configuration', listener: (key: string, value: IntelliSenseConfiguration) => void): this;
    on(event: 'done', listener: () => void): this;

    once(event: 'configuration', listener: (key: string, value: IntelliSenseConfiguration) => void): this;
    once(event: 'done', listener: () => void): this;

}

