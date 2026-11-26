/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as fs from 'fs';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export interface Environment {
    name: string;
    value: string;
}

export class ParsedEnvironmentFile {
    public Env: Environment[];
    public Warning?: string;

    private constructor(env: Environment[], warning?: string) {
        this.Env = env;
        this.Warning = warning;
    }

    public static CreateFromFile(envFile: string, initialEnv?: Environment[]): ParsedEnvironmentFile {
        const content: string = fs.readFileSync(envFile, "utf8");
        return this.CreateFromContent(content, envFile, initialEnv);
    }

    public static CreateFromContent(content: string, envFile: string, initialEnv?: Environment[]): ParsedEnvironmentFile {

        // Remove UTF-8 BOM if present
        if (content.charAt(0) === '\uFEFF') {
            content = content.substring(1);
        }

        const parseErrors: string[] = [];
        const env: Map<string, any> = new Map();

        if (initialEnv) {
            // Convert array to map to prevent duplicate keys being created.
            // If a duplicate key is found, replace it.
            initialEnv.forEach((e) => {
                env.set(e.name, e.value);
            });
        }

        content.split("\n").forEach(line => {
            // Split the line between key and value
            const r: RegExpMatchArray | null = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);

            if (r) {
                const key: string = r[1];
                let value: string = r[2] ?? "";
                if ((value.length > 0) && (value.charAt(0) === '"') && (value.charAt(value.length - 1) === '"')) {
                    value = value.replace(/\\n/gm, "\n");
                }

                // A single-quoted value is literal, so a reference inside it must not be
                // expanded. The quotes come off on the next line, so this has to be read here.
                // Whitespace outside the closing quote is not part of the value, and leaving it
                // in hid the quote from the check below.
                const trimmed: string = value.replace(/\s+$/, "");
                const singleQuoted: boolean = (trimmed.length > 1) && (trimmed.charAt(0) === "'") && (trimmed.charAt(trimmed.length - 1) === "'");
                if (singleQuoted) {
                    value = trimmed;
                }

                value = value.replace(/(^['"]|['"]$)/g, "");

                // Resolve ${VAR} references against the variables defined so far in the file,
                // then the process environment. A name we don't know is left as-is rather than
                // dropped, so ${workspaceFolder} and the other launch variables still resolve
                // from the debug configuration.
                //
                // A reference that has to stay literal is written back as ${dollar}{VAR}. This
                // parser's output goes on to expandAllStrings (configurationProvider.expand),
                // which substitutes every remaining ${...} it knows and warns about the rest, so
                // a bare ${VAR} would be replaced or reported instead of reaching the debuggee.
                // ${dollar} is the one form that expansion leaves alone and collapses to a plain
                // $ once it is done, which is what makes the literal survive the trip.
                //
                // The dotenv-style names are not the only ones that expansion touches: it also
                // rewrites ${env:...} and runs ${command:...}, both matched on anything up to the
                // closing brace. So the protection cannot be limited to [\w\.\-]+ -- every ${ in
                // a single-quoted value, and every escaped ${ anywhere, is written back, whatever
                // follows it. Unescaped dotenv-style names are the only ones resolved here; an
                // unescaped ${env:...} is left for the launch expansion, as before.
                if (singleQuoted) {
                    value = value.replace(/\$\{/g, `\${dollar}{`);
                } else {
                    value = ParsedEnvironmentFile.resolveReferences(value, (name: string) => ParsedEnvironmentFile.lookup(name, env));
                }

                env.set(key, value);
            } else {
                // Blank lines and lines starting with # are no parse errors
                const comments: RegExp = new RegExp(/^\s*(#|$)/);
                if (!comments.test(line)) {
                    parseErrors.push(line);
                }
            }
        });

        // show error message if single lines cannot get parsed
        let warning: string | undefined;
        if (parseErrors.length !== 0) {
            warning = localize("ignoring.lines.in.envfile", "Ignoring non-parsable lines in {0} {1}: ", "envFile", envFile);
            parseErrors.forEach(function (value, idx, array): void {
                warning += "\"" + value + "\"" + ((idx !== array.length - 1) ? ", " : ".");
            });
        }

        // Convert env map back to array.
        const arrayEnv: Environment[] = [];
        for (const key of env.keys()) {
            arrayEnv.push({name: key, value: env.get(key)});
        }

        return new ParsedEnvironmentFile(arrayEnv, warning);
    }

    /**
     * Resolve the references the file can actually answer, and leave the others untouched so
     * the launch expansion still sees them.
     */
    private static resolveReferences(value: string, known: (name: string) => string | undefined): string {
        // A backslash in front of a reference escapes it, except inside a Windows path, where it
        // separates segments instead. Only a drive letter or a UNC prefix makes the value a path:
        // in ordinary text \${ is an escape, on any platform.
        const windowsPath: boolean = /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
        let result: string = "";
        let i: number = 0;
        while (i < value.length) {
            const char: string = value.charAt(i);

            // An escaped reference is literal. ${dollar} is the form the launch expansion leaves
            // alone and collapses back to a plain $ once it is done, so the debuggee is the only
            // place that sees the literal. The whole opener has to be there: \$USER} is not a
            // reference and must not be rewritten.
            if (char === "\\" && value.charAt(i + 1) === "$" && value.charAt(i + 2) === "{" && !windowsPath) {
                const end: number = value.indexOf("}", i + 3);
                if (end !== -1) {
                    result += `\${dollar}{${value.substring(i + 3, end)}}`;
                    i = end + 1;
                    continue;
                }
            }

            if (char === "$" && value.charAt(i + 1) === "{") {
                const end: number = value.indexOf("}", i + 2);
                if (end !== -1) {
                    const name: string = value.substring(i + 2, end);
                    const resolved: string | undefined = /^[\w\.\-]+$/.test(name) ? known(name) : undefined;
                    result += resolved !== undefined ? resolved : value.substring(i, end + 1);
                    i = end + 1;
                    continue;
                }
            }

            result += char;
            i += 1;
        }

        return result;
    }

    /**
     * Environment variable names are case-insensitive on Windows, and the launch configuration
     * may have spelled the name differently than the reference does, so Path and PATH have to
     * find each other there.
     */
    private static lookup(name: string, env: Map<string, any>): string | undefined {
        if (env.has(name)) {
            return env.get(name);
        }

        if (process.platform === "win32") {
            const folded: string = name.toLowerCase();
            for (const key of env.keys()) {
                if (key.toLowerCase() === folded) {
                    return env.get(key);
                }
            }
            for (const key of Object.keys(process.env)) {
                if (key.toLowerCase() === folded) {
                    return process.env[key];
                }
            }
            return undefined;
        }

        return process.env[name];
    }
}
