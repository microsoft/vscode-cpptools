/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { resolve } from 'path';
import { setTimeout as delay } from 'timers/promises';
import { verbose } from '../src/Utility/Text/streams';
import { mkdir, readJson, rimraf, warn, write } from './common';
import { getVSCodeTestIsolate } from './vscodeTestPath';

export const isolated = getVSCodeTestIsolate(__dirname);
export const extensionsDir = resolve(isolated, 'extensions');
export const userDir = resolve(isolated, 'user-data');
export const settings = resolve(userDir, "User", 'settings.json');

// Pin the test VS Code build to a known-good stable release for deterministic CI instead of
// always pulling latest. Launching macOS 1.110+ builds requires @vscode/test-electron >= 3.1.0.
export const testVSCodeVersion = '1.131.0';

export const options = {
    version: testVSCodeVersion,
    cachePath: `${isolated}/cache`,
    launchArgs: ['--no-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-extensions', `--extensions-dir=${extensionsDir}`, `--user-data-dir=${userDir}`, '--disable-workspace-trust']
};

const transientNetworkErrors = new Set(['EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ETIMEDOUT']);

function isRetryableAcquisitionError(err: unknown): boolean {
    if (err instanceof AggregateError) {
        return err.errors.length > 0 && err.errors.every(isRetryableAcquisitionError);
    }
    return err instanceof Error && (err.constructor.name === 'TimeoutError'
        || ('code' in err && typeof err.code === 'string' && transientNetworkErrors.has(err.code)));
}

function describeAcquisitionError(err: unknown): string {
    if (err instanceof AggregateError) {
        return err.errors.map(describeAcquisitionError).join('; ') || err.message;
    }
    if (err instanceof Error) {
        return 'code' in err ? `${err.code}: ${err.message}` : err.message;
    }
    return String(err);
}

async function downloadVSCode(): Promise<string> {
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt++) {
        try {
            return await downloadAndUnzipVSCode(options);
        } catch (err: unknown) {
            const details = describeAcquisitionError(err);
            if (attempt === maxAttempts || !isRetryableAcquisitionError(err)) {
                throw new Error(`VS Code ${options.version} acquisition failed after ${attempt} ${attempt === 1 ? 'attempt' : 'attempts'}: ${details}`, { cause: err });
            }
            const delayMs = 1000 * 2 ** (attempt - 1);
            warn(`VS Code acquisition attempt ${attempt}/${maxAttempts} failed: ${details}. Retrying in ${delayMs} ms.`);
            await delay(delayMs);
        }
    }
}

export async function install() {
    try {
        // Create a new isolated directory for VS Code instance in the test folder, and make it specific to the extension folder so we can avoid collisions.
        // keeping this out of the Extension folder means we're not worried about VS Code getting weird with locking files and such.

        verbose(`Isolated VSCode test folder: ${isolated}`);
        await mkdir(isolated);

        const vscodeExecutablePath = await downloadVSCode();
        const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath).filter(each => !each.startsWith('--extensions-dir=') && !each.startsWith('--user-data-dir='));

        args.push(`--extensions-dir=${extensionsDir}`, `--user-data-dir=${userDir}`);

        // install the appropriate extensions
        // runVSCodeCommand([...args, '--install-extension', 'ms-vscode.cpptools'], options);
        // runVSCodeCommand([...args, '--install-extension', 'twxs.cmake'], options);
        // runVSCodeCommand([...args, '--install-extension', 'ms-vscode.cmake-tools'], options);
        const settingsJson = await readJson(settings, {});
        if (!settingsJson["workbench.colorTheme"]) {
            settingsJson["workbench.colorTheme"] = "Tomorrow Night Blue";
        }

        settingsJson["git.openRepositoryInParentFolders"] = "never";
        await write(settings, JSON.stringify(settingsJson, null, 4));

        return {
            cli, args
        };

    } catch (err: unknown) {
        throw new Error(`Failed to install VS Code: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }

}

export async function reset() {
    verbose(`Removing VSCode test folder: ${isolated}`);
    await rimraf(isolated);
}
