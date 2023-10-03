/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { identifyToolset } from '../../ToolsetDetection/detection';
import { IntelliSenseConfiguration } from '../../ToolsetDetection/interfaces';
import { is } from '../../Utility/System/guards';
import { add } from '../../Utility/System/set';
import { structuredClone } from '../../Utility/System/structuredClone';
import { DefaultClient } from '../client';
import { Configuration } from '../configurations';

export class IntellisenseConfiguration {

    constructor(protected client: DefaultClient, protected configuration: Configuration) {

    }

    async getBaseConfiguration() {

        // first we have to send the base config
        const baseConfiguration = {
            enableNewIntellisense: true,
            ...structuredClone(this.configuration),
            // we don't want the server to handle any configuration provider or compile commands.
            configurationProvider: undefined,
            compileCommands: undefined

        } as Configuration;

        //* await client.patchConfigurationForNewIntellisense(baseConfiguration);

        return baseConfiguration;
    }

    mergeBrowseInfo(browseInfo: {browsePaths: Set<string>; systemPaths: Set<string>; userFrameworks: Set<string>; systemFrameworks: Set<string>}, intellisense: IntelliSenseConfiguration) {
        // add include paths to the browse paths
        add(browseInfo.browsePaths, intellisense.path?.quoteInclude);
        add(browseInfo.browsePaths, intellisense.path?.include);
        add(browseInfo.browsePaths, intellisense.path?.afterInclude);
        add(browseInfo.browsePaths, intellisense.path?.externalInclude);
        add(browseInfo.browsePaths, intellisense.path?.environmentInclude);

        // add system include and built-in paths to the system paths
        add(browseInfo.systemPaths, intellisense.path?.systemInclude);
        add(browseInfo.systemPaths, intellisense.path?.builtInInclude);

        // add frameworks to the user frameworks.
        add(browseInfo.userFrameworks, intellisense.path?.framework);
    }

    async probeForBrowseInfo(browseInfo: {browsePaths: Set<string>; systemPaths: Set<string>; userFrameworks: Set<string>; systemFrameworks: Set<string>}, compilerPath: string | undefined, compilerArgs: string[] | undefined): Promise<void> {
        if (compilerPath) {
            using toolset = await identifyToolset(compilerPath);
            if (toolset) {
                // todo: support compilerFragments args too
                let intellisense = await toolset.getIntellisenseConfiguration(compilerArgs ?? [], { userIntellisenseConfiguration: is.object(this.configuration.intellisense) ? this.configuration.intellisense : undefined});
                intellisense = toolset.harvestFromConfiguration(this.configuration, intellisense);
                this.mergeBrowseInfo(browseInfo, intellisense);
            }
        }
    }
}
