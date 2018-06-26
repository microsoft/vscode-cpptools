/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CustomConfigurationProvider, Version } from 'vscode-cpptools';
import { CppToolsTestApi, CppToolsTestHook } from 'vscode-cpptools/out/testApi';
import { CustomConfigurationProvider1, getCustomConfigProviders, CustomConfigurationProviderCollection } from './LanguageServer/customProviders';
import * as LanguageServer from './LanguageServer/extension';
import * as test from './testHook';

export class CppTools implements CppToolsTestApi {
    private version: Version;
    private providers: CustomConfigurationProvider1[] = [];

    constructor(version: Version) {
        this.version = version;
    }

    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        if (providers.add(provider, this.version)) {
            let added: CustomConfigurationProvider1 = providers.get(provider);
            this.providers.push(added);
            LanguageServer.getClients().forEach(client => client.onRegisterCustomConfigurationProvider(added));
        }
    }

    didChangeCustomConfiguration(provider: CustomConfigurationProvider): void {
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        let p: CustomConfigurationProvider1 = providers.get(provider);

        if (p) {
            LanguageServer.getClients().forEach(client => client.updateCustomConfigurations(p));
        } else {
            console.assert(false, "provider should be registered before sending config change messages");
        }
    }

    dispose(): void {
        this.providers.forEach(provider => {
            getCustomConfigProviders().remove(provider);
            provider.dispose();
        });
        this.providers = [];
    }

    getTestHook(): CppToolsTestHook {
        return test.getTestHook();
    }
}
