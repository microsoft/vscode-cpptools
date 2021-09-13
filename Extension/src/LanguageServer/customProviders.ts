/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CustomConfigurationProvider, Version, SourceFileConfigurationItem, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { CppSettings } from './settings';
import * as ext from './extension';

/**
 * An interface that is guaranteed to be backward compatible with version 0
 */
export interface CustomConfigurationProvider1 extends CustomConfigurationProvider {
    isReady: boolean;
    readonly isValid: boolean;
    readonly version: Version;
}

const oldCmakeToolsExtensionId: string = "vector-of-bool.cmake-tools";
const newCmakeToolsExtensionId: string = "ms-vscode.cmake-tools";

/**
 * Wraps the incoming CustomConfigurationProvider so that we can treat all of them as if they were the same version (e.g. latest)
 */
class CustomProviderWrapper implements CustomConfigurationProvider1 {
    private provider: CustomConfigurationProvider;
    private _isReady: boolean;
    private _version: Version;

    constructor(provider: CustomConfigurationProvider, version: Version) {
        this._isReady = version < Version.v2;
        this.provider = provider;
        if (provider.extensionId && version === Version.v0) {
            version = Version.v1; // provider implemented the new API but is interfacing with the extension using the old API version.
        }
        this._version = version;
    }

    public get isReady(): boolean {
        return this._isReady;
    }

    public set isReady(ready: boolean) {
        this._isReady = ready;
    }

    public get isValid(): boolean {
        let valid: boolean = !!this.provider.name && !!this.provider.canProvideConfiguration && !!this.provider.provideConfigurations;
        if (valid && this._version > Version.v0) {
            valid = !!this.provider.extensionId && !!this.provider.dispose;
        }
        if (valid && this._version > Version.v1) {
            valid = !!this.provider.canProvideBrowseConfiguration && !!this.provider.provideBrowseConfiguration;
        }
        if (valid && this._version > Version.v2) {
            valid = !!this.provider.canProvideBrowseConfigurationsPerFolder && !!this.provider.provideFolderBrowseConfiguration;
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

    public canProvideBrowseConfiguration(token?: vscode.CancellationToken): Thenable<boolean> {
        return this._version < Version.v2 ? Promise.resolve(false) : this.provider.canProvideBrowseConfiguration(token);
    }

    public provideBrowseConfiguration(token?: vscode.CancellationToken): Thenable<WorkspaceBrowseConfiguration | null> {
        console.assert(this._version >= Version.v2);
        return this._version < Version.v2 ? Promise.resolve({browsePath: []}) : this.provider.provideBrowseConfiguration(token);
    }

    public canProvideBrowseConfigurationsPerFolder(token?: vscode.CancellationToken): Thenable<boolean> {
        return this._version < Version.v3 ? Promise.resolve(false) : this.provider.canProvideBrowseConfigurationsPerFolder(token);
    }

    public provideFolderBrowseConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken): Thenable<WorkspaceBrowseConfiguration | null> {
        console.assert(this._version >= Version.v3);
        return this._version < Version.v3 ? Promise.resolve({browsePath: []}) : this.provider.provideFolderBrowseConfiguration(uri, token);
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
        const missing: string[] = [];
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
        if (version >= Version.v2 && !provider.canProvideBrowseConfiguration) {
            missing.push("'canProvideBrowseConfiguration'");
        }
        if (version >= Version.v2 && !provider.provideBrowseConfiguration) {
            missing.push("'provideBrowseConfiguration'");
        }
        if (version >= Version.v3 && !provider.canProvideBrowseConfigurationsPerFolder) {
            missing.push("'canProvideBrowseConfigurationsPerFolder'");
        }
        if (version >= Version.v3 && !provider.provideFolderBrowseConfiguration) {
            missing.push("'provideFolderBrowseConfiguration'");
        }
        console.error(`CustomConfigurationProvider was not registered. The following properties are missing from the implementation: ${missing.join(", ")}.`);
    }

    private getId(provider: string | CustomConfigurationProvider): string {
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
        if (new CppSettings(ext.getActiveClient().RootUri).intelliSenseEngine === "Disabled") {
            console.warn("Language service is disabled. Provider will not be registered.");
            return false;
        }

        const wrapper: CustomProviderWrapper = new CustomProviderWrapper(provider, version);
        if (!wrapper.isValid) {
            this.logProblems(provider, version);
            return false;
        }

        let exists: boolean = false;
        const existing: CustomProviderWrapper | undefined = this.providers.get(wrapper.extensionId);
        if (existing) {
            exists = (existing.version === Version.v0 && wrapper.version === Version.v0);
        }

        if (!exists) {
            this.providers.set(wrapper.extensionId, wrapper);
        } else {
            console.error(`CustomConfigurationProvider '${wrapper.extensionId}' has already been registered.`);
        }
        return !exists;
    }

    public get(provider: string | CustomConfigurationProvider): CustomConfigurationProvider1 | undefined {
        let id: string = this.getId(provider);

        if (this.providers.has(id)) {
            return this.providers.get(id);
        }

        if (typeof provider === "string") {
            // Consider old and new names for cmake-tools as equivalent
            if (provider === newCmakeToolsExtensionId) {
                id = oldCmakeToolsExtensionId;
            } else if (provider === oldCmakeToolsExtensionId) {
                id = newCmakeToolsExtensionId;
            }
            if (this.providers.has(id)) {
                return this.providers.get(id);
            }
        }
        return undefined;
    }

    public forEach(func: (provider: CustomConfigurationProvider1) => void): void {
        this.providers.forEach(func);
    }

    public remove(provider: CustomConfigurationProvider): void {
        const id: string = this.getId(provider);
        if (this.providers.has(id)) {
            this.providers.delete(id);
        } else {
            console.warn(`${id} is not registered`);
        }
    }

    public checkId(providerId?: string): string | undefined {
        if (!providerId) {
            return undefined;
        }
        const found: CustomConfigurationProvider1[] = [];
        let noUpdate: boolean = false;
        this.forEach(provider => {
            if (provider.extensionId === providerId) {
                noUpdate = true;
            } else if (provider.name === providerId && provider.version !== Version.v0) {
                found.push(provider);
            }
        });
        if (noUpdate) {
            return providerId;
        }
        if (found.length === 1) {
            return found[0].extensionId;
        } else if (found.length > 1) {
            console.warn("duplicate provider name found. Not upgrading.");
        }
        return providerId;
    }
}

const providerCollection: CustomConfigurationProviderCollection = new CustomConfigurationProviderCollection();

export function getCustomConfigProviders(): CustomConfigurationProviderCollection {
    return providerCollection;
}

export function isSameProviderExtensionId(settingExtensionId: string | undefined, providerExtensionId: string | undefined): boolean {
    if (!settingExtensionId && !providerExtensionId) {
        return true;
    }
    if (settingExtensionId === providerExtensionId) {
        return true;
    }
    // Consider old and new names for cmake-tools as equivalent
    if ((settingExtensionId === newCmakeToolsExtensionId && providerExtensionId === oldCmakeToolsExtensionId)
        || (settingExtensionId === oldCmakeToolsExtensionId && providerExtensionId === newCmakeToolsExtensionId)) {
        return true;
    }
    return false;
}
