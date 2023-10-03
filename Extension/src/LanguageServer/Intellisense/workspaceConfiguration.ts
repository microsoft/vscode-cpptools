/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { dirname } from "path";
import { CancellationToken, Uri } from 'vscode';
import { SourceFileConfiguration, SourceFileConfigurationItem, WorkspaceBrowseConfiguration } from "vscode-cpptools";
import { identifyToolset } from '../../ToolsetDetection/detection';
import { fastFind } from "../../Utility/Filesystem/ripgrep";
import { is } from '../../Utility/System/guards';
import { getOrAdd } from "../../Utility/System/map";
import { sources } from '../../constants';
import { DefaultClient } from "../client";
import { Configuration } from '../configurations';
import { IntellisenseConfiguration } from './intellisenseConfiguration';
import { ExtendedBrowseInformation, IntellisenseConfigurationProvider } from './interfaces';
/* eslint-disable @typescript-eslint/no-unused-vars */

export class WorkspaceCofigurationProvider extends IntellisenseConfiguration implements IntellisenseConfigurationProvider {
    private sourceFiles!: Uri[];
    private browsePath!: string[];

    private ready: Promise<void>;

    private constructor(client: DefaultClient, configuration: Configuration) {
        super(client, configuration);
        this.ready = this.init();
    }
    static instances = new Map<DefaultClient, WorkspaceCofigurationProvider>();

    static async getProvider(client: DefaultClient, configuration: Configuration): Promise<IntellisenseConfigurationProvider> {
        const provider = getOrAdd(this.instances, client, () => new WorkspaceCofigurationProvider(client, configuration));
        // ensure that if we've changed the configuration that we update this.
        provider.configuration = configuration;
        return provider;
    }

    async init() {
        // scan for files in the workspace folder
        await Promise.all([
            // get all the source files (and the )
            fastFind(sources, this.client.RootPath).then(results => {
                this.sourceFiles = results.map(each => Uri.file(each));
                this.browsePath = [...new Set(results.map(each => dirname(each)))];
            })
        ]);
    }

    async getSourceFiles(): Promise<Uri[]> {
        // scan for source (things that can be TUs) files in the workspace folder
        await this.ready;
        return this.sourceFiles;
    }

    async getHeaderFiles(): Promise<Uri[]> {
        // scan for header files in the workspace folder
        await this.ready;
        return [];
    }

    get isReady() { return true; }
    get isValid() { return true; }
    get version() { return 7; }
    get name() { return "WorkspaceConfigurationProvider"; }
    get extensionId() { return "built-in.workspaace"; }

    async canProvideConfiguration(uri: Uri, token?: CancellationToken | undefined): Promise<boolean> {
        return true;
    }

    async provideConfigurations(uris: Uri[], token?: CancellationToken | undefined): Promise<SourceFileConfigurationItem[]> {
        const compiler = this.configuration.compiler || this.configuration.compilerPath;
        if (compiler) {
            using toolset = await identifyToolset(compiler);

            if (toolset) {
                const intellisense = await toolset.getIntellisenseConfiguration(this.configuration.compilerArgs ?? [], { userIntellisenseConfiguration: is.object(this.configuration.intellisense) ? this.configuration.intellisense : undefined});
                //* cfg.intellisense = toolset.harvestFromConfiguration(cfg, intellisense);
                return uris.map(uri => ({
                    uri: uri,
                    configuration: { intellisense } as unknown as SourceFileConfiguration
                } as SourceFileConfigurationItem));
            }
        }
        return [];
    }

    async canProvideBrowseConfiguration(token?: CancellationToken | undefined): Promise<boolean> {
        return true;
    }

    async provideBrowseConfiguration(token?: CancellationToken | undefined): Promise<WorkspaceBrowseConfiguration | null> {
        return { browsePath: this.browsePath };
    }

    async canProvideBrowseConfigurationsPerFolder(token?: CancellationToken | undefined): Promise<boolean> {
        return false;
    }

    async provideFolderBrowseConfiguration(uri: Uri, token?: CancellationToken | undefined): Promise<WorkspaceBrowseConfiguration | null> {
        return { browsePath: [] };
    }

    dispose() {
    }
    async getExtendedBrowseInformation(token: CancellationToken): Promise<ExtendedBrowseInformation> {
        return {
            browsePath: this.browsePath,
            systemPath: [],
            userFrameworks: [],
            systemFrameworks: []
        };
    }
}
