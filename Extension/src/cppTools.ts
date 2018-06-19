/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CustomConfigurationProvider } from 'vscode-cpptools';
import { CppToolsTestApi, CppToolsTestHook, Status } from 'vscode-cpptools/testApi';
import * as LanguageServer from './LanguageServer/extension';
import * as vscode from 'vscode';

export class CppTools implements CppToolsTestApi {
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

    getTestHook(): CppToolsTestHook {
        return getTestHook();
    }
}

export class TestHook implements CppToolsTestHook {
    private statusChangedEvent: vscode.EventEmitter<Status> = new vscode.EventEmitter<Status>();

    public get StatusChanged(): vscode.Event<Status> {
        return this.statusChangedEvent.event;
    }

    public updateStatus(status: Status): void {
        this.statusChangedEvent.fire(status);
    }

    public dispose(): void {
        this.statusChangedEvent.dispose();
        this.statusChangedEvent = null;
    }

    public valid(): boolean {
        return !!this.statusChangedEvent;
    }
}

let testHook: TestHook;

export function getTestHook(): TestHook {
    if (!testHook || !testHook.valid()) {
        testHook = new TestHook();
    }
    return testHook;
}