/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

/**
 * This file is used for packaging the application and should not be referenced
 * by any other source files
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Change this to true to force a dev workflow.
const EnableDevWorkflow: boolean = false;

const DebugAdapterPath: string = "./debugAdapters";
const DebugAdapterBinPath: string = DebugAdapterPath + "/bin";

let CpptoolsExtensionRoot: string = null;
let SearchCompleted: boolean = false;

interface RootsHashtable {
    "miEngineRoot": string;
    "openDebugRoot": string;
    "monoDeps": string;
}

const internalBinaryRoots: RootsHashtable = {
    "miEngineRoot": process.env.CPPTOOLS_MIENGINE_ROOT,
    "openDebugRoot": process.env.CPPTOOLS_OPENDEBUG_ROOT,
    "monoDeps": process.env.CPPTOLS_MONODEPS_ROOT
};

const externalBinaryRoots: RootsHashtable = {
    "miEngineRoot": DebugAdapterBinPath,
    "openDebugRoot": DebugAdapterBinPath,
    "monoDeps": DebugAdapterPath
};

function findCppToolsExtensionDebugAdapterFolder(): string {
    const vscodeFolderRegExp: RegExp = new RegExp(/\.vscode-*[a-z]*$/);
    const cpptoolsFolderRegExp: RegExp = new RegExp(/ms\-vscode\.cpptools\-.*$/);

    let dirPath: string = os.homedir();
    if (fs.existsSync(dirPath)) {
        const files: string[] = fs.readdirSync(dirPath);
        for (let i: number = 0; i < files.length; i++) {
            // Check to see if it starts with '.vscode'
            if (vscodeFolderRegExp.test(files[i])) {
                const extPath: string = path.join(dirPath, files[i], "extensions");
                if (fs.existsSync(extPath)) {
                    const extFiles: string[] = fs.readdirSync(extPath);
                    for (let j: number = 0; j < extFiles.length; j++) {
                        if (cpptoolsFolderRegExp.test(path.join(extFiles[j]))) {
                            dirPath = path.join(extPath, extFiles[j]);
                            break;
                        }
                    }
                }
            }
        }

        if (dirPath === os.homedir()) {
            console.error("Could not find installed C/C++ extension.");
            return null;
        }

        return dirPath;
    } else {
        console.error("Unable to determine C/C++ extension installation location.");
        return null;
    }
}

function enableDevWorkflow(): Boolean {
    if (process.env.AGENT_ID) {
        // Agent machines must not attempt any dev workflows
        return false;
    }

    return (EnableDevWorkflow || (process.env.CPPTOOLS_DEV !== undefined));
}

function copySourceDependencies(): void {
    copy("./", DebugAdapterBinPath, "cppdbg.ad7Engine.json");
}

function getRoot(rootKey: string): string {
    const internal: string = internalBinaryRoots[rootKey];
    if (internal) {
        return internal;
    }

    // Only search for the extension root once.
    if (!CpptoolsExtensionRoot && !SearchCompleted) {
        CpptoolsExtensionRoot = findCppToolsExtensionDebugAdapterFolder();
        SearchCompleted = true;
    }

    if (CpptoolsExtensionRoot) {
        return path.join(CpptoolsExtensionRoot, externalBinaryRoots[rootKey]);
    }

    console.error("Unable to determine internal/external location to copy from for root %s.", rootKey);
    return null;
}

function copyBinaryDependencies(): void {
    const miEngineRoot: string = getRoot("miEngineRoot");
    const openDebugRoot: string = getRoot("openDebugRoot");

    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MICore.dll");
    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MICore.dll.mdb");
    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MICore.XmlSerializers.dll");
    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MIDebugEngine.dll");
    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MIDebugEngine.dll.mdb");
    copy(miEngineRoot, DebugAdapterBinPath, "osxlaunchhelper.scpt");
    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.VisualStudio.Debugger.Interop.15.0.dll");

    copy(openDebugRoot, DebugAdapterBinPath, "Microsoft.VisualStudio.Debugger.Interop.10.0.dll");
    copy(openDebugRoot, DebugAdapterBinPath, "Microsoft.VisualStudio.Debugger.Interop.11.0.dll");
    copy(openDebugRoot, DebugAdapterBinPath, "Microsoft.VisualStudio.Debugger.Interop.12.0.dll");
    copy(openDebugRoot, DebugAdapterBinPath, "Microsoft.VisualStudio.Debugger.InteropA.dll");
    copy(openDebugRoot, DebugAdapterBinPath, "Microsoft.DebugEngineHost.dll");
    copy(openDebugRoot, DebugAdapterBinPath, "Microsoft.DebugEngineHost.dll.mdb");
    copy(openDebugRoot, DebugAdapterBinPath, "OpenDebugAD7.exe");
    copy(openDebugRoot, DebugAdapterBinPath, "OpenDebugAD7.exe.config");
    copy(openDebugRoot, DebugAdapterBinPath, "OpenDebugAD7.exe.mdb");
    copy(openDebugRoot, DebugAdapterBinPath, "Newtonsoft.Json.dll");
    copy(openDebugRoot, DebugAdapterBinPath, "WindowsDebugLauncher.exe");
    copy(openDebugRoot, DebugAdapterBinPath, "Microsoft.VisualStudio.Shared.VSCodeDebugProtocol.dll");
}

function copyMonoDependencies(): void {
    const monoDeps: string = getRoot("monoDeps");

    copy(monoDeps, DebugAdapterPath, "OpenDebugAD7");
}

function copy(root: string, target: string, file: string): void {
    if (!root) {
        console.error("Unknown root location. Copy Failed for %s.", file);
        return;
    }

    const source: string = path.join(root, file);
    const destination: string = path.join(target, file);

    if (!fs.existsSync(target)) {
        console.log('Creating directory %s', target);
        makeDirectory(target);
    }

    console.log('copying %s to %s', source, destination);
    if (fs.existsSync(source)) {
        fs.writeFileSync(destination, fs.readFileSync(source));
    } else {
        console.error('ERR: could not find file %s', source);
    }
}

function removeFolder(root: string): void {
    if (!isDirectory(root)) {
        console.warn('Skipping deletion of %s; directory does not exist', root);
        return;
    }

    const files: string[] = fs.readdirSync(root);
    for (let i: number = 0; i < files.length; i++) {
        const fullPath: string = path.join(root, files[i]);
        console.warn('Found entry %s', fullPath);
        if (!isDirectory(fullPath)) {
            console.warn('Deleting %s', fullPath);
            fs.unlinkSync(fullPath);
        } else {
            removeFolder(fullPath);
        }
    }

    console.warn('Deleting %s', root);
    fs.rmdirSync(root);
}

function isDirectory(dir: string): Boolean {
    try {
        return fs.statSync(dir).isDirectory();
    } catch (e) {
    }
    return false;
}

function makeDirectory(dir: string): void {
    try {
        // Note: mkdir is limited to creating folders with one level of nesting. Creating "a/b" if 'a' doesn't exist will throw a ENOENT.
        fs.mkdirSync(dir);
    } catch (e) {
        if ((<NodeJS.ErrnoException>e).code !== "EEXIST") {
            throw e;
        }
    }
}

if (enableDevWorkflow()) {
    removeFolder("./debugAdapters");
}

makeDirectory("./debugAdapters");
copySourceDependencies();

if (enableDevWorkflow()) {
    copyMonoDependencies();
    copyBinaryDependencies();
} else {
    console.warn('WARNING: Debugger dependencies are missing.');
    console.log('If you are trying to build and run the extension from source and need the debugger dependencies, set the environment variable CPPTOOLS_DEV=1 and try again.');
}
