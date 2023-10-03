/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { dirname } from 'path';

import { CancellationToken, Uri } from 'vscode';
import { SourceFileConfigurationItem, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { getOrAdd } from '../../Utility/System/map';
import { add } from '../../Utility/System/set';
import { DefaultClient, InternalWorkspaceBrowseConfiguration } from '../client';
import { Configuration } from '../configurations';
import { CustomConfigurationProvider1, isV7 } from '../customProviders';
import { IntellisenseConfiguration } from './intellisenseConfiguration';
import { ExtendedBrowseInformation, IntellisenseConfigurationProvider } from './interfaces';

export class ProviderConfiguration extends IntellisenseConfiguration implements IntellisenseConfigurationProvider {
    private constructor(client: DefaultClient, private provider: CustomConfigurationProvider1, configuration: Configuration) {
        super(client, configuration);
    }
    static instances = new Map<CustomConfigurationProvider1, ProviderConfiguration>();

    static async getProvider(client: DefaultClient, provider: CustomConfigurationProvider1 | undefined, configuration: Configuration): Promise<IntellisenseConfigurationProvider | undefined> {
        if (!provider) {
            return undefined;
        }

        return getOrAdd(this.instances, provider, () => new ProviderConfiguration(client, provider, configuration));
    }

    async getSourceFiles(): Promise<Uri[]> {
        if (isV7(this.provider)) {
            return this.provider.getSourceFiles();
        }
        // if we don't have a v7+ provider, we have to find the files ourselves.

        return [];
    }
    async getHeaderFiles(): Promise<Uri[]> {
        if (isV7(this.provider)) {
            return this.provider.getHeaderFiles();
        }
        return [];
    }

    get isReady() { return this.provider.isReady; }
    get isValid() { return this.provider.isValid; }
    get version() { return this.provider.version; }
    get name() { return this.provider.name; }
    get extensionId() { return this.provider.extensionId; }

    canProvideConfiguration(uri: Uri, token?: CancellationToken | undefined): Thenable<boolean> {
        return this.provider.canProvideConfiguration(uri, token);
    }
    provideConfigurations(uris: Uri[], token?: CancellationToken | undefined): Thenable<SourceFileConfigurationItem[]> {
        return this.provider.provideConfigurations(uris, token);
    }
    canProvideBrowseConfiguration(token?: CancellationToken | undefined): Thenable<boolean> {
        return this.provider.canProvideBrowseConfiguration(token);
    }
    provideBrowseConfiguration(token?: CancellationToken | undefined): Thenable<WorkspaceBrowseConfiguration | null> {
        return this.provider.provideBrowseConfiguration(token);
    }
    canProvideBrowseConfigurationsPerFolder(token?: CancellationToken | undefined): Thenable<boolean> {
        return this.provider.canProvideBrowseConfigurationsPerFolder(token);
    }
    provideFolderBrowseConfiguration(uri: Uri, token?: CancellationToken | undefined): Thenable<WorkspaceBrowseConfiguration | null> {
        return this.provider.provideFolderBrowseConfiguration(uri, token);
    }
    dispose() {
        this.provider.dispose();
    }
    async getExtendedBrowseInformation(token: CancellationToken): Promise<ExtendedBrowseInformation> {
        const browseConfig = await this.provideBrowseConfiguration();

        const browsePaths = new Set<string>();
        const systemPaths = new Set<string>();
        const userFrameworks = new Set<string>();
        const systemFrameworks = new Set<string>();

        if (browseConfig) {
            // got a browse config

            // we expanded the kinds of paths to include the system, user frameworks, etc.
            // so a very enlightened provider give us all the information we need
            add(browsePaths, browseConfig.browsePath);
            add(systemPaths, (browseConfig as InternalWorkspaceBrowseConfiguration).systemPath);
            add(userFrameworks, (browseConfig as InternalWorkspaceBrowseConfiguration).userFrameworks);
            add(systemFrameworks, (browseConfig as InternalWorkspaceBrowseConfiguration).systemFrameworks);

            // if we have a compilerPath, we can use that to find the system paths.
            await this.probeForBrowseInfo({ browsePaths, systemPaths, userFrameworks, systemFrameworks }, browseConfig.compilerPath, browseConfig.compilerArgs);
        }

        // if we are not given any browsePaths, we have to find the browse paths ourselves.
        if (browsePaths.size === 0) {
            // we assume that any folders that source files are in are part of the browse path.
            const sourceFiles = await this.getSourceFiles();
            sourceFiles.map(each => browsePaths.add(dirname(each.fsPath)));

            // if we can get a compiler for the source files, we can use that to query for system paths.
            const configurations = await this.provideConfigurations(sourceFiles, token);

            // todo: I don't like this. we could have hundreds or even thousands of source files.
            // todo: and add in cancellation support for this too.
            await Promise.all(configurations.map(config => this.probeForBrowseInfo({ browsePaths, systemPaths, userFrameworks, systemFrameworks }, config.configuration.compilerPath, config.configuration.compilerArgs)));
        }

        // we have to find the system/frameworks/etc paths ourselves.

        return {
            browsePath: [...browsePaths],
            systemPath: [...systemPaths],
            userFrameworks: [...userFrameworks],
            systemFrameworks: [...systemFrameworks]
        };
    }
}
