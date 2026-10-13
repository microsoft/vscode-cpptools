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
                const singleQuoted: boolean = (value.length > 1) && (value.charAt(0) === "'") && (value.charAt(value.length - 1) === "'");

                value = value.replace(/(^['"]|['"]$)/g, "");

                // Resolve ${VAR} references against the variables defined so far in the file,
                // then the process environment. A single-quoted value and a reference written
                // with a backslash both stay literal; the backslash itself is dropped, so
                // \${VAR} ends up as the text ${VAR}. A name we don't know is left as-is
                // instead of being dropped.
                if (!singleQuoted) {
                    value = value.replace(/(\\)?\$\{([\w\.\-]+)\}/g, (full: string, escape: string | undefined, name: string): string => {
                        if (escape) {
                            return full.substring(1);
                        }
                        if (env.has(name)) {
                            return env.get(name);
                        }
                        const processValue: string | undefined = process.env[name];
                        return processValue !== undefined ? processValue : full;
                    });
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
}
