/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import TelemetryReporter from '@vscode/extension-telemetry';
import { getExperimentationServiceAsync, IExperimentationService, IExperimentationTelemetry, TargetPopulation } from 'vscode-tas-client';
import * as util from './common';
import { CppSettings } from './LanguageServer/settings';
import { logAndReturn } from './Utility/Async/returns';
import { is } from './Utility/System/guards';

interface IPackageInfo {
    name: string;
    version: string;
}

export class ExperimentationTelemetry implements IExperimentationTelemetry {
    private sharedProperties: Record<string, string> = {};

    constructor(private baseReporter: TelemetryReporter) { }

    sendTelemetryEvent(eventName: string, properties?: Record<string, string>, measurements?: Record<string, number>): void {
        this.baseReporter.sendTelemetryEvent(
            eventName,
            {
                ...this.sharedProperties,
                ...properties
            },
            measurements
        );
    }

    sendTelemetryErrorEvent(eventName: string, properties?: Record<string, string>, _measurements?: Record<string, number>): void {
        this.baseReporter.sendTelemetryErrorEvent(eventName, {
            ...this.sharedProperties,
            ...properties
        });
    }

    setSharedProperty(name: string, value: string): void {
        this.sharedProperties[name] = value;
    }

    postEvent(eventName: string, props: Map<string, string>): void {
        const event: Record<string, string> = {};
        for (const [key, value] of props) {
            event[key] = value;
        }
        this.sendTelemetryEvent(eventName, event);
    }

    dispose(): Promise<any> {
        return this.baseReporter.dispose();
    }
}

let initializationPromise: Promise<IExperimentationService> | undefined;
let experimentationTelemetry: ExperimentationTelemetry | undefined;
const appInsightsKey: string = "0c6ae279ed8443289764825290e4f9e2-1a736e7c-1324-4338-be46-fc2a58ae4d14-7255";

export function activate(): void {
    try {
        if (util.extensionContext) {
            const packageInfo: IPackageInfo = getPackageInfo();
            if (packageInfo) {
                const targetPopulation: TargetPopulation = util.getCppToolsTargetPopulation();
                experimentationTelemetry = new ExperimentationTelemetry(new TelemetryReporter(packageInfo.name, packageInfo.version, appInsightsKey));
                initializationPromise = getExperimentationServiceAsync(packageInfo.name, packageInfo.version, targetPopulation, experimentationTelemetry, util.extensionContext.globalState);
            }
        }
    } catch (e) {
        // Handle error with a try/catch, but do nothing for errors.
    }
}

export function getExperimentationService(): Promise<IExperimentationService> | undefined {
    return initializationPromise;
}

export async function isExperimentEnabled(experimentName: string): Promise<boolean> {
    if (new CppSettings().experimentalFeatures) {
        return true;
    }
    const experimentationService: IExperimentationService | undefined = await getExperimentationService();
    const isEnabled: boolean | undefined = experimentationService?.getTreatmentVariable<boolean>("vscode", experimentName);
    return isEnabled ?? false;
}

export async function deactivate(): Promise<void> {
    await initializationPromise?.catch(logAndReturn.undefined);
    await experimentationTelemetry?.dispose().catch(logAndReturn.undefined);
}

export function logDebuggerEvent(eventName: string, properties?: Record<string, string>, metrics?: Record<string, number>): void {
    const sendTelemetry = () => {
        if (experimentationTelemetry) {
            const eventNamePrefix: string = "cppdbg/VS/Diagnostics/Debugger/";
            experimentationTelemetry.sendTelemetryEvent(eventNamePrefix + eventName, properties, metrics);
        }
    };

    // simpler expression of the original:
    // Uses 'then' instead of 'await' because telemetry should be "fire and forget".
    if (is.promise(initializationPromise)) {
        return void initializationPromise.catch(logAndReturn.undefined).then(sendTelemetry).catch(logAndReturn.undefined);
    }
    sendTelemetry();
}

export function logLanguageServerEvent(eventName: string, properties?: Record<string, string>, metrics?: Record<string, number>): void {
    const sendTelemetry = () => {
        if (experimentationTelemetry) {
            const eventNamePrefix: string = "C_Cpp/LanguageServer/";
            experimentationTelemetry.sendTelemetryEvent(eventNamePrefix + eventName, properties, metrics);
        }
    };

    if (is.promise(initializationPromise)) {
        return void initializationPromise.catch(logAndReturn.undefined).then(sendTelemetry).catch(logAndReturn.undefined);
    }
    sendTelemetry();
}

function getPackageInfo(): IPackageInfo {
    return {
        name: util.packageJson.publisher + "." + util.packageJson.name,
        version: util.packageJson.version
    };
}
