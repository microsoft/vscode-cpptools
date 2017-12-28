/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import * as util from './debugProxyUtils';
import { serializeProtocolEvent, InitializationErrorResponse } from './debugProtocol';
const showNoError: string = ""; // Used to avoid showing the error with the "Open launch.json" button.

function proxy() {
    util.checkInstallLockFile().then((installLockExists: boolean) => {
        util.checkPackageLockFile().then((packageLockExists: boolean) => {
            var payload: string = "";
            if (installLockExists) {
                // package.json's program was not overwritten properly from main.ts rewriteManifest().
                payload = serializeProtocolEvent(
                    new InitializationErrorResponse(!packageLockExists ? showNoError : "Internal package.json error encountered. Please reinstall the C/C++ extension for Visual Studio Code."));
                if (!packageLockExists)
                    util.touchDebuggerReloadFile(); // Triggers the reload popup.
            } else {
                payload = serializeProtocolEvent(new InitializationErrorResponse(showNoError));
                util.touchDebuggerReloadFile(); // Triggers wait for download popup (and reload afterwards).
            }
            process.stdout.write(payload);
            util.logToFile(payload);
        })
        .catch(function (reason: Error) {
            util.logToFile(`Promise failed: ${reason}`);
        });
    });
}

function startDebugChildProcess(targetProcess: string, args: string[], workingFolder: string): Promise<void> {
    var promise = new Promise<void>(function (resolve, reject) {
        const child = child_process.spawn(targetProcess, args, { cwd: workingFolder });
        child.on('close', (code: number) => {
            if (code !== 0) {
                reject(new Error(code.toString()));
            }
            else {
                resolve();
            }
        });

        start(process.stdin, process.stdout, child);
    });

    return promise;
}

function start(inStream: NodeJS.ReadableStream, outStream: NodeJS.WritableStream, child: child_process.ChildProcess): void {

    inStream.setEncoding('utf8');

    child.on('error', (data) => {
        util.logToFile(`Child error: ${data}`);
    });

    process.on('SIGTERM', () => {
        child.kill();
        process.exit(0);
    });

    process.on('SIGHUP', () => {
        child.kill();
        process.exit(0);
    });

    inStream.on('error', (error) => {
        util.logToFile(`Instream error: ${error}`);
    });

    outStream.on('error', (error) => {
        util.logToFile(`Outstream error: ${error}`);
    });

    child.stdout.on('data', (data) => {
        outStream.write(data);
    });

    inStream.on('data', (data) => {
        child.stdin.write(data);
    });

    inStream.resume();
}

proxy();