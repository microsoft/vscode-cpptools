/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export interface ProcessFilterItem {
    label?: string;
    description?: string;
    detail?: string;
}

export function filterProcessItems<T extends ProcessFilterItem>(items: T[], processFilter?: unknown): T[] | undefined {
    // The value comes from launch.json, so it is not guaranteed to be a string.
    const trimmedFilter: string | undefined = typeof processFilter === 'string' ? processFilter.trim() : undefined;
    if (!trimmedFilter) {
        return undefined;
    }

    let processRegex: RegExp;
    try {
        processRegex = new RegExp(trimmedFilter);
    } catch {
        throw new Error(`Invalid processFilter regular expression: ${trimmedFilter}`);
    }

    return items.filter((item: T) => {
        const label: string = item.label ?? "";
        const description: string = item.description ?? "";
        const detail: string = item.detail ?? "";
        return processRegex.test(label) || processRegex.test(description) || processRegex.test(detail);
    });
}
