/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CustomConfigurationProvider, Version, CppToolsApi } from 'vscode-cpptools';
import { CppToolsTestApi, CppToolsTestHook, CppToolsTestExtension } from 'vscode-cpptools/out/testApi';
import { CppTools } from './cppTools';

/**
 * This class implements both interfaces since the extension returned CppToolsTestApi for v0,
 * but returns CppToolsTestExtension for v1 and later.
 */
export class CppTools1 implements CppToolsTestApi, CppToolsTestExtension {
    private backupApi: CppTools;

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

            case Version.v1:
                return new CppTools(version);

            default:
                throw new RangeError(`Invalid version: ${version}`);
        }
    }

    getTestApi(version: Version): CppToolsTestApi {
        return <CppToolsTestApi>this.getApi(version);
    }

    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        this.BackupApi.registerCustomConfigurationProvider(provider);
    }

    didChangeCustomConfiguration(provider: CustomConfigurationProvider): void {
        this.BackupApi.didChangeCustomConfiguration(provider);
    }

    dispose(): void {
    }

    getTestHook(): CppToolsTestHook {
        return this.BackupApi.getTestHook();
    }
}
