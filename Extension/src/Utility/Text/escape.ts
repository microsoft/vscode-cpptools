/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export function escapePathForSquiggles(s: string): string {
    return s.replace(/[-"\/\\^$*+?.()|[\]{}]/g, (character: string): string =>
        character === '"' ? '\\\\"' : `\\${character}`);
}
