/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { fail, ok } from 'assert';
import { isAbsolute as isAbsolutePath } from 'path';
import { path } from '../Filesystem/path';

// eslint-disable-next-line @typescript-eslint/naming-convention
export class asserts {
    static async isFile(fileName: string | undefined | Promise<string | undefined>): Promise<string> {
        return (await path.isFile(fileName)) || fail(new Error(`File ${fileName} is not a file`));
    }

    static async isExecutable(filename: string | undefined | Promise<string | undefined>): Promise<string> {
        const { fullPath, isFile, isExecutable } = (await path.info(filename)) || fail(new Error(`Path ${filename} does not exist`));
        ok(isFile, new Error(`Path ${filename} is not a file`));
        ok(isExecutable, new Error(`File ${filename} is not executable`));
        return fullPath;
    }

    static isAbsolute(path: string) {
        ok(isAbsolutePath(path), `Path ${path} is not an absolute path`);
    }
}
