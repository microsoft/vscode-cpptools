/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CustomConfigurationProvider, Version, CppToolsApi, SourceFileConfigurationItem } from 'vscode-cpptools';
import * as vscode from 'vscode';

export interface CustomConfigurationProviderInternal extends CustomConfigurationProvider {
    isValid: boolean;
    version: Version;
}

/**
 * Wraps the incoming CustomConfigurationProvider so that we can treat all of them as if they were the same version (e.g. latest)
 */
export class CustomProviderWrapper implements CustomConfigurationProviderInternal {
    private provider: CustomConfigurationProvider;
    private _version: Version;

    constructor(provider: CustomConfigurationProvider, version: Version) {
        this.provider = provider;
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
