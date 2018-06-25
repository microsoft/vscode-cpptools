/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CustomConfigurationProvider, Version, SourceFileConfigurationItem } from 'vscode-cpptools';
import * as vscode from 'vscode';

/**
 * An interface that is guaranteed to be backward compatible with version 0
 */
export interface CustomConfigurationProvider1 extends CustomConfigurationProvider {
    isValid: boolean;
    version: Version;
}

/**
 * Wraps the incoming CustomConfigurationProvider so that we can treat all of them as if they were the same version (e.g. latest)
 */
class CustomProviderWrapper implements CustomConfigurationProvider1 {
    private provider: CustomConfigurationProvider;
    private _version: Version;

    constructor(provider: CustomConfigurationProvider, version: Version) {
        this.provider = provider;
        if (provider.extensionId && version === Version.v0) {
            version = Version.v1;   // provider implemented the new API but is interfacing with the extension using the old API version.
        }
        this._version = version;
    }

    public get isValid(): boolean {
        let valid: boolean = true;
        if (!this.provider.name || !this.provider.canProvideConfiguration || !this.provider.provideConfigurations) {
            valid = false;
        }
        if (this._version !== Version.v0) {
            if (!this.provider.extensionId || !this.provider.dispose) {
                valid = false;
            }
        }
        return valid;
    }

    public get version(): Version {
        return this._version;
    }

    public get name(): string {
        return this.provider.name;
    }

    public get extensionId(): string {
        return this._version === Version.v0 ? this.provider.name : this.provider.extensionId;
    }

    public canProvideConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken): Thenable<boolean> {
        return this.provider.canProvideConfiguration(uri, token);
    }

    public provideConfigurations(uris: vscode.Uri[], token?: vscode.CancellationToken): Thenable<SourceFileConfigurationItem[]> {
        return this.provider.provideConfigurations(uris, token);
    }

    public dispose(): void {
        if (this._version !== Version.v0) {
            this.provider.dispose();
        }
    }
}

export class CustomConfigurationProviderCollection {
    private providers: Map<string, CustomProviderWrapper> = new Map<string, CustomProviderWrapper>();

    private logProblems(provider: CustomConfigurationProvider, version: Version): void {
        let missing: string[] = [];
        if (!provider.name) {
            missing.push("'name'");
        }
        if (version !== Version.v0 && !provider.extensionId) {
            missing.push("'extensionId'");
        }
        if (!provider.canProvideConfiguration) {
            missing.push("'canProvideConfiguration'");
        }
        if (!provider.provideConfigurations) {
            missing.push("'canProvideConfiguration'");
        }
        if (version !== Version.v0 && !provider.dispose) {
            missing.push("'dispose'");
        }
        console.error(`CustomConfigurationProvider was not registered. The following properties are missing from the implementation: ${missing.join(", ")}`);
    }

    private getId(provider: string|CustomConfigurationProvider): string {
        if (typeof provider === "string") {
            return provider;
        } else if (provider.extensionId) {
            return provider.extensionId;
        } else if (provider.name) {
            return provider.name;
        } else {
            console.error(`invalid provider: ${provider}`);
            return "";
        }
    }

    public get size(): number {
        return this.providers.size;
    }

    public add(provider: CustomConfigurationProvider, version: Version): boolean {
        let wrapper: CustomProviderWrapper = new CustomProviderWrapper(provider, version);
        if (!wrapper.isValid) {
            this.logProblems(provider, version);
            return false;
        }

        let exists: boolean = this.providers.has(wrapper.extensionId);
        if (exists) {
            let existing: CustomProviderWrapper = this.providers.get(wrapper.extensionId);
            exists = (existing.version === Version.v0 && wrapper.version === Version.v0);
        }
    
        if (!exists) {
            this.providers.set(wrapper.extensionId, wrapper);
        } else {
            console.error(`CustomConfigurationProvider '${wrapper.extensionId}' has already been registered.`);
        }
        return !exists;
    }

    public get(provider: string|CustomConfigurationProvider): CustomConfigurationProvider1|null {
        let id: string = this.getId(provider);

        if (this.providers.has(id)) {
            return this.providers.get(id);
        }
        return null;
    }

    public forEach(func: (provider: CustomConfigurationProvider1) => void): void {
        this.providers.forEach(provider => func(provider));
    }

    public remove(provider: CustomConfigurationProvider): void {
        let id: string = this.getId(provider);
        if (this.providers.has(id)) {
            this.providers.delete(id);
        } else {
            console.warn(`${id} is not registered`);
        }
    }
}

let providerCollection: CustomConfigurationProviderCollection = new CustomConfigurationProviderCollection();

export function getCustomConfigProviders(): CustomConfigurationProviderCollection {
    return providerCollection;
}