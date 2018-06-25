/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CustomConfigurationProvider, Version } from 'vscode-cpptools';
import { CppToolsTestApi, CppToolsTestHook } from 'vscode-cpptools/out/testApi';
import { CustomConfigurationProviderInternal, CustomProviderWrapper } from './LanguageServer/customProviders';
import * as LanguageServer from './LanguageServer/extension';
import * as test from './testHook';

export class CppTools implements CppToolsTestApi {
    private version: Version;
    private providers: CustomConfigurationProviderInternal[] = [];

    constructor(version: Version) {
        this.version = version;
    }

    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        let wrapper: CustomProviderWrapper = new CustomProviderWrapper(provider, this.version);
        if (wrapper.isValid) {
            this.providers.push(wrapper);
            LanguageServer.registerCustomConfigurationProvider(wrapper);
        } else {
            let missing: string[] = [];
            if (!provider.name) {
                missing.push("'name'");
            }
            if (this.version !== Version.v0 && !provider.extensionId) {
                missing.push("'extensionId'");
            }
            if (!provider.canProvideConfiguration) {
                missing.push("'canProvideConfiguration'");
            }
            if (!provider.provideConfigurations) {
                missing.push("'canProvideConfiguration'");
            }
            if (this.version !== Version.v0 && !provider.dispose) {
                missing.push("'dispose'");
            }
            console.error(`CustomConfigurationProvider was not registered. The following properties are missing from the implementation: ${missing.join(", ")}`);
        }
    }

    didChangeCustomConfiguration(provider: CustomConfigurationProvider): void {
        let wrapper: CustomConfigurationProviderInternal = this.providers.find(p => {
            let result: boolean = p.name === provider.name;
            if (result && this.version !== Version.v0) {
                result = p.extensionId === provider.extensionId;
            }
            return result;
        });

        if (wrapper) {
            LanguageServer.onDidChangeCustomConfiguration(wrapper);
        } else {
            console.assert(false, "provider should be registered before sending config change messages");
        }
    }

    dispose(): void {
        this.providers.forEach(provider => {
            LanguageServer.unregisterCustomConfigurationProvider(provider);
            provider.dispose();
        });
        this.providers = [];
    }

    getTestHook(): CppToolsTestHook {
        return test.getTestHook();
    }
}
