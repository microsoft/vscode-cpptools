/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface ProcessFilterItem {
    label?: string;
    description?: string;
    detail?: string;
}

export function filterProcessItems<T extends ProcessFilterItem>(items: T[], processFilter?: unknown): T[] | undefined {
    // The value comes from launch.json, so it is not guaranteed to be a string.
    if (typeof processFilter !== 'string' || !processFilter.trim()) {
        return undefined;
    }

    let processRegex: RegExp;
    try {
        processRegex = new RegExp(processFilter);
    } catch {
        throw new Error(localize("invalid.processFilter.regex", "Invalid {0} regular expression: {1}", "processFilter", processFilter));
    }

    return items.filter((item: T) => [item.label, item.description, item.detail]
        .some((value: string | undefined) => typeof value === "string" && processRegex.test(value)));
}
