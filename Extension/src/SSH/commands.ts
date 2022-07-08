/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { ISshHostInfo, ISshLocalForwardInfo, ProcessReturnType } from '../common';
import { defaultSystemInteractor } from './commandInteractors';
import { runSshTerminalCommandWithLogin } from './sshCommandRunner';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export async function scp(files: vscode.Uri[], host: ISshHostInfo, targetDir: string, scpPath?: string, jumpHosts?: ISshHostInfo[], cancellationToken?: vscode.CancellationToken): Promise<ProcessReturnType> {
    const args: string[] = [];
    if (jumpHosts && jumpHosts.length > 0) {
        args.push('-J', jumpHosts.map(getFullHostAddress).join(','));
    }
    if (host.port) {
        // upper case P
        args.push('-P', `${host.port}`);
    }
    args.push(files.map(uri => `"${uri.fsPath}"`).join(' '), `${getFullHostAddressNoPort(host)}:${targetDir}`);

    return runSshTerminalCommandWithLogin(host, { systemInteractor: defaultSystemInteractor, nickname: 'scp', command: `"${scpPath || 'scp'}" ${args.join(' ')}`, token: cancellationToken });
}

export function ssh(host: ISshHostInfo, command: string, sshPath?: string, jumpHosts?: ISshHostInfo[], localForwards?: ISshLocalForwardInfo[], continueOn?: string, cancellationToken?: vscode.CancellationToken): Promise<ProcessReturnType> {
    const args: string[] = [];
    if (jumpHosts && jumpHosts.length > 0) {
        args.push('-J', jumpHosts.map(getFullHostAddress).join(','));
    }
    if (host.port) {
        // lower case p
        args.push('-p', `${host.port}`);
    }
    if (localForwards) {
        localForwards.forEach(info => args.push(...localForwardToArgs(info)));
    }
    args.push(getFullHostAddressNoPort(host), `"${command}"`);

    return runSshTerminalCommandWithLogin(host, {
        systemInteractor: defaultSystemInteractor,
        command: `"${sshPath || 'ssh'}" ${args.join(' ')}`,
        nickname: 'ssh',
        continueOn,
        token: cancellationToken
    });
}

/**
 * Takes one local forward info and convert it to '-L' args in ssh.
 */
function localForwardToArgs(localForward: ISshLocalForwardInfo): string[] {
    // Do not combine error checking and arg conversion for clarity.
    if (localForward.localSocket && (localForward.bindAddress || localForward.port)) {
        throw Error(localize('local.forward.local.conflict', '"localSocket" cannot be specifed at the same time with "bindAddress" or "port" in localForwards'));
    }
    if (!localForward.localSocket && !localForward.port) {
        throw Error(localize('local.forward.local.missing', '"port" or "localSocket" required in localForwards'));
    }
    if (localForward.remoteSocket && (localForward.host || localForward.hostPort)) {
        throw Error(localize('local.forward.remote.conflict', '"remoteSocket" cannot be specifed at the same time with "host" or "hostPort" in localForwards'));
    }
    if (!localForward.remoteSocket && (!localForward.host || !localForward.hostPort)) {
        throw Error(localize('local.forward.remote.missing', '"host" and "hostPort", or "remoteSocket" required in localForwards'));
    }

    let arg: string = '';
    if (localForward.localSocket) {
        arg += `${localForward.localSocket}:`;
    }
    if (localForward.bindAddress) {
        arg += `${localForward.bindAddress}:`;
    }
    if (localForward.port) {
        arg += `${localForward.port}:`;
    }
    if (localForward.remoteSocket) {
        arg += `${localForward.remoteSocket}`;
    }
    if (localForward.host && localForward.hostPort) {
        arg += `${localForward.host}:${localForward.hostPort}`;
    }

    return ['-L', arg];
}

/** user@host */
function getFullHostAddressNoPort(host: ISshHostInfo): string {
    return host.user ? `${host.user}@${host.hostName}` : `${host.hostName}`;
}

function getFullHostAddress(host: ISshHostInfo): string {
    const fullHostName: string = getFullHostAddressNoPort(host);
    return host.port ? `${fullHostName}:${host.port}` : fullHostName;
}
