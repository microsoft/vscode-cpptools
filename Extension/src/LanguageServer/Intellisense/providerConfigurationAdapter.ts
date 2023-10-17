/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { dirname } from 'path';

import { CancellationToken, Uri } from 'vscode';
import { SourceFileConfigurationItem, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { getOrAdd } from '../../Utility/System/map';
import { addNormalizedPath } from '../../Utility/System/set';
import { DefaultClient, InternalWorkspaceBrowseConfiguration } from '../client';
import { Configuration } from '../configurations';
import { CustomConfigurationProvider1 } from '../customProviders';
import { ConfigurationAdapter } from './configurationAdapter';
import { ExtendedBrowseInformation, IntellisenseConfigurationAdapter } from './interfaces';

export class ProviderConfigurationAdapter extends ConfigurationAdapter implements IntellisenseConfigurationAdapter {
    private constructor(client: DefaultClient, private provider: CustomConfigurationProvider1, configuration: Configuration) {
        super(client, configuration);
    }
    static instances = new Map<CustomConfigurationProvider1, ProviderConfigurationAdapter>();

    static async getProvider(client: DefaultClient, provider: CustomConfigurationProvider1 | undefined, configuration: Configuration): Promise<IntellisenseConfigurationAdapter | undefined> {
        if (!provider) {
            return undefined;
        }

        return getOrAdd(this.instances, provider, () => new ProviderConfigurationAdapter(client, provider, configuration));
    }

    async getSourceFiles(): Promise<Uri[]> {
        if ('getSourceFiles' in this.provider) {
            return (this.provider as any).getSourceFiles();
        }
        // if we don't have a provider that has 'getSourceFiles', we have to find the files ourselves.

        return [];
    }
    async getHeaderFiles(): Promise<Uri[]> {
        if ('getHeaderFiles' in this.provider) {
            return (this.provider as any).getHeaderFiles();
        }

        // if we don't have a provider that has 'getSourceFiles', we have to find the files ourselves.

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
    override async getExtendedBrowseInformation(token: CancellationToken): Promise<ExtendedBrowseInformation> {
        const browseConfig = await this.provideBrowseConfiguration();

        if (browseConfig) {
            // got a browse config

            // we expanded the kinds of paths to include the system, user frameworks, etc.
            // so a very enlightened provider give us all the information we need
            addNormalizedPath(this.browseInfo.browsePaths, browseConfig.browsePath);
            addNormalizedPath(this.browseInfo.systemPaths, (browseConfig as InternalWorkspaceBrowseConfiguration).systemPath);
            addNormalizedPath(this.browseInfo.userFrameworks, (browseConfig as InternalWorkspaceBrowseConfiguration).userFrameworks);
            addNormalizedPath(this.browseInfo.systemFrameworks, (browseConfig as InternalWorkspaceBrowseConfiguration).systemFrameworks);

            // if we have a compilerPath, we can use that to find the system paths.
            await this.probeForBrowseInfo(browseConfig.compilerPath, browseConfig.compilerArgs);
        }

        // if we are not given any browsePaths, we have to find the browse paths ourselves.
        if (this.browseInfo.browsePaths.size === 0) {
            // we assume that any folders that source files are in are part of the browse path.
            const sourceFiles = await this.getSourceFiles();
            sourceFiles.map(each => addNormalizedPath(this.browseInfo.browsePaths, dirname(each.fsPath)));

            // if we can get a compiler for the source files, we can use that to query for system paths.
            const configurations = await this.provideConfigurations(sourceFiles, token);

            // todo: I don't like this. we could have hundreds or even thousands of source files.
            // todo: and add in cancellation support for this too.
            await Promise.all(configurations.map(config => this.probeForBrowseInfo(config.configuration.compilerPath, config.configuration.compilerArgs)));
        }

        // we have to find the system/frameworks/etc paths ourselves.

        return super.getExtendedBrowseInformation(token);
    }
}
