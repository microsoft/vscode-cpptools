/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

export enum ArchType {
    ia32,
    x64
}

export class ArchitectureReplacer {
    public static checkAndReplaceWSLPipeProgram(pipeProgramStr: string, expectedArch: ArchType): string | undefined {
        let replacedPipeProgram: string | undefined;
        const winDir: string | undefined = process.env.WINDIR ? process.env.WINDIR.toLowerCase() : undefined;
        const winDirAltDirSep: string | undefined =  process.env.WINDIR ? process.env.WINDIR.replace('\\', '/').toLowerCase() : undefined;
        const winDirEnv: string = "${env:windir}";

        if (winDir && winDirAltDirSep && (pipeProgramStr.indexOf(winDir) === 0 || pipeProgramStr.indexOf(winDirAltDirSep) === 0 || pipeProgramStr.indexOf(winDirEnv) === 0)) {
            if (expectedArch === ArchType.x64) {
                const pathSep: string = ArchitectureReplacer.checkForFolderInPath(pipeProgramStr, "sysnative");
                if (pathSep) {
                    // User has sysnative but we expect 64 bit. Should be using System32 since sysnative is a 32bit concept.
                    replacedPipeProgram = pipeProgramStr.replace(`${pathSep}sysnative${pathSep}`, `${pathSep}system32${pathSep}`);
                }
            } else if (expectedArch === ArchType.ia32) {
                const pathSep: string = ArchitectureReplacer.checkForFolderInPath(pipeProgramStr, "system32");
                if (pathSep) {
                    // User has System32 but we expect 32 bit. Should be using sysnative
                    replacedPipeProgram = pipeProgramStr.replace(`${pathSep}system32${pathSep}`, `${pathSep}sysnative${pathSep}`);
                }
            }
        }

        return replacedPipeProgram;
    }

    // Checks to see if the folder name is in the path using both win and unix style path separators.
    // Returns the path separator it detected if the folder is in the path.
    // Or else it returns empty string to indicate it did not find it in the path.
    public static checkForFolderInPath(path: string, folder: string): string {
        if (path.indexOf(`/${folder}/`) >= 0) {
            return '/';
        } else if (path.indexOf(`\\${folder}\\`) >= 0) {
            return '\\';
        }

        return "";
    }
}
