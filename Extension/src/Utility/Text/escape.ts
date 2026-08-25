/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export function escapePathForSquiggles(s: string): string {
    return s.replace(/[-"\/\\^$*+?.()|[\]{}]/g, (character: string): string =>
        character === '"' ? '\\\\"' : `\\${character}`);
}

export function getTextMatchOffsets(text: string, match: string): [number, number] {
    const startOffset: number = text.indexOf(match);
    return [startOffset, startOffset + match.length];
}
