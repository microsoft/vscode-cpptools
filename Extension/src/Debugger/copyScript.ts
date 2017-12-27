/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/**
 * This file is used for packaging the application and should not be referenced
 * by any other source files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

interface RootsHashtable {
    "miEngineRoot": string;
    "openDebugRoot": string;
    "monoDeps": string
};

const internalBinaryRoots: RootsHashtable = {
    "miEngineRoot": process.env.CPPTOOLS_MIENGINE_ROOT,
    "openDebugRoot": process.env.CPPTOOLS_OPENDEBUG_ROOT,
    "monoDeps": process.env.CPPTOLS_MONODEPS_ROOT
};

const externalBinaryRoots: RootsHashtable = {
    "miEngineRoot": "./node_modules/msvscode.cpptools.miengine",
    "openDebugRoot": "./node_modules/msvscode.cpptools.opendebugad7",
    "monoDeps": "./node_modules/msvscode.cpptools.monodeps"
};

//Change this to true to force a dev workflow.
const EnableDevWorkflow: Boolean = false;

const DebugAdapterPath = "./debugAdapters"
const DebugAdapterBinPath = DebugAdapterPath + "/bin";

function enableDevWorkflow(): Boolean {
    if (process.env.AGENT_ID) {
        //Agent machines must not attempt any dev workflows
        return false;
    }

    return (EnableDevWorkflow || (process.env.CPPTOOLS_DEV != null));
}

function copySourceDependencies(): void {
    copy("./", DebugAdapterBinPath, "cppdbg.ad7Engine.json");
}

function getRoot(rootKey: string): string {
    const internal = internalBinaryRoots[rootKey];
    return internal ? internal : externalBinaryRoots[rootKey];
}

function copyBinaryDependencies(): void {
    const miEngineRoot = getRoot("miEngineRoot");
    const openDebugRoot = getRoot("openDebugRoot");

    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MICore.dll");
    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MICore.dll.mdb");
    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MICore.XmlSerializers.dll");
    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MIDebugEngine.dll");
    copy(miEngineRoot, DebugAdapterBinPath, "Microsoft.MIDebugEngine.dll.mdb");
    copy(miEngineRoot, DebugAdapterBinPath, "osxlaunchhelper.scpt");

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
}

function copyMonoDependencies(): void {
    const monoDeps = getRoot("monoDeps");

    copy(monoDeps, DebugAdapterPath, "OpenDebugAD7");
}

function copy(root: string, target: string, file: string): void {
    var source = path.join(root, file);
    var destination: string = path.join(target, file);

    console.log('Creating directory %s', target);
    makeDirectory(target);

    console.log('copying %s to %s', source, destination);
    fs.writeFileSync(destination, fs.readFileSync(source));
}

function copyFolder(root: string, target: string): void {
    var files: string[] = fs.readdirSync(root);

    for (var i = 0; i < files.length; i++) {
        var fullPath: string = path.join(root, files[i]);

        if (!isDirectory(fullPath)) {
            copy(root, target, files[i]);
        }
        else {
            copyFolder(fullPath, path.join(target, files[i]));
        }
    }
}

function removeFolder(root: string): void {
    if (!isDirectory(root)) {
        console.warn('Skipping deletion of %s; directory does not exist', root);
        return;
    }

    var files: string[] = fs.readdirSync(root);
    for (var i = 0; i < files.length; i++) {
        var fullPath: string = path.join(root, files[i]);
        console.warn('Found entry %s', fullPath);
        if (!isDirectory(fullPath)) {
            console.warn('Deleting %s', fullPath);
            fs.unlinkSync(fullPath)
        }
        else {
            removeFolder(fullPath);
        }
    }

    console.warn('Deleting %s', root);
    fs.rmdirSync(root);
}

function isDirectory(dir: string): Boolean {
    try {
        return fs.statSync(dir).isDirectory();
    }
    catch (e) {
    }
    return false;
}

function fileExists(file: string): Boolean {
    try {
        return fs.statSync(file).isFile();
    }
    catch (e) {
    }

    return false;
}

function makeDirectory(dir: string): void {
    try {
        //Note: mkdir is limited to creating folders with one level of nesting. Creating "a/b" if 'a' doesn't exist will throw a ENOENT.
        fs.mkdirSync(dir);
    }
    catch (e) {
        if ((<NodeJS.ErrnoException>e).code !== "EEXIST") {
            throw e;
        }
    }
}

var devWorkFlowMessage: string = '\nWARNING: If you are trying to build and run the extension locally, please set the environment variable CPPTOOLS_DEV=1 and try again.\n';

if (enableDevWorkflow()) {
    removeFolder("./debugAdapters");
}

makeDirectory("./debugAdapters");
copySourceDependencies();

if (enableDevWorkflow()) {
    copyMonoDependencies();
    copyBinaryDependencies();
}
else {
    console.warn(devWorkFlowMessage);
}
