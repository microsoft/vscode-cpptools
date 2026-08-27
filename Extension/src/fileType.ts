/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';

export type FileTypeKind = 'source' | 'header' | 'idl' | 'resource' | 'other';
export type FileTypeLanguage = 'c' | 'cpp' | 'cuda';

export interface FileTypeMapping {
    name: string;
    kind: FileTypeKind;
    language?: FileTypeLanguage;
}

export interface FileTypeMappings {
    extensions: FileTypeMapping[];
    filenames: FileTypeMapping[];
}

const bootstrapMappings: FileTypeMappings = {
    extensions: [
        ...['.cuh', '.hpp', '.hh', '.hxx', '.h++', '.hp', '.h', '.inl', '.ipp', '.tcc', '.txx', '.tpp', '.tlh', '.tli']
            .map(name => ({ name, kind: 'header' as const, language: name === '.cuh' ? 'cuda' as const : 'cpp' as const })),
        ...['.cu', '.cpp', '.cc', '.cxx', '.c++', '.cp', '.ii', '.ino']
            .map(name => ({ name, kind: 'source' as const, language: name === '.cu' ? 'cuda' as const : 'cpp' as const })),
        ...['.c', '.i'].map(name => ({ name, kind: 'source' as const, language: 'c' as const })),
        { name: '.idl', kind: 'idl' }
    ],
    filenames: []
};

let extensionMappings: ReadonlyMap<string, FileTypeMapping>;
let filenameMappings: ReadonlyMap<string, FileTypeMapping>;
let nativeMappingsAvailable: boolean = false;

function createMappingMap(mappings: FileTypeMapping[]): ReadonlyMap<string, FileTypeMapping> {
    const result: Map<string, FileTypeMapping> = new Map<string, FileTypeMapping>();
    for (const mapping of mappings) {
        result.set(mapping.name.toLowerCase(), { ...mapping, name: mapping.name.toLowerCase() });
    }
    return result;
}

export function resetFileTypeMappings(): void {
    extensionMappings = createMappingMap(bootstrapMappings.extensions);
    filenameMappings = createMappingMap(bootstrapMappings.filenames);
    nativeMappingsAvailable = false;
}

export function updateFileTypeMappings(mappings: FileTypeMappings | undefined): void {
    if (!mappings) {
        resetFileTypeMappings();
        return;
    }

    extensionMappings = createMappingMap(mappings.extensions);
    filenameMappings = createMappingMap(mappings.filenames);
    nativeMappingsAvailable = true;
}

export function hasNativeFileTypeMappings(): boolean {
    return nativeMappingsAvailable;
}

function getRegisteredFileType(filePath: string): FileTypeMapping | undefined {
    const filename: string = path.basename(filePath);
    const filenameMapping: FileTypeMapping | undefined = filenameMappings.get(filename.toLowerCase());
    if (filenameMapping) {
        return filenameMapping;
    }

    const extension: string = path.extname(filename);
    // VS Code initially assigns uppercase .C files to C. Preserve the extension's
    // long-standing correction until the exact filename association is installed.
    if (extension === '.C') {
        return { name: extension, kind: 'source', language: 'cpp' };
    }
    return extensionMappings.get(extension.toLowerCase());
}

export function classifyFilePath(filePath: string, languageId?: string): FileTypeMapping | undefined {
    const registeredType: FileTypeMapping | undefined = getRegisteredFileType(filePath);
    if (registeredType) {
        return registeredType;
    }

    if (!nativeMappingsAvailable && !path.extname(filePath)) {
        return { name: '', kind: 'header' };
    }

    switch (languageId) {
        case 'c':
            return { name: '', kind: 'source', language: 'c' };
        case 'cpp':
            return { name: '', kind: 'source', language: 'cpp' };
        case 'cuda-cpp':
            return { name: '', kind: 'source', language: 'cuda' };
        default:
            return undefined;
    }
}

export function isTagParsableFile(filePath: string): boolean {
    const type: FileTypeMapping | undefined = getRegisteredFileType(filePath);
    return type?.kind === 'source' || type?.kind === 'header' || type?.kind === 'idl';
}

resetFileTypeMappings();
