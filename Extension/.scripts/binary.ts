/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { parse } from 'semver';
import { $root, $switches, cyan, glob, green, note, updateFiles } from './common';
import { extensionsDir, installExtension, uninstallExtension } from './vscode';

export async function install(version: string) {
    if (!version || parse(version)) {
        note(`Attempting to install binaries from published vsix (${version ? version : $switches.includes('--pre-release') ? 'latest pre-release' : 'latest'})`);
    }
    // install it in the isolated vscodearea
    note("Temporarily installing vscode-cpptools extension");
    const { id, ver } = await installExtension('ms-vscode.cpptools', version);

    // grab the binaries out
    let files = [] as string[];

    files.push(...await glob(`${extensionsDir}/${id}-${ver}*/bin/cpptools*`));
    files.push(...await glob(`${extensionsDir}/${id}-${ver}*/bin/*.dll`));
    files.push(...await glob(`${extensionsDir}/${id}-${ver}*/bin/*.exe`));

    files.push(...await glob(`${extensionsDir}/${id}-${ver}*/LLVM/**`));
    files.push(...await glob(`${extensionsDir}/${id}-${ver}*/debugAdapters/**`));
    files = [...new Set(files)];
    const extensionFolder = files[0].replace(/.bin.cpptools.*$/g, '');
    note(`Copying files from vscode-cpptools extension ${ver} in '${extensionFolder}'`);
    await updateFiles(files, $root, extensionFolder);

    // remove the extension fromthe isolated vscode
    note("Removing temporary vscode-cpptools extension");
    await uninstallExtension('ms-vscode.cpptools');

}

export async function main() {
    console.log(`use ${green(`yarn binary install ${cyan('[version] [--pre-release]')}`)}`);

}
