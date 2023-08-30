/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as os from 'os';
import { homedir } from 'os';
import { basename, delimiter, sep } from 'path';
import { Cache } from '../../Utility/System/cache';
import { readKey } from '../../Utility/System/registry';
import { CustomResolver } from '../../Utility/Text/taggedLiteral';
import { DefinitionFile, IntelliSenseConfiguration } from '../interfaces';

export function createResolver(definition: DefinitionFile, compilerPath: string = ''): CustomResolver {
    // cache values/registry reads for the duration of the resolver.
    // (that is, scoped to the current definition)
    // this will drastically speed up resolution if an expensive variable is used repeatedly.
    const valueCache = new Cache<any>();

    // the resolver function
    return async (prefix: string, expression: string): Promise<string> => {
        const cacheKey = `${prefix}:${expression}`;
        const cached = valueCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        function cache(value: any) {
            return valueCache.set(cacheKey, value);
        }

        switch (prefix) {
            case 'env':
                // make sure ${env:HOME} is expanded to the user's home directory always
                if (expression.toLowerCase() === 'home') {
                    return cache(homedir());
                }
                return cache(process.env[expression] || '');

            case 'definition':
                return cache((definition as any)[expression] || '');

            case 'HKLM':
            case 'HKCU':
                const [path, value] = expression.split(';');
                return cache((await readKey(prefix, path))?.properties[value]?.toString() || '');

            case 'host':
                switch (expression) {
                    case 'os':
                    case 'platform':
                        return cache(os.platform());

                    case 'arch':
                    case 'architecture':
                        return cache(os.arch());
                }
                break;

            case 'compilerPath':
                switch (expression) {
                    case 'basename':
                        return cache(process.platform === 'win32' ? basename(compilerPath, '.exe') : basename(compilerPath));
                }
                break;

            case '':
                switch (expression) {
                    case 'cwd':
                        return cache(process.cwd()); // fake, this should come from the host.

                    case 'pathSeparator':
                        return sep;

                    case 'pathDelimiter':
                        return delimiter;

                    case 'name':
                        return definition.name;

                    case 'binary':
                    case 'compilerPath':
                        return compilerPath;

                    default:
                        // if the request was looking for a value in the intellisense configuration, we'll try to resolve that
                        if (definition.intellisense && expression in definition.intellisense) {
                            return cache((definition.intellisense as any)[expression as keyof IntelliSenseConfiguration]);
                        }
                }
                break;

            default:
                return '';
        }

        return '';
    };
}
