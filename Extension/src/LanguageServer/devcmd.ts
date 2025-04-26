/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { promises as fs } from 'fs';
import { vcvars } from 'node-vcvarsall';
import { vswhere } from 'node-vswhere';
import * as path from 'path';
import * as vscode from 'vscode';

export async function setEnvironment(context?: vscode.ExtensionContext) {
    if (!context) {
        throw new Error('No context provided');
    }

    const vses = await getVSInstallations();
    if (!vses) {
        throw new Error('A Visual Studio installation with the C++ compiler was not found');
    }

    let vs = await chooseVSInstallation(vses);
    let options: vcvars.Options | undefined;
    if (!vs) {
        const compiler = await getAdvancedConfiguration(vses);
        vs = compiler.vs;
        options = compiler.options;
    }
    const vars = await vscode.window.withProgress({
        cancellable: false,
        location: vscode.ProgressLocation.Notification,
        title: 'Configuring Developer Environment...'
    }, () => vcvars.getVCVars(vs, options));

    if (!vars || !vars['INCLUDE']) {
        throw new Error(`Something went wrong: ${JSON.stringify(vars)}`);
    }

    const host = vars['VSCMD_ARG_HOST_ARCH'];
    const target = vars['VSCMD_ARG_TGT_ARCH'];
    const arch = vcvars.getArchitecture({
        host: match(host, { 'x86': 'x86', 'x64': 'x64' }) ?? 'x64',
        target: match(target, { 'x86': 'x86', 'x64': 'x64', 'arm64': 'ARM64', 'arm': 'ARM' }) ?? 'x64'
    });
    const persist = vscode.workspace.getConfiguration('devcmd').get<boolean>('persistEnvironment') === true;

    context.environmentVariableCollection.clear();
    for (const key of Object.keys(vars)) {
        context.environmentVariableCollection.replace(key, vars[key].replace(`%${key}%`, '${env:' + key + '}'));
    }
    context.environmentVariableCollection.description = (arch ? `${arch} ` : '') + 'Developer Command Prompt for ' + vs.displayName;
    context.environmentVariableCollection.persistent = persist;
    return true;
}

async function getVSInstallations() {
    const installations = await vswhere.getVSInstallations({
        all: true,
        prerelease: true,
        sort: true,
        requires: ['Microsoft.VisualStudio.Component.VC.Tools.x86.x64']
    });

    if (installations.length === 0) {
        throw new Error('A Visual Studio installation with the C++ compiler was not found');
    }
    return installations;
}

async function chooseVSInstallation(installations: vswhere.Installation[]): Promise<vswhere.Installation | undefined> {
    const items: vscode.QuickPickItem[] = installations.map(installation => <vscode.QuickPickItem>{
        label: installation.displayName,
        description: `Default settings for ${installation.displayName}`
    });
    items.push({
        label: 'Advanced options...',
        description: 'Select a specific host/target architecture, toolset version, etc.'
    });
    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a Visual Studio installation'
    });
    if (!selection) {
        throw new Error('The operation was cancelled');
    }

    return installations.find(installation => installation.displayName === selection.label);
}

async function getAdvancedConfiguration(vses: vswhere.Installation[]): Promise<Compiler> {
    const compiler = await chooseCompiler(vses);
    if (!compiler) {
        throw new Error('The operation was cancelled');
    }
    await setOptions(compiler);
    return compiler;
}

interface Compiler {
    version: string;
    vs: vswhere.Installation;
    options: vcvars.Options;
}

async function chooseCompiler(vses: vswhere.Installation[]): Promise<Compiler | undefined> {
    const compilers: Compiler[] = [];
    for (const vs of vses) {
        const vcPath = path.join(vs.installationPath, 'VC', 'Tools', 'MSVC');
        const folders = await fs.readdir(vcPath);
        for (const version of folders) {
            const options: vcvars.Options = {
                // Don't set the version in the options if there is only one
                vcVersion: folders.length > 1 ? version : undefined
            };
            compilers.push({ version, vs, options });
        }
    }
    const items = compilers.map(compiler => <vscode.QuickPickItem>{
        label: compiler.version,
        description: compiler.vs.displayName
    });
    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a toolset version'
    });
    if (!selection) {
        throw new Error('The operation was cancelled');
    }
    return compilers.find(compiler => compiler.version === selection.label && compiler.vs.displayName === selection.description);
}

async function setOptions(compiler: Compiler): Promise<void> {
    const vcPath = path.join(compiler.vs.installationPath, 'VC', 'Tools', 'MSVC', compiler.version, 'bin');
    const hostTargets = await getHostsAndTargets(vcPath);
    if (hostTargets.length > 1) {
        const items = hostTargets.map(ht => <vscode.QuickPickItem>{
            label: vcvars.getArchitecture(ht),
            description: `host = ${ht.host}, target = ${ht.target}`
        });
        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a host and target architecture'
        });
        if (!selection) {
            throw new Error('The operation was cancelled');
        }
        compiler.options.arch = <vcvars.Architecture>selection.label;
    }
}

async function getHostsAndTargets(vcPath: string): Promise<vcvars.HostTarget[]> {
    const hosts = await fs.readdir(vcPath);
    if (hosts.length === 0) {
        throw new Error('No hosts found');
    }
    const hostTargets: vcvars.HostTarget[] = [];
    for (const host of hosts) {
        const h = match<'x86' | 'x64' | undefined>(host.toLowerCase(), { 'hostx86': 'x86', 'hostx64': 'x64' });
        if (!h) {
            // skip any arm/arm64 folders because there is no arm compiler
            continue;
        }
        const targets = await fs.readdir(path.join(vcPath, host));
        for (const target of targets) {
            hostTargets.push({
                host: h,
                target: match(target, { 'x86': 'x86', 'x64': 'x64', 'arm64': 'ARM64', 'arm': 'ARM' }) ?? 'x64'
            });
        }
    }
    return hostTargets;
}

export function deactivate() {
}

function match<T>(item: string, cases: { [key: string]: T }): T | undefined {
    return cases[item];
}
