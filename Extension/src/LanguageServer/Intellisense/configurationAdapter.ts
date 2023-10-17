/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import EventEmitter = require('events');
import { CancellationToken, Uri } from 'vscode';
import { SourceFileConfigurationItem, Version, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { identifyToolset } from '../../ToolsetDetection/detection';
import { IntelliSenseConfiguration } from '../../ToolsetDetection/interfaces';
import { ManualPromise } from '../../Utility/Async/manualPromise';
import { is } from '../../Utility/System/guards';
import { addNormalizedPath } from '../../Utility/System/set';
import { structuredClone } from '../../Utility/System/structuredClone';
import { DefaultClient } from '../client';
import { Configuration } from '../configurations';
import { ExtendedBrowseInformation, IntellisenseConfigurationAdapter } from './interfaces';

export abstract class ConfigurationAdapter extends EventEmitter implements IntellisenseConfigurationAdapter {

    browseInfo = {
        browsePaths: new Set<string>(),
        systemPaths:  new Set<string>(),
        userFrameworks: new Set<string>(),
        systemFrameworks: new Set<string>()
    };

    constructor(protected client: DefaultClient, protected configuration: Configuration) {
        super();
    }
    abstract isReady: boolean;
    abstract isValid: boolean;
    abstract version: Version;
    abstract name: string;
    abstract extensionId: string;
    abstract canProvideConfiguration(uri: Uri, token?: CancellationToken | undefined): Thenable<boolean>;

    abstract provideConfigurations(uris: Uri[], token?: CancellationToken | undefined): Thenable<SourceFileConfigurationItem[]>;

    abstract canProvideBrowseConfiguration(token?: CancellationToken | undefined): Thenable<boolean>;

    abstract provideBrowseConfiguration(token?: CancellationToken | undefined): Thenable<WorkspaceBrowseConfiguration | null>;

    abstract canProvideBrowseConfigurationsPerFolder(token?: CancellationToken | undefined): Thenable<boolean>;

    abstract provideFolderBrowseConfiguration(uri: Uri, token?: CancellationToken | undefined): Thenable<WorkspaceBrowseConfiguration | null> ;
    abstract dispose(): void ;
    abstract getSourceFiles(): Promise<Uri[]> ;
    abstract getHeaderFiles(): Promise<Uri[]> ;

    #compilerArgs: string[] | undefined;
    get compilerArgs(): string[] | undefined {
        return this.#compilerArgs ?? (this.#compilerArgs = this.configuration.compilerArgs);
    }
    set compilerArgs(compilerArgs: string[] | undefined) {
        this.#compilerArgs = compilerArgs;
    }

    initialized = new ManualPromise<void>();

    #compiler: string | undefined;
    get compiler(): string | undefined {
        return this.#compiler ?? (this.#compiler = this.configuration.compiler ?? this.configuration.compilerPath);
    }
    set compiler(compiler: string | undefined) {
        this.#compiler = compiler;
    }

    async getBaseConfiguration() {
        await this.initialized;

        // first we have to send the base config
        const baseConfiguration = {
            enableNewIntellisense: true,
            ...structuredClone(this.configuration)
            // we don't want the server to handle any configuration provider or compile commands.
        } as Configuration;

        delete baseConfiguration.configurationProvider;
        delete baseConfiguration.compileCommands;
        delete baseConfiguration.compileCommandsInCppPropertiesJson;

        baseConfiguration.browse = baseConfiguration.browse ?? {};
        addNormalizedPath(this.browseInfo.browsePaths, baseConfiguration.browse.path);

        await this.probeForBrowseInfo(this.compiler, this.compilerArgs);

        baseConfiguration.browse.path = [...this.browseInfo.browsePaths];

        // if we don't have a toolset, let's see if we can pick one;
        /*!
        if (!this.compiler) {
            log(`No compiler specified for new Intellisense?`);
            // can we get provided one?

        } else {
            // the user has specifically set the compiler name/path
            const toolset = await identifyToolset(this.compiler);
            if (toolset) {
                baseConfiguration.intellisense = await toolset.getIntellisenseConfiguration(this.compilerArgs || [], { userIntellisenseConfiguration: baseConfiguration.intellisense});
            }
        }
*/
        return baseConfiguration;
    }

    mergeBrowseInfo(intellisense: IntelliSenseConfiguration) {
        // add include paths to the browse paths
        addNormalizedPath(this.browseInfo.browsePaths, intellisense.path?.quoteInclude);
        addNormalizedPath(this.browseInfo.browsePaths, intellisense.path?.include);
        addNormalizedPath(this.browseInfo.browsePaths, intellisense.path?.afterInclude);
        addNormalizedPath(this.browseInfo.browsePaths, intellisense.path?.externalInclude);
        addNormalizedPath(this.browseInfo.browsePaths, intellisense.path?.environmentInclude);

        // add system include and built-in paths to the system paths
        addNormalizedPath(this.browseInfo.systemPaths, intellisense.path?.systemInclude);
        addNormalizedPath(this.browseInfo.systemPaths, intellisense.path?.builtInInclude);

        // add frameworks to the user frameworks.
        addNormalizedPath(this.browseInfo.userFrameworks, intellisense.path?.framework);
    }

    async probeForBrowseInfo(compilerPath: string | undefined, compilerArgs: string[] | undefined): Promise<void> {
        if (compilerPath) {
            using toolset = await identifyToolset(compilerPath);
            if (toolset) {
                // todo: support compilerFragments args too
                let intellisense = await toolset.getIntellisenseConfiguration(compilerArgs ?? [], { userIntellisenseConfiguration: is.object(this.configuration.intellisense) ? this.configuration.intellisense : undefined});
                intellisense = toolset.harvestFromConfiguration(this.configuration, intellisense);
                this.mergeBrowseInfo(intellisense);
            }
        }
    }

    override on(event: 'configuration', listener: (key: string, value: IntelliSenseConfiguration) => void): this;
    override on(event: 'done', listener: () => void): this;
    override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.on(eventName, listener);
    }

    override once(event: 'configuration', listener: (key: string, value: IntelliSenseConfiguration) => void): this;
    override once(event: 'done', listener: () => void): this;
    override once(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return super.once(eventName, listener);
    }

    async getExtendedBrowseInformation(_token: CancellationToken): Promise<ExtendedBrowseInformation> {
        return {
            browsePath: [...this.browseInfo.browsePaths],
            systemPath: [...this.browseInfo.systemPaths],
            userFrameworks: [...this.browseInfo.userFrameworks],
            systemFrameworks: [...this.browseInfo.systemFrameworks]
        };
    }
}
