/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export interface InactiveRegion {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

interface InactiveRegionSet {
    regions: InactiveRegion[];
    isComplete: boolean;
}

export class InactiveRegionStore {
    private readonly regionSets = new Map<string, InactiveRegionSet>();

    public update(uri: string, regions: InactiveRegion[], startNewSet: boolean, isComplete: boolean): void {
        let regionSet: InactiveRegionSet | undefined = this.regionSets.get(uri);
        if (startNewSet || regionSet === undefined) {
            regionSet = {
                regions: [],
                isComplete: false
            };
            this.regionSets.set(uri, regionSet);
        }

        for (const region of regions) {
            regionSet.regions.push(region);
        }
        regionSet.isComplete = isComplete;
    }

    public getComplete(uri: string): readonly InactiveRegion[] | undefined {
        const regionSet: InactiveRegionSet | undefined = this.regionSets.get(uri);
        return regionSet?.isComplete ? regionSet.regions : undefined;
    }

    public delete(uri: string): void {
        this.regionSets.delete(uri);
    }
}

export function getInactiveRegionStartLines(regions: readonly InactiveRegion[]): number[] {
    return [...new Set(regions.map(region => region.startLine))].sort((a, b) => a - b);
}
