/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import { ISshHostInfo, ProcessReturnType } from '../common';
import { defaultSystemInteractor } from './commandInteractors';
import { runSshTerminalCommandWithLogin } from './sshCommandRunner';

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

export function ssh(host: ISshHostInfo, command: string, sshPath?: string, jumpHosts?: ISshHostInfo[], continueOn?: string, cancellationToken?: vscode.CancellationToken): Promise<ProcessReturnType> {
    const args: string[] = [];
    if (jumpHosts && jumpHosts.length > 0) {
        args.push('-J', jumpHosts.map(getFullHostAddress).join(','));
    }
    if (host.port) {
        // lower case p
        args.push('-p', `${host.port}`);
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

/** user@host */
function getFullHostAddressNoPort(host: ISshHostInfo): string {
    return host.user ? `${host.user}@${host.hostName}` : `${host.hostName}`;
}

function getFullHostAddress(host: ISshHostInfo): string {
    const fullHostName: string = getFullHostAddressNoPort(host);
    return host.port ? `${fullHostName}:${host.port}` : fullHostName;
}
