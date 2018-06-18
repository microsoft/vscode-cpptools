/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CppToolsApi, CustomConfigurationProvider } from './api';
import * as LanguageServer from './LanguageServer/extension';

export class CppTools implements CppToolsApi {
    private providers: CustomConfigurationProvider[] = [];

    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        if (provider.name && provider.extensionId && provider.canProvideConfiguration && provider.provideConfigurations && provider.dispose) {
            this.providers.push(provider);
            LanguageServer.registerCustomConfigurationProvider(provider);
        } else {
            let missing: string[] = [];
            if (!provider.name) {
                missing.push("'name'");
            }
            if (!provider.extensionId) {
                missing.push("'extensionId'");
            }
            if (!provider.canProvideConfiguration) {
                missing.push("'canProvideConfiguration'");
            }
            if (!provider.provideConfigurations) {
                missing.push("'canProvideConfiguration'");
            }
            if (!provider.dispose) {
                missing.push("'dispose'");
            }
            console.error(`CustomConfigurationProvider was not registered. The following properties are missing from the implementation: ${missing.join(", ")}`);
        }
    }

    didChangeCustomConfiguration(provider: CustomConfigurationProvider): void {
        LanguageServer.onDidChangeCustomConfiguration(provider);
    }

    dispose(): void {
        this.providers.forEach(provider => {
            LanguageServer.unregisterCustomConfigurationProvider(provider);
            provider.dispose();
        });
        this.providers = [];
    }
}