/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { spawnSync } from 'child_process';
import { OperatingSystem } from '../../constants';
import { resolveEnvironmentVariables } from '../System/environment';

function windows(argsString: string): string[] {
    argsString = resolveEnvironmentVariables(argsString);
    const result: string[] = [];
    let currentArg: string = "";
    let isInQuote: boolean = false;
    let wasInQuote: boolean = false;
    let i: number = 0;
    while (i < argsString.length) {
        let c: string = argsString[i];
        if (c === '\"') {
            if (!isInQuote) {
                isInQuote = true;
                wasInQuote = true;
                ++i;
                continue;
            }
            // Need to peek at next character.
            if (++i === argsString.length) {
                break;
            }
            c = argsString[i];
            if (c !== '\"') {
                isInQuote = false;
            }
            // Fall through. If c was a quote character, it will be added as a literal.
        }
        if (c === '\\') {
            let backslashCount: number = 1;
            let reachedEnd: boolean = true;
            while (++i !== argsString.length) {
                c = argsString[i];
                if (c !== '\\') {
                    reachedEnd = false;
                    break;
                }
                ++backslashCount;
            }
            const still_escaping: boolean = (backslashCount % 2) !== 0;
            if (!reachedEnd && c === '\"') {
                backslashCount = Math.floor(backslashCount / 2);
            }
            while (backslashCount--) {
                currentArg += '\\';
            }
            if (reachedEnd) {
                break;
            }
            // If not still escaping and a quote was found, it needs to be handled above.
            if (!still_escaping && c === '\"') {
                continue;
            }
            // Otherwise, fall through to handle c as a literal.
        }
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
            if (!isInQuote) {
                if (currentArg !== "" || wasInQuote) {
                    wasInQuote = false;
                    result.push(currentArg);
                    currentArg = "";
                }
                i++;
                continue;
            }
        }
        currentArg += c;
        i++;
    }
    if (currentArg !== "" || wasInQuote) {
        result.push(currentArg);
    }
    return result;
}

function posix(argsString: string): string[] {
    // inspired by https://github.com/migueldeicaza/mono-wasm-libc/blob/96eaa7afc23cd675358595e1dd6ab4b6c8f9f07f/src/misc/wordexp.c#L32
    let doubleQuote = false;
    let singleQuote = false;
    let paren = 0;
    let brace = 0;

    let arg = '';
    let args = ['printf', `%s\\\\n`];

    for (let i = 0; i < argsString.length; ++i) {
        const char = argsString[i];
        const next = argsString[i + 1];

        switch (char) {

            case '\\':
                if (!singleQuote) {
                    if (next === '\\') {
                        arg += '\\\\\\\\';
                        ++i;
                        continue;
                    }
                    arg += `\\${next}`;
                    ++i;
                    continue;
                }
                break;

            case '\'':
                if (!doubleQuote) {
                    singleQuote = !singleQuote;
                }
                arg += "'";
                continue;

            case '"':
                if (!singleQuote) {
                    doubleQuote = !doubleQuote;
                }
                arg += '"';
                continue;
            case '(':
                if (!singleQuote && !doubleQuote) {
                    ++paren;
                }
                break;
            case ')':
                if (!singleQuote && !doubleQuote) {
                    --paren;
                }
                break;

            case '}':
                if (!singleQuote && !doubleQuote && !brace) {
                    throw new Error(`Unsupported character: ${char}`);
                }
                brace--;
                break;

            case '\n':
            case '|':
            case '&':
            case ';':
            case '<':
            case '>':
            case '{':

                if (!singleQuote && !doubleQuote) {
                    throw new Error(`Unsupported character: ${char}`);
                }
                break;
            case '$':
                if (!singleQuote) {
                    if (next === '(') {
                        if (argsString[i + 2] === '(') {
                            paren += 2;
                            i += 2;
                            arg += '$((';
                            continue;
                        }
                        throw new Error(`Nested Commands not supported`);
                    }
                    if (next === '{') {
                        arg += '${';
                        brace++;
                        i++;
                        continue;
                    }
                }
                break;
            case '`':
                if (!singleQuote) {
                    throw new Error(`Nested Commands not supported`);
                }
                break;
            case ' ':
            case '\t':
                if (doubleQuote || singleQuote || paren || brace) {
                    break;
                }
                if (arg.length > 0) {
                    args.push(arg);
                    arg = '';
                }
                continue;
        }
        arg += char;
    }
    if (arg.length > 0) {
        args.push(arg);
    }

    args = args.map(s => {
        if (s.startsWith(`'`) && s.endsWith(`'`)) {
            return `"${s}"`;
        }
        if (s.startsWith('$[') && s.endsWith(']')) {
            return `${s}`;
        }
        return `'${s}'`;
    });

    if (paren !== 0) {
        throw new Error(`Unbalanced parenthesis`);
    }
    if (singleQuote || doubleQuote) {
        throw new Error(`Unbalanced quotes`);
    }
    if (brace) {
        throw new Error(`Unbalanced braces`);
    }

    const r = spawnSync(`eval`, args, {shell: process.env['SHELL'] || true});
    if (r.error || r.status !== 0) {
        throw new Error('Failed to parse command line');
    }
    const txt = r.stdout.toString();

    const result = txt.split('\n');

    result.length--;
    return result;
}

/** parses a command line out of a string and produces an array of strings
 *
 * handles quotes, escapes, and environment variables
*/
export function extractArgs(argsString: string): string[] {
    argsString = argsString.trim();
    switch (OperatingSystem) {
        case 'win32':
            return windows(argsString);
        case 'linux':
        case 'darwin':
        case 'freebsd':
        case 'openbsd':
            return posix(argsString);
    }

    throw new Error(`Unsupported OS: ${OperatingSystem}`);
}
