/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CustomConfigurationProvider, Version } from 'vscode-cpptools';
import { CppToolsTestApi, CppToolsTestHook } from 'vscode-cpptools/out/testApi';
import { CustomConfigurationProvider1, getCustomConfigProviders, CustomConfigurationProviderCollection } from './LanguageServer/customProviders';
import { getOutputChannel } from './logger';
import * as LanguageServer from './LanguageServer/extension';
import * as test from './testHook';

export class CppTools implements CppToolsTestApi {
    private version: Version;
    private providers: CustomConfigurationProvider1[] = [];
    private failedRegistrations: CustomConfigurationProvider[] = [];
    private timers = new Map<string, NodeJS.Timer>();

    constructor(version: Version) {
        if (version > Version.latest) {
            console.warn(`version ${version} is not supported by this version of cpptools`);
            console.warn(`  using ${Version.latest} instead`);
            version = Version.latest;
        }
        this.version = version;
    }

    private addNotifyReadyTimer(provider: CustomConfigurationProvider1): void {
        if (this.version >= Version.v2) {
            const timeout: number = 30;
            let timer: NodeJS.Timer = setTimeout(() => {
                console.warn(`registered provider ${provider.extensionId} did not call 'notifyReady' within ${timeout} seconds`);
            }, timeout * 1000);
            this.timers.set(provider.extensionId, timer);
        }
    }

    private removeNotifyReadyTimer(provider: CustomConfigurationProvider1): void {
        if (this.version >= Version.v2) {
            let timer: NodeJS.Timer = this.timers.get(provider.extensionId);
            if (timer) {
                this.timers.delete(provider.extensionId);
                clearTimeout(timer);
            }
        }
    }

    public getVersion(): Version {
        return this.version;
    }

    public registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        if (providers.add(provider, this.version)) {
            let added: CustomConfigurationProvider1 = providers.get(provider);
            getOutputChannel().appendLine(`Custom configuration provider '${added.name}' registered`);
            this.providers.push(added);
            LanguageServer.getClients().forEach(client => client.onRegisterCustomConfigurationProvider(added));
            this.addNotifyReadyTimer(added);
        } else {
            this.failedRegistrations.push(provider);
        }
    }

    public notifyReady(provider: CustomConfigurationProvider): void {
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        let p: CustomConfigurationProvider1 = providers.get(provider);

        if (p) {
            this.removeNotifyReadyTimer(p);
            p.isReady = true;
            LanguageServer.getClients().forEach(client => {
                client.updateCustomConfigurations(p);
                client.updateCustomBrowseConfiguration(p);
            });
        } else if (this.failedRegistrations.find(p => p === provider)) {
            console.warn("provider not successfully registered, 'notifyReady' ignored");
        } else {
            console.warn("provider should be registered before signaling it's ready to provide configurations");
        }
    }

    public didChangeCustomConfiguration(provider: CustomConfigurationProvider): void {
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        let p: CustomConfigurationProvider1 = providers.get(provider);

        if (p) {
            if (!p.isReady) {
                console.warn("didChangeCustomConfiguration was invoked before notifyReady");
            }
            LanguageServer.getClients().forEach(client => client.updateCustomConfigurations(p));
        } else if (this.failedRegistrations.find(p => p === provider)) {
            console.warn("provider not successfully registered, 'didChangeCustomConfiguration' ignored");
        } else {
            console.warn("provider should be registered before sending config change messages");
        }
    }

    public didChangeCustomBrowseConfiguration(provider: CustomConfigurationProvider): void {
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();
        let p: CustomConfigurationProvider1 = providers.get(provider);

        if (p) {
            LanguageServer.getClients().forEach(client => client.updateCustomBrowseConfiguration(p));
        } else if (this.failedRegistrations.find(p => p === provider)) {
            console.warn("provider not successfully registered, 'didChangeCustomBrowseConfiguration' ignored");
        } else {
            console.warn("provider should be registered before sending config change messages");
        }
    }

    public dispose(): void {
        this.providers.forEach(provider => {
            getCustomConfigProviders().remove(provider);
            provider.dispose();
        });
        this.providers = [];
    }

    public getTestHook(): CppToolsTestHook {
        return test.getTestHook();
    }
}
