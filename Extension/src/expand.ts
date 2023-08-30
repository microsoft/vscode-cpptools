/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable no-cond-assign */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { isString, replaceAll } from './common';
import { getOutputChannelLogger } from './logger';

/**
 * Support ExpansionVars (${var}), env (${env:var}), and optionally VS CODE commands (${command:commandID}).
 * Supported format follows https://code.visualstudio.com/docs/editor/variables-reference
 * Expand options and functions are mofidifed from https://github.com/microsoft/vscode-cmake-tools/blob/main/src/expand.ts
 */

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface ExpansionVars {
    [key: string]: string;
    workspaceFolder: string;
    workspaceFolderBasename: string;
}

export interface ExpansionOptions {
    vars: ExpansionVars;
    doNotSupportCommands?: boolean;
    recursive?: boolean;
}

export async function expandAllStrings(obj: any, options: ExpansionOptions): Promise<void> {
    if (Array.isArray(obj) || (obj !== null && typeof obj === 'object')) {
        for (const key of Object.keys(obj)) {
            if (isString(obj[key])) {
                obj[key] = await expandString(obj[key], options);
            } else {
                await expandAllStrings(obj[key], options);
            }
        }
    }
}

export async function expandString(input: string, options: ExpansionOptions): Promise<string> {
    const MAX_RECURSION: number = 10;
    let result: string = input;
    let didReplacement: boolean = false;

    let i: number = 0;
    do {
        // TODO: consider a full circular reference check?
        [result, didReplacement] = await expandStringImpl(result, options);
        i++;
    } while (i < MAX_RECURSION && options.recursive && didReplacement);

    if (i === MAX_RECURSION && didReplacement) {
        void getOutputChannelLogger().showErrorMessage(localize('max.recursion.reached', 'Reached max string expansion recursion. Possible circular reference.'));
    }

    return replaceAll(result, '${dollar}', '$');
}

/** Returns [expandedString, didReplacement] */
async function expandStringImpl(input: string, options: ExpansionOptions): Promise<[string, boolean]> {
    if (!input) {
        return [input, false];
    }

    // We accumulate a list of substitutions that we need to make, preventing
    // recursively expanding or looping forever on bad replacements
    const subs: Map<string, string> = new Map<string, string>();

    const var_re: RegExp = /\$\{(\w+)\}/g;
    let match: RegExpMatchArray | null = null;
    while (match = var_re.exec(input)) {
        const full: string = match[0];
        const key: string = match[1];
        if (key !== 'dollar') {
            // Replace dollar sign at the very end of the expanding process
            const repl: string = options.vars[key];
            if (!repl) {
                void getOutputChannelLogger().showWarningMessage(localize('invalid.var.reference', 'Invalid variable reference {0} in string: {1}.', full, input));
            } else {
                subs.set(full, repl);
            }
        }
    }

    // Regular expression for variable value (between the variable suffix and the next ending curly bracket):
    // .+? matches any character (except line terminators) between one and unlimited times,
    // as few times as possible, expanding as needed (lazy)
    const varValueRegexp: string = ".+?";
    const env_re: RegExp = RegExp(`\\$\\{env:(${varValueRegexp})\\}`, "g");
    while (match = env_re.exec(input)) {
        const full: string = match[0];
        const varname: string = match[1];
        if (process.env[varname] === undefined) {
            void getOutputChannelLogger().showWarningMessage(localize('env.var.not.found', 'Environment variable {0} not found', varname));
        }
        const repl: string = process.env[varname] || '';
        subs.set(full, repl);
    }

    const command_re: RegExp = RegExp(`\\$\\{command:(${varValueRegexp})\\}`, "g");
    while (match = command_re.exec(input)) {
        if (options.doNotSupportCommands) {
            void getOutputChannelLogger().showWarningMessage(localize('commands.not.supported', 'Commands are not supported for string: {0}.', input));
            break;
        }
        const full: string = match[0];
        const command: string = match[1];
        if (subs.has(full)) {
            continue; // Don't execute commands more than once per string
        }
        try {
            const command_ret: unknown = await vscode.commands.executeCommand(command, options.vars.workspaceFolder);
            subs.set(full, `${command_ret}`);
        } catch (e: any) {
            void getOutputChannelLogger().showWarningMessage(localize('exception.executing.command', 'Exception while executing command {0} for string: {1} {2}.', command, input, e));
        }
    }

    let result: string = input;
    let didReplacement: boolean = false;
    subs.forEach((value, key) => {
        if (value !== key) {
            result = replaceAll(result, key, value);
            didReplacement = true;
        }
    });

    return [result, didReplacement];
}
