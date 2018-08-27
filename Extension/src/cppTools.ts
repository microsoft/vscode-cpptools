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
        if (version > Version.latest) {
            console.warn(`Version ${version} is not supported by this version of cpptools. Using ${Version.latest} instead.`);
            version = Version.latest;
        }
        this.version = version;
    }

    public getVersion(): Version {
        return this.version;
    }

    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        if (providers.add(provider, this.version)) {
            let added: CustomConfigurationProvider1 = providers.get(provider);
            this.providers.push(added);
            LanguageServer.getClients().forEach(client => client.onRegisterCustomConfigurationProvider(added));
        }
    }

    notifyReady(provider: CustomConfigurationProvider): void {
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        let p: CustomConfigurationProvider1 = providers.get(provider);

        if (p) {
            p.isReady = true;
            LanguageServer.getClients().forEach(client => {
                client.updateCustomConfigurations(p);
                client.updateCustomBrowseConfiguration(p);
            });
        } else {
            console.assert(false, "provider should be registered before signaling it's ready to provide configurations");
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

    didChangeCustomBrowseConfiguration(provider: CustomConfigurationProvider): void {
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        let p: CustomConfigurationProvider1 = providers.get(provider);

        if (p) {
            LanguageServer.getClients().forEach(client => client.updateCustomBrowseConfiguration(p));
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
