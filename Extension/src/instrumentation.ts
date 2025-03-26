/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

/* eslint @typescript-eslint/no-var-requires: "off" */

export interface PerfMessage<TInput = Record<string, any> | undefined> {
    /** this is the 'name' of the event */
    name: string;

    /** this indicates the context or origin of the message  */
    context: Record<string, string | Set<string>>;

    /** if the message contains complex data, it should be in here */
    data?: TInput;

    /** if the message is just a text message, this is the contents of the message  */
    text?: string;

    /** the message can have a numeric value that indicates the 'level' or 'severity' etc */
    level?: number;
}

const services = {
    instrument: <T extends Record<string, any>>(instance: T, _options?: { ignore?: string[]; name?: string }): T => instance,
    message: (_message: PerfMessage) => { },
    init: (_vscode: any) => { }
};

/** Adds instrumentation to all the members of an object when instrumentation is enabled  */
export function instrument<T extends Record<string, any>>(instance: T, options?: { ignore?: string[]; name?: string }): T {
    return services.instrument(instance, options);
}

/** sends a perf message to the monitor */
export function sendInstrumentation(message: PerfMessage): void {
    services.message(message);
}

/** verifies that the instrumentation is loaded into the global namespace */
export const isInstrumentationEnabled = !!(global as any).instrumentation;

// If the instrumentation is enabled, then ensure the functions are wired up.
if (isInstrumentationEnabled) {
    // Instrumentation services provided by the tool.
    services.instrument = (global as any).instrumentation.instrument;
    services.message = (global as any).instrumentation.message;
    services.init = (global as any).instrumentation.init;

    // Passes the specific vscode object for this extension to the init routine.
    services.init(require('vscode'));
}
