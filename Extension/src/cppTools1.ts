/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CustomConfigurationProvider, Version, CppToolsApi, CppToolsExtension } from 'vscode-cpptools';
import { CppToolsTestApi, CppToolsTestHook, CppToolsTestExtension } from 'vscode-cpptools/out/testApi';
import { CppTools } from './cppTools';

/**
 * This class implements both interfaces since the extension returned CppToolsApi for v0,
 * but returns CppToolsTestExtension for v1 and later.
 */
export class CppTools1 implements CppToolsTestApi, CppToolsTestExtension {
    private backupApi?: CppTools;

    private get BackupApi(): CppToolsTestApi {
        if (!this.backupApi) {
            this.backupApi = new CppTools(Version.v0);
        }
        return this.backupApi;
    }

    getApi(version: Version): CppToolsApi {
        switch (version) {
            case Version.v0:
                return this.BackupApi;

            default:
                return new CppTools(version);
        }
    }

    getTestApi(version: Version): CppToolsTestApi {
        return <CppToolsTestApi>this.getApi(version);
    }

    getVersion(): Version {
        return this.BackupApi.getVersion();
    }

    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        this.BackupApi.registerCustomConfigurationProvider(provider);
    }

    notifyReady(provider: CustomConfigurationProvider): void {
        this.BackupApi.notifyReady(provider);
    }

    didChangeCustomConfiguration(provider: CustomConfigurationProvider): void {
        this.BackupApi.didChangeCustomConfiguration(provider);
    }

    didChangeCustomBrowseConfiguration(provider: CustomConfigurationProvider): void {
        this.BackupApi.didChangeCustomBrowseConfiguration(provider);
    }

    dispose(): void {
    }

    getTestHook(): CppToolsTestHook {
        return this.BackupApi.getTestHook();
    }
}

/**
 * This is an empty implementation of the API. Used when the extension is activated on
 * an unsupported platform.
 */
export class NullCppTools implements CppToolsApi, CppToolsExtension {
    private version: Version = Version.v0;

    getApi(version: Version): CppToolsApi {
        this.version = version;
        return this;
    }

    getVersion(): Version {
        return this.version;
    }

    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
    }

    notifyReady(provider: CustomConfigurationProvider): void {
    }

    didChangeCustomConfiguration(provider: CustomConfigurationProvider): void {
    }

    didChangeCustomBrowseConfiguration(provider: CustomConfigurationProvider): void {
    }

    dispose(): void {
    }
}
